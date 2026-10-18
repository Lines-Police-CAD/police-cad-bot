const { EmbedBuilder } = require('discord.js');
const { apiRequest } = require('../util/api');
const {
  formatMoney,
  formatDuration,
  getLpcUser,
  lookupCivilianName,
  getActiveSession,
  getLastClosedSession,
  closedShiftMessage,
} = require('../util/economy');

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
      if (!useCommand) return interaction.send({ content: await client.noPermissionMessage(GuildDB.serverID), flags: (1 << 6) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });

      const userId = user._id.toString();
      await interaction.defer();

      try {
        const active = await getActiveSession(client, userId);
        if (!active) {
          // A shift the server already closed (inactivity or max session)
          // reads as "no shift" otherwise, which looks like lost pay.
          const explained = closedShiftMessage(await getLastClosedSession(client, userId));
          return interaction.editOriginal({ content: explained || `You don't have an active shift to clock out of.` });
        }

        const result = await apiRequest(
          client,
          'POST',
          `/api/v2/economy/clock-out?userId=${encodeURIComponent(userId)}`,
          { sessionId: String(active._id) },
        );

        const sess = (result && result.session) || result;
        // The sweep can close the shift between the lookup and this call; the
        // API then returns the closed session as-is with nothing credited.
        const closedFirst = closedShiftMessage(sess);
        if (closedFirst) return interaction.editOriginal({ content: closedFirst });
        const credited = (result && typeof result.creditedAmount === 'number') ? result.creditedAmount : 0;
        const elapsed = sess && sess.startedAt ? Date.now() - new Date(sess.startedAt).getTime() : 0;
        const civName = (await lookupCivilianName(client, sess.civilianId)) || 'User-level shift';

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Clocked Out', iconURL: client.config.IconURL })
          .setTitle(sess.departmentName || 'Off Duty')
          .addFields(
            { name: '**Civilian**', value: `\`${civName}\``, inline: true },
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
