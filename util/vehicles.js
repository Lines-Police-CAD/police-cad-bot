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
 * Build Discord autocomplete choices (label "PLATE • 2026 Dinka Chavos V6",
 * value = vehicle _id).
 */
async function plateAutocompleteChoices(client, communityId, query) {
  const vehicles = await vehiclePlateSearch(client, communityId, query, 25);
  return vehicles.slice(0, 25).map((v) => {
    const d = v.vehicle || {};
    const name = vehicleName(v);
    const label = name ? `${d.plate || '—'} • ${name}` : (d.plate || '—');
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
    try {
      return await apiRequest(client, 'GET', `/api/v1/vehicle/${raw}`);
    } catch (err) {
      return null;
    }
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
