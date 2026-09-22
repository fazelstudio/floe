#!/usr/bin/env node
/**
 * Floe CLI
 * Commands:
 *   floe check <file.floe> [--json] [--quiet]
 *   floe format <file.floe> [--write] [--check]
 *   floe render <file.floe> [-o output.svg]
 *   floe lsp [--stdio]   (starts LSP server)
 *
 * Keep CLI behavior scriptable for CI with appropriate exit codes:
 *   0 success
 *   1 validation / check failure
 *   2 usage / file not found error
 *
 * Treat .floe files as untrusted: never eval, ensure SVG cannot execute code.
 * This CLI never uses eval and delegates to safe core.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { runCheck } from "./check.js";
import { runFormat } from "./format.js";
import { runRender } from "./render.js";

const VERSION = "1.2.0";

function printHelp(): void {
  console.log(`Floe ${VERSION} — diagram DSL (lightweight, human-readable, AI-friendly)

Usage:
  floe <command> [options] <file...>

Commands:
  init    Scaffold a new .floe starter file
  check   Validate a .floe file and print diagnostics
  format  Format file using canonical formatter
  render  Produce SVG output
  lsp     Start Language Server (stdio)
  help    Show this help

Options:
  -h, --help     Show help
  -v, --version  Show version

Init:
  floe init [diagram.floe]
    Creates a starter file (refuses to overwrite existing).

Check:
  floe check diagram.floe [--json] [--quiet]
    --json   Output diagnostics as JSON
    --quiet  Suppress OK messages

Format:
  floe format diagram.floe [--write] [--check]
    --write  Overwrite file in place
    --check  Exit 1 if file not formatted (for CI)
    (default: print formatted content to stdout)

Render:
  floe render diagram.floe [-o output.svg] [--theme light|dark|auto] [--background <color>] [--font <family>]
    -o, --output <file>  Write SVG to file (default: stdout)
    --theme <t>          Override meta theme (light/dark/auto)
    --background <c>     Override background (color or transparent)
    --font <f>           Override font family

LSP:
  floe lsp [--stdio]
    Starts LSP server over stdio (for editor integration)

Exit codes:
  0  success
  1  validation error / not formatted / render had errors
  2  usage or file error

Examples:
  floe init my-flow.floe
  floe check diagram.floe
  floe format diagram.floe --write
  floe render diagram.floe -o diagram.svg --theme dark
  floe lsp

Syntax (additive, old files still valid):
  direction LR
  User [person] "End User"
  User -> Login -> Dashboard : success
  API -> Worker, Cache : fan-out
  Cache <-> API : sync (bidirectional)
  Critical ==> Alert : hot path (emphasis)
  E1: Gateway -> Cache : warm (named edge)
  meta Gateway.fill = "#dbeafe" (per-element style)
  group Backend "Services" { API -> Worker : rpc }
  meta title = "My Flow"
  meta theme = "auto"   // light|dark|auto
  meta legend = "true"
  note API "Handles auth"
  link API "https://api.example.com"

Docs: SPEC.md + docs/02-syntax.md
`);
}

function printVersion(): void {
  console.log(VERSION);
}

function parseArgs(argv: string[]): { command?: string; files: string[]; opts: Record<string, any> } {
  const args = argv.slice(2);
  if (args.length === 0) return { files: [], opts: {} };
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    return { command: "help", files: [], opts: {} };
  }
  if (args[0] === "--version" || args[0] === "-v" || args[0] === "version") {
    return { command: "version", files: [], opts: {} };
  }
  const command = args[0];
  const rest = args.slice(1);
  const files: string[] = [];
  const opts: Record<string, any> = {};
  let i = 0;
  while (i < rest.length) {
    const a = rest[i]!;
    if (a === "--json") { opts.json = true; i++; }
    else if (a === "--quiet" || a === "-q") { opts.quiet = true; i++; }
    else if (a === "--write" || a === "-w") { opts.write = true; i++; }
    else if (a === "--check" || a === "-c") { opts.check = true; i++; }
    else if (a === "--stdio") { opts.stdio = true; i++; }
    else if (a === "--theme") {
      const next = rest[i + 1];
      if (!next || !["light", "dark", "auto"].includes(next)) { console.error(`floe ${command}: --theme must be light|dark|auto`); process.exit(2); }
      opts.theme = next; i += 2;
    }
    else if (a === "--background") {
      const next = rest[i + 1];
      if (!next) { console.error(`floe ${command}: missing value for ${a}`); process.exit(2); }
      opts.background = next; i += 2;
    }
    else if (a === "--font") {
      const next = rest[i + 1];
      if (!next) { console.error(`floe ${command}: missing value for ${a}`); process.exit(2); }
      opts.font = next; i += 2;
    }
    else if (a === "-o" || a === "--output") {
      const next = rest[i + 1];
      if (!next) { console.error(`floe ${command}: missing value for ${a}`); process.exit(2); }
      opts.output = next; i += 2;
    } else if (a === "--help" || a === "-h") { opts.help = true; i++; }
    else if (a === "--version" || a === "-v") { opts.version = true; i++; }
    else if (a.startsWith("-")) {
      console.error(`floe ${command}: unknown option ${a}`);
      console.error(`Run 'floe ${command} --help' for usage.`);
      process.exit(2);
    } else { files.push(a); i++; }
  }
  return { command, files, opts };
}

function runInit(files: string[]): number {
  const target = files[0] ?? "diagram.floe";
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved)) {
    console.error(`floe init: file already exists: ${target} (refusing to overwrite)`);
    return 2;
  }
  const template = `// Floe v1.1 — starter (lightweight, human-readable, AI-friendly)
direction LR
meta title = "My Flow"
meta theme = "auto"
meta legend = "true"

User [person] "End User"
Login
Dashboard
API [service] "Gateway"
Worker
Cache
Critical
Alert

User -> Login -> Dashboard : success
API -> Worker, Cache : fan-out
Cache <-> API : sync
Critical ==> Alert : hot path

group Backend "Services" {
  API -> Worker : rpc
}

note API "Handles auth"
link API "https://api.example.com"
`;
  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, template, "utf-8");
    console.log(`created ${path.relative(process.cwd(), resolved)}`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`floe init: cannot write '${target}': ${msg}`);
    return 2;
  }
}

async function main(): Promise<void> {
  const { command, files, opts } = parseArgs(process.argv);
  if (!command) { printHelp(); process.exit(2); }
  if (command === "help") { printHelp(); process.exit(0); }
  if (command === "version") { printVersion(); process.exit(0); }
  if (opts.help) { printHelp(); process.exit(0); }
  if (opts.version) { printVersion(); process.exit(0); }
  let exitCode = 0;
  switch (command) {
    case "init": { exitCode = runInit(files); break; }
    case "check": { exitCode = runCheck(files, { json: !!opts.json, quiet: !!opts.quiet }); break; }
    case "format": { exitCode = runFormat(files, { write: !!opts.write, check: !!opts.check, json: !!opts.json }); break; }
    case "render": { exitCode = runRender(files, { output: opts.output, json: !!opts.json, theme: opts.theme, background: opts.background, font: opts.font }); break; }
    case "lsp":
    case "lsp-server": {
      const { startLspServer } = await import("../lsp/server.js");
      await startLspServer({ stdio: true });
      return;
    }
    default: { console.error(`floe: unknown command '${command}'`); console.error("Run 'floe --help' for usage."); process.exit(2); }
  }
  process.exit(exitCode);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`floe: internal error: ${msg}`);
  if (process.env.FLOE_DEBUG) console.error(e instanceof Error ? e.stack : "");
  process.exit(1);
});
