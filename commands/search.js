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
        name: "full_name",
        description: "Civilian's Full Name",
        value: "name",
        type: CommandOptions.String,
        required: true,
      },
      {
        name: "dob",
        description: "Civilian's DOB (dd/mm/yyyy)",
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
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) return interaction.send({ content: `You are not in an active community.` });
      let data;

      if (args[0].name == "firearm") {
        data = {
          user: user,
          query: {
            serialNumber: args[0].options[0].value,
            activeCommunityID: user.user.lastAccessedCommunity.communityID
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
            activeCommunityID: user.user.lastAccessedCommunity.communityID
          }
        }
        const socket = io.connect(client.config.socket);
        socket.emit('bot_plate_search', data);
        socket.on('bot_plate_search_results', results => {
          
          if (results.user._id==user._id) {
            if (results.vehicles.length == 0) {
              return interaction.send({ content: `Plate Number \`${args[0].options[0].value}\` not found.` });
            }

            let plateResults = [];
            for (let i = 0; i < results.vehicles.length; i++) {
              if (results.vehicles[i].vehicle.activeCommunityID != user.user.lastAccessedCommunity.communityID) continue;
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
              plateResults.push(plateResult);
            }
            return interaction.send({ embeds: plateResults });
          }
          socket.disconnect();
        });

      } else if (args[0].name == "name") {
        let query = {
          "civilian.name": `${args[0].options[0].value}`,
          "civilian.birthday": args[0].options[1].value,
          "civilian.activeCommunityID": user.user.lastAccessedCommunity.communityID
        };

        client.dbo.collection("civilians").findOne(query).then((results) => {
          
          if (!results) {
            return interaction.send({ content: `Name \`${args[0].options[0].value}\` not found.` });
          }
          
          // Get Drivers Licence Status
          let licenceStatus;
          if (results.civilian.licenseStatus == 1) licenceStatus = 'Valid';
          if (results.civilian.licenceStatus == 2) licenceStatus = 'Revoked';
          if (results.civilian.licenceStatus == 3) licenceStatus = 'None';
          if (!results.civilian.licenceStatus) licenceStatus = "None";
          // Get Firearm Licence Status
          let firearmLicence = results.civilian.firearmLicense;
          if (!firearmLicence) firearmLicence = 'None';
          if (firearmLicence == '2') firearmLicence = 'Valid';
          if (firearmLicence == '3') firearmLicence = 'Revoked';
          let nameResult = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle(`**${results.civilian.name} | ${results._id}**`)
          .setURL('https://discord.gg/jgUW656v2t')
          .setAuthor({ name: 'LPS Website Support', iconURL: client.config.IconURL, url: 'https://discord.gg/jgUW656v2t' })
          .setDescription('Name Search Results')
          .addFields(
            { name: `**Name**`, value: `\`${results.civilian.name}\``, inline: true },
            { name: `**DOB**`, value: `\`${results.civilian.birthday}\``, inline: true },
            { name: `**Drivers License**`, value: `\`${licenceStatus}\``, inline: true },
            { name: `**Firearm Licence**`, value: `\`${firearmLicence}\``, inline: true },
            { name: `**Gender**`, value: `\`${results.civilian.gender}\``, inline: true }
          )
          // Check Other details
          let address = results.civilian.address;
          let occupation = results.civilian.occupation;
          let height = results.civilian.height;
          let weight = results.civilian.weight;
          let eyeColor = results.civilian.eyeColor;
          let hairColor = results.civilian.hairColor;
          if (address != null && address != undefined && address != '') nameResult.addFields({ name: `**Address**`, value: `\`${address}\``, inline: true });
          if (occupation != null && occupation != undefined && occupation != '') nameResult.addFields({ name: `**Occupation**`, value: `\`${occupation}\``, inline: true });
          if (height!=null&&height!=undefined&&height!="NaN"&&height!='') {
            if (results.civilian.heightClassification=='imperial') {
              let ft = Math.floor(height/12);
              let inch = height%12;
              nameResult.addFields({ name: '**Height**', value: `\`${ft}'${inch}"\``, inline: true });
            } else {
              nameResult.addFields({ name: '**Height**', value: `\`${height}cm\``, inline: true });
            }
          }
          if (weight!=null&&weight!=undefined&&weight!='') {
            let units = results.civilian.weightClassification=='imperial' ? 'lbs.' : 'kgs.';
            nameResult.addFields({ name: '**Weight**', value: `\`${weight}${units}\``, inline: true });
          }
          if (eyeColor!=null&&eyeColor!=undefined&&eyeColor!='') nameResult.addFields({name:'**Eye Color**',value:`\`${eyeColor}\``,inline:true});
          if (hairColor!=null&&hairColor!=undefined&&hairColor!='') nameResult.addFields({name:'**Hair Color**',value:`\`${hairColor}\``,inline:true});
          nameResult.addFields({name:'**Organ Donor**',value:`\`${results.civilian.organDonor}\``,inline:true});
          nameResult.addFields({name:'**Veteran**',value:`\`${results.civilian.veteran}\``,inline:true});
          interaction.send({ embeds: [nameResult] });
        });
      }
    },
  },
}