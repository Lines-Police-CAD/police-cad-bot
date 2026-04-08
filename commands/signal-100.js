const { apiRequest } = require('../util/api');

module.exports = {
  name: "signal-100",
  description: "Toggle Signal 100 for your community",
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
      if (!useCommand) return interaction.send({ content: "You don't have permission to use this command", flags: (1 << 6) });

      const user = await client.dbo.collection("users").findOne({ "user.discord.id": interaction.member.user.id });
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) return interaction.send({ content: `You must join a community to use this command.`, flags: (1 << 6) });

      const communityId = user.user.lastAccessedCommunity.communityID;
      const userId = user._id.toString();

      // Defer the response since API calls may take a moment
      await interaction.defer();

      try {
        // Check current Signal 100 status
        const status = await apiRequest(client, 'GET', `/api/v1/community/${communityId}/signal-100`);

        if (status.active) {
          // Signal 100 is already active — clear it
          await apiRequest(client, 'DELETE', `/api/v1/community/${communityId}/signal-100`, {
            clearedByUserId: userId,
            clearedByUsername: user.user.username,
            clearedByCallSign: user.user.callSign || '',
          });

          return interaction.editOriginal({ content: `Signal 100 has been cleared.` });
        }

        // Activate Signal 100
        await apiRequest(client, 'POST', `/api/v1/community/${communityId}/signal-100`, {
          userId: userId,
          username: user.user.username,
          callSign: user.user.callSign || '',
          departmentName: '',
        });

        // Send ping notification if configured
        let guild = await client.dbo.collection("prefixes").findOne({ "server.serverID": GuildDB.serverID });
        if (guild && guild.server.pingOnPanic) {
          const channel = client.channels.cache.get(interaction.channel_id);
          if (channel) {
            channel.send({ content: `Attention <@&${guild.server.pingRole}> \`${user.user.username}\` has activated Signal 100!` });
          }
        }

        return interaction.editOriginal({ content: `Signal 100 activated.` });
      } catch (err) {
        client.error(`Signal 100 command error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to toggle Signal 100. Please try again.` });
      }
    },
  },
};
