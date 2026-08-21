const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const ObjectId = require('mongodb').ObjectId;
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const {
  getLpcUser,
  getFocusedOption,
  findOption,
  civilianName,
} = require('../util/economy');
const { civilianAutocompleteChoices, resolveCivilian } = require('../util/civilians');
const { getCivilianLicenses } = require('../util/licenses');

const ACCENT = '#38bdf8';
const MAX_ROWS = 12; // cap list length per tab so the embed stays within Discord limits

const TABS = [
  { key: 'overview', label: 'Overview', emoji: '🪪' },
  { key: 'licenses', label: 'Licenses', emoji: '📋' },
  { key: 'citations', label: 'Citations', emoji: '🎟️' },
  { key: 'warnings', label: 'Warnings', emoji: '⚠️' },
  { key: 'arrests', label: 'Arrests', emoji: '🚔' },
  { key: 'warrants', label: 'Warrants', emoji: '📜' },
  { key: 'vehicles', label: 'Vehicles', emoji: '🚗' },
  { key: 'firearms', label: 'Firearms', emoji: '🔫' },
];

const STATUS_EMOJI = { Valid: '🟢', Approved: '🟢', Suspended: '🟡', Revoked: '🔴', Pending: '⚪' };

// --- small helpers -------------------------------------------------------

function listFrom(res, key) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res[key])) return res[key];
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

function fmtDate(v) {
  if (!v) return '';
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return String(v);
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function yesNo(b) { return b ? 'Yes' : 'No'; }

/*
 * Vehicle flags come in two encodings. Newer records use "true"/"false"; older
 * ones use a 1-based select index from the original form, whose polarity is
 * per-field — "1" = valid registration, but "2" = stolen. Roughly 92% of
 * vehicles still carry the numeric form, and ~5% the modern one, so both
 * branches matter. See police-cad/public/js/vehicle-flags.js.
 */
function stolenYes(v) { return v === 'true' || v === '2' || v === true; }
function regValid(v) { return v === '1' || v === 'true' || v === true; }
function regLabel(v) {
  if (v === undefined || v === null || v === '') return '—';
  return regValid(v) ? 'Valid' : 'Invalid';
}

function capNote(items, rendered) {
  return items.length > rendered.length
    ? `\n_…and ${items.length - rendered.length} more — view on the website._`
    : '';
}

async function getCivilianDoc(client, civilianId) {
  try {
    return await client.dbo.collection('civilians').findOne({ _id: new ObjectId(civilianId) });
  } catch (_) {
    return null;
  }
}

function criminalHistory(civ, type) {
  const items = (civ && civ.civilian && civ.civilian.criminalHistory) || [];
  return items.filter((h) => !h.redacted && String(h.type || '').toLowerCase() === type);
}

// --- tab renderers: each returns a description string --------------------

async function renderLicenses(client, civilianId) {
  const licenses = await getCivilianLicenses(client, civilianId);
  if (!licenses.length) return '_No licenses on file._';
  const rows = licenses.slice(0, MAX_ROWS).map((lic) => {
    const d = lic.license || {};
    const emoji = STATUS_EMOJI[d.status] || '⚪';
    const exp = d.expirationDate ? ` · exp ${d.expirationDate}` : '';
    return `${emoji} **${d.type || 'License'}** — ${d.status || 'Unknown'}${exp}`;
  });
  return rows.join('\n') + capNote(licenses, rows);
}

function renderCitations(civ) {
  const items = criminalHistory(civ, 'citation');
  if (!items.length) return '_No citations on file._';
  const rows = items.slice(0, MAX_ROWS).map((h) => {
    const fines = h.fines || [];
    const total = fines.reduce((s, f) => s + (Number(f.fineAmount) || 0), 0);
    const types = fines.map((f) => f.fineType).filter(Boolean).join(', ') || 'Citation';
    const status = h.status ? ` · ${h.status}` : '';
    const when = fmtDate(h.createdAt);
    return `• **${types}** — $${total}${status}${when ? ` · ${when}` : ''}`;
  });
  return rows.join('\n') + capNote(items, rows);
}

function renderWarnings(civ) {
  const items = criminalHistory(civ, 'warning');
  if (!items.length) return '_No warnings on file._';
  const rows = items.slice(0, MAX_ROWS).map((h) => {
    const when = fmtDate(h.createdAt);
    const note = h.notes ? `: ${h.notes}` : '';
    return `• **Warning**${when ? ` (${when})` : ''}${note}`.slice(0, 200);
  });
  return rows.join('\n') + capNote(items, rows);
}

async function renderArrests(client, civilianId) {
  const res = await apiRequest(client, 'GET', `/api/v1/arrest-report/arrestee/${civilianId}?limit=25&page=0`);
  const items = listFrom(res, 'data');
  if (!items.length) return '_No arrest reports on file._';
  const rows = items.slice(0, MAX_ROWS).map((a) => {
    const d = a.arrestReport || {};
    const charges = d.charges ? ` — ${d.charges}` : '';
    const status = d.status ? ` · ${d.status}` : '';
    const who = d.officer && d.officer.name ? ` · by ${d.officer.name}` : '';
    return `• **${d.reportNumber || 'Arrest'}** (${d.arrestDate || '—'})${charges}${status}${who}`.slice(0, 250);
  });
  return rows.join('\n') + capNote(items, rows);
}

async function renderWarrants(client, civilianId) {
  const res = await apiRequest(client, 'GET', `/api/v1/warrants/user/${civilianId}`);
  const items = listFrom(res, 'data');
  if (!items.length) return '_No warrants on file._';
  const rows = items.slice(0, MAX_ROWS).map((w) => {
    const d = w.warrant || {};
    const charges = Array.isArray(d.charges) && d.charges.length ? ` — ${d.charges.join(', ')}` : '';
    const status = d.status ? ` · ${d.status}` : '';
    return `• **${(d.warrantType || 'warrant')} warrant**${status}${charges}`.slice(0, 250);
  });
  return rows.join('\n') + capNote(items, rows);
}

async function renderVehicles(client, civilianId) {
  const res = await apiRequest(client, 'GET', `/api/v1/vehicles/registered-owner/${civilianId}?limit=25&page=0`);
  const items = listFrom(res, 'vehicles');
  if (!items.length) return '_No vehicles registered._';
  const rows = items.slice(0, MAX_ROWS).map((v) => {
    const d = v.vehicle || {};
    const name = [d.year, d.make, d.model].filter(Boolean).join(' ') || d.type || 'Vehicle';
    const meta = [];
    if (d.color) meta.push(d.color);
    meta.push(`Reg: ${regLabel(d.validRegistration)}`);
    meta.push(`Ins: ${regLabel(d.validInsurance)}`);
    if (stolenYes(d.isStolen)) meta.push('⚠️ STOLEN');
    return `• \`${d.plate || '—'}\` **${name}** — ${meta.join(' · ')}`.slice(0, 250);
  });
  return rows.join('\n') + capNote(items, rows);
}

async function renderFirearms(client, civilianId) {
  const res = await apiRequest(client, 'GET', `/api/v1/firearms/registered-owner/${civilianId}?limit=25&page=0`);
  const items = listFrom(res, 'firearms');
  if (!items.length) return '_No firearms registered._';
  const rows = items.slice(0, MAX_ROWS).map((f) => {
    const d = f.firearm || {};
    const meta = [d.weaponType, d.caliber].filter(Boolean).join(' · ');
    const stolen = stolenYes(d.isStolen) ? ' · ⚠️ STOLEN' : '';
    return `• \`${d.serialNumber || '—'}\` **${d.name || d.weaponType || 'Firearm'}**${meta ? ` — ${meta}` : ''}${stolen}`.slice(0, 250);
  });
  return rows.join('\n') + capNote(items, rows);
}

// --- hub payload --------------------------------------------------------

async function buildHubPayload(client, civilianId, activeKey) {
  const tab = TABS.find((t) => t.key === activeKey) || TABS[0];
  const civ = await getCivilianDoc(client, civilianId);
  const c = (civ && civ.civilian) || {};
  const displayName = (civ && civilianName(civ)) || 'Civilian';

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({ name: `${tab.emoji} ${tab.label}`, iconURL: client.config.IconURL })
    .setTitle(displayName);

  // Footer carries the DOB rather than the record id — nobody can act on a raw
  // ObjectId, whereas DOB is what actually tells two same-named civilians
  // apart. It matters here specifically because DOB is a field on the overview
  // tab only; every other tab replaces the fields with a body, so without this
  // the name is the sole identifier once you switch sections.
  if (c.birthday) embed.setFooter({ text: `DOB: ${c.birthday}` });
  if (c.image) embed.setThumbnail(c.image);

  if (tab.key === 'overview') {
    const citations = criminalHistory(civ, 'citation').length;
    const warnings = criminalHistory(civ, 'warning').length;
    embed.addFields(
      { name: '🎂 DOB', value: `\`${c.birthday || 'Unknown'}\``, inline: true },
      { name: '🧍 Gender', value: `\`${c.gender || 'Unknown'}\``, inline: true },
      { name: '🧬 Race', value: `\`${c.race || '—'}\``, inline: true },
    );
    const flags = [];
    if (c.onProbation) flags.push('Probation');
    if (c.onParole) flags.push('Parole');
    if (c.deceased) flags.push('Deceased');
    embed.addFields(
      { name: '🚩 Flags', value: `\`${flags.length ? flags.join(', ') : 'None'}\``, inline: true },
      { name: '🎟️ Citations', value: `\`${citations}\``, inline: true },
      { name: '⚠️ Warnings', value: `\`${warnings}\``, inline: true },
    );
    if (c.address) embed.addFields({ name: '🏠 Address', value: `\`${c.address}\``, inline: true });
    if (c.occupation) embed.addFields({ name: '💼 Occupation', value: `\`${c.occupation}\``, inline: true });
    embed.setDescription('Use the menu below to view licenses, citations, warnings, arrests, warrants, vehicles, and firearms.');
  } else {
    let body = '_Nothing to show._';
    if (tab.key === 'licenses') body = await renderLicenses(client, civilianId);
    else if (tab.key === 'citations') body = renderCitations(civ);
    else if (tab.key === 'warnings') body = renderWarnings(civ);
    else if (tab.key === 'arrests') body = await renderArrests(client, civilianId);
    else if (tab.key === 'warrants') body = await renderWarrants(client, civilianId);
    else if (tab.key === 'vehicles') body = await renderVehicles(client, civilianId);
    else if (tab.key === 'firearms') body = await renderFirearms(client, civilianId);
    embed.setDescription(body.slice(0, 4096));
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`civtab-${civilianId}`)
    .setPlaceholder('View record section')
    .addOptions(TABS.map((t) => ({
      label: t.label,
      value: t.key,
      emoji: t.emoji,
      default: t.key === tab.key,
    })));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

module.exports = {
  name: 'civilian',
  description: "Look up a civilian's full record — licenses, citations, arrests, warrants, vehicles & more",
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
        client.error(`/civilian autocomplete: ${err.message}`);
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
      if (!useCommand) return interaction.send({ content: await client.noPermissionMessage(GuildDB.serverID) });

      const user = await client.dbo.collection('users').findOne({ 'user.discord.id': interaction.member.user.id });
      if (!user) return interaction.send({ content: `You are not logged in.` });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) {
        return interaction.send({ content: `You are not in an active community.` });
      }

      await interaction.defer({ flags: (1 << 6) });

      const communityId = user.user.lastAccessedCommunity.communityID;
      const picked = (findOption(args, 'civilian') || {}).value || '';

      let civilian = null;
      try {
        civilian = await resolveCivilian(client, communityId, picked);
      } catch (err) {
        client.error(`/civilian lookup failed: ${err.message}`);
      }
      if (!civilian) {
        return interaction.editOriginal({ content: `No civilian found for \`${picked}\`. Try selecting a name from the suggestions.` });
      }

      try {
        const payload = await buildHubPayload(client, String(civilian._id), 'overview');
        return interaction.editOriginal(payload);
      } catch (err) {
        client.error(`/civilian error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to load civilian record. Please try again.` });
      }
    },
  },
  // Exported so other commands can open this same record view rather than
  // rendering their own thinner version of it — /search plate's owner button
  // uses it. Functions are dropped when the command object is serialized for
  // Discord's registration payload, so this is invisible to the API.
  buildHubPayload,
  Interactions: {
    // Tab select → render the chosen section.
    civtab: {
      run: async (client, interaction) => {
        try {
          await interaction.deferUpdate();
          const civilianId = interaction.customId.split('-')[1];
          const tabKey = (interaction.values || [])[0] || 'overview';
          return interaction.editReply(await buildHubPayload(client, civilianId, tabKey));
        } catch (err) {
          client.error(`civtab: ${err.message}`);
          try { return interaction.editReply({ content: 'Failed to load that section.', embeds: [], components: [] }); } catch (_) {}
        }
      },
    },
  },
};
