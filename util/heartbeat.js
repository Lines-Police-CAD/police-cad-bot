/**
 * Bot health heartbeat.
 *
 * The bot runs on a volunteer's machine, so nobody notices when that machine
 * goes offline. Every 60 seconds this posts a small "I am alive" beat to the
 * API's public health route; the API alerts if it stops hearing from us.
 *
 * Two rules drive everything in here:
 *
 * 1. A heartbeat must NEVER take the bot down. It is fire-and-forget: every
 *    path is wrapped in try/catch, the fetch carries an abort timeout, nothing
 *    is ever rethrown, and no promise is left to reject unhandled. A broken
 *    API, a dead network, or a hung socket costs us a skipped beat, nothing
 *    more.
 *
 * 2. A heartbeat must only be sent when the bot is ACTUALLY healthy. We check
 *    the live gateway state, not "we finished starting up once". `client.Ready`
 *    is set once in events/ready.js and is never reset on disconnect, so using
 *    it would keep the monitor green while the bot sat there hung, which is the
 *    exact failure this feature exists to catch.
 *
 * This deliberately does not go through util/api.js: `apiRequest` sends a
 * Bearer api_token, throws on failure, and has no timeout. The heartbeat needs
 * a dedicated header, a timeout, and must not throw.
 *
 * Each shard is its own process (index.js uses a ShardingManager), so each
 * shard runs its own interval and reports its own id and guild count.
 */

"use strict";

// discord.js WebSocketManager status. 0 is Status.Ready; compared numerically
// so this module stays dependency free and unit-testable with a plain stub.
const WS_STATUS_READY = 0;

const HEARTBEAT_PATH = "/health/discord-bot/heartbeat";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 10 * 1000;

// Failures are logged sparsely on purpose. A host that has lost its network
// would otherwise write an error line every 60 seconds forever. We log the
// first failure in a run of failures, then at most one line per throttle
// window, then one line when beats start landing again.
const FAILURE_LOG_THROTTLE_MS = 15 * 60 * 1000;

function logInfo(client, text) {
  try {
    if (client && typeof client.log === "function") client.log(text);
  } catch (_) {
    /* logging must never break the heartbeat */
  }
}

function logError(client, text) {
  try {
    if (client && typeof client.error === "function") client.error(text);
  } catch (_) {
    /* logging must never break the heartbeat */
  }
}

/**
 * Live liveness check. True only when this shard's gateway connection is
 * genuinely up right now.
 */
function isGatewayConnected(client) {
  try {
    return (
      !!client &&
      !!client.ws &&
      client.ws.status === WS_STATUS_READY &&
      client.uptime !== null &&
      client.uptime !== undefined
    );
  } catch (_) {
    return false;
  }
}

function heartbeatState(client) {
  if (!client.heartbeat) {
    client.heartbeat = {
      timer: null,
      failureCount: 0,
      lastFailureLogAt: 0,
    };
  }
  return client.heartbeat;
}

function noteFailure(client, reason) {
  const state = heartbeatState(client);
  state.failureCount += 1;
  const now = Date.now();
  if (
    state.failureCount === 1 ||
    now - state.lastFailureLogAt >= FAILURE_LOG_THROTTLE_MS
  ) {
    state.lastFailureLogAt = now;
    logError(
      client,
      `Heartbeat failed (${state.failureCount} in a row): ${reason}`,
    );
  }
}

function noteSuccess(client) {
  const state = heartbeatState(client);
  if (state.failureCount > 0) {
    logInfo(
      client,
      `Heartbeat recovered after ${state.failureCount} failed attempt(s)`,
    );
  }
  state.failureCount = 0;
  state.lastFailureLogAt = 0;
}

function buildPayload(client) {
  const uptimeMs = typeof client.uptime === "number" ? client.uptime : 0;
  return {
    shardId: client.shard?.ids?.[0] ?? 0,
    guildCount: client.guilds?.cache?.size ?? 0,
    version: client.config?.Version ?? "",
    uptimeSeconds: Math.floor(uptimeMs / 1000),
  };
}

function abortTimeout(ms) {
  // AbortSignal.timeout landed in Node 17.3; the bot requires Node 18+. Guard
  // anyway so an older runtime loses the timeout instead of the heartbeat.
  try {
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      return AbortSignal.timeout(ms);
    }
  } catch (_) {
    /* fall through */
  }
  return undefined;
}

/**
 * Send one heartbeat. Resolves either way and never rejects, so callers do not
 * need to catch and an unawaited call cannot produce an unhandled rejection.
 * Returns true only when the API accepted the beat.
 */
async function sendHeartbeat(client) {
  try {
    if (!isGatewayConnected(client)) return false; // unhealthy: stay silent

    const baseUrl = String(client.config?.api_url || "").replace(/\/+$/, "");
    const token = client.config?.bot_heartbeat_token || "";
    if (!baseUrl || !token) return false; // not configured: stay silent

    const res = await fetch(`${baseUrl}${HEARTBEAT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Heartbeat-Token": token,
      },
      body: JSON.stringify(buildPayload(client)),
      signal: abortTimeout(HEARTBEAT_TIMEOUT_MS),
    });

    // Drain the body so the socket is released. The status alone is logged;
    // the response is never echoed anywhere.
    try {
      await res.text();
    } catch (_) {
      /* body is irrelevant */
    }

    if (!res.ok) {
      noteFailure(client, `API responded ${res.status}`);
      return false;
    }

    noteSuccess(client);
    return true;
  } catch (err) {
    // Network failure, DNS failure, abort timeout, bad config, anything.
    const name = err && err.name ? `${err.name}: ` : "";
    const message = err && err.message ? err.message : String(err);
    noteFailure(client, `${name}${message}`);
    return false;
  }
}

/**
 * Start this shard's heartbeat interval. Safe to call more than once; a second
 * call is a no-op while an interval is already running.
 */
function startHeartbeat(client) {
  try {
    const state = heartbeatState(client);
    if (state.timer) return state.timer;

    if (!client.config?.api_url || !client.config?.bot_heartbeat_token) {
      logInfo(
        client,
        "Heartbeat disabled: API_URL and BOT_HEARTBEAT_TOKEN must both be set",
      );
      return null;
    }

    state.timer = setInterval(() => {
      // Explicitly swallow here too: setInterval does not await the callback,
      // so a rejection would surface as an unhandled rejection.
      sendHeartbeat(client).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    // Do not hold the event loop open just for the heartbeat.
    if (typeof state.timer.unref === "function") state.timer.unref();

    // Send one immediately so a restart shows up without waiting a minute.
    sendHeartbeat(client).catch(() => {});

    logInfo(
      client,
      `Heartbeat started for shard ${client.shard?.ids?.[0] ?? 0} (every ${
        HEARTBEAT_INTERVAL_MS / 1000
      }s)`,
    );
    return state.timer;
  } catch (err) {
    logError(
      client,
      `Heartbeat failed to start: ${err && err.message ? err.message : err}`,
    );
    return null;
  }
}

/** Stop this shard's heartbeat interval. Safe to call when none is running. */
function stopHeartbeat(client) {
  try {
    const state = client && client.heartbeat;
    if (state && state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  } catch (_) {
    /* shutdown must never throw */
  }
}

module.exports = {
  startHeartbeat,
  stopHeartbeat,
  sendHeartbeat,
  isGatewayConnected,
  HEARTBEAT_PATH,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
};
