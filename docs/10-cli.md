# Floe — CLI

**Bin:** `floe` → `dist/src/cli/main.js`  
**Version:** `1.2.0`  
**Commands:** `init`, `check`, `format`, `render`, `lsp`

## Usage
```bash
floe init [diagram.floe]                           # scaffold starter (refuses overwrite)
floe check diagram.floe [--json] [--quiet]       # exit 0 OK, 1 errors, 2 usage
floe format diagram.floe [--write] [--check]     # stdout default
floe render diagram.floe [-o output.svg] [--theme light|dark|auto] [--background <color>] [--font <family>]
floe lsp [--stdio]                               # Language Server over stdio
floe --help / --version
```

## `check`
Validates and prints diagnostics `file:line:column CODED severity message`.
- `--json` → JSON array `{file, diagnostics: {code,severity,message,range}, hasErrors}`
- `--quiet` → suppress `✔ OK`
- Exit: 0 no errors, 1 has errors, 2 missing file/usage

## `format`
Canonical deterministic formatting (see `07-formatting.md`).
- Default: print formatted to stdout
- `--write` → overwrite in place
- `--check` → exit 1 if not formatted (CI)
- `--write` and `--check` mutually exclusive → exit 2

## `render`
Produces SVG via `renderFloe` (deterministic, escaped, responsive).
- `floe render in.floe` → stdout
- `floe render in.floe -o out.svg` → file (creates dirs)
- `--theme light|dark|auto` overrides `meta theme`; `--background` and `--font` override canvas meta
- `-o` with multiple files → exit 2
- Exit: 1 if input had parse errors (but still writes best-effort SVG), 0 otherwise, 2 missing file

## `lsp`
- `floe lsp --stdio` → JSON-RPC over stdio with capabilities:
  `textDocumentSync: {openClose:true, change:1 (Full), save}`, `completionProvider {triggerChars: [" ","[","-",">",":","<","=",",","."], resolveProvider:false}`, `hoverProvider:true`, `definitionProvider:true`, `referencesProvider:true`, `renameProvider:{prepareProvider:true}`, `documentFormattingProvider:true`, `documentSymbolProvider:true`, `foldingRangeProvider:true`, `diagnosticProvider`
- Reuses `src/language/*` — no duplicate parsers.

## Security
- Files treated as untrusted: no `eval`, SVG escaped, `sanitizeUrl` for links.
- Reads via `fs.readFileSync(..., "utf-8")` only.

## Scriptable for CI
```bash
floe check *.floe --json | jq .
floe format *.floe --check || exit 1
floe render diagram.floe -o diagram.svg
```

See `src/cli/main.ts:1`, `tests/v02.test.ts`, and `docs/security.md`.
