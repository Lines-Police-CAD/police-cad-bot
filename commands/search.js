const { EmbedBuilder } = require('discord.js');
const io = require('socket.io-client');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;

module.exports = {
  name: "search",
  description: "Search Names, Plates, and Firearms",
  usage: "[opt]",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "firearm",
      description: "Search firearm database",
      value: "firearm",
      type: CommandOptions.SubCommand,
      options: [{
        name: "serial_number",
        description: "Firearm serial number",
        value: "serial_number",
        type: CommandOptions.String,
        required: true,
      }],
    },
    {
      name: "plate",
      description: "Search license plate database",
      value: "plate",
      type: CommandOptions.SubCommand,
      options: [{
        name: "plate_number",
        description: "Vehicle license plate number",
        value: "plate_number",
        type: CommandOptions.String,
        required: true,
      }],
    },
    {
      name: "name",
      description: "Search name database",
      value: "name",
      type: CommandOptions.SubCommand,
      options: [{
        name: "firstname",
        description: "Civilian's First Name",
        value: "firstname",
        type: CommandOptions.String,
        required: true,
      },
      {
        name: "lastname",
        description: "Civilian's Last Name",
        value: "lastname",
        type: CommandOptions.String,
        required: true,
      },
      {
        name: "dob",
        description: "Civilian's DOB (yyyy-mm-dd)",
        value: "dob",
        type: CommandOptions.String,
        required: true,
      },],
    }
  ], 
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
    */
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id)) {
        return interaction.send({ content: `You are not allowed to use the bot in this channel.` });
      }
      
      let useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: "You don't have permission to use this command" });

      const user = await client.dbo.collection("users").findOne({"user.discord.id":interaction.member.user.id}).then(user => user);
      if (!user) return interaction.send({ content: `You are not logged in.` });
      let data;

      if (args[0].name == "firearm") {
        data = {
          user: user,
          query: {
            serialNumber: args[0].options[0].value,
            activeCommunityID: user.user.activeCommunity
          }
        }
        const socket = io.connect(client.config.socket);
        socket.emit('bot_firearm_search', data);
        socket.on('bot_firearm_search_results', results => {
          if (results.user._id==user._id) {
            if (results.firearms.length==0) {
              return interaction.send({ content: `No Firearms found <@${interaction.member.user.id}>` });
            }
  
            for (let i = 0; i < results.firearms.length; i++) {
              let firearmResult = new EmbedBuilder()
              .setColor('#0099ff')
              .setTitle(`**${results.firearms[i].firearm.serialNumber} | ${results.firearms[i]._id}**`)
              .setURL('https://discord.gg/jgUW656v2t')
              .setAuthor({ name: 'LPS Website Support', iconURL: client.config.IconURL, url: 'https://discord.gg/jgUW656v2t' })
              .setDescription('Firearm Search Results')
              .addFields(
                { name: `**Serial Number**`, value: `\`${results.firearms[i].firearm.serialNumber}\``, inline: true },
                { name: `**Type**`, value: `\`${results.firearms[i].firearm.weaponType}\``, inline: true },
                { name: `**Owner**`, value: `\`${results.firearms[i].firearm.registeredOwner}\``, inline: true },
              )
              // Other details
              let isStolen = results.firearms[i].firearm.isStolen;
              if (isStolen=="false"||isStolen==false) firearmResult.addFields({name:`**Stolen**`,value:'\`No\`',inline: true});
              if (isStolen=="true"||isStolen==true) firearmResult.addFields({name:`**Stolen**`,value:'\`Yes\`',inline: true});
              interaction.send({ embeds: [firearmResult] });
            }
          }
          socket.disconnect();
        });

      } else if (args[0].name == "plate") {
        data = {
          user: user,
          query: {
            plateNumber: args[0].options[0].value,
            activeCommunityID: user.user.activeCommunity
          }
        }
        const socket = io.connect(client.config.socket);
        socket.emit('bot_plate_search', data);
        socket.on('bot_plate_search_results', results => {
          
          if (results.user._id==user._id) {
            if (results.vehicles.length == 0) {
              return interaction.send({ content: `Plate Number \`${args[0].options[0].value}\` not found.` });
            }

            for (let i = 0; i < results.vehicles.length; i++) {
              let plateResult = new EmbedBuilder()
              .setColor('#0099ff')
              .setTitle(`**${results.vehicles[i].vehicle.plate} | ${results.vehicles[i]._id}**`)
              .setURL('https://discord.gg/jgUW656v2t')
              .setAuthor({ name: 'LPS Website Support', iconURL: client.config.IconURL, url: 'https://discord.gg/jgUW656v2t' })
              .setDescription('Plate Search Results')
              .addFields(
                { name: `**Plate #**`, value: `\`${results.vehicles[i].vehicle.plate}\``, inline: true },
                { name: `**Vin #**`, value: `\`${results.vehicles[i].vehicle.vin}\``, inline: true },
                { name: `**Model**`, value: `\`${results.vehicles[i].vehicle.model}\``, inline: true },
                { name: `**Color**`, value: `\`${results.vehicles[i].vehicle.color}\``, inline: true },
                { name: `**Owner**`, value: `\`${results.vehicles[i].vehicle.registeredOwner}\``, inline: true },
              )
              // Other details
              let validRegistration = results.vehicles[i].vehicle.validRegistration;
              let validInsurance = results.vehicles[i].vehicle.validInsurance;
              let stolen = results.vehicles[i].vehicle.isStolen;
              if (validRegistration=='1') plateResult.addFields({ name: `**Registration**`, value: `\`Valid\``, inline: true });
              if (validRegistration=='2') plateResult.addFields({ name: `**Registration**`, value: `\`InValid\``, inline: true });
              if (validInsurance=='1') plateResult.addFields({ name: `**Insurance**`, value: `\`Valid\``, inline: true });
              if (validInsurance=='2') plateResult.addFields({ name: `**Insurance**`, value: `\`InValid\``, inline: true });
              if (stolen=='1') plateResult.addFields({ name: `**Stolen**`, value: `\`No\``, inline: true });
              if (stolen=='2') plateResult.addFields({ name: `**Stolen**`, value: `\`Yes\``, inline: true });
              return interaction.send({ embeds: [plateResult] });
            }
          }
          socket.disconnect();
        });

      } else if (args[0].name == "name") {
        data = {
          user: user,
          query: {
            firstName: args[0].options[0].value,
            lastName: args[0].options[1].value,
            dateOfBirth: args[0].options[2].value,
            activeCommunityID: user.user.activeCommunity
          }
        }
  
        const socket = io.connect(client.config.socket);
        socket.emit("bot_name_search", data);
        socket.on("bot_name_search_results", results => {
  
          if (results.user._id==user._id) {
            if (results.civilians.length == 0) {
              return interaction.send({ content: `Name \`${args[0].options[0].value} ${args[0].options[1].value}\` not found.` });
            }
  
            for (let i = 0; i < results.civilians.length; i++) {
              // Get Drivers Licence Status
              let licenceStatus;
              if (results.civilians[i].civilian.licenseStatus == 1) licenceStatus = 'Valid';
              if (results.civilians[i].civilian.licenceStatus == 2) licenceStatus = 'Revoked';
              if (results.civilians[i].civilian.licenceStatus == 3) licenceStatus = 'None';
              // Get Firearm Licence Status
              let firearmLicence = results.civilians[i].civilian.firearmLicense;
              if (firearmLicence == undefined || firearmLicence == null) firearmLicence = 'None';
              if (firearmLicence == '2') firearmLicence = 'Valid';
              if (firearmLicence == '3') firearmLicence = 'Revoked';
              let nameResult = new EmbedBuilder()
              .setColor('#0099ff')
              .setTitle(`**${results.civilians[i].civilian.firstName} ${results.civilians[i].civilian.lastName} | ${results.civilians[i]._id}**`)
              .setURL('https://discord.gg/jgUW656v2t')
              .setAuthor({ name: 'LPS Website Support', iconURL: client.config.IconURL, url: 'https://discord.gg/jgUW656v2t' })
              .setDescription('Name Search Results')
              .addFields(
                { name: `**First Name**`, value: `\`${results.civilians[i].civilian.firstName}\``, inline: true },
                { name: `**Last Name**`, value: `\`${results.civilians[i].civilian.lastName}\``, inline: true },
                { name: `**DOB**`, value: `\`${results.civilians[i].civilian.birthday}\``, inline: true },
                { name: `**Drivers License**`, value: `\`${licenceStatus}\``, inline: true },
                { name: `**Firearm Licence**`, value: `\`${firearmLicence}\``, inline: true },
                { name: `**Gender**`, value: `\`${results.civilians[i].civilian.gender}\``, inline: true }
              )
              // Check Other details
              let address = results.civilians[i].civilian.address;
              let occupation = results.civilians[i].civilian.occupation;
              let height = results.civilians[i].civilian.height;
              let weight = results.civilians[i].civilian.weight;
              let eyeColor = results.civilians[i].civilian.eyeColor;
              let hairColor = results.civilians[i].civilian.hairColor;
              if (address != null && address != undefined && address != '') nameResult.addFields({ name: `**Address**`, value: `\`${address}\``, inline: true });
              if (occupation != null && occupation != undefined && occupation != '') nameResult.addFields({ name: `**Occupation**`, value: `\`${occupation}\``, inline: true });
              if (height!=null&&height!=undefined&&height!="NaN"&&height!='') {
                if (results.civilians[i].civilian.heightClassification=='imperial') {
                  let ft = Math.floor(height/12);
                  let inch = height%12;
                  nameResult.addFields({ name: '**Height**', value: `\`${ft}'${inch}"\``, inline: true });
                } else {
                  nameResult.addFields({ name: '**Height**', value: `\`${height}cm\``, inline: true });
                }
              }
              if (weight!=null&&weight!=undefined&&weight!='') {
                let units = results.civilians[i].civilian.weightClassification=='imperial' ? 'lbs.' : 'kgs.';
                nameResult.addFields({ name: '**Weight**', value: `\`${weight}${units}\``, inline: true });
              }
              if (eyeColor!=null&&eyeColor!=undefined&&eyeColor!='') nameResult.addFields({name:'**Eye Color**',value:`\`${eyeColor}\``,inline:true});
              if (hairColor!=null&&hairColor!=undefined&&hairColor!='') nameResult.addFields({name:'**Hair Color**',value:`\`${hairColor}\``,inline:true});
              nameResult.addFields({name:'**Organ Donor**',value:`\`${results.civilians[i].civilian.organDonor}\``,inline:true});
              nameResult.addFields({name:'**Veteran**',value:`\`${results.civilians[i].civilian.veteran}\``,inline:true});
              interaction.send({ embeds: [nameResult] });
            }
          }
          socket.disconnect();
        });

      }
    },
  },
}