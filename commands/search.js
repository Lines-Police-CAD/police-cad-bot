const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const io = require('socket.io-client');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const ObjectId = require("mongodb").ObjectId;
const { getLpcUser, getFocusedOption, civilianName } = require('../util/economy');
const { civilianAutocompleteChoices, resolveCivilian } = require('../util/civilians');
const {
  plateAutocompleteChoices,
  resolveVehicle,
  vehicleName,
  communityVehicleCount,
} = require('../util/vehicles');
const { getCommunityName, communityUrl } = require('../util/communities');
const { apiRequest } = require('../util/api');
// Reuse /civilian's record renderer rather than building a thinner copy here.
const { buildHubPayload: buildCivilianHub } = require('./civilian');
const {
  getCivilianLicenses,
  pickLicense,
  isDriversLicense,
  isWeaponLicense,
  legacyCivilianLicenseLabel,
  legacyFirearmLicenseLabel,
} = require('../util/licenses');

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
        description: "Start typing a plate, then pick from the list",
        value: "plate_number",
        type: CommandOptions.String,
        required: true,
        autocomplete: true,
      }],
    },
    {
      name: "name",
      description: "Search name database",
      value: "name",
      type: CommandOptions.SubCommand,
      options: [{
        name: "full_name",
        description: "Start typing a civilian's name, then pick from the list",
        value: "name",
        type: CommandOptions.String,
        required: true,
        autocomplete: true,
      }],
    }
  ],
  Autocomplete: {
    run: async (client, interaction) => {
      const focused = getFocusedOption(interaction.data.options);
      if (!focused || (focused.name !== 'full_name' && focused.name !== 'plate_number')) {
        return interaction.respond([]);
      }
      try {
        const user = await getLpcUser(client, interaction.member.user.id);
        const communityId = user && user.user && user.user.lastAccessedCommunity
          && user.user.lastAccessedCommunity.communityID;
        if (!communityId) return interaction.respond([]);

        const choices = focused.name === 'plate_number'
          ? await plateAutocompleteChoices(client, communityId, focused.value)
          : await civilianAutocompleteChoices(client, communityId, focused.value);
        return interaction.respond(choices);
      } catch (err) {
        client.error(`/search autocomplete: ${err.message}`);
        return interaction.respond([]);
      }
    },
  },
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
    */
    run: async (client, interaction, args, { GuildDB }) => {
      // All /search replies are private to the requester — these surface
      // civilian/plate/firearm PII that shouldn't be posted to the whole channel.
      await interaction.defer({ flags: (1 << 6) });

      if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id)) {
        return interaction.editOriginal({ content: `You are not allowed to use the bot in this channel.` });
      }
      
      let useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.editOriginal({ content: await client.noPermissionMessage(GuildDB.serverID) });

      const user = await client.dbo.collection("users").findOne({"user.discord.id":interaction.member.user.id}).then(user => user);
      if (!user) return interaction.editOriginal({ content: `You are not logged in.` });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) return interaction.editOriginal({ content: `You are not in an active community. Run \`/set-active-community\` to pick one.` });

      if (args[0].name == "firearm") {
        let query = {
          "firearm.serialNumber": args[0].options[0].value,
          "firearm.activeCommunityID": user.user.lastAccessedCommunity.communityID
        };
        
        client.dbo.collection("firearms").findOne(query).then(async (results) => {
          
          if (!results) {
            return interaction.editOriginal({ content: `No Firearms found <@${interaction.member.user.id}>` });
          }

          let civilian = null;
          if (results.firearm.linkedCivilianID != "") civilian = await client.dbo.collection("civilians").findOne({ _id: new ObjectId(results.firearm.linkedCivilianID) }).then((civ) => civ);
          let owner = civilian ? civilian.civilian.name : "N/A";

          let firearmResult = new EmbedBuilder()
            .setColor('#38bdf8')
            .setAuthor({ name: 'Firearm Search', iconURL: client.config.IconURL })
            .setTitle(`${results.firearm.serialNumber}`)
            .addFields(
              { name: `**Serial Number**`, value: `\`${results.firearm.serialNumber}\``, inline: true },
              { name: `**Name**`, value: `\`${results.firearm.name}\``, inline: true },
              { name: `**Type**`, value: `\`${results.firearm.weaponType}\``, inline: true },
              { name: `**Owner**`, value: `\`${owner}\``, inline: true },
            )

          // Other details
          let isStolen = results.firearm.isStolen;
          if (isStolen=="false"||isStolen==false) firearmResult.addFields({name:`**Stolen**`,value:'\`No\`',inline: true});
          if (isStolen=="true"||isStolen==true) firearmResult.addFields({name:`**Stolen**`,value:'\`Yes\`',inline: true});
          interaction.editOriginal({ embeds: [firearmResult] });
        });


      } else if (args[0].name == "plate") {
        const communityId = user.user.lastAccessedCommunity.communityID;
        const typed = args[0].options[0].value;

        // The autocomplete picker submits the vehicle's _id; a free-typed plate
        // falls back to the best server-side match. Both go through the API
        // rather than reading Mongo directly.
        //
        // The community name is fetched alongside so it costs no extra wait.
        // Every search is scoped to the active community, which is easy to
        // forget you're in — naming it means a genuine miss doesn't look the
        // same as searching the wrong community.
        let results = null;
        let communityLabel = null;
        try {
          [results, communityLabel] = await Promise.all([
            resolveVehicle(client, communityId, typed),
            getCommunityName(client, communityId),
          ]);
        } catch (err) {
          client.error(`/search plate: ${err.message}`);
          return interaction.editOriginal({ content: `Something went wrong looking up that plate. Try again in a moment.` });
        }

        const inCommunity = communityLabel ? ` in **${communityLabel}**` : '';

        if (!results || !results.vehicle) {
          const fleet = await communityVehicleCount(client, communityId);
          const where = communityLabel ? 'that community' : 'your active community';
          // Point at the bot command, not the website — they can switch right here.
          const elsewhere = ` If it's registered elsewhere, run \`/set-active-community\` to switch._`;
          const searched = fleet === null
            ? `\n_Searches only cover ${where}.${elsewhere}`
            : `\n_Searched all ${fleet.toLocaleString()} ${fleet === 1 ? 'vehicle' : 'vehicles'} in ${where}.${elsewhere}`;
          return interaction.editOriginal({
            content: `Plate Number \`${typed}\` not found${inCommunity}.${searched}`,
          });
        }

        const d = results.vehicle;

        let owner = "N/A";
        let ownerId = null;
        if (d.linkedCivilianID) {
          try {
            const civ = await apiRequest(client, 'GET', `/api/v1/civilian/${d.linkedCivilianID}`);
            if (civ && civ.civilian && civ.civilian.name) {
              owner = civ.civilian.name;
              ownerId = String(civ._id || d.linkedCivilianID);
            }
          } catch (err) {
            // An unreachable owner shouldn't blank the whole lookup.
            client.error(`/search plate owner ${d.linkedCivilianID}: ${err.message}`);
          }
        }

        // Vehicle flags come in two encodings. Newer records use "true"/"false",
        // older ones a 1-based select index whose polarity is per-field ("1" is
        // a valid registration, but "2" is stolen). The API normalizes these on
        // read, so this is belt-and-braces for a stale API deploy — it can go
        // once every record has been backfilled.
        // See police-cad/public/js/vehicle-flags.js for the full explanation.
        const yesIsOne = (v) => v === '1' || v === 'true' || v === true;
        const yesIsTwo = (v) => v === '2' || v === 'true' || v === true;

        const stolen = yesIsTwo(d.isStolen);
        const exempt = yesIsOne(d.isExempt);
        const name = vehicleName(results);
        const dash = (v) => (v === undefined || v === null || v === '' ? '—' : v);

        const regOk = yesIsOne(d.validRegistration);
        const insOk = yesIsOne(d.validInsurance);

        // Lead with the flags an officer is actually looking for. Same icons as
        // the status fields below, so the summary and the detail agree at a
        // glance rather than using two vocabularies for one fact.
        const alerts = [];
        if (stolen) alerts.push('🚨 **STOLEN**');
        if (!regOk) alerts.push('❌ Invalid registration');
        if (!insOk) alerts.push('❌ No insurance');
        if (exempt) alerts.push('🛡️ Exempt');

        let plateResult = new EmbedBuilder()
        .setColor(stolen ? '#ef4444' : (alerts.length ? '#f59e0b' : '#38bdf8'))
        .setAuthor({ name: 'Plate Search', iconURL: client.config.IconURL })
        .setTitle(`${d.plate || '—'}${name ? ` · ${name}` : ''}`);

        if (alerts.length) plateResult.setDescription(alerts.join('\n'));
        if (d.image) plateResult.setThumbnail(d.image);

        plateResult.addFields(
          { name: `**Plate #**`, value: `\`${dash(d.plate)}\``, inline: true },
          { name: `**Plate State**`, value: `\`${dash(d.licensePlateState)}\``, inline: true },
          { name: `**Vin #**`, value: `\`${dash(d.vin)}\``, inline: true },
          { name: `**Make**`, value: `\`${dash(d.make)}\``, inline: true },
          { name: `**Model**`, value: `\`${dash(d.model)}\``, inline: true },
          { name: `**Year**`, value: `\`${dash(d.year)}\``, inline: true },
          { name: `**Type**`, value: `\`${dash(d.type)}\``, inline: true },
          { name: `**Color**`, value: `\`${dash(d.color)}\``, inline: true },
          { name: `**Owner**`, value: `\`${owner}\``, inline: true },
          // Status fields drop the code formatting the factual fields use, and
          // carry an icon instead — these are the three an officer scans for,
          // and monospace made them read like just more data. Note the icon
          // tracks *good vs bad*, not the literal value: a stolen "Yes" is the
          // alarming one, where an invalid registration is the "Invalid".
          // Rendered unconditionally — an omitted Stolen line reads as
          // "unknown" when every other surface would say "No".
          { name: `**Registration**`, value: regOk ? '✅ Valid' : '❌ Invalid', inline: true },
          { name: `**Insurance**`, value: insOk ? '✅ Valid' : '❌ Invalid', inline: true },
          { name: `**Stolen**`, value: stolen ? '🚨 Yes' : '✅ No', inline: true },
        );

        // Which community this came from, as a link straight to it. This lives
        // in a full-width field rather than the footer because Discord renders
        // footers as plain text — a markdown link there would show as literal
        // brackets. Dropping the record id: nobody can do anything with it.
        if (communityLabel) {
          const url = communityUrl(communityId);
          plateResult.addFields({
            name: `**Community**`,
            value: url ? `[${communityLabel}](${url})` : communityLabel,
            inline: false,
          });
        }

        // Discord can't pre-fill and submit a slash command for someone, but a
        // button can just do the lookup — one click instead of retyping the
        // owner's name into /civilian and hoping the autocomplete matches.
        const rows = [];
        if (ownerId) {
          rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`plateowner-${ownerId}`)
              .setLabel(`View owner: ${owner}`.slice(0, 80))
              .setStyle(ButtonStyle.Primary)
              .setEmoji('👤')
          ));
        }

        return interaction.editOriginal({ embeds: [plateResult], components: rows });

      } else if (args[0].name == "name") {
        const communityId = user.user.lastAccessedCommunity.communityID;
        const picked = args[0].options[0].value;

        // The autocomplete picker submits the civilian's _id; a free-typed value
        // falls back to the best server-side name match.
        let results = null;
        try {
          results = await resolveCivilian(client, communityId, picked);
        } catch (err) {
          client.error(`/search name lookup failed: ${err.message}`);
        }

        if (!results) {
          return interaction.editOriginal({ content: `No civilian found for \`${picked}\`. Try selecting a name from the suggestions.` });
        }

        // Driver's and firearm license status. Prefer the licenses collection
        // (what the web DMV/Licensing panel writes, read via the same API the
        // website uses) so the bot reflects web updates. Fall back to the legacy
        // civilian.licenseStatus / civilian.firearmLicense fields for civilians
        // with no record in the licenses collection.
        let licenceStatus;
        let firearmLicence;
        try {
          const licenses = await getCivilianLicenses(client, results._id);
          const driversLicense = pickLicense(licenses, isDriversLicense);
          const weaponLicense = pickLicense(licenses, isWeaponLicense);
          licenceStatus = driversLicense
            ? (driversLicense.license.status || 'None')
            : legacyCivilianLicenseLabel(results.civilian.licenseStatus);
          firearmLicence = weaponLicense
            ? (weaponLicense.license.status || 'None')
            : legacyFirearmLicenseLabel(results.civilian.firearmLicense);
        } catch (err) {
          client.error(`search: license lookup failed for ${results._id}: ${err.message}`);
          licenceStatus = legacyCivilianLicenseLabel(results.civilian.licenseStatus);
          firearmLicence = legacyFirearmLicenseLabel(results.civilian.firearmLicense);
        }

        const displayName = civilianName(results) || results.civilian.name || 'Unknown';
        let nameResult = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Name Search', iconURL: client.config.IconURL })
          .setTitle(displayName)
          .addFields(
            { name: '🎂 DOB', value: `\`${results.civilian.birthday || 'Unknown'}\``, inline: true },
            { name: '🧍 Gender', value: `\`${results.civilian.gender || 'Unknown'}\``, inline: true },
            { name: '🪪 Drivers License', value: `\`${licenceStatus}\``, inline: true },
            { name: '🔫 Firearm License', value: `\`${firearmLicence}\``, inline: true },
          )
          .setFooter({ text: `Tip: /civilian shows the full record` });
        if (results.civilian.image) nameResult.setThumbnail(results.civilian.image);

        // Optional details
        const address = results.civilian.address;
        const occupation = results.civilian.occupation;
        const height = results.civilian.height;
        const weight = results.civilian.weight;
        const eyeColor = results.civilian.eyeColor;
        const hairColor = results.civilian.hairColor;
        if (address) nameResult.addFields({ name: '🏠 Address', value: `\`${address}\``, inline: true });
        if (occupation) nameResult.addFields({ name: '💼 Occupation', value: `\`${occupation}\``, inline: true });
        if (height != null && height != undefined && height != "NaN" && height != '') {
          if (results.civilian.heightClassification == 'imperial') {
            const ft = Math.floor(height / 12);
            const inch = height % 12;
            nameResult.addFields({ name: '📏 Height', value: `\`${ft}'${inch}"\``, inline: true });
          } else {
            nameResult.addFields({ name: '📏 Height', value: `\`${height}cm\``, inline: true });
          }
        }
        if (weight != null && weight != undefined && weight != '') {
          const units = results.civilian.weightClassification == 'imperial' ? 'lbs.' : 'kgs.';
          nameResult.addFields({ name: '⚖️ Weight', value: `\`${weight}${units}\``, inline: true });
        }
        if (eyeColor) nameResult.addFields({ name: '👁️ Eye Color', value: `\`${eyeColor}\``, inline: true });
        if (hairColor) nameResult.addFields({ name: '💇 Hair Color', value: `\`${hairColor}\``, inline: true });
        nameResult.addFields(
          { name: '❤️ Organ Donor', value: `\`${results.civilian.organDonor}\``, inline: true },
          { name: '🎖️ Veteran', value: `\`${results.civilian.veteran}\``, inline: true },
        );
        return interaction.editOriginal({ embeds: [nameResult] });
      }
    },
  },
  Interactions: {
    // "View owner" on a plate result. Opens the same record view /civilian
    // renders, in a new ephemeral message so the plate embed stays put — the
    // tab select on it works because /civilian registers that handler globally.
    plateowner: {
      run: async (client, interaction) => {
        try {
          const civilianId = interaction.customId.split('-')[1];
          if (!civilianId) return;

          // Re-check scope rather than trusting the customId. The button only
          // ever appears on an ephemeral result the clicker owns, but a
          // customId is just a string a client can send.
          const user = await getLpcUser(client, interaction.user.id);
          const communityId = user && user.user && user.user.lastAccessedCommunity
            && user.user.lastAccessedCommunity.communityID;
          if (!communityId) {
            return interaction.reply({
              content: 'You are not in an active community. Run `/set-active-community` to pick one.',
              flags: (1 << 6),
            });
          }

          const civ = await resolveCivilian(client, communityId, civilianId);
          if (!civ) {
            return interaction.reply({
              content: 'That civilian is no longer available in your active community.',
              flags: (1 << 6),
            });
          }

          const payload = await buildCivilianHub(client, String(civ._id), 'overview');
          return interaction.reply({ ...payload, flags: (1 << 6) });
        } catch (err) {
          client.error(`plateowner: ${err.message}`);
          try {
            return interaction.reply({ content: 'Failed to load that owner.', flags: (1 << 6) });
          } catch (_) {}
        }
      },
    },
  },
}