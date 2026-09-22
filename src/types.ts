import type { Range } from "./range.js";

export type Direction = "TB" | "BT" | "LR" | "RL";
export const DIRECTIONS: readonly Direction[] = ["TB", "BT", "LR", "RL"] as const;
export const DEFAULT_DIRECTION: Direction = "TB";

/**
 * Identifier rules:
 * - Must match: [A-Za-z_][A-Za-z0-9_-]*
 */
export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export function isValidIdentifier(id: string): boolean {
  return IDENTIFIER_RE.test(id);
}

/** Semantic edge kind — v1.0 directed/undirected, v1.1 adds bidirectional + emphasis */
export type EdgeKind = "directed" | "undirected" | "bidirectional" | "emphasis";

/** Per-element visual overrides (all optional, additive v1.2).
 *  Set via scoped metadata, e.g. `meta API.fill = "#dbeafe"`.
 *  Rendered in any environment (static docs, editors, web embeds). */
export interface FloeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontColor?: string;
  opacity?: number;
}

export const STYLE_KEYS = ["fill", "stroke", "strokeWidth", "fontSize", "fontColor", "opacity"] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];
export function isStyleKey(k: string): k is StyleKey {
  return (STYLE_KEYS as readonly string[]).includes(k);
}

/** Renderer-independent semantic model — no visual coordinates */
export interface FloeNode {
  id: string;
  /** Display label — quoted string after id/type, defaults to id if not set */
  label?: string;
  /** Explicit node type, e.g. "person", "service", "database" — semantic style reference */
  type?: string;
  range: Range;
  /** v1.2: sub-ranges for precise editor reveal/highlight */
  typeRange?: Range;
  labelRange?: Range;
  /** v1.2: per-node visual overrides via `meta ID.fill = "..."` */
  style?: FloeStyle;
  /** v1.2: custom key-values via `meta ID.key = "..."` (non-style keys) */
  metadata?: Record<string, string>;
  /** v1.2: resolved link URL via `link ID "..."` (sanitized at render) */
  link?: string;
}

export interface FloeAnnotation {
  /** Target node, group, or edge id; undefined => diagram-level */
  target?: string;
  text: string;
  range: Range;
}

export interface FloeLink {
  target: string;
  url: string;
  range: Range;
}

export interface FloeEdge {
  /** v1.2: stable edge id — explicit via `E1: A -> B` or auto `e1..eN` (collision-free) */
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: EdgeKind;
  range: Range;
  sourceRange: Range;
  targetRange: Range;
  labelRange?: Range;
  /** v1.2: range of explicit `ID:` prefix if present (for rename/reveal) */
  idRange?: Range;
  /** v1.2: per-edge visual overrides via `meta E1.fill = "..."` */
  style?: FloeStyle;
  /** v1.2: custom key-values via `meta E1.key = "..."` */
  metadata?: Record<string, string>;
  /** v1.2: resolved link URL via `link E1 "..."` */
  link?: string;
}

export interface FloeGroup {
  id: string;
  label?: string;
  type?: string;
  range: Range;
  typeRange?: Range;
  labelRange?: Range;
  nodeIds: string[];
  groups: FloeGroup[];
  metadata: Record<string, string>;
  annotations: FloeAnnotation[];
  link?: string;
  parentId?: string;
  /** v1.2: per-group visual overrides via `meta G.fill = "..."` */
  style?: FloeStyle;
}

export interface FloeDiagram {
  direction: Direction;
  directionRange?: Range;
  nodes: FloeNode[];
  edges: FloeEdge[];
  groups: FloeGroup[];
  metadata: Record<string, string>;
  annotations: FloeAnnotation[];
  links: FloeLink[];
}

export interface ParseResult {
  diagram: FloeDiagram;
  diagnostics: import("./diagnostics.js").Diagnostic[];
}
