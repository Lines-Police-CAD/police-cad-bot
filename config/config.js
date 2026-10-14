require('dotenv').config()

module.exports = {
	Dev: "PRODUCTION",
	Version: "4.0.8",
  Admins: ["362791661274660874"], // Admins of the bot
	DefaultPrefix: "?",
	socket: "https://www.linespolice-cad.com/",
	SupportServer: "https://discord.gg/w2g2FFmHbF", //Support Server Link
	Token: process.env.token || "", //Discord Bot Token
  Scopes: ["identify", "guilds", "applications.commands"], //Discord OAuth2 Scopes
  IconURL: "https://raw.githubusercontent.com/Linesmerrill/police-cad/master/lines-police-cad.png",
  EmbedColor: "#0099ff",
  Permissions: 2205281600,
  // www, not the apex: the apex redirects to https://www.linespolice-cad.com
  // WITHOUT the path, so anything built on top of this that isn't the bare
  // homepage would land the user on the homepage instead.
  Website: "https://www.linespolice-cad.com",
  api_url: process.env.API_URL || "",
  api_token: process.env.API_TOKEN || "",
  // Server-to-server secret shared with the API (its API_GATEWAY_KEY).
  // api_token above is the shared service token, so it does not say which
  // person is acting. Endpoints that act for a specific LPC user take the user
  // id in the query string and only trust it when this secret comes with it.
  // Without it, /invite and /join cannot identify the caller.
  api_gateway_key: process.env.API_GATEWAY_KEY || "",
  mongoURI: process.env.mongoURI || "mongodb://localhost:27017",
  dbo: process.env.dbo || "knoldus",
  Colors: {
    Red: "#ba0f0f"
  },
  Presence: {
    status: "online", // You can show online, idle, and dnd
    name: "Grand Theft Auto V", // The message shown
    type: "PLAYING", // PLAYING, WATCHING, LISTENING, STREAMING
  },
}