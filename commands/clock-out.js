const { EmbedBuilder } = require('discord.js');
const { apiRequest } = require('../util/api');
const { formatMoney, formatDuration, getLpcUser } = require('../util/economy');

module.exports = {
  name: "clock-out",
  description: "End your active shift",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [],
  SlashCommand: {
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.`, flags: (1 << 6) });

      const useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: "You don't have permission to use this command", flags: (1 << 6) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });

      const userId = user._id.toString();
      await interaction.defer();

      try {
        const active = await apiRequest(
          client,
          'GET',
          `/api/v2/economy/session/active?userId=${encodeURIComponent(userId)}`,
        );
        if (!active || !active._id) {
          return interaction.editOriginal({ content: `You don't have an active user-level shift. If you clocked in as a civilian, end it from the website or app.` });
        }

        const result = await apiRequest(
          client,
          'POST',
          `/api/v2/economy/clock-out?userId=${encodeURIComponent(userId)}`,
          { sessionId: String(active._id) },
        );

        const sess = (result && result.session) || result;
        const credited = (result && typeof result.creditedAmount === 'number') ? result.creditedAmount : 0;
        const elapsed = sess && sess.startedAt ? Date.now() - new Date(sess.startedAt).getTime() : 0;

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Clocked Out', iconURL: client.config.IconURL })
          .setTitle(sess.departmentName || 'Off Duty')
          .addFields(
            { name: '**Earned**', value: `\`${formatMoney(credited)}\``, inline: true },
            { name: '**Shift Length**', value: `\`${formatDuration(elapsed)}\``, inline: true },
          );

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        client.error(`/clock-out error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to clock out. Please try again.` });
      }
    },
  },
};
