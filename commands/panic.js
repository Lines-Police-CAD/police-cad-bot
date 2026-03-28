const { EmbedBuilder } = require('discord.js');
const io = require('socket.io-client');

module.exports = {
  name: "panic",
  description: "Enables users panic button",
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
      
      const user = await client.dbo.collection("users").findOne({"user.discord.id": interaction.member.user.id}).then(user => user);
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) return interaction.send({ content: `You must join a community to use this command.`, flags: (1 << 6) });


      // If panic is enabled, disable panic
      if (user.user.dispatchStatus == 'Signal 100' || user.user.dispatchStatus == 'Panic') {

        const socket = io.connect(client.config.socket);

        const req = {
          activeCommunity: user.user.lastAccessedCommunity.communityID,
          activatedByCallSign: "example",
        };

        socket.emit('clear_signal_100', req);

        let myUpdateReq = {
          userID: user._id,
          status: '10-8',
          setBy: 'Self',
          onDuty: true,
        };

        socket.emit('bot_update_status', myUpdateReq);
        socket.on('bot_updated_status', (res) => {
          if (res.userID == user._id) {
            interaction.send({ content: `Disabled Signal 100 and set status to \`10-8\`.`, flags: (1 << 6) });
            socket.disconnect();
          }
        });

        return;
      
      // If panic is disabled, enable panic
      } else {
        client.forceUpdateStatus('Signal 100', user);        
        if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) return interaction.send({ content: `You must join a community to use this command.`, flags: (1 << 6) });

        const socket = io.connect(client.config.socket);      
        
        const req = {
          activeCommunity: user.user.lastAccessedCommunity.communityID,
          activatedByCallSign: "example",
        };

        socket.emit('signal_100_button_update', req);

        socket.on('signal_100_button_updated', (res) => {
          if (res.activeCommunity === req.activeCommunity) {
            socket.disconnect();
          }
        });
      
        let guild = await client.dbo.collection("prefixes").findOne({"server.serverID": GuildDB.serverID}).then(guild => guild);
      
        if (guild.server.pingOnPanic) {
          const channel = client.channels.cache.get(interaction.channel_id);
          channel.send({ content: `Attention <@&${guild.server.pingRole}> \`${user.user.username}\` has activated Signal 100!` });
        }

        return interaction.send({ content: 'Successfully activated Signal 100', flags: (1 << 6) });
      }
    },
  },
}