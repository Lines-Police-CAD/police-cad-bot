const LinesPoliceCadBot = require("./structures/LinesPoliceCadBot");
const { GatewayIntentBits } = require("discord.js");
const config = require("./config/config");

process.on("unhandledRejection", (r) =>
  console.error("UNHANDLED REJECTION:", r),
);
process.on("uncaughtException", (e) => console.error("UNCAUGHT EXCEPTION:", e));

let client = new LinesPoliceCadBot(
  { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] },
  config,
);
client.build();
