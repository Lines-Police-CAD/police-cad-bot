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

// Legacy bot-only collection. We still read from it as a fallback so users
// who picked an active civilian on the bot before the shared API existed
// keep that pick. Nothing writes to it any more, and a pick read from it is
// ownership-checked like any other (resolveCivilian).
const LEGACY_ACTIVE_CIV_COLLECTION = 'bot_active_civilians';

const { apiRequest } = require('./api');

/**
 * Read the persisted "active civilian" the user picked via /set-active-civilian
 * for the given community. Returns null when not set.
 *
 * Reads from the shared /api/v2/user/active-civilian endpoint so the
 * Discord bot and the web wallet honor the same pick. Falls back to the
 * legacy bot_active_civilians collection when the API returns null/errors
 * so historical picks aren't lost.
 */
async function getActiveCivilianId(client, userId, communityId) {
  if (!userId || !communityId) return null;
  try {
    const path = `/api/v2/user/active-civilian?userId=${encodeURIComponent(userId)}&communityId=${encodeURIComponent(communityId)}`;
    const doc = await apiRequest(client, 'GET', path);
    if (doc && doc.civilianId) return doc.civilianId;
  } catch (err) {
    if (client.error) client.error(`getActiveCivilianId API call failed: ${err.message}`);
  }
  // Legacy fallback. Anything found here will be migrated up to the
  // shared endpoint on the next setActiveCivilianId call for this user.
  try {
    const legacy = await client.dbo
      .collection(LEGACY_ACTIVE_CIV_COLLECTION)
      .findOne({ userId, communityId });
    return legacy && legacy.civilianId ? legacy.civilianId : null;
  } catch (_) {
    return null;
  }
}

/**
 * Persist the user's active civilian for a community. Upsert on (userId, communityId).
 *
 * Writes only to the shared /api/v2/user/active-civilian endpoint, which
 * checks the civilian is the user's own in that community. Throws when the
 * API refuses or is unreachable, so the caller can say so.
 */
async function setActiveCivilianId(client, userId, communityId, civilianId) {
  if (!userId || !communityId || !civilianId) return null;
  await apiRequest(client, 'PUT', '/api/v2/user/active-civilian', {
    userId,
    communityId,
    civilianId,
  });
  return { userId, communityId, civilianId };
}

/**
 * Load a civilian through the API. Returns null when it does not exist or the
 * id is malformed; throws on any other failure.
 */
async function fetchCivilian(client, civilianId) {
  if (!civilianId) return null;
  try {
    return await apiRequest(client, 'GET', `/api/v1/civilian/${encodeURIComponent(civilianId)}`);
  } catch (err) {
    if (err.status === 404 || err.status === 400) return null;
    throw err;
  }
}

/**
 * True when civ is userId's civilian in communityId.
 */
function isOwnCivilianInCommunity(civ, userId, communityId) {
  const d = (civ && civ.civilian) || {};
  return !!userId && !!communityId && d.userID === userId && d.activeCommunityID === communityId;
}

const NOT_YOUR_CIVILIAN_MESSAGE = `That civilian isn't yours in this community. Pick one of your own civilians.`;
const SAVED_CIVILIAN_GONE_MESSAGE =
  `Your active civilian no longer exists or isn't in this community. Run \`/set-active-civilian\` to pick another, or pass \`civilian:\` on this command.`;
const CIVILIAN_CHECK_FAILED_MESSAGE = `Couldn't load that civilian right now. Please try again.`;

/**
 * Resolve the civilian to act on: the explicit pick if provided, otherwise the
 * user's saved active civilian for the community. Either way it must be the
 * user's own civilian in that community.
 *
 * Returns `{ civilianId, civilian, message }`. civilianId is null when there is
 * nothing usable; message then says why, or is null when the user simply has
 * no pick (callers keep their own "no civilian selected" copy). Never throws.
 */
async function resolveCivilian(client, userId, communityId, explicitId) {
  try {
    const candidate = explicitId || await getActiveCivilianId(client, userId, communityId);
    if (!candidate) return { civilianId: null, civilian: null, message: null };
    const civ = await fetchCivilian(client, candidate);
    if (isOwnCivilianInCommunity(civ, userId, communityId)) {
      return { civilianId: candidate, civilian: civ, message: null };
    }
    return {
      civilianId: null,
      civilian: null,
      message: explicitId ? NOT_YOUR_CIVILIAN_MESSAGE : SAVED_CIVILIAN_GONE_MESSAGE,
    };
  } catch (err) {
    if (client.error) client.error(`resolveCivilian: ${err.message}`);
    return { civilianId: null, civilian: null, message: CIVILIAN_CHECK_FAILED_MESSAGE };
  }
}

/**
 * resolveCivilian, for callers that only need the id (autocompletes).
 */
async function resolveCivilianId(client, userId, communityId, explicitId) {
  return (await resolveCivilian(client, userId, communityId, explicitId)).civilianId;
}

/**
 * Look up a civilian's name by id through the API. Returns null when not
 * found / id is invalid / the lookup fails.
 */
async function lookupCivilianName(client, civilianId) {
  try {
    const doc = await fetchCivilian(client, civilianId);
    return doc ? civilianName(doc) : null;
  } catch (err) {
    if (client.error) client.error(`lookupCivilianName: ${err.message}`);
    return null;
  }
}

/**
 * List the communities a user has been approved into. Returns an array of
 * `{ _id, name, imageLink, ... }` objects from the v2 API.
 */
async function listApprovedCommunities(client, userId) {
  if (!userId) return [];
  const path = `/api/v2/user/${encodeURIComponent(userId)}/communities?filter=status:approved&limit=50&page=1`;
  const res = await apiRequest(client, 'GET', path);
  return (res && res.data) || [];
}

/**
 * Set the user's active (last-accessed) community via the shared API so the
 * web app, mobile app, and bot all agree on which community is "active".
 */
async function setActiveCommunityId(client, userId, communityId) {
  if (!userId || !communityId) return null;
  await apiRequest(client, 'PUT', '/api/v1/user/last-accessed-community', {
    userId,
    communityId,
    createdAt: new Date().toISOString(),
  });
  return { userId, communityId };
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
 * List civilians in a community (community-wide, not just the caller's).
 * Used to populate the recipient picker for /send-money. Caps at 100 results
 * — the API enforces the same upper bound.
 */
async function listCommunityCivilians(client, communityId) {
  if (!communityId) return [];
  const path = `/api/v2/community/${encodeURIComponent(communityId)}/civilians?page=1&limit=100`;
  const res = await apiRequest(client, 'GET', path);
  return (res && res.civilians) || [];
}

/**
 * Autocomplete choices for picking a peer-transfer recipient. Excludes the
 * sender's own civilian so the API's self-send guard isn't triggered from
 * the picker. Falls back gracefully on error.
 */
async function communityCivilianAutocomplete(client, communityId, query, excludeCivilianId) {
  let civs = [];
  try {
    civs = await listCommunityCivilians(client, communityId);
  } catch (err) {
    if (client.error) client.error(`communityCivilianAutocomplete: ${err.message}`);
    return [];
  }
  const q = (query || '').toLowerCase();
  return civs
    .filter((c) => c && c._id && (!excludeCivilianId || c._id.toString() !== excludeCivilianId))
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
 * @param {string} userId LPC user making the request
 * @param {string} civilianId Civilian whose inbox to query
 * @param {string} communityId Active community id
 * @param {string} query Currently-typed filter text
 * @param {string[]} statuses Statuses to include (e.g., ['pending','delinquent'])
 */
async function fetchInboxChoices(client, userId, civilianId, communityId, query, statuses) {
  const { apiRequest } = require('./api');
  const q = (query || '').toLowerCase();
  const all = [];
  for (const status of statuses) {
    const path = `/api/v2/economy/inbox?userId=${encodeURIComponent(userId)}&civilianId=${encodeURIComponent(civilianId)}&communityId=${encodeURIComponent(communityId)}&status=${encodeURIComponent(status)}&limit=25`;
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

/**
 * Copy for a clock-in the API refused because of the civilian: it no longer
 * exists (404) or isn't the caller's (403). Returns null for any other error.
 * A saved pick that has gone stale needs /set-active-civilian, not a retry.
 */
function civilianRejectionMessage(err, wasExplicit) {
  const reason = ((err && err.reason) || '').toLowerCase();
  if (!reason.includes('civilian')) return null;
  const fix = wasExplicit
    ? `Pick a different one with \`civilian:\`.`
    : `Run \`/set-active-civilian\` to pick another, or pass \`civilian:\` on this command.`;
  if (err.status === 404) {
    return wasExplicit
      ? `That civilian no longer exists. ${fix}`
      : `Your active civilian no longer exists (it may have been deleted). ${fix}`;
  }
  if (err.status === 403) return `That civilian isn't on your account. ${fix}`;
  if (err.status === 400) return `That civilian couldn't be found. ${fix}`;
  return null;
}

/**
 * The user's active shift, or null. Reads through the API rather than the
 * clock_sessions collection so the bot sees what every other surface sees.
 */
async function getActiveSession(client, userId) {
  if (!userId) return null;
  const res = await apiRequest(
    client,
    'GET',
    `/api/v2/economy/session/active?userId=${encodeURIComponent(userId)}`,
  );
  return res && res._id ? res : null;
}

/**
 * The user's most recently closed shift (ended, expired or abandoned), or
 * null. Best-effort: it only feeds an explanation, so a failure (including an
 * API that predates the endpoint) returns null rather than throwing.
 */
async function getLastClosedSession(client, userId) {
  if (!userId) return null;
  try {
    const res = await apiRequest(
      client,
      'GET',
      `/api/v2/economy/session/last-closed?userId=${encodeURIComponent(userId)}`,
    );
    return res && res._id ? res : null;
  } catch (err) {
    if (client.error) client.error(`getLastClosedSession: ${err.message}`);
    return null;
  }
}

// How far back /clock-out looks for a shift the server closed on its own.
const RECENT_CLOSED_SHIFT_MS = 24 * 60 * 60 * 1000;

/**
 * Explain a shift the server closed without the user clocking out: the AFK
 * sweep ("abandoned") or the max session ("expired"). Returns null when there
 * is nothing worth explaining: the user ended it themselves, or it closed
 * more than a day ago.
 */
function closedShiftMessage(sess, now = Date.now()) {
  if (!sess || (sess.status !== 'abandoned' && sess.status !== 'expired')) return null;
  const endedMs = new Date(sess.endedAt).getTime();
  if (!Number.isFinite(endedMs) || now - endedMs > RECENT_CLOSED_SHIFT_MS) return null;

  const dept = sess.departmentName ? `**${sess.departmentName}** shift` : 'shift';
  const when = `<t:${Math.floor(endedMs / 1000)}:R>`;
  const why = sess.status === 'expired'
    ? `when it reached the ${sess.maxSessionMinutes || 120}m max session`
    : 'for inactivity';
  const paid = `It paid **${formatMoney(sess.earnings || 0)}** for ${formatDuration((sess.paidSeconds || 0) * 1000)}.`;
  return `Your ${dept} was already closed ${when} ${why}, so there's nothing to clock out of. ${paid}`;
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
  listApprovedCommunities,
  setActiveCommunityId,
  civilianAutocomplete,
  communityCivilianAutocomplete,
  listCommunityCivilians,
  getActiveCivilianId,
  setActiveCivilianId,
  resolveCivilian,
  resolveCivilianId,
  fetchCivilian,
  isOwnCivilianInCommunity,
  NOT_YOUR_CIVILIAN_MESSAGE,
  lookupCivilianName,
  isCommunityEconomyEnabled,
  formatInboxItemLabel,
  civilianRejectionMessage,
  getActiveSession,
  getLastClosedSession,
  closedShiftMessage,
};
