const { EmbedBuilder } = require('discord.js');
const io = require('socket.io-client');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const ObjectId = require('mongodb').ObjectId;

module.exports = {
  name: "community",
  description: "Manage your community",
  usage: "[opt]",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "join",
      description: "Join a community",
      value: "join",
      type: CommandOptions.SubCommand,
      options: [{
        name: "code",
        description: "Join community with community code",
        value: "code",
        type: CommandOptions.String,
        required: true,
      }],
    },
    {
      name: "leave",
      description: "Leave your active community",
      value: "leave",
      type: CommandOptions.SubCommand,
    },
    {
      name: "view",
      description: "Check your active community",
      value: "view",
      type: CommandOptions.SubCommand,
    }
  ],  
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").MessageCreate} message
     * @param {string[]} args
     * @param {*} param3
    */
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.` });

      const user = await client.dbo.collection("users").findOne({"user.discord.id":interaction.member.user.id}).then(user => user);
      if (!user) return interaction.send({ content: `You are not logged in.` });
      let req;
      
      if (args[0].name == "join") {
        req = {
          userID: user._id,
          communityCode: args[0].options[0].value
        };
        const socket = io.connect(client.config.socket);
        socket.emit('bot_join_community', req);
        socket.on('bot_joined_community', (data) => {
          socket.disconnect();
          if (data.error)
            return interaction.send({ content: `${data.error}` });
          
          return interaction.send({ content: `Successfully joined the community \` ${data.commName} \`` })
        });

      } else if (args[0].name == "leave") {
        req = {
          userID: user._id
        };
        const socket = io.connect(client.config.socket);
        socket.emit('bot_leave_community', req);
        socket.on('bot_left_community', (data) => {
          socket.disconnect();
          if (data.error)
            return interaction.send({ content: `${data.error}` });

          return interaction.send({ content: `${data.message}` });
        });

      } else if (args[0].name == "view") {
        if (user.user.activeCommunity == null)
          return interaction.send({ content: `You are not in a community.` });
        
        let community = await client.dbo.collection("communities").findOne({ _id: ObjectId(user.user.activeCommunity) }).then(community => community);
        if (!community)
          return interaction.send({ content: `Community not found.` });
        
        return interaction.send({ content: `You are in the community \`${community.community.name}\`` });

      }
    },
  },
}