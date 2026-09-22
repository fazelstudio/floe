/**
 * Floe — Diagram DSL public API (v1.0 stable)
 *
 * Core language does not depend on CodeMirror, React, Vue, DOM, SVG, Canvas, Dagre, ELK, or LSP.
 * This entry point re-exports pure language primitives.
 * Language services are editor-independent (see src/language/).
 *
 * Stability: exports listed under "Stable Public API" in docs/api.md are semver-stable.
 * Exports marked @internal are deprecated and may be hidden in 2.0 — prefer stable wrappers.
 */
export { rangeToString } from "./range.js"; // utility, stable
export { DEFAULT_DIRECTION, DIRECTIONS, IDENTIFIER_RE, isValidIdentifier, STYLE_KEYS, isStyleKey, } from "./types.js";
export type { Direction, EdgeKind, FloeStyle, StyleKey, FloeNode, FloeEdge, FloeGroup, FloeAnnotation, FloeLink, FloeDiagram, ParseResult, } from "./types.js";
// ── Stable: high-level parse API ──
// parseFloe is the recommended entry; parse is alias; parseRaw is raw without validation (stable).
// Parser class and Lexer are low-level and considered @internal/low-level (still exported for tooling compat).
export { Lexer, tokenize } from "./lexer.js"; // @internal low-level
export { Parser, parse as parseRaw, parseRaw as parseRawFloe } from "./parser.js"; // @internal low-level: prefer parseRaw() function
export { validate } from "./validator.js"; // @internal: validation is internal phase, use parseFloe()
import { Parser } from "./parser.js";
import { validate } from "./validator.js";
/**
 * @stable
 * Parse Floe source with full pipeline:
 *  1. lexical analysis
 *  2. grammar-based parsing (with source ranges, error recovery)
 *  3. semantic validation (separate phase)
 *
 * Never throws on malformed input — returns diagnostics instead.
 * This is the recommended entry point (stable).
 */
export function parseFloe(source) {
    const raw = new Parser(source).parse();
    const validated = validate({
        diagram: raw.diagram,
        diagnostics: raw.diagnostics,
        explicitNodes: raw.explicitNodes,
        edges: raw.edges,
        directionDeclarations: raw.directionDeclarations,
        groups: raw.groups,
        annotations: raw.annotations,
        links: raw.links,
    });
    return {
        diagram: validated.diagram,
        diagnostics: validated.diagnostics,
    };
}
/**
 * Alias: `parse` is the validated entry as well for ergonomics.
 * For raw (without validation) use `parseRaw` / `parseRawFloe`.
 */
export const parse = parseFloe;
// Convenience: check if source is valid (no error diagnostics)
export function isValid(source) {
    const { diagnostics } = parseFloe(source);
    return diagnostics.every((d) => d.severity !== "error");
}
// ---------------------------------------------------------------------------
// Language Tooling — editor-independent language services (stable)
// Re-export explicit stable surface instead of wildcard to avoid leaking internals.
// ---------------------------------------------------------------------------
export { getHighlightTokens, getHighlightingInfo, getCompletions, getDiagnostics, getDiagnosticsWithSource, lint, getHover, getSymbols, getFlatSymbols, getDefinition, getDefinitionForWord, getReferences, getReferencesForWord, rename, renameWord, applyEdits, format, isFormatted, getIndentForLine, getIndentationInfo, getIndentationColumn, DEFAULT_INDENT, getFoldingRanges, getFoldingInfo, buildSemanticModel, getSemanticModel, } from "./language/index.js";
export { FloeLanguageService, floeLanguageService } from "./language/index.js";
