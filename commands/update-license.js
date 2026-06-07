const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const {
  getLpcUser,
  getFocusedOption,
  findOption,
  lookupCivilianName,
} = require('../util/economy');
const { civilianAutocompleteChoices, resolveCivilian } = require('../util/civilians');
const { getCivilianLicenses } = require('../util/licenses');

const ACCENT = '#38bdf8';

// Per-license actions and the canonical status each one sets (matches the
// website's status dropdown: Pending / Valid / Approved / Suspended / Revoked).
const LICENSE_ACTIONS = {
  reinstate: { status: 'Valid', label: 'Reinstate', style: ButtonStyle.Success },
  approve: { status: 'Approved', label: 'Approve', style: ButtonStyle.Success },
  suspend: { status: 'Suspended', label: 'Suspend', style: ButtonStyle.Secondary },
  revoke: { status: 'Revoked', label: 'Revoke', style: ButtonStyle.Danger },
};

const STATUS_EMOJI = {
  Valid: '🟢',
  Approved: '🟢',
  Suspended: '🟡',
  Revoked: '🔴',
  Pending: '⚪',
};

function isExpired(d) {
  if (!d || !d.expirationDate) return false;
  const t = new Date(d.expirationDate).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

function licenseLine(lic) {
  const d = lic.license || {};
  const emoji = STATUS_EMOJI[d.status] || '⚪';
  const exp = d.expirationDate ? ` · exp ${d.expirationDate}` : '';
  const expired = isExpired(d) ? ' · ⛔ EXPIRED' : '';
  return `${emoji} **${d.type || 'License'}** — ${d.status || 'Unknown'}${exp}${expired}`;
}

async function safeName(client, civilianId) {
  try {
    return (await lookupCivilianName(client, civilianId)) || 'Civilian';
  } catch (_) {
    return 'Civilian';
  }
}

// The civilian's full license list with a select menu to drill into one.
async function buildLicenseListPayload(client, civilianId, displayName, notice) {
  const licenses = await getCivilianLicenses(client, civilianId);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({ name: 'Licenses', iconURL: client.config.IconURL })
    .setTitle(displayName || 'Civilian')
    .setFooter({ text: `ID: ${civilianId}` });
  if (notice) embed.setDescription(notice);

  if (!licenses.length) {
    embed.addFields({ name: 'Licenses (0)', value: '_No licenses on file._' });
    return { embeds: [embed], components: [] };
  }

  const shown = licenses.slice(0, 25);
  embed.addFields({
    name: `Licenses (${licenses.length})`,
    value: shown.map(licenseLine).join('\n').slice(0, 1024),
  });
  if (licenses.length > 25) {
    embed.addFields({ name: '​', value: `_Showing first 25 of ${licenses.length}._` });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`licsel-${civilianId}`)
    .setPlaceholder('Select a license to update')
    .addOptions(shown.map((lic) => {
      const d = lic.license || {};
      return {
        label: (d.type || 'License').slice(0, 100),
        description: `${d.status || 'Unknown'}${d.expirationDate ? ` • exp ${d.expirationDate}` : ''}`.slice(0, 100),
        value: String(lic._id),
      };
    }));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

// A single license with its status-action buttons.
function buildLicenseDetailPayload(client, civilianId, displayName, lic) {
  const d = lic.license || {};
  const emoji = STATUS_EMOJI[d.status] || '⚪';

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({ name: 'Update License', iconURL: client.config.IconURL })
    .setTitle(d.type || 'License')
    .addFields(
      { name: 'Status', value: `${emoji} ${d.status || 'Unknown'}${isExpired(d) ? ' · ⛔ EXPIRED' : ''}`, inline: true },
      { name: 'Expiration', value: d.expirationDate || '—', inline: true },
    )
    .setFooter({ text: displayName ? `${displayName} · ID: ${civilianId}` : `ID: ${civilianId}` });
  if (d.notes) embed.addFields({ name: 'Notes', value: String(d.notes).slice(0, 1024) });

  const actionRow = new ActionRowBuilder().addComponents(
    ...Object.entries(LICENSE_ACTIONS).map(([action, cfg]) =>
      new ButtonBuilder()
        .setCustomId(`licact-${action}-${lic._id}-${civilianId}`)
        .setLabel(cfg.label)
        .setStyle(cfg.style)
        .setDisabled(d.status === cfg.status)),
  );
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`licback-${civilianId}`)
      .setLabel('Back to licenses')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [actionRow, backRow] };
}

module.exports = {
  name: 'update-license',
  description: "Update a civilian's license status (suspend, revoke, reinstate, approve)",
  usage: '[civilian]',
  permissions: {
    channel: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS'],
    member: [],
  },
  options: [
    {
      name: 'civilian',
      description: "Start typing a civilian's name, then pick from the list",
      value: 'civilian',
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
  ],
  Autocomplete: {
    run: async (client, interaction) => {
      const focused = getFocusedOption(interaction.data.options);
      if (!focused || focused.name !== 'civilian') return interaction.respond([]);
      try {
        const user = await getLpcUser(client, interaction.member.user.id);
        const communityId = user && user.user && user.user.lastAccessedCommunity
          && user.user.lastAccessedCommunity.communityID;
        if (!communityId) return interaction.respond([]);
        const choices = await civilianAutocompleteChoices(client, communityId, focused.value);
        return interaction.respond(choices);
      } catch (err) {
        client.error(`/update-license autocomplete: ${err.message}`);
        return interaction.respond([]);
      }
    },
  },
  SlashCommand: {
    /**
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} interaction
     * @param {string[]} args
     * @param {*} param3
     */
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id)) {
        return interaction.send({ content: `You are not allowed to use the bot in this channel.` });
      }

      const useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: "You don't have permission to use this command" });

      const user = await client.dbo.collection('users').findOne({ 'user.discord.id': interaction.member.user.id });
      if (!user) return interaction.send({ content: `You are not logged in.` });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) {
        return interaction.send({ content: `You are not in an active community.` });
      }

      // Ephemeral so the license controls stay private to the requester.
      await interaction.defer({ flags: (1 << 6) });

      const communityId = user.user.lastAccessedCommunity.communityID;
      const picked = (findOption(args, 'civilian') || {}).value || '';

      let civilian = null;
      try {
        civilian = await resolveCivilian(client, communityId, picked);
      } catch (err) {
        client.error(`/update-license lookup failed: ${err.message}`);
      }
      if (!civilian) {
        return interaction.editOriginal({ content: `No civilian found for \`${picked}\`. Try selecting a name from the suggestions.` });
      }

      try {
        const civilianId = String(civilian._id);
        const displayName = (await lookupCivilianName(client, civilianId)) || 'Civilian';
        const payload = await buildLicenseListPayload(client, civilianId, displayName);
        return interaction.editOriginal(payload);
      } catch (err) {
        client.error(`/update-license error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to load licenses. Please try again.` });
      }
    },
  },
  Interactions: {
    // Picked a license from the select menu → show it with action buttons.
    licsel: {
      run: async (client, interaction) => {
        try {
          await interaction.deferUpdate();
          const civilianId = interaction.customId.split('-')[1];
          const licenseId = (interaction.values || [])[0];
          const lic = await apiRequest(client, 'GET', `/api/v1/license/${licenseId}`);
          if (!lic || !lic._id) {
            return interaction.editReply({ content: 'License not found.', embeds: [], components: [] });
          }
          const displayName = await safeName(client, civilianId);
          return interaction.editReply(buildLicenseDetailPayload(client, civilianId, displayName, lic));
        } catch (err) {
          client.error(`licsel: ${err.message}`);
          try { return interaction.editReply({ content: 'Failed to load license.', embeds: [], components: [] }); } catch (_) {}
        }
      },
    },
    // "Back to licenses" → re-render the full list.
    licback: {
      run: async (client, interaction) => {
        try {
          await interaction.deferUpdate();
          const civilianId = interaction.customId.split('-')[1];
          const displayName = await safeName(client, civilianId);
          return interaction.editReply(await buildLicenseListPayload(client, civilianId, displayName));
        } catch (err) {
          client.error(`licback: ${err.message}`);
          try { return interaction.editReply({ content: 'Failed to load licenses.', embeds: [], components: [] }); } catch (_) {}
        }
      },
    },
    // Action button → set the license status, then re-render the list.
    licact: {
      run: async (client, interaction) => {
        try {
          await interaction.deferUpdate();
          const [, action, licenseId, civilianId] = interaction.customId.split('-');
          const cfg = LICENSE_ACTIONS[action];
          if (!cfg) return;
          await apiRequest(client, 'PUT', `/api/v1/license/${licenseId}`, { status: cfg.status });
          const displayName = await safeName(client, civilianId);
          const notice = `✅ License set to **${cfg.status}**.`;
          return interaction.editReply(await buildLicenseListPayload(client, civilianId, displayName, notice));
        } catch (err) {
          client.error(`licact: ${err.message}`);
          try { return interaction.editReply({ content: 'Failed to update license.', embeds: [], components: [] }); } catch (_) {}
        }
      },
    },
  },
};
