# Floe — Rendering

## Pipeline
```
source `.floe` → parseFloe → FloeDiagram (IR)
                → layoutEngine.layout(diagram) → LayoutResult (x/y, width/height, points)
                → renderSvg(layout) → SVG string
```
Convenience: `renderFloe(source, { layoutEngine, svgOptions })` does all three and returns timings/sizes.

## SVG Renderer (`src/render/svg.ts`)
- Deterministic: sorts nodes/edges/groups by id, no `Math.random`, no timestamps, no `NaN` in output.
- Dimensions: `layout.width/height + padding*2`, `viewBox="0 0 W H"`, `xmlns="http://www.w3.org/2000/svg"`.
- Responsive: `preserveAspectRatio="xMidYMid meet"` + `max-width:100%;height:auto` so diagrams never overflow their container.
- Escaping: `escapeXml` for labels, `escapeAttr` for attrs, `escapeId` for ids — prevents XSS. No `<script>`, `<foreignObject>`, `javascript:`.
- Styles: default CSS `.node text` only; user `opts.css` is trusted caller side, not from `.floe`.
- Markers: `<marker id="arrowhead">` for directed/emphasis edges, plus `arrowhead-start` when a bidirectional edge exists. Undirected (`--`) uses `stroke-dasharray="6 3"` and no marker. Emphasis (`==>`) uses `stroke-width="2.8"`.
- Edge ids are suffixed per edge (`-0`, `-1`, …) so parallel edges never share an `id`.
- Labels: edge labels centered at edge midpoint with white background rect for readability; long node labels wrap to 3 lines with ellipsis.
- Groups: dashed container `stroke-dasharray="8 4"`, header bar `22px`, label centered.
- Links: nodes and edge paths with safe URLs render as `<a href target="_blank" rel="noopener">`; `note TARGET "…"` becomes a hover `<title>`.
- No style → output stays byte-stable across versions. Invalid style colors fall back silently.

## Node Shapes (`src/render/shapes.ts`)
Semantic type → shape/color (renderer maps, not semantics):
- `person` → capsule `rx = h/2`, `#fef3c7`/`#d97706`
- `service` → rounded rect `6`, `#dbeafe`/`#2563eb`
- `database` → cylinder (path + 2 ellipses), `#dcfce7`/`#16a34a`
- `client` → rounded rect variant
- `decision` → diamond, `start`/`end` → stadium, `document` → wavy page, `gateway` → hexagon
- `ellipse`, `circle`, `cloud`, `process`, `queue`, `store`, `system`, `external`, `subsystem`, `container`, `component`
- `default` → `#f1f5f9`/`#334155`
Unknown types fallback to `default` — predictable.

## Per-element Styles
`meta TARGET.key = "value"` overrides the mapped style for one node, edge (`E1`), or group:
keys `fill`, `stroke`, `strokeWidth`, `fontSize`, `fontColor`, `opacity`.
`fontSize` also scales layout measurement so text never overflows its node.
Other keys become custom metadata (available to tools, ignored by rendering).

## Document Meta → SVG
```
meta title = "My Flow"        // <title> + aria-label
meta description = "..."      // <desc>
meta theme = "light|dark|auto"// dark swaps edges/labels/bg; auto adds prefers-color-scheme CSS
meta background = "#0f172a"   // or transparent; meta font = "Inter, sans-serif"
meta accent = "#2563eb"       // safe colors only (#hex or name): edges + markers
meta legend = "true"          // legend of used types in the footer (expands height)
meta author = "Team"          // footer provenance (`Author · vX`)
meta version = "2.4.0"
```
CLI overrides: `floe render -o out.svg --theme dark --background transparent --font "Inter"`.

## Security
- Labels may contain `& < > " '`; they are escaped.
- Ids sanitized for `id="node-..."` attributes.
- Style colors allow-listed (`#hex` or CSS names); anything else falls back.
- Edge label background prevents text overlap.

## Example
```ts
import { renderFloe } from "@fazelstudio/floe/pipeline";
const { svg, layoutResult, parseResult, timings } = renderFloe("A -> B\nB -> C");
console.log(svg); // deterministic
```

See `tests/v02.test.ts` for invariants and `benchmarks/run.ts` for render timings.
