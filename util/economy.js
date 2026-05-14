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
 * Build autocomplete choices for an inbox-item picker.
 * @param {object} client Bot client (for apiRequest)
 * @param {string} userId LPC user _id
 * @param {string} communityId Active community id
 * @param {string} query Currently-typed filter text
 * @param {string[]} statuses Statuses to include (e.g., ['pending','delinquent'])
 */
async function fetchInboxChoices(client, userId, communityId, query, statuses) {
  const { apiRequest } = require('./api');
  const q = (query || '').toLowerCase();
  const all = [];
  for (const status of statuses) {
    const path = `/api/v2/economy/inbox?userId=${encodeURIComponent(userId)}&communityId=${encodeURIComponent(communityId)}&status=${encodeURIComponent(status)}&limit=25`;
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
      const title = i.title || i.type || 'Item';
      const label = `${formatMoney(i.amount)} — ${title}`.slice(0, 100);
      return { name: label, value: id, _searchKey: `${title} ${id}`.toLowerCase() };
    })
    .filter((c) => !q || c._searchKey.includes(q))
    .slice(0, 25)
    .map(({ _searchKey, ...rest }) => rest);
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
};
