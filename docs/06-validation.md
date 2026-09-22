# Floe — Validation (v1.0 + v1.2 delta)

Validation is separate from parsing (see `src/validator.ts:51`).

## Phases
1. **Parsing:** syntax, tokens, ranges, recovery → `raw.diagram` + `raw.diagnostics` (E005, E006, E007, E001 partial, etc.)
2. **Validation:** semantics over `explicitNodes`, `edges`, `groups`, `metadata`, `annotations`, `links`, `directionDeclarations` → appended diagnostics → `validated.diagram` (deduped) + `validated.diagnostics`

Public `parseFloe` does both and sorts diagnostics by `offset`.

## Stable Codes
| Code | Meaning | Example |
|------|---------|---------|
| `E001` | Invalid direction | `direction XX` |
| `E002` | Invalid identifier | `123abc`, `User [$bad]` |
| `E003` | Duplicate node declaration | `User [person]` twice |
| `E004` | Duplicate direction | second `direction LR` |
| `E005` | Malformed / unexpected token | `-> Login`, `direction LR extra` |
| `E006` | Missing / incomplete | `direction`, `User [`, `A ->` |
| `E007` | Invalid character | `$`, `•` |
| `E008` | Invalid node type | `User []` |
| `E009` | Missing edge target | `User ->` |
| `E010` | Empty edge label | `A -> B :` |
| `E011` | Duplicate group | `group A {}` twice |
| `E012` | Unclosed group | missing `}` |
| `E013` | Invalid metadata | `meta author "no ="` |
| `E014` | Invalid annotation/link | unknown target, empty text/url, unsafe scheme |
| `E015` | Duplicate edge id (v1.2) | `E1: A -> B` twice, or edge id colliding with node/group id |

All diagnostics have `{ severity: "error" | "warning" | "info", code, message, range }` with `range` covering culprit.

## Examples
```ts
import { parseFloe } from "@fazelstudio/floe";
parseFloe("direction XX").diagnostics[0].code // "E001"
parseFloe("A -> B :").diagnostics[0].code     // "E010"
parseFloe('link API "javascript:alert(1)"').diagnostics.some(d=>d.code==="E014") // unsafe scheme
parseFloe("E1: A -> B\nE1: B -> C").diagnostics.some(d=>d.code==="E015") // duplicate edge id
parseFloe('meta A.fill = "Ghost"').diagnostics // [] — named colors allowed
```

## Source Ranges
`Range { start: {line, column, offset}, end: ... }` — 1-indexed line/column, 0-indexed offset, used for diagnostics, nodes, edges, groups, annotations, links.

See `tests/validation.test.ts:1` and `tests/ranges.test.ts:1`.
