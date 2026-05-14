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

## Deploying the docs site

The site is deployed by [`.github/workflows/pages-deploy.yml`](./.github/workflows/pages-deploy.yml):

- **Auto-deploy:** every push to `main` deploys `docs/` to https://bot.linespolice-cad.com.
- **Preview deploy:** Actions tab → "pages-deploy" → **Run workflow** → pick any branch. That branch's `docs/` becomes the live site at `bot.linespolice-cad.com` until someone re-deploys `main` (manually or by pushing to it). Useful for testing wiki changes before merging.

Pages source MUST be set to "GitHub Actions" in repo Settings → Pages (one-time configuration). Both deploy paths regenerate `docs/commands.json` from source as part of the build, so the deployed JSON always matches the deployed `commands/`.

## Git workflow

- Feature branches: `feature/<name>`
- Push to feature branch, open PR against `main` — never push directly
