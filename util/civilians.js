/**
 * Shared civilian lookup helpers for commands that let a user pick a civilian
 * by name (e.g. /search, /update-license). Backed by the same server-side
 * name-search endpoint the website's autofill uses
 * (police-cad/public/js/cd-person-search.js).
 */

const ObjectId = require('mongodb').ObjectId;
const { apiRequest } = require('./api');
const { civilianName } = require('./economy');

// Server-side civilian name search, scoped to a community. Returns an array of
// civilian documents ({ _id, civilian: {...} }).
async function civilianNameSearch(client, communityId, query, limit) {
  const path = `/api/v1/civilians/search?name=${encodeURIComponent((query || '').trim())}`
    + `&active_community_id=${encodeURIComponent(communityId)}&limit=${limit}&page=0`;
  const res = await apiRequest(client, 'GET', path);
  return Array.isArray(res) ? res : (res && res.data) || [];
}

// Build Discord autocomplete choices (label "Name • DOB", value = civilian _id).
async function civilianAutocompleteChoices(client, communityId, query) {
  const civs = await civilianNameSearch(client, communityId, query, 25);
  return civs.slice(0, 25).map((c) => {
    const dob = (c.civilian && c.civilian.birthday) || '';
    const label = dob ? `${civilianName(c)} • ${dob}` : civilianName(c);
    return { name: label.slice(0, 100), value: String(c._id) };
  });
}

// Resolve a civilian from the value submitted to a name option. The autocomplete
// picker submits the civilian's _id; a free-typed value (no suggestion chosen)
// falls back to the best server-side name match. Returns the civilian doc or null.
async function resolveCivilian(client, communityId, value) {
  if (/^[a-f0-9]{24}$/i.test(value)) {
    return client.dbo.collection('civilians').findOne({
      _id: new ObjectId(value),
      'civilian.activeCommunityID': communityId,
    });
  }
  const civs = await civilianNameSearch(client, communityId, value, 1);
  if (civs.length && civs[0]._id) {
    return client.dbo.collection('civilians').findOne({ _id: new ObjectId(civs[0]._id) });
  }
  return null;
}

module.exports = {
  civilianNameSearch,
  civilianAutocompleteChoices,
  resolveCivilian,
};
