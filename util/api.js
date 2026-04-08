/**
 * Shared helper for making HTTP requests to the Lines Police CAD API.
 */

async function apiRequest(client, method, path, body) {
  const baseUrl = client.config.api_url.replace(/\/+$/, '');
  const url = `${baseUrl}${path}`;

  const headers = { 'Content-Type': 'application/json' };
  if (client.config.api_token) {
    headers['Authorization'] = `Bearer ${client.config.api_token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

module.exports = { apiRequest };
