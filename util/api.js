/**
 * Shared helper for making HTTP requests to the Lines Police CAD API.
 */

/**
 * Header the API reads the server-to-server secret from. Must match
 * apiGatewayHeader in police-cad-api (api/handlers/gateway.go).
 */
const GATEWAY_SECRET_HEADER = 'X-API-Key';

/**
 * Pull the human-readable reason out of an API error body.
 *
 * Two shapes are in play: the Go API nests it as `response.message`, while a
 * few handlers (and the website's own Express routes) return a top-level
 * `message`/`error`. Returns '' when the body carries neither, so callers can
 * fall back to their own copy rather than showing a blank line.
 */
function apiErrorReason(text) {
  if (!text) return '';
  try {
    const data = JSON.parse(text);
    if (data && data.response && typeof data.response.message === 'string') return data.response.message;
    if (data && typeof data.message === 'string') return data.message;
    if (data && typeof data.error === 'string') return data.error;
  } catch (_) {
    // Not JSON. Nothing worth showing a user.
  }
  return '';
}

async function apiRequest(client, method, path, body) {
  const baseUrl = client.config.api_url.replace(/\/+$/, '');
  const url = `${baseUrl}${path}`;

  const headers = { 'Content-Type': 'application/json' };
  if (client.config.api_token) {
    headers['Authorization'] = `Bearer ${client.config.api_token}`;
  }
  // The bot's bearer token is the shared service token, so it says "this is the
  // bot", not "this is Alice". Endpoints that act on behalf of a person take the
  // acting LPC user as ?userId=, which the API believes only when the request
  // also carries this server-to-server secret — a user cannot forge it because
  // they never see it. Sent on every request so any such endpoint works.
  if (client.config.api_gateway_key) {
    headers[GATEWAY_SECRET_HEADER] = client.config.api_gateway_key;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Message format is unchanged: existing callers sniff it for "(403)" etc.
    // The status and reason are attached as fields so new callers can branch on
    // them directly instead of pattern-matching a string.
    const err = new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    err.status = res.status;
    err.body = text;
    err.reason = apiErrorReason(text);
    throw err;
  }

  return res.json();
}

module.exports = { apiRequest, apiErrorReason, GATEWAY_SECRET_HEADER };
