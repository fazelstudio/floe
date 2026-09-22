# Changelog

All notable changes to Floe follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-22

Portable advance. No new deps, no breaking changes — v1.0/v1.1 files parse identically.

### Added
- Named edges `E1: A -> B : ok` (single edge only) + deterministic auto ids `e1..eN`
  (collision-free vs node/group ids); `note E1` / `link E1` may target edges.
- Scoped metadata `meta Target.key = "value"` (dot, no new keywords): style keys
  (`fill`, `stroke`, `strokeWidth`, `fontSize`, `fontColor`, `opacity`) override
  rendering in any environment; other keys become per-element custom metadata.
- Per-element `link` resolution for nodes/edges/groups; edge paths render clickable.
- Editor sub-ranges (`typeRange`/`labelRange`/`idRange`); hover/symbols/definition/
  rename understand edge ids; completion after `meta Target.`; `E015` duplicate
  edge id (+ collisions); `E013` for bad style values; `E014` for unknown scoped targets.
- Portability contract + tests: zero-`node:`/DOM core (CLI/LSP/optional dagre excluded),
  deterministic cross-runtime output, XSS-safe styles/links/labels.

## [1.1.0] - 2026-09-22

Global-ready additive expansion. Goal preserved: easy, lightweight, complex. No migration — v1.0 files parse identically.

### Added
- Edge operators `<->` (bidirectional, dual markers) and `==>` / `=>` (emphasis, 2.8px). Ranking treats all as directed for determinism.
- Chaining `A -> B -> C` (mixed ops allowed), label after `:` applies to last segment.
- Fan-in/out `A -> B, C`, `A, B -> C`, `A, B -> C, D` (cross product, shared label for single segment).
- Node shapes `ellipse`, `circle`, `cloud` (total 20 kinds, unknown falls back to default).
- Themes via `meta theme="light|dark|auto"`, `meta background/font/accent`, auto legend `meta legend="true"`, provenance `meta author/version`. CLI `floe init` + `render --theme/--background/--font`.
- Layout: group-clustered ordering + barycenter crossing reduction + backward elbow bypass + parallel offsets (ungrouped order unchanged).
- Docs `docs/02-syntax.md`, `04-rendering.md`, `05-layout.md`, `07-formatting.md`, `10-cli.md`, `12-examples.md`, examples `showcase-v1-1/decision-tree/microservices.floe`, corpus `edge-cases/{bidirectional,emphasis,chaining,fanout}.floe`, `metadata/theme-legend.floe`.

## [1.0.0] - 2026-09-05

Initial stable open source release.

### Added
- Stable language `v1.0` — frozen grammar documented in `docs/00-language-freeze.md` and `SPEC.md`; `direction`, `node [type] "label"`, `edge -> / -- : label`, `group { }` (nested), `meta`, `note`, `link`
- Renderer-independent IR — `FloeDiagram`, `FloeNode`, `FloeEdge` (`kind: directed | undirected`), `FloeGroup`, `FloeAnnotation`, `FloeLink`, `Range` with stable diagnostics `E001`–`E014`
- Deterministic layout `SimpleLayoutEngine` (zero-deps) and SVG renderer `renderSvg` / `renderFloe` with `escapeXml` / `escapeId` and URL sanitization `src/security/url.ts`
- Editor-independent language services — `diagnostics`, `completion`, `hover`, `symbols`, `definition`, `references`, `rename`, `formatting`, `highlighting`, `indentation`, `folding`
- CLI `floe check | format | render | lsp` (exit codes 0/1/2, `--json`, `--write`, `-o`) and LSP server (`src/lsp/server.ts`) reusing language services
- Comprehensive corpus `corpus/basic`, `labels`, `nodes`, `groups`, `direction`, `metadata`, `invalid`, `edge-cases`, `large` plus examples `examples/*.floe`
- Tests — `bun run test` 387 tests (parser, validator, language, layout, render, CLI, LSP, security, fuzz, corpus)
- Benchmarks `benchmarks/run.ts` → `benchmarks/results.json` and bundle sizes `scripts/measure-bundle.ts` → `benchmarks/bundle-size.json`
- Documentation `docs/` — Introduction, Syntax, Language Specification, Semantic Model, Rendering, Layout, Validation, Formatting, AI Generation, Editor Integration, CLI, LSP, API, Examples, Security, Versioning, Package Strategy

### Security
- Untrusted `.floe` input never executed; SVG output sanitized, `javascript:`/`data:` URLs flagged as `E014`.
