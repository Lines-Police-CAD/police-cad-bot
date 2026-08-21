/**
 * Community lookup helpers.
 *
 * Commands scope everything to the user's active community, which is easy to
 * forget you're in — a search that legitimately finds nothing looks identical
 * to searching the wrong community. Naming the community in the result lets
 * someone spot that themselves.
 *
 * `user.lastAccessedCommunity` carries only the id, so the name needs a lookup.
 * It's cached for the lifetime of the process since community names change
 * rarely and a stale one is cosmetic.
 */

const { apiRequest } = require('./api');

const nameCache = new Map();

/**
 * Display name for a community, or null if it can't be resolved. Never throws —
 * a missing name should degrade the footer, not fail the command.
 */
async function getCommunityName(client, communityId) {
  if (!communityId) return null;
  if (nameCache.has(communityId)) return nameCache.get(communityId);

  let name = null;
  try {
    const res = await apiRequest(client, 'GET', `/api/v1/community/${communityId}`);
    name = (res && res.community && res.community.name) || null;
  } catch (err) {
    if (client && client.error) client.error(`community name ${communityId}: ${err.message}`);
  }

  nameCache.set(communityId, name);
  return name;
}

module.exports = { getCommunityName };
