# Floe — Semantic Model (IR)

Renderer-independent, no coordinates/svg/layout.

```ts
type Direction = "TB" | "BT" | "LR" | "RL";
type EdgeKind = "directed" | "undirected" | "bidirectional" | "emphasis";
interface FloeStyle { fill?; stroke?; strokeWidth?; fontSize?; fontColor?; opacity? }

interface FloeNode {
  id: string;        // IDENT, internal key
  label?: string;    // display, quoted STRING or defaults to id
  type?: string;     // semantic type e.g., person/service/database, not CSS
  range: Range;      // source range covering declaration
  typeRange?: Range; // sub-range of `[type]`
  labelRange?: Range;// sub-range of `"label"`
  style?: FloeStyle; // via `meta ID.fill = "..."`
  metadata?: Record<string,string>; // via `meta ID.key` (non-style keys)
  link?: string;     // resolved from `link ID "..."`
}

interface FloeEdge {
  id: string;        // explicit `E1:` or deterministic auto `e1..eN`
  source: string;
  target: string;
  label?: string;    // free-form after colon, may contain spaces
  kind: EdgeKind;
  range: Range;      // whole statement
  sourceRange: Range;
  targetRange: Range;
  labelRange?: Range;
  idRange?: Range;   // sub-range of explicit `ID:` prefix
  style?: FloeStyle;
  metadata?: Record<string,string>;
  link?: string;
}

interface FloeGroup {
  id: string;
  label?: string;
  type?: string;
  range: Range;
  typeRange?: Range;
  labelRange?: Range;
  nodeIds: string[]; // direct members (not counting nested subgroup members)
  groups: FloeGroup[]; // nested, tree
  metadata: Record<string,string>;
  annotations: FloeAnnotation[];
  link?: string;     // url if link target is this group
  parentId?: string;
  style?: FloeStyle; // via `meta G.fill = "..."`
}

interface FloeAnnotation {
  target?: string; // undefined = diagram-level, else node/group/edge id
  text: string;
  range: Range;
}

interface FloeLink {
  target: string;
  url: string;
  range: Range;
}

interface FloeDiagram {
  direction: Direction; // default TB
  directionRange?: Range;
  nodes: FloeNode[];    // explicit + implicit (from edges), deduped by id (first wins)
  edges: FloeEdge[];
  groups: FloeGroup[];  // top-level, tree
  metadata: Record<string,string>;
  annotations: FloeAnnotation[];
  links: FloeLink[];
}

interface ParseResult {
  diagram: FloeDiagram;
  diagnostics: Diagnostic[];
}
```

**Separation:** parsing = syntax/tokens/ranges/recovery → raw diagram + syntax diags; validation = semantics: duplicates, identifier re-check, direction re-check → appended diags. Public `parseFloe` runs both.

**Invariants:**
- `nodes` deduplicated (first explicit declaration wins for type/label)
- Implicit nodes from edges have range at edge occurrence
- Groups' `nodeIds` are also in global `diagram.nodes`
- No `x`, `y`, `width`, `height`, `svg` in core

See `src/types.ts:1` for implementation.
