# Floe — AI Generation

Concise reference for AI systems to generate `.floe` reliably.

## Grammar (keep)
```ebnf
direction ::= "direction" ("TB"|"BT"|"LR"|"RL")
node      ::= IDENT ("[" IDENT "]")? (STRING)?   // IDENT = [A-Za-z_][A-Za-z0-9_-]*, no spaces, no digit start
edge      ::= (IDENT ":")? IDENT ("," IDENT)* (("->"|"--"|"<->"|"==>"|"=>") IDENT ("," IDENT)*)+ (":" Label)? // Label trimmed, non-empty; chaining A->B->C, fan-out A->B,C
group     ::= "group" IDENT ("[" IDENT "]")? (STRING)? "{" ... "}"
meta      ::= "meta" IDENT ("." IDENT)? "=" STRING   // meta Target.key styles single elements
note      ::= "note" (IDENT)? STRING
link      ::= "link" IDENT STRING
Reserved: direction, group, meta, note, link cannot be bare ids.
STRING: "text" with \" escape.
Comment: // to end of line.
One statement per line, blank lines ignored.
Valid example:
  direction LR
  User [person] "End User"
  API [service] "API Gateway"
  User -> API : request
  group Backend { API Database }
  meta author = "Alice"
  note API "Handles auth"
  link API "https://example.com"
Invalid to avoid: 123bad, A ->, A -> B :, direction lr, User [], E1: A -> B, C.
```

## Generation Rules
- Use `direction LR` for left-to-right, `TB` for top-to-bottom; omit for default `TB`.
- Node ids are internal keys: `^[A-Za-z_][A-Za-z0-9_-]*$`, case-sensitive, use hyphen/underscore for multi-word: `api-gateway`, not `API Gateway`.
- Display text is `STRING` after node: `API [service] "API Gateway"` — never put spaces in id.
- Edge `->` is directed, `--` is undirected association, `<->` is bidirectional, `==>` is emphasis; label after single `:` (trimmed): `User -> Login : success`.
- Chains (`A -> B -> C`) and lists (`A -> B, C`) expand to multiple edges; a label covers the last segment.
- Named edges (`E1: A -> B`) are single-edge only and addressable by `note`/`link`/`meta`.
- Groups use braces and indent 2 spaces inside; they may nest.
- `meta author = "Alice"` is diagram metadata; `meta API.fill = "#fff"` styles one element (style keys: fill, stroke, strokeWidth, fontSize, fontColor, opacity; other keys are custom data).
- `note TARGET "text"` attaches (targets: node, group, or edge id); `note "text"` is diagram-level.
- `link TARGET "https://..."` — target must exist, use safe `https:` only (no `javascript:`).
- Reserved keywords cannot be node ids: `direction`, `group`, `meta`, `note`, `link`.

## Valid Examples (AI should reproduce)
```floe
direction LR
User [person] "End User"
API [service] "API Gateway"
Database [database]
User -> API : request
API -> Database : query
group Backend {
  API
  Database
}
meta author = "Alice"
note API "Handles auth"
link API "https://api.example.com"
```

```floe
A -- B : associated
group Frontend [subsystem] "Frontend Services" {
  group Auth {
    Login
    Login -> Dashboard
  }
}
```

## Invalid Examples (avoid)
```floe
123User -> Login        // E002 leading digit
User ->                // E009 missing target
A -> B :               // E010 empty label
direction lr           // E001 case-sensitive
User [person]
User [service]         // E003 duplicate node
direction LR
direction TB           // E004 duplicate direction
My Node -> Login       // E005 space in id
Group [bad               // E006 missing ]
```

## Semantic Model Summary
- Diagram has `direction`, `nodes` (explicit+implicit deduped), `edges` (with `kind` + stable `id`), `groups` (tree), `metadata`, `annotations`, `links`.
- Validation rules: duplicate node `E003`, duplicate group `E011`, unclosed group `E012`, invalid meta `E013`, unknown annotation/link target `E014`, duplicate edge id `E015`.

## Validation Rules to Follow
- Generate ids matching `IDENTIFIER_RE`, quote display strings, keep edge labels non-empty, close every `group` with `}`, define a node before `note`/`link` targets it, use exactly one `direction`.

See `docs/ai-reference.md` for even more concise needle or `SPEC.md` for source of truth.
