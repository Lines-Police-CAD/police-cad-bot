const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const {
  formatMoney,
  getLpcUser,
  findOption,
  getFocusedOption,
  fetchInboxChoices,
  civilianAutocomplete,
  resolveCivilianId,
  lookupCivilianName,
} = require('../util/economy');

module.exports = {
  name: "pay-fine",
  description: "Pay a pending fine or fee from your balance",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "fine",
      description: "The fine to pay",
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "civilian",
      description: "Override your active civilian for this run",
      type: CommandOptions.String,
      required: false,
      autocomplete: true,
    },
  ],
  Autocomplete: {
    run: async (client, interaction) => {
      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user || !user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) {
        return interaction.respond([]);
      }
      const userId = user._id.toString();
      const communityId = user.user.lastAccessedCommunity.communityID;
      const focused = getFocusedOption(interaction.data.options);
      if (!focused) return interaction.respond([]);

      if (focused.name === 'civilian') {
        try {
          const choices = await civilianAutocomplete(client, userId, communityId, focused.value);
          return interaction.respond(choices);
        } catch (err) {
          client.error(`/pay-fine civilian autocomplete: ${err.message}`);
          return interaction.respond([]);
        }
      }
      if (focused.name === 'fine') {
        const explicitId = (findOption(interaction.data.options, 'civilian') || {}).value || '';
        const civilianId = await resolveCivilianId(client, userId, communityId, explicitId);
        if (!civilianId) return interaction.respond([]);
        try {
          const choices = await fetchInboxChoices(
            client,
            civilianId,
            communityId,
            focused.value,
            ['pending', 'delinquent', 'contested'],
          );
          return interaction.respond(choices);
        } catch (err) {
          client.error(`/pay-fine fine autocomplete: ${err.message}`);
          return interaction.respond([]);
        }
      }
      return interaction.respond([]);
    },
  },
  SlashCommand: {
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.`, flags: (1 << 6) });

      const useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: "You don't have permission to use this command", flags: (1 << 6) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });

      const userId = user._id.toString();
      const fineId = (findOption(args, 'fine') || {}).value;
      if (!fineId) return interaction.send({ content: `Please pick a fine to pay.`, flags: (1 << 6) });

      await interaction.defer();

      try {
        const item = await apiRequest(
          client,
          'POST',
          `/api/v2/economy/inbox/${encodeURIComponent(fineId)}/pay?userId=${encodeURIComponent(userId)}`,
        );

        const civName = (await lookupCivilianName(client, item.civilianId)) || 'Unknown';
        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Fine Paid', iconURL: client.config.IconURL })
          .setTitle(item.title || item.type || 'Paid')
          .addFields(
            { name: '**Civilian**', value: `\`${civName}\``, inline: true },
            { name: '**Amount**', value: `\`${formatMoney(item.amount)}\``, inline: true },
            { name: '**Status**', value: `\`${item.status || 'paid'}\``, inline: true },
          );

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        client.error(`/pay-fine error: ${msg}`);
        if (msg.includes('(402)'))
          return interaction.editOriginal({ content: `Insufficient balance to pay this fine.` });
        if (msg.includes('(403)'))
          return interaction.editOriginal({ content: `You can't pay this fine — it belongs to a different user.` });
        if (msg.includes('(404)'))
          return interaction.editOriginal({ content: `Fine not found.` });
        return interaction.editOriginal({ content: `Failed to pay fine. Please try again.` });
      }
    },
  },
};
