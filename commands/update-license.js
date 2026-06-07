const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const io = require('socket.io-client');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const { getDriversLicense, legacyCivilianLicenseLabel } = require('../util/licenses');

module.exports = {
  name: "update-license",
  description: "Update Drivers License Status",
  usage: "[firstName] [lastName] [DOB]",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
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
    },
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
      
      let user = await client.dbo.collection("users").findOne({"user.discord.id":interaction.member.user.id}).then(user => user);
      if (!user) return interaction.send({ content: `You are not logged in.` });
      
      let data = {
        user: user,
        query: {
          firstName: args[0].value,
          lastName: args[1].value,
          dateOfBirth: args[2].value,
          activeCommunityID: user.user.lastAccessedCommunity.communityID
        }
      }
      
      // Acknowledge within Discord's 3s window before the (slow) socket
      // round-trip, otherwise the user sees "application did not respond".
      // Ephemeral so the license controls stay private to the requester.
      await interaction.defer({ flags: (1 << 6) });

      const socket = io.connect(client.config.socket);

      // Guard against the socket never replying (server down / no event) so the
      // deferred reply doesn't hang indefinitely.
      const searchTimeout = setTimeout(() => {
        socket.disconnect();
        interaction.editOriginal({ content: `Search timed out, please try again.` });
      }, 12000);

      socket.emit("bot_name_search", data);
      socket.on("bot_name_search_results", async (results) => {
        clearTimeout(searchTimeout);
        socket.disconnect();

        if (results.user._id==user._id) {
          if (results.civilians.length == 0) {
            return interaction.editOriginal({ content: `Name \`${args[0].value} ${args[1].value}\` not found.` });
          }
        }

        let nameResult;
        let row;
        for (let i = 0; i < results.civilians.length; i++) {
          // Driver's license status — prefer the licenses collection (web DMV
          // panel) via the API, fall back to the legacy civilian field.
          let licenseStatus;
          try {
            const driversLicense = await getDriversLicense(client, results.civilians[i]._id);
            licenseStatus = driversLicense
              ? (driversLicense.license.status || 'None')
              : legacyCivilianLicenseLabel(results.civilians[i].civilian.licenseStatus);
          } catch (err) {
            client.error(`update-license: driver license lookup failed: ${err.message}`);
            licenseStatus = legacyCivilianLicenseLabel(results.civilians[i].civilian.licenseStatus);
          }
          nameResult = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`**${results.civilians[i].civilian.firstName} ${results.civilians[i].civilian.lastName} | ${results.civilians[i]._id}**`)
            .setURL('https://discord.gg/jgUW656v2t')
            .setAuthor({ name: 'LPS Website Support', iconURL: client.config.IconURL, url: 'https://discord.gg/jgUW656v2t' })
            .setDescription('Name Search Results')
            .addFields(
              { name: `**First Name**`, value: `\`${results.civilians[i].civilian.firstName}\``, inline: true },
              { name: `**Last Name**`, value: `\`${results.civilians[i].civilian.lastName}\``, inline: true },
              { name: `**DOB**`, value: `\`${results.civilians[i].civilian.birthday}\``, inline: true },
              { name: `**Drivers License**`, value: `\`${licenseStatus}\``, inline: true },
              { name: `**Gender**`, value: `\`${results.civilians[i].civilian.gender}\``, inline: true }
            )
          row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`license-revoke-${results.civilians[i]._id}`)
                .setLabel("Revoke")
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId(`license-reinstate-${results.civilians[i]._id}`)
                .setLabel("Reinstate")
                .setStyle(ButtonStyle.Success)
            )
        }

        return interaction.editOriginal({ embeds: [nameResult], components: [row] });
      });
    },
  },
  Interactions: {
    license: {
      run: async (client, ButtonInteraction, { GuildDB }) => {
        // customId: license-<revoke|reinstate>-<civilianId>
        const parts = ButtonInteraction.customId.split('-');
        const action = parts[1];
        const civilianId = parts[2];
        const newStatus = action === 'revoke' ? 'Revoked' : 'Valid';

        // Ack the component interaction so the 3s window isn't blocked by the
        // API/socket round-trip below.
        await ButtonInteraction.deferUpdate();

        // Preferred path: update the license record the website reads/writes,
        // so the change is reflected everywhere (web + `/search`).
        try {
          const driversLicense = await getDriversLicense(client, civilianId);
          if (driversLicense) {
            await apiRequest(client, 'PUT', `/api/v1/license/${driversLicense._id}`, { status: newStatus });
            return ButtonInteraction.editReply({ content: `Successfully updated license to \`${newStatus}\`.`, embeds: [], components: [] });
          }
        } catch (err) {
          client.error(`update-license: API update failed for civ ${civilianId}: ${err.message}`);
          return ButtonInteraction.editReply({ content: 'Failed to update license.', embeds: [], components: [] });
        }

        // Legacy fallback: civilian has no license record in the licenses
        // collection — update the legacy `civilian.licenseStatus` field via the
        // existing socket path (status codes: 1 valid, 2 revoked).
        const socket = io.connect(client.config.socket);
        const legacyStatus = action === 'revoke' ? 2 : 1;
        let settled = false;
        const finish = (content) => {
          if (settled) return;
          settled = true;
          try { socket.disconnect(); } catch (_) {}
          return ButtonInteraction.editReply({ content, embeds: [], components: [] });
        };
        socket.emit("update_drivers_license_status", { _id: civilianId, status: legacyStatus, bot_request: true });
        socket.on("bot_updated_drivers_license_status", (res) => {
          finish((res && res.success) ? `Successfully updated license to \`${newStatus}\`.` : 'Failed to update license.');
        });
        setTimeout(() => finish('License update timed out, please try again.'), 12000);
      }
    }
  }
}