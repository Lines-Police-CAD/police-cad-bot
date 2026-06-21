const { apiRequest } = require('../util/api');

module.exports = {
  name: "panic",
  description: "Toggle your panic alert",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [],
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
     */
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.`, flags: (1 << 6) });

      let useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: await client.noPermissionMessage(GuildDB.serverID), flags: (1 << 6) });

      const user = await client.dbo.collection("users").findOne({ "user.discord.id": interaction.member.user.id });
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) return interaction.send({ content: `You must join a community to use this command.`, flags: (1 << 6) });

      const communityId = user.user.lastAccessedCommunity.communityID;
      const userId = user._id.toString();

      // Defer the response since API calls may take a moment
      await interaction.defer();

      try {
        // Check if user already has an active panic alert
        const alertsRes = await apiRequest(client, 'GET', `/api/v1/community/${communityId}/panic-alerts?status=active`);
        const myActiveAlert = (alertsRes.alerts || []).find(a => a.userId === userId || a.userID === userId);

        if (myActiveAlert) {
          // Clear the user's active panic alerts
          await apiRequest(client, 'DELETE', `/api/v1/community/${communityId}/panic-alerts/user/${userId}`, {
            clearedBy: userId,
          });

          return interaction.editOriginal({ content: `Panic alert cleared.` });
        }

        // Activate panic alert
        await apiRequest(client, 'POST', `/api/v1/community/${communityId}/panic-alerts`, {
          userId: userId,
          username: user.user.username,
          callSign: user.user.callSign || '',
          departmentType: 'police',
        });

        // Send ping notification if configured
        let guild = await client.dbo.collection("prefixes").findOne({ "server.serverID": GuildDB.serverID });
        if (guild && guild.server.pingOnPanic) {
          const channel = client.channels.cache.get(interaction.channel_id);
          if (channel) {
            channel.send({ content: `Attention <@&${guild.server.pingRole}> \`${user.user.username}\` has activated a panic alert!` });
          }
        }

        return interaction.editOriginal({ content: `Panic alert activated.` });
      } catch (err) {
        client.error(`Panic command error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to toggle panic alert. Please try again.` });
      }
    },
  },
};
