const LinesPoliceCadBot = require("./structures/LinesPoliceCadBot");
const { GatewayIntentBits } = require("discord.js");
const config = require("./config/config");
const { stopHeartbeat } = require("./util/heartbeat");

process.on("unhandledRejection", (r) =>
  console.error("UNHANDLED REJECTION:", r),
);
process.on("uncaughtException", (e) => console.error("UNCAUGHT EXCEPTION:", e));

let client = new LinesPoliceCadBot(
  { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] },
  config,
);
client.build();

// Minimal shutdown handling. This shard process had none before; it is added
// so the health heartbeat interval is cleared and the gateway connection is
// closed rather than being torn down mid-request. Signals sent to the process
// group reach the ShardingManager in index.js too, so it exits alongside us
// instead of respawning this shard.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    stopHeartbeat(client);
  } catch (_) {
    /* shutdown must never throw */
  }
  try {
    client.destroy();
  } catch (_) {
    /* shutdown must never throw */
  }
  console.log(`Shard shutting down on ${signal}`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
