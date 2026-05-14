const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const {
  formatMoney,
  formatDueDate,
  getLpcUser,
  findOption,
  getFocusedOption,
  fetchInboxChoices,
  civilianAutocomplete,
  resolveCivilianId,
  lookupCivilianName,
} = require('../util/economy');

module.exports = {
  name: "contest-fine",
  description: "Contest a pending fine; extends its due date until a judge rules",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "fine",
      description: "The fine to contest",
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "reason",
      description: "Why you're contesting this fine",
      type: CommandOptions.String,
      required: true,
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
          client.error(`/contest-fine civilian autocomplete: ${err.message}`);
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
            ['pending', 'delinquent'],
          );
          return interaction.respond(choices);
        } catch (err) {
          client.error(`/contest-fine fine autocomplete: ${err.message}`);
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
      const reason = ((findOption(args, 'reason') || {}).value || '').trim();
      if (!fineId) return interaction.send({ content: `Please pick a fine to contest.`, flags: (1 << 6) });
      if (!reason) return interaction.send({ content: `Please provide a reason.`, flags: (1 << 6) });

      await interaction.defer();

      try {
        const item = await apiRequest(
          client,
          'POST',
          `/api/v2/economy/inbox/${encodeURIComponent(fineId)}/contest?userId=${encodeURIComponent(userId)}`,
          { reason },
        );

        const civName = (await lookupCivilianName(client, item.civilianId)) || 'Unknown';
        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Fine Contested', iconURL: client.config.IconURL })
          .setTitle(item.title || item.type || 'Contested')
          .addFields(
            { name: '**Civilian**', value: `\`${civName}\``, inline: true },
            { name: '**Amount**', value: `\`${formatMoney(item.amount)}\``, inline: true },
            { name: '**New Due Date**', value: `\`${formatDueDate(item.dueAt)}\``, inline: true },
          );

        const chargeLines = (item.charges || [])
          .filter((c) => c && c.label && c.status !== 'dismissed')
          .map((c) => `• ${c.label} — ${formatMoney(c.amount)}`);
        if (chargeLines.length > 0) {
          embed.addFields({ name: '**Charges**', value: chargeLines.join('\n').slice(0, 1024) });
        } else if (item.body) {
          embed.addFields({ name: '**Details**', value: String(item.body).slice(0, 1024) });
        }
        embed.addFields({ name: '**Reason**', value: `\`${reason.slice(0, 1000)}\`` });

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        client.error(`/contest-fine error: ${msg}`);
        if (msg.includes('(400)'))
          return interaction.editOriginal({ content: `Only pending fines can be contested, and not ones already ruled on.` });
        if (msg.includes('(404)'))
          return interaction.editOriginal({ content: `Fine not found.` });
        return interaction.editOriginal({ content: `Failed to contest fine. Please try again.` });
      }
    },
  },
};
