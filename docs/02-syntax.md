# Floe — Syntax

Line-oriented, UTF-8 (`\n` or `\r\n`), blank lines ignored, `//` comment to end-of-line.
Additive since v1.0 (frozen in `SPEC.md`): old files parse identically.

## Tokens
```
IDENT         ::= [A-Za-z_][A-Za-z0-9_-]*   // pattern ^[A-Za-z_][A-Za-z0-9_-]*$
DIRECTION_KW  ::= "direction"
GROUP_KW      ::= "group"
META_KW       ::= "meta"
NOTE_KW       ::= "note"
LINK_KW       ::= "link"
ARROW         ::= "->"
DASHDASH      ::= "--"
BIDIR         ::= "<->"
EMPHASIS      ::= "==>" | "=>"
COMMA         ::= ","
DOT           ::= "."
LBRACKET      ::= "["
RBRACKET      ::= "]"
LBRACE        ::= "{"
RBRACE        ::= "}"
COLON         ::= ":"
EQUALS        ::= "="
STRING        ::= '"' ( [^"\n] | '\"' | '\\' | '\n' | '\t' )* '"'
COMMENT       ::= "//" ...
NEWLINE       ::= \n | \r\n | \r
```

Whitespace (` `, `\t`) is separator only; not inside tokens except inside edge label after `:`.

## Statements (one per non-blank line)
```ebnf
Statement ::= DirectionStmt | NodeStmt | EdgeStmt | GroupStmt | MetadataStmt | AnnotationStmt | LinkStmt
DirectionStmt ::= "direction" ("TB"|"BT"|"LR"|"RL")
NodeStmt      ::= IDENT ("[" IDENT "]")? (STRING)?
EdgeStmt      ::= (IDENT ":")? SourceList (EdgeOp TargetList)+ (":" Label)?
SourceList    ::= IDENT ("," IDENT)*
TargetList    ::= IDENT ("," IDENT)*
EdgeOp        ::= "->" | "--" | "<->" | "==>" | "=>"
GroupStmt     ::= "group" IDENT ("[" IDENT "]")? (STRING)? "{" GroupBody "}"
GroupBody     ::= (Statement | NEWLINE | COMMENT)*
MetadataStmt  ::= "meta" IDENT ("." IDENT)? "=" STRING
AnnotationStmt::= "note" (IDENT)? STRING
LinkStmt      ::= "link" IDENT STRING
```

## Identifier Rules
- Must match `^[A-Za-z_][A-Za-z0-9_-]*$`
- Start with letter or `_`, not digit
- May contain hyphen `-` and underscore `_`
- No spaces, no Unicode beyond ASCII (>127 → `E007`)
- Case-sensitive, no empty

Display labels are separate — use quoted `STRING` after node: `API [service] "API Gateway"` — never put spaces in id.

## Edge Operators
```
A -> B   directed (arrowhead at target)
A -- B   undirected association (dashed, no marker)
A <-> B  bidirectional (markers both ends; ranked as source -> target)
A ==> B  emphasis / hot path (thick 2.8px; `=>` formats to `==>`)
```
Use `->` by default; `<->` only for true sync, `==>` only for the critical path.

## Chaining, Fan-in, Fan-out
```floe
A -> B -> C            // two edges: A->B, B->C
A -> B <-> C ==> D     // operators may mix per segment
API -> Worker, Cache   // fan-out: one edge per target, shared label
User, Admin -> Login   // fan-in
A, B -> C, D           // cross product: four edges
A -> B -> C : done     // a label applies to the last segment only
```
Endpoints are bare `IDENT`s — declare `[type] "label"` on separate lines.
Inline `User [person] "X" -> Login` is invalid.

## Named Edges
```floe
E1: Gateway -> Cache : warm
note E1 "warms on deploy"
link E1 "https://api.example.com/cache"
```
- An `ID:` prefix gives the edge a stable id (single edge only — no lists or chaining).
- Unnamed edges get deterministic auto ids `e1, e2, …` skipping taken node/group ids.
- Duplicate explicit ids, or ids colliding with node/group ids → `E015`.
- Canonical form: `E1:A->B` → `E1: A -> B`.

## Scoped Metadata (styles + custom data)
```floe
meta API.fill = "#dbeafe"      // style override
meta API.strokeWidth = "2"     // numeric styles are parsed (E013 if bad)
meta API.owner = "payments"    // other keys become custom element metadata
meta E1.stroke = "#2563eb"     // edges addressable by id
meta Backend.fill = "#f8fafc"  // groups too
```
Style keys: `fill`, `stroke`, `strokeWidth`, `fontSize`, `fontColor`, `opacity`.
Unknown targets → `E014`. Renderer ignores unknown keys and falls back on bad colors.

## Examples
**Valid:**
```floe
direction LR
User [person] "End User"
API [service] "API Gateway"
User -> Login
Login -> Dashboard : success
Cache -- Database : associated
Cache <-> API : sync
Critical ==> Alert : hot
E1: Gateway -> Cache : warm
API -> Worker, Cache : fan-out
group Backend {
  API
  Database
}
meta author = "Alice"
meta API.fill = "#dbeafe"
note "Global note"
note API "Handles auth"
link API "https://api.example.com"
```

**Invalid:**
```floe
direction XX           // E001
123User -> Login        // E002
User [person]
User [service]         // E003 duplicate node
direction LR
direction TB           // E004 duplicate direction
-> Login               // E005 malformed
direction              // E006 incomplete
User$ -> Login         // E007 invalid char
User []                // E008 empty type
User ->                // E009 missing target
A -> B :               // E010 empty label
group A {}
group A {}             // E011 duplicate group
group A {              // E012 unclosed
meta author "Alice"    // E013 invalid meta (missing =)
note Unknown "x"       // E014 unknown target (if Unknown not exists)
E1: A -> B
E1: B -> C             // E015 duplicate edge id
A -> B,                // E009 trailing comma
```

See `00-language-freeze.md` for the frozen v1.0 grammar and `SPEC.md` for full spec.
