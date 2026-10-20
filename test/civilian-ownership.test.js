// Economy commands act only on the caller's own civilians in their active
// community. Run with `npm test`. fetch is stubbed, so no API or Discord is needed.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { resolveCivilian, fetchInboxChoices } = require('../util/economy');
const wallet = require('../commands/wallet');
const setActiveCivilian = require('../commands/set-active-civilian');

const USER_ID = new ObjectId().toString();
const OTHER_USER_ID = new ObjectId().toString();
const COMMUNITY_ID = new ObjectId().toString();
const OTHER_COMMUNITY_ID = new ObjectId().toString();
const OWN_CIV = new ObjectId().toString();
const OTHER_CIV = new ObjectId().toString();
const OWN_CIV_ELSEWHERE = new ObjectId().toString();

let calls;
let routes;
let savedPick;
const realFetch = global.fetch;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function route(method, prefix, status, body) {
  routes.push({ method, prefix, status, body });
}

function civ(id, userID, activeCommunityID, firstName) {
  return { _id: id, civilian: { firstName, lastName: 'Doe', userID, activeCommunityID } };
}

beforeEach(() => {
  calls = [];
  routes = [];
  savedPick = null;
  global.fetch = async (url, opts) => {
    const path = url.replace('http://api.test', '');
    const call = { method: opts.method, path, body: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(call);
    const r = routes.find((x) => x.method === opts.method && path.startsWith(x.prefix));
    if (!r) return jsonResponse(404, { response: { message: 'no route' } });
    return jsonResponse(r.status, typeof r.body === 'function' ? r.body(call) : r.body);
  };
  route('GET', `/api/v1/civilian/${OWN_CIV}`, 200, civ(OWN_CIV, USER_ID, COMMUNITY_ID, 'Mine'));
  route('GET', `/api/v1/civilian/${OTHER_CIV}`, 200, civ(OTHER_CIV, OTHER_USER_ID, COMMUNITY_ID, 'Theirs'));
  route('GET', `/api/v1/civilian/${OWN_CIV_ELSEWHERE}`, 200, civ(OWN_CIV_ELSEWHERE, USER_ID, OTHER_COMMUNITY_ID, 'Elsewhere'));
  route('GET', '/api/v2/user/active-civilian', 200, () => (savedPick ? { civilianId: savedPick } : null));
});

afterEach(() => {
  global.fetch = realFetch;
});

function fakeClient() {
  const collections = {
    users: { _id: new ObjectId(USER_ID), user: { lastAccessedCommunity: { communityID: COMMUNITY_ID } } },
    communities: { community: { economy: { enabled: true } } },
    bot_active_civilians: null,
  };
  return {
    config: { api_url: 'http://api.test', IconURL: 'https://example.test/icon.png' },
    dbo: {
      collection: (name) => ({
        findOne: async () => collections[name] || null,
        updateOne: async () => { throw new Error(`unexpected direct write to ${name}`); },
      }),
    },
    verifyUseCommand: async () => true,
    error: () => {},
  };
}

function fakeInteraction() {
  const out = { edits: [], sends: [] };
  return {
    out,
    channel_id: 'c1',
    member: { user: { id: 'discord-1' }, roles: [] },
    send: async (m) => out.sends.push(m),
    defer: async () => {},
    editOriginal: async (m) => out.edits.push(m),
  };
}

const guild = { GuildDB: { customChannelStatus: false, serverID: 'g1' } };

function lastContent(interaction) {
  const edit = interaction.out.edits[interaction.out.edits.length - 1];
  return edit && edit.content;
}

// ---- resolveCivilian ----

test('an explicit civilian of your own in this community is used', async () => {
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, OWN_CIV);
  assert.equal(res.civilianId, OWN_CIV);
  assert.equal(res.message, null);
});

test("an explicit civilian belonging to someone else is refused", async () => {
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, OTHER_CIV);
  assert.equal(res.civilianId, null);
  assert.match(res.message, /isn't yours in this community/);
});

test('your own civilian from a different community is refused', async () => {
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, OWN_CIV_ELSEWHERE);
  assert.equal(res.civilianId, null);
  assert.match(res.message, /isn't yours in this community/);
});

test('a civilian id that does not exist is refused', async () => {
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, new ObjectId().toString());
  assert.equal(res.civilianId, null);
  assert.match(res.message, /isn't yours in this community/);
});

test('a saved pick is checked too, and points at /set-active-civilian when unusable', async () => {
  savedPick = OTHER_CIV;
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, '');
  assert.equal(res.civilianId, null);
  assert.match(res.message, /\/set-active-civilian/);
});

test('a saved pick of your own is used', async () => {
  savedPick = OWN_CIV;
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, '');
  assert.equal(res.civilianId, OWN_CIV);
});

test('no pick at all leaves the message to the caller', async () => {
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, '');
  assert.equal(res.civilianId, null);
  assert.equal(res.message, null);
});

test('an API failure fails closed', async () => {
  routes.unshift({ method: 'GET', prefix: `/api/v1/civilian/${OTHER_CIV}`, status: 500, body: {} });
  const res = await resolveCivilian(fakeClient(), USER_ID, COMMUNITY_ID, OTHER_CIV);
  assert.equal(res.civilianId, null);
  assert.match(res.message, /try again/);
});

// ---- /wallet ----

test("/wallet refuses someone else's civilian without reading their wallet", async () => {
  const interaction = fakeInteraction();
  await wallet.SlashCommand.run(fakeClient(), interaction, [{ name: 'civilian', value: OTHER_CIV }], guild);

  assert.match(lastContent(interaction), /isn't yours in this community/);
  assert.ok(!calls.some((c) => c.path.startsWith('/api/v2/economy/wallet/')), 'no wallet request was made');
});

test('/wallet identifies the caller to the API', async () => {
  route('GET', `/api/v2/economy/wallet/${OWN_CIV}`, 200, { civilianId: OWN_CIV, balance: 1000, recentInbox: [] });
  route('GET', '/api/v2/economy/session/active', 200, null);
  const interaction = fakeInteraction();
  await wallet.SlashCommand.run(fakeClient(), interaction, [{ name: 'civilian', value: OWN_CIV }], guild);

  const req = calls.find((c) => c.path.startsWith('/api/v2/economy/wallet/'));
  assert.ok(req, 'wallet was requested');
  assert.match(req.path, new RegExp(`userId=${USER_ID}`));
  assert.equal(interaction.out.edits[0].embeds.length, 1);
});

// ---- /set-active-civilian ----

test("/set-active-civilian refuses someone else's civilian and saves nothing", async () => {
  route('PUT', '/api/v2/user/active-civilian', 200, {});
  const interaction = fakeInteraction();
  await setActiveCivilian.SlashCommand.run(fakeClient(), interaction, [{ name: 'civilian', value: OTHER_CIV }], guild);

  assert.match(lastContent(interaction), /isn't yours in this community/);
  assert.ok(!calls.some((c) => c.method === 'PUT'), 'no PUT was sent');
});

test('/set-active-civilian saves your own civilian through the API only', async () => {
  route('PUT', '/api/v2/user/active-civilian', 200, {});
  const interaction = fakeInteraction();
  // fakeClient's updateOne throws, so a legacy direct write would fail this test.
  await setActiveCivilian.SlashCommand.run(fakeClient(), interaction, [{ name: 'civilian', value: OWN_CIV }], guild);

  const put = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, { userId: USER_ID, communityId: COMMUNITY_ID, civilianId: OWN_CIV });
  assert.equal(interaction.out.edits[0].embeds[0].data.title, 'Mine Doe');
});

test('/set-active-civilian reports an API refusal instead of saving it locally', async () => {
  route('PUT', '/api/v2/user/active-civilian', 403, { response: { message: "that civilian isn't yours in this community" } });
  const interaction = fakeInteraction();
  await setActiveCivilian.SlashCommand.run(fakeClient(), interaction, [{ name: 'civilian', value: OWN_CIV }], guild);

  assert.match(lastContent(interaction), /Failed to save/);
});

// ---- fine autocomplete ----

test('fine autocomplete identifies the caller to the API', async () => {
  route('GET', '/api/v2/economy/inbox', 200, { data: [] });
  await fetchInboxChoices(fakeClient(), USER_ID, OWN_CIV, COMMUNITY_ID, '', ['pending']);
  const req = calls.find((c) => c.path.startsWith('/api/v2/economy/inbox'));
  assert.match(req.path, new RegExp(`userId=${USER_ID}`));
  assert.match(req.path, new RegExp(`civilianId=${OWN_CIV}`));
});
