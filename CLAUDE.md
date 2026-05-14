# police-cad-bot — Claude instructions

## Documentation Wiki — keep it in sync

The bot has a docs site served from `/docs` via GitHub Pages on `main`:
**https://bot.linespolice-cad.com**

The site renders command metadata from [`docs/commands.json`](./docs/commands.json), which is **generated** by [`scripts/build-docs.js`](./scripts/build-docs.js) from `commands/*.js`.

**When you add, remove, or modify any command** (anything in `commands/`), you MUST:

1. Run `node scripts/build-docs.js`
2. Commit the regenerated `docs/commands.json` alongside the command change

CI will fail the PR otherwise — see [`.github/workflows/docs-sync.yml`](./.github/workflows/docs-sync.yml).

For larger changes (a new command category, a new prerequisite the user must satisfy, a new failure mode), also update the **hand-written** sections of [`docs/index.html`](./docs/index.html) — the Setup guide and FAQ. The command-card list itself is generated, but the surrounding narrative isn't.

## Git workflow

- Feature branches: `feature/<name>`
- Push to feature branch, open PR against `main` — never push directly
- One-time post-merge step (Pages enablement): repo Settings → Pages → source = `main` `/docs`
