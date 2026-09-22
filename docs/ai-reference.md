# Floe — AI Reference (concise)

**Copy this block to system prompt for reliable generation:**

```
Floe is a diagram DSL (.floe). Grammar:
  direction ::= "direction" ("TB"|"BT"|"LR"|"RL")
  node ::= IDENT ("[" IDENT "]")? (STRING)?   // IDENT = [A-Za-z_][A-Za-z0-9_-]*, no spaces, no digit start
  edge ::= (IDENT ":")? IDENT ("," IDENT)* (("->"|"--"|"<->"|"==>"|"=>") IDENT ("," IDENT)*)+ (":" Label)? // "->" directed, "--" undirected, "<->" bidirectional, "==>" emphasis; chaining A->B->C, fan-out A->B,C
  group ::= "group" IDENT ("[" IDENT "]")? (STRING)? "{" ... "}"
  meta ::= "meta" IDENT ("." IDENT)? "=" STRING   // meta Target.key styles single elements
  note ::= "note" (IDENT)? STRING
  link ::= "link" IDENT STRING
Reserved: direction, group, meta, note, link cannot be bare ids.
STRING: "text" with \" escape.
Comment: // to end of line.
One statement per line, blank lines ignored.
Valid example:
  direction LR
  User [person] "End User"
  API [service] "API Gateway"
  User -> API : request
  E1: API -> Cache : warm
  meta API.fill = "#dbeafe"
  group Backend { API Database }
  meta author = "Alice"
  note API "Handles auth"
  link API "https://example.com"
Invalid to avoid: 123bad, A ->, A -> B :, direction lr, User [], E1: A -> B, C.
```

**Generation rules:**
- Use `IDENT` for ids, `STRING` for display text.
- Exactly one `direction`; default `TB`.
- Edge operators require no extra words: `A -> B : label` not `A -> B label`.
- Groups need `{` and `}` and `2-space` indent inside.
- Links use safe `https:` only.

**Semantic model:** diagram {direction, nodes, edges, groups, metadata, annotations, links}; edges have kind directed/undirected/bidirectional/emphasis plus stable id; diagnostics codes E001–E015.

**Canonical examples (copy reliably):**
```floe
direction LR
User [person] "End User"
API [service] "API Gateway"
User -> API : request
API -> Database : query
```

See `docs/08-ai-generation.md` for full.
