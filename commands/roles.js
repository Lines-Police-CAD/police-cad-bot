const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { PermissionsBitField } = require("discord.js");

module.exports = {
  name: "roles",
  description: "Manage allowed roles",
  usage: "",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "view",
      description: "View allowed roles",
      value: "view",
      type: CommandOptions.SubCommand,
    },
    {
      name: "set",
      description: "Set an allowed role",
      value: "set",
      type: CommandOptions.SubCommand,
      options: [{
        name: "role",
        description: "Role to add to allowed roles",
        value: "role",
        type: CommandOptions.Role,
        required: true,
      }]
    },
    {
      name: "remove",
      description: "Remove role from allowed roles",
      value: "remove",
      type: CommandOptions.SubCommand,
      options: [{
        name: "role",
        description: "Role to remove from allowed roles",
        value: "role",
        type: CommandOptions.Role,
        required: true,
      }]
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
        if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id)) {
          return interaction.send({ content: `You are not allowed to use the bot in this channel.` });
        }

        let guild = await client.dbo.collection("prefixes").findOne({"server.serverID":interaction.guild.id}).then(guild => guild);
        if (!client.exists(guild.server.hasCustomRoles) || !guild.server.hasCustomRoles) {
          return interaction.send({ content: 'There are no roles set for the bot.' });
        }

        // Resolve role names, skipping any that were deleted from the server.
        // A deleted role used to crash this command (role.name on undefined),
        // which left admins unable to even see what was locking the bot.
        let resolvedNames = [];
        for (let i = 0; i < guild.server.allowedRoles.length; i++) {
          if (guild.server.allowedRoles[i] == undefined) continue;
          let role = interaction.guild.roles.cache.find(r => r.id == guild.server.allowedRoles[i]);
          if (role) resolvedNames.push(`@${role.name}`);
        }

        if (resolvedNames.length == 0) {
          return interaction.send({ content: 'The allowed roles for the bot no longer exist (they were deleted). The restriction will clear automatically the next time a command is run, or you can run `/roles remove` to clear it now.' });
        }

        let roles = resolvedNames.join('\n');
        let rolesEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setDescription('|**Allowed Roles to use the Bot**')
          .addFields(
            { name: `There are currently **${resolvedNames.length}** allowed roles.`, value: `\`${roles}\``, inline: true },
          )
          .setFooter({ text: 'LPS Website Support', iconURL: client.config.IconURL, proxyIconURL: 'https://discord.gg/jgUW656v2t' })
        return interaction.send({ embeds: [rolesEmbed] });

      }


      // These sub-commands require elevated permissions
      const permissions = new PermissionsBitField(interaction.member.permissions).toArray();
      if (!permissions.includes("ManageGuild")) return interaction.send({ content: 'You don\'t have the permissions to use this command.' });

      if (args[0].name == "set") {
        let roleid = args[0].options[0].value;
        let role = interaction.guild.roles.cache.find(x => x.id == roleid);
        if (role == undefined) {
          return interaction.send({ content: `Uh Oh! The role <@&${roleid}> connot be found.` });
        } else {
          const guild = await client.dbo.collection("prefixes").findOne({"server.serverID":interaction.guild.id}).then(guild => guild);
          if (client.exists(guild.server.allowedRoles)&&guild.server.allowedRoles.includes(roleid)) return interaction.send({ content: `The role <@&${roleid}> has already been added.` });
          client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$push:{"server.allowedRoles":roleid},$set:{"server.hasCustomRoles":true}},function(err, res) {
            if (err) throw err;
            return interaction.send({ content: `Successfully added <@&${roleid}> to allowed roles.` });
          });
        }

      } else if (args[0].name == "remove") {
        let roleid = args[0].options[0].value;
        let role = interaction.guild.roles.cache.find(x => x.id == roleid);
        if (role == undefined) return interaction.send({ content: `Uh Oh! The role <@&${roleid}> connot be found.` });

        const guild = await client.dbo.collection("prefixes").findOne({"server.serverID":interaction.guild.id}).then(guild => guild);
        if (!client.exists(guild.server.hasCustomRoles) || !guild.server.hasCustomRoles) return interaction.send({ content: `There are no roles to be removed.` });
        if (!guild.server.allowedRoles.includes(roleid)) return interaction.send({ content: `The role <@&${roleid}> is not added to your roles.` });

        for (let i = 0; i < guild.server.allowedRoles.length; i++) {
          if (guild.server.allowedRoles[i]==roleid) {
            if ((guild.server.allowedRoles.length-1)==0) {
              client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$pull:{"server.allowedRoles":roleid},$set:{"server.hasCustomRoles":false}},function(err, res) {
                if (err) throw err;
                return interaction.send({ content: `Successfully removed <@&${roleid}> from allowed roles! There are no more allowed roles.` });
              });
            } else if ((guild.server.allowedRoles.length-1)>0) {
              client.dbo.collection("prefixes").updateOne({"server.serverID":interaction.guild.id},{$pull:{"server.allowedRoles":roleid}},function(err, res) {
                if (err) throw err;
                return interaction.send({ content: `Successfully removed <@&${roleid}> from allowed roles.` });
              });
            }
          }
        }
      }
    },
  },
}
