// Discord /clock-in and /clock-out behaviour around the shift-source fix.
// Run with `npm test`. fetch is stubbed, so no API or Discord is needed.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { civilianRejectionMessage, closedShiftMessage } = require('../util/economy');
const clockIn = require('../commands/clock-in');
const clockOut = require('../commands/clock-out');

const USER_ID = new ObjectId().toString();
const COMMUNITY_ID = new ObjectId().toString();
const DEPT_ID = new ObjectId().toString();
const CIV_ID = new ObjectId().toString();

// ---- fakes ----

let calls;
let routes;
const realFetch = global.fetch;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  calls = [];
  routes = [];
  global.fetch = async (url, opts) => {
    const path = url.replace('http://api.test', '');
    const call = { method: opts.method, path, body: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(call);
    const route = routes.find((r) => r.method === opts.method && path.startsWith(r.prefix));
    if (!route) return jsonResponse(404, { response: { message: 'no route' } });
    return jsonResponse(route.status, typeof route.body === 'function' ? route.body(call) : route.body);
  };
});

afterEach(() => {
  global.fetch = realFetch;
});

function route(method, prefix, status, body) {
  routes.push({ method, prefix, status, body });
}

function fakeClient() {
  const collections = {
    users: { _id: new ObjectId(USER_ID), user: { lastAccessedCommunity: { communityID: COMMUNITY_ID } } },
    communities: {
      community: {
        economy: { enabled: true },
        departments: [{ _id: DEPT_ID, name: 'LSPD', economyEnabled: true, approvalRequired: false }],
      },
    },
    civilians: { _id: new ObjectId(CIV_ID), civilian: { firstName: 'Test', lastName: 'Dude' } },
    bot_active_civilians: null,
  };
  return {
    config: { api_url: 'http://api.test', IconURL: 'https://example.test/icon.png' },
    dbo: { collection: (name) => ({ findOne: async () => collections[name] || null }) },
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

function apiError(status, message) {
  const err = new Error(`API POST /x failed (${status})`);
  err.status = status;
  err.reason = message;
  return err;
}

// ---- /clock-in ----

test('/clock-in tells the API the shift came from Discord', async () => {
  route('GET', '/api/v2/user/active-civilian', 200, { civilianId: CIV_ID });
  route('POST', '/api/v2/economy/clock-in', 201, (call) => ({
    ...call.body, _id: 's1', departmentName: 'LSPD', payRateSnapshot: 2500, payoutMode: 'on_clockout', maxSessionMinutes: 120,
  }));
  const interaction = fakeInteraction();

  await clockIn.SlashCommand.run(fakeClient(), interaction, [{ name: 'department', value: DEPT_ID }], guild);

  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.source, 'discord');
  assert.equal(post.body.civilianId, CIV_ID);
  assert.equal(interaction.out.edits[0].embeds.length, 1);
});

test('/clock-in with a deleted saved civilian points at /set-active-civilian', async () => {
  route('GET', '/api/v2/user/active-civilian', 200, { civilianId: CIV_ID });
  route('POST', '/api/v2/economy/clock-in', 404, {
    response: { message: 'civilian not found; it may have been deleted. Pick another civilian to clock in' },
  });
  const interaction = fakeInteraction();

  await clockIn.SlashCommand.run(fakeClient(), interaction, [{ name: 'department', value: DEPT_ID }], guild);

  assert.match(lastContent(interaction), /active civilian no longer exists/);
  assert.match(lastContent(interaction), /\/set-active-civilian/);
  assert.doesNotMatch(lastContent(interaction), /Unknown|Department not found/);
});

test('/clock-in department 404 still reads as department not found', async () => {
  route('GET', '/api/v2/user/active-civilian', 200, { civilianId: CIV_ID });
  route('POST', '/api/v2/economy/clock-in', 404, { response: { message: 'department not found' } });
  const interaction = fakeInteraction();

  await clockIn.SlashCommand.run(fakeClient(), interaction, [{ name: 'department', value: DEPT_ID }], guild);

  assert.equal(lastContent(interaction), 'Department not found.');
});

test('civilianRejectionMessage', () => {
  const gone = 'civilian not found; it may have been deleted. Pick another civilian to clock in';
  assert.match(civilianRejectionMessage(apiError(404, gone), false), /\/set-active-civilian/);
  assert.match(civilianRejectionMessage(apiError(404, gone), true), /That civilian no longer exists/);
  assert.doesNotMatch(civilianRejectionMessage(apiError(404, gone), true), /set-active-civilian/);
  assert.match(civilianRejectionMessage(apiError(403, 'that civilian does not belong to you'), false), /isn't on your account/);
  assert.equal(civilianRejectionMessage(apiError(403, 'user is not a member of this department'), false), null);
  assert.equal(civilianRejectionMessage(apiError(404, 'department not found'), false), null);
  assert.equal(civilianRejectionMessage(new Error('network down'), false), null);
});

// ---- /clock-out ----

test('/clock-out after the shift was swept explains it and what it paid', async () => {
  route('GET', '/api/v2/economy/session/active', 200, null);
  route('GET', '/api/v2/economy/session/last-closed', 200, {
    _id: 's1', status: 'abandoned', departmentName: 'LSPD', earnings: 40, paidSeconds: 60,
    endedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  });
  const interaction = fakeInteraction();

  await clockOut.SlashCommand.run(fakeClient(), interaction, [], guild);

  const content = lastContent(interaction);
  assert.match(content, /LSPD/);
  assert.match(content, /for inactivity/);
  assert.match(content, /\$0\.40/);
  assert.match(content, /1m 0s/);
  assert.ok(!calls.some((c) => c.method === 'POST'), 'must not try to clock out a closed shift');
});

test('/clock-out with no recent closed shift keeps the plain message', async () => {
  route('GET', '/api/v2/economy/session/active', 200, null);
  route('GET', '/api/v2/economy/session/last-closed', 200, {
    _id: 's1', status: 'ended', endedAt: new Date().toISOString(),
  });
  const interaction = fakeInteraction();

  await clockOut.SlashCommand.run(fakeClient(), interaction, [], guild);

  assert.equal(lastContent(interaction), `You don't have an active shift to clock out of.`);
});

test('/clock-out falls back to the plain message when last-closed is unavailable', async () => {
  route('GET', '/api/v2/economy/session/active', 200, null);
  const interaction = fakeInteraction();

  await clockOut.SlashCommand.run(fakeClient(), interaction, [], guild);

  assert.equal(lastContent(interaction), `You don't have an active shift to clock out of.`);
});

test('/clock-out ends an active shift through the API', async () => {
  route('GET', '/api/v2/economy/session/active', 200, { _id: 's1', status: 'active', civilianId: CIV_ID });
  route('POST', '/api/v2/economy/clock-out', 200, {
    session: { _id: 's1', status: 'ended', departmentName: 'LSPD', civilianId: CIV_ID, startedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString() },
    creditedAmount: 1875,
  });
  const interaction = fakeInteraction();

  await clockOut.SlashCommand.run(fakeClient(), interaction, [], guild);

  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { sessionId: 's1' });
  const fields = interaction.out.edits[0].embeds[0].toJSON().fields;
  assert.equal(fields.find((f) => f.name === '**Earned**').value, '`$18.75`');
});

test('closedShiftMessage', () => {
  const now = Date.parse('2026-10-17T20:00:00Z');
  const recent = new Date(now - 60 * 60 * 1000).toISOString();
  const old = new Date(now - 25 * 60 * 60 * 1000).toISOString();

  const expired = closedShiftMessage({ status: 'expired', departmentName: 'EMS', maxSessionMinutes: 90, earnings: 3750, paidSeconds: 5400, endedAt: recent }, now);
  assert.match(expired, /reached the 90m max session/);
  assert.match(expired, /\$37\.50/);
  assert.match(expired, /1h 30m/);
  assert.match(expired, /<t:\d+:R>/);

  assert.equal(closedShiftMessage({ status: 'ended', endedAt: recent }, now), null);
  assert.equal(closedShiftMessage({ status: 'abandoned', endedAt: old }, now), null);
  assert.equal(closedShiftMessage({ status: 'abandoned' }, now), null);
  assert.equal(closedShiftMessage(null, now), null);
});
