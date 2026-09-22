# Floe — Formatting

## Canonical Formatter (`src/language/formatting.ts`)
Deterministic, line-oriented, preserves semantics, never crashes.

**Rules:**
- `A->B` → `A -> B`
- `B -> C: hello` → `B -> C : hello`
- `A=>B` → `A ==> B`, `A<->B` → `A <-> B`, `A->B,C` → `A -> B, C`
- `A->B->C` → `A -> B -> C` (chains keep one operator spacing)
- `E1:A->B` → `E1: A -> B` (named edge: tight colon after id)
- `direction    LR` → `direction LR`
- `User[service]"label"` → `User [service] "label"` (but formatter uses regex for node `^[IDENT] ([type])? ("label")?`)
- Groups: `group Backend [subsystem] "Backend Services" {` + indent `2 spaces` inside, `}` dedented; `group X { }` stays one line
- Meta: `meta author = "Alice"`, scoped `meta API.fill = "#fff"` (tight dot, spaces around `=`)
- Note/link: `note "text"`, `note API "text"`, `link API "url"`
- Comments preserved, normalized to `// ` with single space, kept trailing on same line
- Blank lines collapsed to at most one, leading/trailing blanks trimmed, final newline ensured (`insertFinalNewline !== false`)

**Idempotent:** `format(format(src)) === format(src)` — tested in `tests/v04.test.ts`.

**Never throws:** malformed input is normalized via fallback spacing (`<->|==>|->|=>|--`, `,`, `:`, `.`, `[]`, `=`) — always returns string.

## API
```ts
import { format, isFormatted } from "@fazelstudio/floe";
format("A->B\n") // "A -> B\n"
isFormatted("A -> B\n") // true
```

CLI:
```bash
floe format diagram.floe                  # stdout
floe format diagram.floe --write          # in place
floe format diagram.floe --check          # CI: exit 1 if not formatted
```

See `tests/v04.test.ts` and corpus formatter checks.
