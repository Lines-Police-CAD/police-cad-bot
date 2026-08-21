/**
 * Shared vehicle lookup helpers for commands that let a user pick a vehicle by
 * plate (e.g. /search plate). Backed by the same server-side search endpoint
 * the website's plate autofill uses.
 *
 * These go through the API rather than reading Mongo directly — see
 * util/civilians.js for the same pattern. Beyond consistency, it matters
 * because API-side fixes do not reach direct-Mongo readers: when the API began
 * normalizing vehicle flags on read, the API-backed /civilian picked it up and
 * the direct-Mongo /search plate did not.
 */

const { apiRequest } = require('./api');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Server-side plate search, scoped to a community. The endpoint matches the
 * plate as a case-insensitive substring, which is what makes it usable for
 * autocomplete. Returns an array of vehicle documents ({ _id, vehicle: {...} }).
 */
async function vehiclePlateSearch(client, communityId, query, limit) {
  const path = `/api/v1/vehicles/search?plate=${encodeURIComponent((query || '').trim())}`
    + `&active_community_id=${encodeURIComponent(communityId)}&limit=${limit}&page=0`;
  const res = await apiRequest(client, 'GET', path);
  if (Array.isArray(res)) return res;
  return (res && (res.vehicles || res.data)) || [];
}

/** A short "2026 Dinka Chavos V6" style label, or the type, or nothing. */
function vehicleName(v) {
  const d = (v && v.vehicle) || {};
  const ymm = [d.year, d.make, d.model].filter(Boolean).join(' ');
  return ymm || d.type || '';
}

/**
 * Build Discord autocomplete choices, e.g.
 * "TREEGHJ9 • 2013 Vroom9 Bomber · Green9".
 *
 * The label is what the user sees and picks; the value is submitted invisibly
 * on their behalf. That value is the vehicle's _id rather than the plate
 * because plates are NOT unique — 167k plate/community pairs have duplicates,
 * and "NONE" alone appears 1,543 times in a single community. Resolving by
 * plate would hand back whichever record matched first, which may not be the
 * one they picked out of the list.
 *
 * Colour is included for the same reason: with duplicate plates common, two
 * rows can otherwise render identically and there is no way to tell them apart.
 */
async function plateAutocompleteChoices(client, communityId, query) {
  const vehicles = await vehiclePlateSearch(client, communityId, query, 25);
  return vehicles.slice(0, 25).map((v) => {
    const d = v.vehicle || {};
    const name = vehicleName(v);
    let label = d.plate || '—';
    if (name) label += ` • ${name}`;
    if (d.color) label += ` · ${d.color}`;
    return { name: label.slice(0, 100), value: String(v._id) };
  });
}

/**
 * Resolve a vehicle from the value submitted to a plate option. The
 * autocomplete picker submits the vehicle's _id; a free-typed value falls back
 * to a plate search, preferring an exact (case-insensitive) plate match so
 * typing a full plate does not land on some other vehicle that merely contains
 * it as a substring. Returns the vehicle doc or null.
 */
async function resolveVehicle(client, communityId, value) {
  const raw = String(value || '').trim();

  if (OBJECT_ID.test(raw)) {
    let veh = null;
    try {
      veh = await apiRequest(client, 'GET', `/api/v1/vehicle/${raw}`);
    } catch (err) {
      return null;
    }
    // Scope the id path too. The suggestions are already community-scoped, but
    // Discord still submits whatever was typed if the user ignores the picker,
    // so a pasted id from another community must not resolve. The plate path
    // gets this from active_community_id on the search endpoint; fetching by id
    // has no such filter, so check it here.
    if (!veh || !veh.vehicle) return null;
    if (veh.vehicle.activeCommunityID !== communityId) return null;
    return veh;
  }

  const vehicles = await vehiclePlateSearch(client, communityId, raw, 25);
  if (!vehicles.length) return null;

  const wanted = raw.toLowerCase();
  const exact = vehicles.find(
    (v) => String((v.vehicle && v.vehicle.plate) || '').toLowerCase() === wanted
  );
  return exact || vehicles[0];
}

module.exports = {
  vehiclePlateSearch,
  plateAutocompleteChoices,
  resolveVehicle,
  vehicleName,
};
