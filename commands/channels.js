const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const bitfieldCalculator = require('discord-bitfield-calculator');

module.exports = {
  name: "channels",
  description: "View and manage channels the bot may be used in",
  usage: "[opt]",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "view",
      description: "View allowed channels",
      value: "view",
      type: CommandOptions.SubCommand,
    },
    {
      name: "set",
      description: "Add a channel to allowed channels list",
      value: "set",
      type: CommandOptions.SubCommand,
      options: [{
        name: "channel",
        description: "Channel to add to allowed channles",
        value: "channel",
        type: CommandOptions.Channel,
        required: true,
      }]
    },
    {
      name: "remove",
      description: "Remove channel from allowed channels",
      value: "remove",
      type: CommandOptions.SubCommand,
      options: [{
        name: "channel",
        description: "Channel to remove from allowed channles",
        value: "channel",
        type: CommandOptions.Channel,
        required: true,
      }]
    },
    {
      name: "reset",
      description: "Reset allowed channels",
      value: "reset",
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
      if (args[0].name == "view") {
        const guild = await client.dbo.collection("prefixes").findOne({"server.serverID":interaction.guild.id}).then(guild => guild);
        if (!GuildDB.customChannelStatus)
          return interaction.send({ content: 'There are no channels set for the bot.' });

        let channels = ``;
        for (let i = 0; i < guild.server.allowedChannels.length; i++) {
          if (!client.exists(guild.server.allowedChannels[i])) continue;
          else channels += `\n<#${guild.server.allowedChannels[i]}>`;
        }

        let channelsEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setDescription('**Allowed Channels to use the Bot**')
          .addFields(
            { name: `There are currently ${guild.server.allowedChannels.length} allowed channels.`, value: `Channels:${channels}`, inline: true },
          )
          .setFooter({ text: 'LPS Website Support', iconURL: client.config.IconURL, proxyIconURL: 'https://discord.gg/jgUW656v2t' })
        
        return interaction.send({ embeds: [channelsEmbed] });
      }


      // These sub-commands require elevated permissions
      const permissions = bitfieldCalculator.permissions(interaction.member.permissions);
      if (!permissions.includes("MANAGE_GUILD")) return interaction.send({ content: 'You don\'t have the permissions to use this command.' });

      if (args[0].name == "set") {
        let channelid = args[0].options[0].value;
        let channel = client.channels.cache.get(channelid);
        if (!channel) return interaction.send({ content: `Cannot find that channel.` });
        if (channel.type == "voice") return interaction.send({ content: `Connot set voice channel to preferred channel.` });
        if (channel.deleted) return interaction.send({ content: `Connot set deleted channel to preferred channel.` });

        const guild = await client.dbo.collection("prefixes").findOne({"server.serverID":interaction.guild.id}).then(guild => guild);
        if (client.exists(guild.server.allowedChannels)&&guild.server.allowedChannels.includes(channelid)) return interaction.send({ content: `The channel <#${channelid}> has already been added.` });
        client.dbo.collection("prefixes").updateOne({ "server.serverID": interaction.guild.id }, {
          $push: {
            "server.allowedChannels": channelid
          },
          $set: {
            "server.hasCustomChannels": true
          }
        }, (err, _) => {
          if (err) throw err;
          return interaction.send({ content: `Successfully added <#${channelid}> to allowed channels.` });
        });

      } else if (args[0].name == "remove") {
        let channelid = args[0].options[0].value;
        let channel = client.channels.cache.get(channelid);
        if (!channel) return interaction.send({ content: `Uh Oh! The channel <#${channelid}> connot be found.` });
        
        const guild = await client.dbo.collection("prefixes").findOne({"server.serverID":interaction.guild.id}).then(guild => guild);
        if (guild.server.hasCustomChannels==false) return interaction.send({ content: `There are no channels to be removed.` });
        if (!guild.server.allowedChannels.includes(channelid)) return interaction.send({ content: `The channel <#${channelid}> is not added to your channels.` });
        
        for (let i = 0; i < guild.server.allowedChannels.length; i++) {
          if (guild.server.allowedChannels[i]==channelid) {
            if ((guild.server.allowedChannels.length-1)==0) {
              client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$pull:{"server.allowedChannels":channelid},$set:{"server.hasCustomChannels":false}},function(err, res) {
                if (err) throw err;
                return interaction.send({ content: `Successfully removed <#${channelid}> from allowed channels! There are no more allowed channels.` });
              });  
            } else if ((guild.server.allowedChannels.length-1)>0) {
              client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$pull:{"server.allowedChannels":channelid}},function(err, res) {
                if (err) throw err;
                return interaction.send({ content: `Successfully removed <#${channelid}> from allowed channels.` });
              });
            }
          }
        }

      } else if (args[0].name == "reset") {
        client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$set:{"server.allowedChannels": [], "server.hasCustomChannels": false}},function(err, res) {
          if (err) throw err;
          return interaction.send({ content: `Successfully reset all configured channels` });
        });
      }
    },
  },
}