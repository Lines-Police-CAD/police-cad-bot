/**
 * Shared helpers for the /wallet, /clock-in, /clock-out, /inbox, /pay-fine,
 * and /contest-fine commands.
 */

function formatMoney(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const padded = remainder < 10 ? `0${remainder}` : `${remainder}`;
  return `${sign}$${dollars.toLocaleString()}.${padded}`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDueDate(value) {
  if (!value) return "no due date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "no due date";
  return d.toLocaleDateString();
}

/**
 * Find the option the user is currently typing in an autocomplete request.
 * Recurses into subcommand option arrays.
 */
function getFocusedOption(options) {
  for (const opt of options || []) {
    if (opt.focused) return opt;
    if (Array.isArray(opt.options)) {
      const f = getFocusedOption(opt.options);
      if (f) return f;
    }
  }
  return null;
}

function findOption(options, name) {
  for (const opt of options || []) {
    if (opt.name === name) return opt;
    if (Array.isArray(opt.options)) {
      const f = findOption(opt.options, name);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Load the LPC user document for a Discord member. Returns null when the user
 * has not connected their Discord account.
 */
async function getLpcUser(client, discordUserId) {
  return client.dbo
    .collection("users")
    .findOne({ "user.discord.id": discordUserId });
}

const ACTIVE_CIV_COLLECTION = 'bot_active_civilians';

/**
 * Read the persisted "active civilian" the user picked via /set-active-civilian
 * for the given community. Returns null when not set.
 */
async function getActiveCivilianId(client, userId, communityId) {
  const doc = await client.dbo
    .collection(ACTIVE_CIV_COLLECTION)
    .findOne({ userId, communityId });
  return doc && doc.civilianId ? doc.civilianId : null;
}

/**
 * Persist the user's active civilian for a community. Upsert on (userId, communityId).
 */
async function setActiveCivilianId(client, userId, communityId, civilianId) {
  return client.dbo.collection(ACTIVE_CIV_COLLECTION).updateOne(
    { userId, communityId },
    {
      $set: { userId, communityId, civilianId, updatedAt: new Date() },
    },
    { upsert: true },
  );
}

/**
 * Resolve the civilian to act on. Returns the explicit pick if provided,
 * otherwise the user's saved active civilian for the community, otherwise null.
 */
async function resolveCivilianId(client, userId, communityId, explicitId) {
  if (explicitId) return explicitId;
  return getActiveCivilianId(client, userId, communityId);
}

/**
 * Look up a civilian's name by id from the civilians collection. Returns null
 * when not found / id is invalid.
 */
async function lookupCivilianName(client, civilianId) {
  if (!civilianId) return null;
  const ObjectId = require('mongodb').ObjectId;
  let oid;
  try { oid = new ObjectId(civilianId); } catch (_) { return null; }
  const doc = await client.dbo.collection('civilians').findOne({ _id: oid });
  return doc ? civilianName(doc) : null;
}

/**
 * List a user's civilians in a community via the v2 API.
 */
async function listUserCivilians(client, userId, communityId) {
  const { apiRequest } = require('./api');
  const res = await apiRequest(
    client,
    'GET',
    `/api/v2/civilians/user/${userId}?active_community_id=${encodeURIComponent(communityId)}&limit=50`
  );
  return (res && res.data) || [];
}

/**
 * Build civilian autocomplete choices filtered by typed query.
 */
async function civilianAutocomplete(client, userId, communityId, query) {
  const civs = await listUserCivilians(client, userId, communityId);
  const q = (query || '').toLowerCase();
  return civs
    .map((c) => ({ name: civilianName(c), value: c._id.toString() }))
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25);
}

/**
 * Returns true when community-level economy is enabled. Reads Mongo directly.
 */
async function isCommunityEconomyEnabled(client, communityId) {
  const ObjectId = require('mongodb').ObjectId;
  let oid;
  try { oid = new ObjectId(communityId); } catch (_) { return false; }
  const community = await client.dbo.collection('communities').findOne({ _id: oid });
  if (!community) return false;
  const cd = community.community || {};
  return !!(cd.economy && cd.economy.enabled === true);
}

/**
 * List the departments a user can /clock-in to. Filters to:
 *  - community.economy.enabled === true
 *  - department.economyEnabled === true
 *  - public department (approvalRequired === false) OR user is approved member
 *
 * Reads directly from Mongo since the v2 `/my-departments` endpoint does not
 * expose economy fields.
 */
async function listClockableDepartments(client, communityId, userId) {
  const ObjectId = require('mongodb').ObjectId;
  let oid;
  try { oid = new ObjectId(communityId); } catch (_) { return []; }
  const community = await client.dbo.collection('communities').findOne({ _id: oid });
  if (!community) return [];
  const cd = community.community || {};
  if (!cd.economy || cd.economy.enabled !== true) return [];
  const departments = cd.departments || [];

  return departments.filter((d) => {
    if (!d.economyEnabled) return false;
    if (!d.approvalRequired) return true;
    const members = d.members || [];
    return members.some((m) => m.userID === userId && m.status === 'approved');
  });
}

/**
 * Resolve a civilian's display name. Older docs only have `name`; newer ones
 * have `firstName`/`lastName`.
 */
function civilianName(civ) {
  const d = (civ && civ.civilian) || {};
  const composed = `${d.firstName || ''} ${d.lastName || ''}`.trim();
  if (composed) return composed;
  if (d.name && d.name.trim()) return d.name.trim();
  return 'Unnamed';
}

/**
 * Build autocomplete choices for an inbox-item picker, scoped to one civilian.
 * @param {object} client Bot client (for apiRequest)
 * @param {string} civilianId Civilian whose inbox to query
 * @param {string} communityId Active community id
 * @param {string} query Currently-typed filter text
 * @param {string[]} statuses Statuses to include (e.g., ['pending','delinquent'])
 */
async function fetchInboxChoices(client, civilianId, communityId, query, statuses) {
  const { apiRequest } = require('./api');
  const q = (query || '').toLowerCase();
  const all = [];
  for (const status of statuses) {
    const path = `/api/v2/economy/inbox?civilianId=${encodeURIComponent(civilianId)}&communityId=${encodeURIComponent(communityId)}&status=${encodeURIComponent(status)}&limit=25`;
    try {
      const res = await apiRequest(client, 'GET', path);
      const items = (res && res.data) || [];
      for (const i of items) all.push(i);
    } catch (err) {
      client.error(`fetchInboxChoices(${status}): ${err.message}`);
    }
  }
  return all
    .map((i) => {
      const id = String(i._id || '');
      const label = formatInboxItemLabel(i);
      const searchHay = `${i.title || ''} ${i.body || ''} ${(i.charges || []).map((c) => c.label).join(' ')} ${id}`.toLowerCase();
      return { name: label, value: id, _searchKey: searchHay };
    })
    .filter((c) => !q || c._searchKey.includes(q))
    .slice(0, 25)
    .map(({ _searchKey, ...rest }) => rest);
}

/**
 * Build a Discord-friendly label for an inbox item that surfaces what the
 * charge is actually for. Examples:
 *   "$250.00 — Citation: Speeding 25+, No Plates"
 *   "$150.00 — Admin fee: Late library book"
 *   "$50.00 — Verdict (due 5/22)"
 *
 * Capped at 100 chars (Discord's autocomplete name limit).
 */
function formatInboxItemLabel(item) {
  const amount = formatMoney(item && item.amount);
  const sourceLabel = (() => {
    switch (item && item.source) {
      case 'citation': return 'Citation';
      case 'admin': return 'Admin fee';
      case 'judicial': return 'Verdict';
      case 'shop': return 'Purchase';
      case 'system': return 'System';
      default: return (item && item.title) || (item && item.type) || 'Item';
    }
  })();

  let detail = '';
  const charges = (item && item.charges) || [];
  if (charges.length > 0) {
    const labels = charges
      .filter((c) => c && c.status !== 'dismissed' && c.label)
      .map((c) => c.label);
    if (labels.length > 0) detail = labels.join(', ');
  }
  if (!detail && item && item.title) detail = item.title;
  if (!detail && item && item.body) detail = item.body;

  let label = detail ? `${amount} — ${sourceLabel}: ${detail}` : `${amount} — ${sourceLabel}`;

  // Add a due-date hint when there's space.
  if (item && item.dueAt) {
    const d = new Date(item.dueAt);
    if (!Number.isNaN(d.getTime())) {
      const hint = ` (due ${d.getMonth() + 1}/${d.getDate()})`;
      if (label.length + hint.length <= 100) label += hint;
    }
  }

  if (label.length > 100) label = `${label.slice(0, 97)}...`;
  return label;
}

module.exports = {
  formatMoney,
  formatDuration,
  formatDueDate,
  getFocusedOption,
  findOption,
  getLpcUser,
  fetchInboxChoices,
  civilianName,
  listClockableDepartments,
  listUserCivilians,
  civilianAutocomplete,
  getActiveCivilianId,
  setActiveCivilianId,
  resolveCivilianId,
  lookupCivilianName,
  isCommunityEconomyEnabled,
  formatInboxItemLabel,
};
