/**
 * Helpers for reading/writing a civilian's licenses through the same API the
 * website uses. The website's modern DMV/Licensing panel stores licenses in the
 * `licenses` collection (one document per license, with a word-string `status`
 * like "Valid"/"Revoked"), NOT on `civilian.licenseStatus` / `civilian.firearmLicense`.
 * These helpers let the Discord bot reflect that same source of truth.
 */

const { apiRequest } = require('./api');

// The license `type` field is free-text on the website (admins type values like
// "Driver's License", "drivers", "DL", "Firearm License", "Gun License"...), so
// match it fuzzily — mirroring the website's own license type aliases in
// police-cad/public/js/modern-dashboard.js (licenseTypeVariations).
function isDriversLicense(type) {
  if (!type) return false;
  const t = String(type).trim().toLowerCase();
  return t === 'dl' || t.includes('driv'); // driver, drivers, driving, driver's license
}

function isWeaponLicense(type) {
  if (!type) return false;
  const t = String(type).trim().toLowerCase();
  // weapon / firearm(s) / gun license/permit
  return t.includes('weapon') || t.includes('firearm') || t.includes('gun');
}

// Best-effort conversion of an API timestamp (epoch millis or ISO string) to a
// number for sorting. Returns 0 when it can't be parsed.
function toMillis(v) {
  if (!v) return 0;
  const n = new Date(v).getTime();
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Returns all of a civilian's license documents from the licenses collection
 * (via the API the website uses), or [] when the civilian has no records.
 * @returns {Promise<Array<{_id: string, license: object}>>}
 */
async function getCivilianLicenses(client, civilianId) {
  if (!civilianId) return [];
  const resp = await apiRequest(
    client,
    'GET',
    `/api/v1/licenses/civilian/${civilianId}`,
  );
  return (resp && resp.data) || [];
}

/**
 * Picks the single license matching `matcher(type)` from a list. If several
 * match, the most recently updated one wins.
 * @returns {{_id: string, license: object}|null}
 */
function pickLicense(licenses, matcher) {
  const matches = (licenses || []).filter((doc) => {
    const d = doc && doc.license;
    return d && matcher(d.type || d.licenseType);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => toMillis(b.license.updatedAt) - toMillis(a.license.updatedAt));
  return matches[0];
}

// Convenience: fetch + pick the civilian's driver's license in one call.
async function getDriversLicense(client, civilianId) {
  return pickLicense(await getCivilianLicenses(client, civilianId), isDriversLicense);
}

// Maps the legacy `civilian.licenseStatus` code to a human label. Used as a
// fallback for civilians with no record in the licenses collection.
// Codes: "1" valid, "2" revoked, "3"/absent none (police-cad civilian model).
function legacyCivilianLicenseLabel(licenseStatus) {
  if (licenseStatus == 1) return 'Valid';
  if (licenseStatus == 2) return 'Revoked';
  return 'None';
}

// Maps the legacy `civilian.firearmLicense` code to a human label. Used as a
// fallback for civilians with no weapon license record in the licenses
// collection. Codes (legacy /search behavior): "2" valid, "3" revoked, else none.
function legacyFirearmLicenseLabel(firearmLicense) {
  if (firearmLicense == 2) return 'Valid';
  if (firearmLicense == 3) return 'Revoked';
  return 'None';
}

module.exports = {
  isDriversLicense,
  isWeaponLicense,
  getCivilianLicenses,
  pickLicense,
  getDriversLicense,
  legacyCivilianLicenseLabel,
  legacyFirearmLicenseLabel,
};
