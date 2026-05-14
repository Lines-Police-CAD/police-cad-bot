const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const { formatMoney, formatDueDate, getLpcUser, findOption, getFocusedOption, fetchInboxChoices } = require('../util/economy');

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
  ],
  Autocomplete: {
    run: async (client, interaction) => {
      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user || !user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) {
        return interaction.respond([]);
      }
      const focused = getFocusedOption(interaction.data.options);
      if (!focused || focused.name !== 'fine') return interaction.respond([]);
      const choices = await fetchInboxChoices(
        client,
        user._id.toString(),
        user.user.lastAccessedCommunity.communityID,
        focused.value,
        ['pending', 'delinquent'],
      );
      return interaction.respond(choices);
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

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Fine Contested', iconURL: client.config.IconURL })
          .setTitle(item.title || item.type || 'Contested')
          .addFields(
            { name: '**Amount**', value: `\`${formatMoney(item.amount)}\``, inline: true },
            { name: '**New Due Date**', value: `\`${formatDueDate(item.dueAt)}\``, inline: true },
            { name: '**Reason**', value: `\`${reason.slice(0, 1000)}\`` },
          );

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
