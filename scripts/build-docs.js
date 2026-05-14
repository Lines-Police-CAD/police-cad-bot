#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const COMMANDS_DIR = path.join(ROOT, "commands");
const OUT_FILE = path.join(ROOT, "docs", "commands.json");

const { CommandOptionTypes } = require(path.join(ROOT, "util", "CommandOptionTypes.js"));
const TYPE_NAME_BY_ID = Object.fromEntries(
  Object.entries(CommandOptionTypes).map(([name, id]) => [id, name])
);

const CATEGORY = {
  account: "Account",
  "disconnect-account": "Account",
  community: "Community",
  "check-status": "Dispatch",
  "update-status": "Dispatch",
  panic: "Dispatch",
  "signal-100": "Dispatch",
  "clock-in": "Economy",
  "clock-out": "Economy",
  wallet: "Economy",
  inbox: "Economy",
  "pay-fine": "Economy",
  "contest-fine": "Economy",
  "set-active-civilian": "Economy",
  search: "Lookup",
  case: "Lookup",
  "update-license": "Lookup",
  channels: "Admin",
  roles: "Admin",
  "ping-on-panic": "Admin",
  help: "Info",
  stats: "Info",
  debug: "Debug",
};

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((o) => ({
    name: o.name,
    description: o.description ?? "",
    type: TYPE_NAME_BY_ID[o.type] ?? `Type(${o.type})`,
    required: !!o.required,
    choices: Array.isArray(o.choices)
      ? o.choices.map((c) => ({ name: c.name, value: c.value }))
      : undefined,
    options: normalizeOptions(o.options),
  })).map((o) => {
    // drop empty arrays / undefined for compact JSON
    if (!o.choices) delete o.choices;
    if (!o.options || o.options.length === 0) delete o.options;
    return o;
  });
}

function buildCatalog() {
  const files = fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort();

  const commands = [];
  for (const file of files) {
    const mod = require(path.join(COMMANDS_DIR, file));
    if (!mod || !mod.name) {
      console.warn(`[build-docs] skipping ${file}: no exported command name`);
      continue;
    }
    commands.push({
      name: mod.name,
      description: mod.description ?? "",
      category: CATEGORY[mod.name] ?? "Other",
      usage: mod.usage ?? null,
      debug: !!mod.debug,
      permissions: {
        channel: mod.permissions?.channel ?? [],
        member: mod.permissions?.member ?? [],
      },
      options: normalizeOptions(mod.options),
    });
  }

  commands.sort((a, b) => a.name.localeCompare(b.name));

  return {
    generatedAt: null,
    sourceFiles: files.length,
    commands,
  };
}

function main() {
  const catalog = buildCatalog();
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const json = JSON.stringify(catalog, null, 2) + "\n";
  fs.writeFileSync(OUT_FILE, json);
  console.log(
    `[build-docs] wrote ${catalog.commands.length} commands to ${path.relative(ROOT, OUT_FILE)}`
  );
}

main();
