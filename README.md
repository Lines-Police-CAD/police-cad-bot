<img src="https://raw.githubusercontent.com/Linesmerrill/police-cad/main/public/images/lines-police-cad-discord-logo-2024-github-profile.png" alt="Lines Police CAD" width="200" />

# Lines Police CAD — Discord Bot

The official Discord bot for [Lines Police CAD](https://linespolice-cad.com). Allows community members to interact with the CAD system directly from Discord using slash commands.

## 📚 Documentation

The full, always-up-to-date command reference, setup guide, and FAQ live on the docs site:

**→ [bot.linespolice-cad.com](https://bot.linespolice-cad.com)**

The site is generated from the bot source — see [`docs/`](./docs/) and [`scripts/build-docs.js`](./scripts/build-docs.js). CI fails any PR that changes a command without regenerating `docs/commands.json`.

## Requirements

- [Node.js](https://nodejs.org/en/) v18+
- [MongoDB](https://docs.mongodb.com/manual/administration/install-community/) (or a MongoDB Atlas connection string)
- A Discord Bot Application ([discord.com/developers](https://discord.com/developers/applications))

## Getting Started

1. Clone the repository:
   ```
   git clone https://github.com/Lines-Police-CAD/police-cad-bot.git && cd police-cad-bot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in your values:
   ```
   cp .env.example .env
   ```

   | Variable | Description |
   |---|---|
   | `dbo` | MongoDB database name |
   | `mongoURI` | MongoDB connection URI |
   | `token` | Discord bot token |
   | `API_URL` | Lines Police CAD API base URL |
   | `API_TOKEN` | API authentication token (if required) |
   | `BOT_HEARTBEAT_TOKEN` | Health heartbeat secret. Must match the same variable on the API. Leave unset to disable heartbeating. |

4. Start the bot:
   ```
   npm start
   ```

## Health monitoring

Once `API_URL` and `BOT_HEARTBEAT_TOKEN` are set, each shard posts a heartbeat to the API every 60 seconds while its gateway connection is live. The API alerts the team if the beats stop, so an outage on the bot host is noticed in minutes instead of waiting on a support ticket.

Notes for whoever runs the bot:

- Heartbeating only begins after the host pulls this change and restarts the bot. An already-running process keeps running the old code and will look offline to the monitor.
- `BOT_HEARTBEAT_TOKEN` must be set to the same value the API uses. If it is missing the bot logs one line at startup and runs normally, just without heartbeating.
- Heartbeats are fire and forget. A failed beat never interrupts commands, and repeated failures are logged sparsely rather than once per attempt.

## Development

For local development, create a separate Discord Application at [discord.com/developers](https://discord.com/developers/applications) and use a test server. Set the dev bot token in your `.env` and point `API_URL` at your dev API instance.

Make sure to enable these **Privileged Gateway Intents** in your bot's settings:
- Message Content Intent
- Server Members Intent
- Presence Intent
