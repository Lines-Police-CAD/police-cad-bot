const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const bitfieldCalculator = require('discord-bitfield-calculator');

module.exports = {
  name: "ping-on-panic",
  description: "Get ping on panic status",
  usage: "",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "toggle",
      description: "Toggle ping on panic setting",
      value: "toggle",
      type: CommandOptions.SubCommand,
      options: [
        {
          name: "toggle",
          description: "Toggle ping on panic",
          value: "toggle",
          type: CommandOptions.Boolean,
          required: true,
        },
        {
          name: "role",
          description: "Role to ping on panic",
          value: "role",
          type: CommandOptions.Role,
          required: true,
        },
      ]
    },
    {
      name: "view",
      description: "View the current setting for ping on panic",
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

      if (args[0].name == "view") {
        if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id))
          return interaction.send({ content: `You are not allowed to use the bot in this channel.` });
      
        let guild = await client.dbo.collection("prefixes").findOne({ "server.serverID": interaction.guild.id }).then(guild => guild);
        return interaction.send({ content: `Current Ping on Panic Status: \` ${guild.server.pingOnPanic} \`` });  
      } else if (args[0].name == "toggle") {
        const permissions = bitfieldCalculator.permissions(interaction.member.permissions);
        if (!permissions.includes("MANAGE_GUILD")) return interaction.send({ content: 'You don\'t have the permissions to use this command.' });

        if (!args[0].options[0].value) {
          // disable ping on panic and remove ping role
          client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$set:{"server.pingOnPanic":false,"server.pingRole":null}},function(err, res) {
            if (err) throw err;
            return interaction.send({ content: `Successfully disabled ping role on panic.` });
          });
        } else if (args[0].value) {
          let roleid = args[1].value;
          let role = interaction.guild.roles.cache.find(x => x.id == roleid);
          if (role == undefined) {
            return interaction.send({ content: `Uh Oh! The role <@&${args[1].value}> connot be found.` });
          } else {
            client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$set:{"server.pingRole":roleid,"server.pingOnPanic":true}},function(err, res) {
              if (err) throw err;
              return interaction.send({ content: `Successfully set <@&${args[1].value}> to be pinged on panic.` });
            });
          }
        }
      }
    },
  },
}