/**
 * Invite-code helpers shared by /invite and /join.
 *
 * Everything here goes through the API. The bot deliberately holds no opinion
 * about who is allowed to manage a community's invite codes: the API owns that
 * rule (the "manage members" community permission, which the owner and anyone
 * holding "administrator" pass automatically) and the bot surfaces its answer.
 * The bot's own /roles allowlist is a different thing entirely — it decides who
 * may run bot commands at all, not what they may do inside a community.
 */

const crypto = require('crypto');

const { apiRequest } = require('./api');

/**
 * Expiry options, mirroring the website's Share flow. The default is the
 * shortest meaningful one rather than the longest: a code that leaks is a way
 * into the community, and a short-lived one closes that by itself.
 */
const EXPIRY_CHOICES = [
  { name: '30 minutes', value: '30m' },
  { name: '1 hour', value: '1h' },
  { name: '6 hours', value: '6h' },
  { name: '12 hours', value: '12h' },
  { name: '24 hours', value: '1d' },
  { name: '7 days', value: '7d' },
  { name: 'Never', value: 'never' },
];

const DEFAULT_EXPIRY = '1d';
const DEFAULT_MAX_USES = 5;
const MIN_MAX_USES = 1;
const MAX_MAX_USES = 100;

const EXPIRY_MS = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/** The label shown for an expiry value, e.g. "24 hours". */
function expiryLabel(value) {
  const match = EXPIRY_CHOICES.find((c) => c.value === value);
  return match ? match.name : value;
}

/**
 * ISO timestamp the code should expire at, or null for a code that never
 * expires. Matches the website's calculation so a code made here behaves the
 * same as one made there.
 */
function expiryToIso(value, now = new Date()) {
  const ms = EXPIRY_MS[value];
  if (!ms) return null;
  return new Date(now.getTime() + ms).toISOString();
}

// Alphabet without the characters people mistype when reading a code aloud or
// off a screenshot: no O/0, no I/1, no S/5. Codes get shared by voice in
// Discord VCs, so this is not cosmetic.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
const CODE_LENGTH = 6;

/**
 * A fresh invite code. The API takes the code from the request rather than
 * minting one, so the bot generates it. Random bytes are rejection-sampled onto
 * the alphabet so no character is more likely than another.
 */
function generateInviteCode() {
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const byte of crypto.randomBytes(CODE_LENGTH * 2)) {
      if (byte >= 256 - (256 % CODE_ALPHABET.length)) continue;
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/** The link someone can open to accept an invite code. */
function inviteJoinUrl(client, code) {
  return `${client.config.Website}/join/${encodeURIComponent(code)}`;
}

/**
 * One page of a community's invite codes, as the acting LPC user.
 *
 * The list endpoint is 1-based and caps limit at 100.
 */
async function fetchInviteCodesPage(client, communityId, userId, page = 1, limit = 25) {
  const path = `/api/v2/community/${encodeURIComponent(communityId)}/invite-codes`
    + `?page=${page}&limit=${limit}&userId=${encodeURIComponent(userId)}`;
  const res = await apiRequest(client, 'GET', path);
  return {
    inviteCodes: Array.isArray(res && res.inviteCodes) ? res.inviteCodes : [],
    pagination: (res && res.pagination) || {},
    expiredCount: (res && res.expiredCount) || 0,
  };
}

/**
 * Find a code's record id, which is what the delete endpoint takes.
 *
 * Walks the real pages rather than asking for one oversized one, so a community
 * with hundreds of outstanding codes still resolves. Returns null when the
 * community has no such code.
 */
async function findInviteCodeByCode(client, communityId, userId, code) {
  const wanted = String(code || '').trim().toUpperCase();
  if (!wanted) return null;

  const limit = 100;
  let page = 1;
  let totalPages = 1;
  do {
    const { inviteCodes, pagination } = await fetchInviteCodesPage(client, communityId, userId, page, limit);
    const match = inviteCodes.find((c) => String(c.code || '').trim().toUpperCase() === wanted);
    if (match) return match;
    totalPages = Number(pagination.totalPages) || 1;
    page += 1;
    // A page that came back empty means there is nothing further to walk, even
    // if totalPages disagrees.
    if (inviteCodes.length === 0) break;
  } while (page <= totalPages);

  return null;
}

/** How many uses a code has left, as text. -1 is the unlimited sentinel. */
function remainingUsesLabel(inviteCode) {
  const remaining = Number(inviteCode.remainingUses);
  if (remaining === -1) return 'Unlimited';
  if (!Number.isFinite(remaining) || remaining <= 0) return 'None left';
  const max = Number(inviteCode.maxUses);
  if (Number.isFinite(max) && max > 0) return `${remaining} of ${max}`;
  return String(remaining);
}

/**
 * Expiry as a Discord relative timestamp, so everyone reads it in their own
 * timezone instead of guessing which one the bot used.
 */
function expiresAtLabel(expiresAt) {
  if (!expiresAt) return 'Never';
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return 'Unknown';
  const unix = Math.floor(at.getTime() / 1000);
  if (at.getTime() <= Date.now()) return `Expired <t:${unix}:R>`;
  return `<t:${unix}:R>`;
}

/** Whether a listed code can still be redeemed right now. */
function isInviteCodeUsable(inviteCode) {
  if (inviteCode.expiresAt && new Date(inviteCode.expiresAt).getTime() <= Date.now()) return false;
  const remaining = Number(inviteCode.remainingUses);
  if (remaining === -1) return true;
  if (Number.isFinite(remaining) && remaining > 0) return true;
  // Older codes left remainingUses unset and counted upwards in uses instead.
  const max = Number(inviteCode.maxUses);
  if (max === 0) return true;
  return Number(inviteCode.uses || 0) < max;
}

/**
 * Without the gateway secret the API cannot be told which LPC user is acting,
 * so every invite call would come back unauthorized. Saying so plainly beats
 * letting someone read that as "you are not allowed".
 */
const NOT_CONFIGURED_MESSAGE = 'Invite codes are not set up on this bot yet. A bot admin needs to set `API_GATEWAY_KEY` to match the CAD API.';

function inviteApiConfigured(client) {
  return !!(client.config.api_url && client.config.api_gateway_key);
}

module.exports = {
  NOT_CONFIGURED_MESSAGE,
  inviteApiConfigured,
  EXPIRY_CHOICES,
  DEFAULT_EXPIRY,
  DEFAULT_MAX_USES,
  MIN_MAX_USES,
  MAX_MAX_USES,
  expiryLabel,
  expiryToIso,
  generateInviteCode,
  inviteJoinUrl,
  fetchInviteCodesPage,
  findInviteCodeByCode,
  remainingUsesLabel,
  expiresAtLabel,
  isInviteCodeUsable,
};
