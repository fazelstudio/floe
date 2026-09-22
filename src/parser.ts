import { Lexer } from "./lexer.js";
import { diag } from "./diagnostics.js";
import { DEFAULT_DIRECTION, DIRECTIONS, isStyleKey } from "./types.js";
/**
 * Floe grammar-based parser
 *
 * Grammar (EBNF) — v1.2 additive (backward compatible, portable):
 *   Program       ::= (Statement | NEWLINE | COMMENT)* EOF
 *   Statement     ::= DirectionStmt | NodeStmt | EdgeStmt | GroupStmt | MetadataStmt | AnnotationStmt | LinkStmt
 *   DirectionStmt ::= "direction" Direction
 *   Direction     ::= "TB" | "BT" | "LR" | "RL"
 *   NodeStmt      ::= IDENT ("[" IDENT "]")? (STRING)?
 *   EdgeStmt      ::= (IDENT ":")? SourceList (EdgeOp TargetList)+ (":" Label)?
 *   SourceList    ::= IDENT ("," IDENT)*
 *   TargetList    ::= IDENT ("," IDENT)*
 *   EdgeOp        ::= "->" | "--" | "<->" | "==>" | "=>"
 *   Label         ::= <trimmed raw slice after ":">  (non-empty) OR STRING decoded
 *   GroupStmt     ::= "group" IDENT ("[" IDENT "]")? (STRING)? "{" GroupBody "}"
 *   GroupBody     ::= (Statement | NEWLINE | COMMENT)*
 *   MetadataStmt  ::= "meta" IDENT ("." IDENT)? "=" STRING
 *   AnnotationStmt::= "note" (IDENT)? STRING
 *   LinkStmt      ::= "link" IDENT STRING
 *
 * v1.1 examples: `A -> B -> C` (chain), `A -> B, C` (fan-out),
 * `A, B -> C` (fan-in), `A <-> B` (bidirectional), `A ==> B : hot` (emphasis).
 * Label after ":" applies to last segment (shared if single segment).
 * v1.2: `E1: A -> B : ok` (explicit stable edge id, single edge only),
 * `meta API.fill = "#dbeafe"` (per-element style), `meta API.owner = "team"` (custom data).
 * `note E1 "..."` / `link E1 "..."` may target edges by id.
 * Endpoints stay bare IDENTs — declare `[type] "label"` on separate lines.
 *
 * Features:
 * - source ranges for all nodes/edges/groups
 * - syntax error reporting with stable codes (E001-E014)
 * - recovery via synchronization to next NEWLINE or RBRACE
 * - never crashes on malformed input
 * - nested groups supported
 */
export class Parser {
    source;
    tokens;
    idx = 0;
    diagnostics = [];
    explicitNodes = [];
    edges = [];
    direction = DEFAULT_DIRECTION;
    directionRange;
    directionSeen = false;
    directionDeclarations = [];
    // v0.3 fields
    groups = [];
    groupStack = [];
    metadata = {};
    metadataRanges = new Map();
    annotations = [];
    links = [];
    linkMap = new Map();
    // Pending scoped metadata (`meta Target.key`); resolved post-parse.
    scopedMetas = [];
    constructor(source) {
        this.source = source;
        this.tokens = new Lexer(source).tokenize();
    }
    parse() {
        try {
            this.loop();
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const pos = this.peek().range.start;
            this.diagnostics.push(diag("error", "E005", `Internal parser error: ${msg}`, {
                start: pos,
                end: pos,
            }));
        }
        // Unclosed groups report E012 and are treated as closed at EOF.
        for (const grp of this.groupStack) {
            this.diagnostics.push(diag("error", "E012", `Unclosed group '${grp.id}': missing closing '}'`, grp.range));
        }
        this.groupStack = [];
        // Full node list: explicit declarations first, then implicit edge endpoints.
        const nodeMap = new Map();
        for (const n of this.explicitNodes) {
            if (!nodeMap.has(n.id))
                nodeMap.set(n.id, n);
        }
        for (const e of this.edges) {
            if (!nodeMap.has(e.source)) {
                nodeMap.set(e.source, {
                    id: e.source,
                    range: e.sourceRange,
                });
            }
            if (!nodeMap.has(e.target)) {
                nodeMap.set(e.target, {
                    id: e.target,
                    range: e.targetRange,
                });
            }
        }
        const nodes = Array.from(nodeMap.values());
        // Auto edge ids fill the gaps: explicit ids are kept, `eN` skips taken ids.
        const groupIndex = new Map();
        const indexGroups = (arr) => {
            for (const g of arr) {
                if (!groupIndex.has(g.id)) groupIndex.set(g.id, g);
                if (g.groups && g.groups.length > 0) indexGroups(g.groups);
            }
        };
        indexGroups(this.groups);
        const takenIds = new Set([...nodeMap.keys(), ...groupIndex.keys()]);
        for (const e of this.edges) {
            if (e.id) takenIds.add(e.id);
        }
        let autoN = 1;
        for (const e of this.edges) {
            if (!e.id) {
                while (takenIds.has(`e${autoN}`)) autoN++;
                e.id = `e${autoN}`;
                takenIds.add(e.id);
                autoN++;
            }
        }
        const edgeIndex = new Map();
        for (const e of this.edges) {
            if (!edgeIndex.has(e.id)) edgeIndex.set(e.id, e);
        }
        // Scoped metadata (`meta Target.key`) resolves here so forward references work.
        for (const sm of this.scopedMetas) {
            const targetNode = nodeMap.get(sm.target);
            const targetGroup = !targetNode ? groupIndex.get(sm.target) : undefined;
            const targetEdge = !targetNode && !targetGroup ? edgeIndex.get(sm.target) : undefined;
            const el = targetNode ?? targetGroup ?? targetEdge;
            if (!el) {
                this.diagnostics.push(diag("error", "E014", `Scoped metadata target '${sm.target}' does not exist`, sm.range));
                continue;
            }
            if (isStyleKey(sm.key)) {
                if (!el.style) el.style = {};
                if (sm.key === "strokeWidth" || sm.key === "fontSize" || sm.key === "opacity") {
                    const num = Number(sm.value.trim());
                    if (!Number.isFinite(num)) {
                        this.diagnostics.push(diag("error", "E013", `Invalid numeric style value for '${sm.target}.${sm.key}': expected a number, got '${sm.value}'`, sm.range));
                        continue;
                    }
                    if ((sm.key === "strokeWidth" || sm.key === "fontSize") && num <= 0) {
                        this.diagnostics.push(diag("error", "E013", `Invalid style value for '${sm.target}.${sm.key}': must be > 0`, sm.range));
                        continue;
                    }
                    if (sm.key === "opacity" && (num < 0 || num > 1)) {
                        this.diagnostics.push(diag("error", "E013", `Invalid style value for '${sm.target}.${sm.key}': opacity must be 0..1`, sm.range));
                        continue;
                    }
                    el.style[sm.key] = num;
                }
                else {
                    el.style[sm.key] = sm.value;
                }
            }
            else {
                if (el.metadata) el.metadata[sm.key] = sm.value;
                else el.metadata = { [sm.key]: sm.value };
            }
        }
        // Links also resolve here to cover forward references.
        for (const l of this.links) {
            const n = nodeMap.get(l.target);
            if (n && !n.link) n.link = l.url;
            const g = groupIndex.get(l.target);
            if (g && !g.link) g.link = l.url;
            const e = edgeIndex.get(l.target);
            if (e && !e.link) e.link = l.url;
        }
        const diagram = {
            direction: this.direction,
            directionRange: this.directionRange,
            nodes,
            edges: this.edges,
            groups: this.groups,
            metadata: this.metadata,
            annotations: this.annotations,
            links: this.links,
        };
        this.diagnostics.sort((a, b) => a.range.start.offset - b.range.start.offset);
        return {
            diagram,
            diagnostics: this.diagnostics,
            explicitNodes: this.explicitNodes,
            edges: this.edges,
            directionDeclarations: this.directionDeclarations,
            groups: this.groups,
            metadata: this.metadata,
            annotations: this.annotations,
            links: this.links,
        };
    }
    currentGroup() {
        if (this.groupStack.length === 0)
            return undefined;
        return this.groupStack[this.groupStack.length - 1];
    }
    peek() {
        return this.tokens[this.idx] ?? this.tokens[this.tokens.length - 1];
    }
    previous() {
        return this.tokens[Math.max(0, this.idx - 1)];
    }
    isAtEnd() {
        return this.peek().type === "EOF";
    }
    check(type) {
        if (this.isAtEnd() && type !== "EOF")
            return false;
        return this.peek().type === type;
    }
    advance() {
        if (!this.isAtEnd())
            this.idx++;
        return this.previous();
    }
    match(type) {
        if (this.check(type)) {
            this.advance();
            return true;
        }
        return false;
    }
    codeForUnexpected(tok) {
        if (tok.type === "UNKNOWN") {
            if (/^[0-9]/.test(tok.lexeme))
                return "E002";
            return "E007";
        }
        return "E005";
    }
    synchronize() {
        // Skip until NEWLINE, RBRACE, COMMENT or EOF
        while (!this.isAtEnd()) {
            if (this.check("NEWLINE")) {
                this.advance();
                return;
            }
            if (this.check("RBRACE")) {
                // Leave RBRACE for the main loop, which closes the group.
                return;
            }
            if (this.check("COMMENT")) {
                this.advance();
                if (this.check("NEWLINE"))
                    this.advance();
                return;
            }
            this.advance();
        }
    }
    loop() {
        while (!this.isAtEnd()) {
            if (this.match("NEWLINE"))
                continue;
            if (this.match("COMMENT")) {
                continue;
            }
            // Group closing brace.
            if (this.check("RBRACE")) {
                const tok = this.advance();
                const grp = this.groupStack.pop();
                if (!grp) {
                    this.diagnostics.push(diag("error", "E005", `Unexpected '}' without matching 'group'`, tok.range));
                }
                else {
                    grp.range = { start: grp.range.start, end: tok.range.end };
                }
                continue;
            }
            if (this.check("UNKNOWN")) {
                const bad = this.advance();
                if (bad.lexeme.startsWith('"')) {
                    // Unterminated string: the lexer keeps the raw text.
                    this.diagnostics.push(diag("error", "E006", `Unterminated string: missing closing '"'`, bad.range));
                }
                else {
                    const isDigitStart = /^[0-9]/.test(bad.lexeme);
                    if (isDigitStart) {
                        this.diagnostics.push(diag("error", "E002", `Invalid identifier '${bad.lexeme}': must start with a letter or underscore`, bad.range));
                    }
                    else {
                        this.diagnostics.push(diag("error", "E007", `Invalid character '${bad.lexeme}'`, bad.range));
                    }
                }
                this.synchronize();
                continue;
            }
            if (this.check("DIRECTION_KW")) {
                this.parseDirectionStmt();
                continue;
            }
            if (this.check("GROUP_KW")) {
                this.parseGroupStmt();
                continue;
            }
            if (this.check("META_KW")) {
                this.parseMetadataStmt();
                continue;
            }
            if (this.check("NOTE_KW")) {
                this.parseAnnotationStmt();
                continue;
            }
            if (this.check("LINK_KW")) {
                this.parseLinkStmt();
                continue;
            }
            if (this.check("IDENT")) {
                const look = this.tokens[this.idx + 1];
                if (!look) {
                    this.parseNodeStmt();
                    continue;
                }
                if (look.type === "ARROW" || look.type === "DASHDASH" || look.type === "BIDIR" || look.type === "EMPHASIS") {
                    this.parseEdgeStmt();
                    continue;
                }
                // Fan-in edge (`A, B -> C`) starts the same as a node; scan for an operator.
                if (look.type === "COMMA") {
                    if (this.lineHasEdgeOp()) {
                        this.parseEdgeStmt();
                        continue;
                    }
                    this.parseNodeStmt();
                    continue;
                }
                if (look.type === "LBRACKET") {
                    this.parseNodeStmt();
                    continue;
                }
                if (look.type === "STRING") {
                    this.parseNodeStmt();
                    continue;
                }
                if (look.type === "NEWLINE" ||
                    look.type === "COMMENT" ||
                    look.type === "EOF" ||
                    look.type === "RBRACE") {
                    this.parseNodeStmt();
                    continue;
                }
                if (look.type === "COLON") {
                    // Named edge (`E1: A -> B`) vs malformed `User : label`.
                    if (this.isNamedEdge()) {
                        this.parseEdgeStmt();
                        continue;
                    }
                    const idTok = this.advance();
                    const colon = this.advance();
                    this.diagnostics.push(diag("error", "E005", `Malformed statement: expected '->', '--', '<->' or '==>' between identifiers before ':'`, { start: idTok.range.start, end: colon.range.end }));
                    this.synchronize();
                    continue;
                }
                this.parseNodeStmt();
                continue;
            }
            {
                const tok = this.advance();
                this.diagnostics.push(diag("error", "E005", `Unexpected token '${tok.lexeme}' at start of statement`, tok.range));
                this.synchronize();
                continue;
            }
        }
    }
    parseDirectionStmt() {
        const kw = this.advance(); // DIRECTION_KW
        if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
            this.diagnostics.push(diag("error", "E006", `Incomplete direction statement: expected one of ${DIRECTIONS.join(", ")} after 'direction'`, kw.range));
            return;
        }
        let dirTok = null;
        if (this.check("IDENT") || this.check("UNKNOWN")) {
            dirTok = this.advance();
        }
        else {
            const tok = this.advance();
            this.diagnostics.push(diag("error", "E005", `Unexpected token '${tok.lexeme}' after 'direction'; expected one of ${DIRECTIONS.join(", ")}`, tok.range));
            this.synchronize();
            return;
        }
        const raw = dirTok.lexeme;
        const isValid = DIRECTIONS.includes(raw);
        const declRange = { start: kw.range.start, end: dirTok.range.end };
        this.directionDeclarations.push({ value: raw, range: declRange, rawLexeme: raw });
        if (!isValid) {
            if (/^[0-9]/.test(raw)) {
                this.diagnostics.push(diag("error", "E002", `Invalid identifier '${raw}' for direction; expected one of ${DIRECTIONS.join(", ")}`, dirTok.range));
            }
            else {
                this.diagnostics.push(diag("error", "E001", `Invalid direction '${raw}': expected one of ${DIRECTIONS.join(", ")}`, dirTok.range));
            }
            if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
                const extra = this.peek();
                this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after direction value`, extra.range));
                this.synchronize();
            }
            return;
        }
        const newDirection = raw;
        this.direction = newDirection;
        this.directionRange = declRange;
        this.directionSeen = true;
        if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
            const extra = this.peek();
            this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after direction value`, extra.range));
            this.synchronize();
        }
    }
    parseGroupStmt() {
        const kw = this.advance(); // GROUP_KW
        let start = kw.range.start;
        let end = kw.range.end;
        if (this.check("IDENT")) {
            const idTok = this.advance();
            const id = idTok.lexeme;
            let type;
            let typeRange;
            let label;
            let labelRange;
            let headerEnd = idTok.range.end;
            if (this.check("LBRACKET")) {
                const lb = this.advance();
                if (this.check("IDENT")) {
                    const typeTok = this.advance();
                    type = typeTok.lexeme;
                    typeRange = typeTok.range;
                    if (this.check("RBRACKET")) {
                        const rb = this.advance();
                        headerEnd = rb.range.end;
                    }
                    else {
                        this.diagnostics.push(diag("error", "E006", `Missing closing ']' for group type after '${typeTok.lexeme}'`, { start: lb.range.start, end: typeTok.range.end }));
                        headerEnd = typeTok.range.end;
                        if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("LBRACE") && !this.check("STRING")) {
                            const nxt = this.peek();
                            // Only report if not terminator
                            if (nxt.type !== "NEWLINE" && nxt.type !== "COMMENT" && nxt.type !== "EOF" && nxt.type !== "LBRACE" && nxt.type !== "STRING") {
                                this.diagnostics.push(diag("error", this.codeForUnexpected(nxt), `Unexpected token '${nxt.lexeme}' after group type`, nxt.range));
                                this.synchronize();
                            }
                        }
                    }
                }
                else if (this.check("UNKNOWN")) {
                    const bad = this.advance();
                    const isDigitStart = /^[0-9]/.test(bad.lexeme);
                    this.diagnostics.push(diag("error", isDigitStart ? "E002" : "E008", `Invalid group type '${bad.lexeme}'`, bad.range));
                    headerEnd = bad.range.end;
                    if (this.check("RBRACKET")) {
                        const rb = this.advance();
                        headerEnd = rb.range.end;
                    }
                    else {
                        this.diagnostics.push(diag("error", "E006", `Missing closing ']' after invalid group type`, { start: lb.range.start, end: bad.range.end }));
                    }
                    if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("LBRACE") && !this.check("STRING")) {
                        const nxt = this.peek();
                        this.diagnostics.push(diag("error", this.codeForUnexpected(nxt), `Unexpected token '${nxt.lexeme}' after group type`, nxt.range));
                        this.synchronize();
                    }
                }
                else if (this.check("RBRACKET")) {
                    const rb = this.advance();
                    this.diagnostics.push(diag("error", "E008", `Empty group type: expected identifier inside brackets`, { start: lb.range.start, end: rb.range.end }));
                    headerEnd = rb.range.end;
                }
                else if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("LBRACE") || this.check("STRING")) {
                    this.diagnostics.push(diag("error", "E006", `Incomplete group declaration: expected type identifier and ']' after '['`, lb.range));
                    headerEnd = lb.range.end;
                }
                else {
                    const tok = this.advance();
                    this.diagnostics.push(diag("error", this.codeForUnexpected(tok), `Unexpected token '${tok.lexeme}' inside group type brackets`, tok.range));
                    if (this.check("RBRACKET")) {
                        const rb = this.advance();
                        headerEnd = rb.range.end;
                    }
                    else {
                        this.synchronize();
                        headerEnd = tok.range.end;
                        // Create group with whatever we have and return early without expecting brace?
                        // But we need to attempt to create group
                    }
                }
            }
            // Optional label.
            if (this.check("STRING")) {
                const labelTok = this.advance();
                label = labelTok.lexeme;
                labelRange = labelTok.range;
                headerEnd = labelTok.range.end;
                end = headerEnd;
            }
            else {
                end = headerEnd;
            }
            let hasBrace = false;
            let braceRange;
            if (this.check("LBRACE")) {
                const lb = this.advance();
                braceRange = lb.range;
                end = lb.range.end;
                hasBrace = true;
            }
            else {
                this.diagnostics.push(diag("error", "E006", `Missing opening '{' for group '${id}'`, { start: start, end: headerEnd }));
                // Without a brace the group cannot contain a body, so record it
                // without pushing: the rest of the file stays outside the group.
                const grp = {
                    id,
                    label,
                    type,
                    typeRange,
                    labelRange,
                    range: { start, end: headerEnd },
                    nodeIds: [],
                    groups: [],
                    metadata: {},
                    annotations: [],
                    parentId: this.currentGroup()?.id,
                };
                // Duplicate ids are rejected by the validator.
                const parent = this.currentGroup();
                if (parent)
                    parent.groups.push(grp);
                else
                    this.groups.push(grp);
                // Reject trailing tokens after a braceless header.
                if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
                    const extra = this.peek();
                    this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after group header`, extra.range));
                    this.synchronize();
                }
                return;
            }
            // Create group object
            const grp = {
                id,
                label,
                type,
                typeRange,
                labelRange,
                range: { start, end },
                nodeIds: [],
                groups: [],
                metadata: {},
                annotations: [],
                parentId: this.currentGroup()?.id,
            };
            // Add to parent or top-level, then push so the body parses inside it.
            const parent = this.currentGroup();
            if (parent)
                parent.groups.push(grp);
            else
                this.groups.push(grp);
            this.groupStack.push(grp);
            // A body may start on the same line (`group X { API }`), so only
            // reject tokens that cannot start a statement.
            if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
                const extra = this.peek();
                const starterTypes = ["IDENT", "GROUP_KW", "META_KW", "NOTE_KW", "LINK_KW", "DIRECTION_KW", "RBRACE"];
                if (!starterTypes.includes(extra.type)) {
                    this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after '{'`, extra.range));
                    this.synchronize();
                }
            }
            return;
        }
        else if (this.check("UNKNOWN")) {
            const bad = this.advance();
            const isDigitStart = /^[0-9]/.test(bad.lexeme);
            this.diagnostics.push(diag("error", isDigitStart ? "E002" : "E007", `Invalid identifier '${bad.lexeme}' for group id`, bad.range));
            this.synchronize();
            return;
        }
        else if (this.check("LBRACE")) {
            this.diagnostics.push(diag("error", "E006", `Missing group identifier after 'group'`, kw.range));
            this.advance(); // consume { so recovery continues after it
            this.diagnostics.push(diag("error", "E005", `Group without identifier ignored`, kw.range));
            return;
        }
        else if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
            this.diagnostics.push(diag("error", "E006", `Missing group identifier after 'group'`, kw.range));
            return;
        }
        else {
            const tok = this.advance();
            this.diagnostics.push(diag("error", this.codeForUnexpected(tok), `Unexpected token '${tok.lexeme}' after 'group'`, tok.range));
            this.synchronize();
            return;
        }
    }
    parseMetadataStmt() {
        const kw = this.advance(); // META_KW
        let start = kw.range.start;
        let end = kw.range.end;
        if (!this.check("IDENT")) {
            if (this.check("UNKNOWN")) {
                const bad = this.advance();
                this.diagnostics.push(diag("error", "E002", `Invalid identifier '${bad.lexeme}' for metadata key`, bad.range));
                this.synchronize();
                return;
            }
            this.diagnostics.push(diag("error", "E006", `Missing metadata key after 'meta'`, kw.range));
            this.synchronize();
            return;
        }
        const keyTok = this.advance();
        const key = keyTok.lexeme;
        end = keyTok.range.end;
        // Scoped form: `meta Target.key = "value"`.
        let scopeTarget = null;
        let scopeKey = null;
        let scopeKeyRange = null;
        if (this.check("DOT")) {
            this.advance(); // consume .
            if (!this.check("IDENT")) {
                if (this.check("UNKNOWN")) {
                    const bad = this.advance();
                    this.diagnostics.push(diag("error", "E002", `Invalid identifier '${bad.lexeme}' for scoped metadata key`, bad.range));
                    this.synchronize();
                    return;
                }
                this.diagnostics.push(diag("error", "E006", `Missing key after '.' in scoped metadata 'meta ${key}.'`, keyTok.range));
                this.synchronize();
                return;
            }
            const subTok = this.advance();
            scopeTarget = key;
            scopeKey = subTok.lexeme;
            scopeKeyRange = subTok.range;
            end = subTok.range.end;
        }
        // Expect EQUALS
        if (!this.check("EQUALS")) {
            this.diagnostics.push(diag("error", "E006", `Missing '=' after metadata key '${key}'`, { start: kw.range.start, end: keyTok.range.end }));
            this.synchronize();
            return;
        }
        const eq = this.advance();
        end = eq.range.end;
        // Expect STRING value
        if (!this.check("STRING")) {
            if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
                this.diagnostics.push(diag("error", "E006", `Missing value for metadata key '${key}': expected quoted string`, eq.range));
                return;
            }
            const tok = this.advance();
            if (tok.lexeme.startsWith('"')) {
                this.diagnostics.push(diag("error", "E006", `Unterminated string for metadata key '${key}'`, tok.range));
            }
            else {
                this.diagnostics.push(diag("error", "E013", `Invalid metadata value for '${key}': expected quoted string, got '${tok.lexeme}'`, tok.range));
            }
            this.synchronize();
            return;
        }
        const valTok = this.advance();
        const value = valTok.lexeme;
        end = valTok.range.end;
        if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
            const extra = this.peek();
            this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after metadata value`, extra.range));
            this.synchronize();
        }
        const metaRange = { start, end };
        if (scopeTarget !== null) {
            // Targets may be declared later, so scoped entries resolve post-parse.
            this.scopedMetas.push({ target: scopeTarget, key: scopeKey, value, range: metaRange, keyRange: scopeKeyRange });
            return;
        }
        const cur = this.currentGroup();
        if (cur) {
            cur.metadata[key] = value;
        }
        else {
            this.metadata[key] = value;
            this.metadataRanges.set(key, metaRange);
        }
    }
    parseAnnotationStmt() {
        const kw = this.advance(); // NOTE_KW
        let start = kw.range.start;
        let end = kw.range.end;
        let target;
        let text;
        let textRange;
        if (this.check("STRING")) {
            const t = this.advance();
            text = t.lexeme;
            textRange = t.range;
            end = t.range.end;
        }
        else if (this.check("IDENT")) {
            const idTok = this.advance();
            target = idTok.lexeme;
            end = idTok.range.end;
            if (this.check("STRING")) {
                const t = this.advance();
                text = t.lexeme;
                textRange = t.range;
                end = t.range.end;
            }
            else {
                if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
                    this.diagnostics.push(diag("error", "E006", `Missing annotation text after target '${target}': expected quoted string`, idTok.range));
                    return;
                }
                const tok = this.advance();
                if (tok.lexeme.startsWith('"')) {
                    this.diagnostics.push(diag("error", "E006", `Unterminated string for annotation`, tok.range));
                }
                else {
                    this.diagnostics.push(diag("error", "E014", `Invalid annotation text: expected quoted string, got '${tok.lexeme}'`, tok.range));
                }
                this.synchronize();
                return;
            }
        }
        else {
            if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
                this.diagnostics.push(diag("error", "E006", `Incomplete note statement: expected quoted string or target identifier`, kw.range));
                return;
            }
            if (this.check("UNKNOWN")) {
                const bad = this.advance();
                if (bad.lexeme.startsWith('"')) {
                    this.diagnostics.push(diag("error", "E006", `Unterminated string for annotation`, bad.range));
                }
                else {
                    const isDigit = /^[0-9]/.test(bad.lexeme);
                    this.diagnostics.push(diag("error", isDigit ? "E002" : "E007", `Invalid identifier '${bad.lexeme}' for annotation target`, bad.range));
                }
                this.synchronize();
                return;
            }
            const tok = this.advance();
            this.diagnostics.push(diag("error", "E005", `Unexpected token '${tok.lexeme}' after 'note'`, tok.range));
            this.synchronize();
            return;
        }
        // Empty annotation text is stored but flagged.
        if (text !== undefined && text.trim().length === 0) {
            this.diagnostics.push(diag("error", "E014", `Empty annotation text`, textRange));
        }
        if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
            const extra = this.peek();
            this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after annotation`, extra.range));
            this.synchronize();
        }
        const annRange = { start, end };
        const ann = { target, text: text, range: annRange };
        this.annotations.push(ann);
        const cur = this.currentGroup();
        if (cur)
            cur.annotations.push(ann);
    }
    parseLinkStmt() {
        const kw = this.advance(); // LINK_KW
        let start = kw.range.start;
        let end = kw.range.end;
        if (!this.check("IDENT")) {
            if (this.check("UNKNOWN")) {
                const bad = this.advance();
                this.diagnostics.push(diag("error", "E002", `Invalid identifier '${bad.lexeme}' for link target`, bad.range));
                this.synchronize();
                return;
            }
            this.diagnostics.push(diag("error", "E006", `Missing link target after 'link': expected identifier`, kw.range));
            this.synchronize();
            return;
        }
        const targetTok = this.advance();
        const target = targetTok.lexeme;
        end = targetTok.range.end;
        if (!this.check("STRING")) {
            if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
                this.diagnostics.push(diag("error", "E006", `Missing URL for link target '${target}': expected quoted string`, targetTok.range));
                return;
            }
            const tok = this.advance();
            if (tok.lexeme.startsWith('"')) {
                this.diagnostics.push(diag("error", "E006", `Unterminated string for link URL`, tok.range));
            }
            else {
                this.diagnostics.push(diag("error", "E014", `Invalid link URL: expected quoted string, got '${tok.lexeme}'`, tok.range));
            }
            this.synchronize();
            return;
        }
        const urlTok = this.advance();
        const url = urlTok.lexeme;
        end = urlTok.range.end;
        if (url.trim().length === 0) {
            this.diagnostics.push(diag("error", "E014", `Empty link URL for target '${target}'`, urlTok.range));
        }
        if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
            const extra = this.peek();
            this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after link`, extra.range));
            this.synchronize();
        }
        const range = { start, end };
        const link = { target, url, range };
        if (this.linkMap.has(target)) {
            this.diagnostics.push(diag("error", "E014", `Duplicate link for target '${target}'`, range));
        }
        else {
            this.linkMap.set(target, link);
            this.links.push(link);
            const grp = this.findGroupById(target);
            if (grp)
                grp.link = url;
        }
    }
    findGroupById(id) {
        const search = (arr) => {
            for (const g of arr) {
                if (g.id === id)
                    return g;
                const found = search(g.groups);
                if (found)
                    return found;
            }
            return undefined;
        };
        return search(this.groups);
    }
    parseNodeStmt() {
        const idTok = this.advance(); // IDENT
        let start = idTok.range.start;
        let end = idTok.range.end;
        let type;
        let typeRange;
        let label;
        let labelRange;
        if (this.check("LBRACKET")) {
            const lb = this.advance();
            if (this.check("IDENT")) {
                const typeTok = this.advance();
                type = typeTok.lexeme;
                typeRange = typeTok.range;
                if (this.check("RBRACKET")) {
                    const rb = this.advance();
                    end = rb.range.end;
                }
                else {
                    this.diagnostics.push(diag("error", "E006", `Missing closing ']' for node type after '${typeTok.lexeme}'`, { start: lb.range.start, end: typeTok.range.end }));
                    end = typeTok.range.end;
                    if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE") && !this.check("STRING")) {
                        const nxt = this.peek();
                        if (nxt.type !== "NEWLINE" && nxt.type !== "COMMENT" && nxt.type !== "EOF" && nxt.type !== "RBRACE" && nxt.type !== "STRING") {
                            this.diagnostics.push(diag("error", this.codeForUnexpected(nxt), `Unexpected token '${nxt.lexeme}' after node type`, nxt.range));
                            this.synchronize();
                        }
                    }
                }
            }
            else if (this.check("UNKNOWN")) {
                const bad = this.advance();
                const isDigitStart = /^[0-9]/.test(bad.lexeme);
                if (isDigitStart) {
                    this.diagnostics.push(diag("error", "E002", `Invalid identifier '${bad.lexeme}' for node type: must start with a letter or underscore`, bad.range));
                }
                else {
                    this.diagnostics.push(diag("error", "E008", `Invalid node type '${bad.lexeme}'`, bad.range));
                }
                end = bad.range.end;
                if (this.check("RBRACKET")) {
                    const rb = this.advance();
                    end = rb.range.end;
                }
                else {
                    this.diagnostics.push(diag("error", "E006", `Missing closing ']' after invalid node type`, { start: lb.range.start, end: bad.range.end }));
                }
                if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE") && !this.check("STRING")) {
                    const nxt = this.peek();
                    this.diagnostics.push(diag("error", this.codeForUnexpected(nxt), `Unexpected token '${nxt.lexeme}' after node type`, nxt.range));
                    this.synchronize();
                }
            }
            else if (this.check("RBRACKET")) {
                const rb = this.advance();
                this.diagnostics.push(diag("error", "E008", `Empty node type: expected identifier inside brackets`, { start: lb.range.start, end: rb.range.end }));
                end = rb.range.end;
                if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE") && !this.check("STRING")) {
                    const nxt = this.peek();
                    this.diagnostics.push(diag("error", this.codeForUnexpected(nxt), `Unexpected token '${nxt.lexeme}' after node declaration`, nxt.range));
                    this.synchronize();
                }
            }
            else if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE") || this.check("STRING")) {
                this.diagnostics.push(diag("error", "E006", `Incomplete node declaration: expected type identifier and ']' after '['`, lb.range));
                end = lb.range.end;
            }
            else {
                const tok = this.advance();
                this.diagnostics.push(diag("error", this.codeForUnexpected(tok), `Unexpected token '${tok.lexeme}' inside node type brackets`, tok.range));
                if (this.check("RBRACKET")) {
                    const rb = this.advance();
                    end = rb.range.end;
                }
                else {
                    this.synchronize();
                    const nodeRange = { start, end };
                    this.pushNode({ id: idTok.lexeme, type, typeRange, label, labelRange, range: nodeRange });
                    return;
                }
            }
        }
        // Optional display label.
        if (this.check("STRING")) {
            const labelTok = this.advance();
            label = labelTok.lexeme;
            labelRange = labelTok.range;
            end = labelTok.range.end;
            if (label.trim().length === 0) {
                this.diagnostics.push(diag("error", "E010", `Empty display label for node '${idTok.lexeme}'`, labelTok.range));
            }
        }
        if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
            const extra = this.peek();
            this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after node declaration`, extra.range));
            this.synchronize();
        }
        const nodeRange = { start, end };
        this.pushNode({ id: idTok.lexeme, type, typeRange, label, labelRange, range: nodeRange });
    }
    pushNode(node) {
        this.explicitNodes.push(node);
        const cur = this.currentGroup();
        if (cur) {
            if (!cur.nodeIds.includes(node.id)) cur.nodeIds.push(node.id);
        }
    }
    lineHasEdgeOp() {
        // True when an edge operator appears before the line ends or a label starts.
        for (let i = this.idx; i < this.tokens.length; i++) {
            const t = this.tokens[i];
            if (!t) break;
            if (t.type === "ARROW" || t.type === "DASHDASH" || t.type === "BIDIR" || t.type === "EMPHASIS") return true;
            if (t.type === "COLON" || t.type === "NEWLINE" || t.type === "COMMENT" || t.type === "RBRACE" || t.type === "EOF") return false;
        }
        return false;
    }
    isNamedEdge() {
        // `E1: A -> B` has an edge operator after the `ID : sources` prefix;
        // malformed `User : label` has none.
        let i = this.idx;
        const toks = this.tokens;
        if (!toks[i] || toks[i].type !== "IDENT") return false;
        if (!toks[i + 1] || toks[i + 1].type !== "COLON") return false;
        i += 2;
        if (!toks[i] || toks[i].type !== "IDENT") return false;
        i++;
        while (toks[i] && toks[i].type === "COMMA") {
            i++;
            if (!toks[i] || toks[i].type !== "IDENT") return false;
            i++;
        }
        if (!toks[i]) return false;
        return toks[i].type === "ARROW" || toks[i].type === "DASHDASH" || toks[i].type === "BIDIR" || toks[i].type === "EMPHASIS";
    }
    parseIdentList(role) {
        // Parses `IDENT (, IDENT)*`. Returns null after reporting and synchronizing.
        const list = [];
        if (!this.check("IDENT")) {
            const tok = this.advance();
            this.diagnostics.push(diag("error", "E005", `Unexpected token '${tok.lexeme}' where ${role} identifier expected`, tok.range));
            this.synchronize();
            return null;
        }
        list.push(this.advance());
        while (this.check("COMMA")) {
            this.advance(); // consume comma
            if (this.check("IDENT")) {
                list.push(this.advance());
                continue;
            }
            if (this.check("UNKNOWN")) {
                const bad = this.advance();
                const isDigitStart = /^[0-9]/.test(bad.lexeme);
                this.diagnostics.push(diag("error", isDigitStart ? "E002" : "E007", isDigitStart
                    ? `Invalid identifier '${bad.lexeme}' for edge ${role}: must start with a letter or underscore`
                    : `Invalid character '${bad.lexeme}' for edge ${role}`, bad.range));
                this.synchronize();
                return null;
            }
            // Trailing comma with no identifier after it.
            const commaTok = this.previous();
            this.diagnostics.push(diag("error", "E009", `Missing edge ${role} after ','`, commaTok.range));
            this.diagnostics.push(diag("error", "E006", `Incomplete edge: expected identifier after ','`, commaTok.range));
            return null;
        }
        return list;
    }
    parseEdgeOp() {
        if (this.check("ARROW")) return { kind: "directed", opTok: this.advance() };
        if (this.check("DASHDASH")) return { kind: "undirected", opTok: this.advance() };
        if (this.check("BIDIR")) return { kind: "bidirectional", opTok: this.advance() };
        if (this.check("EMPHASIS")) return { kind: "emphasis", opTok: this.advance() };
        return null;
    }
    parseEdgeStmt() {
        // SourceList (EdgeOp TargetList)+ (":" Label)? with optional `ID:` prefix.
        // Covers fan-in, fan-out, chaining, and all operators.
        let explicitId = null;
        let explicitIdRange = null;
        if (this.check("IDENT") && this.tokens[this.idx + 1] && this.tokens[this.idx + 1].type === "COLON" && this.isNamedEdge()) {
            const idTok = this.advance();
            this.advance(); // consume COLON
            explicitId = idTok.lexeme;
            explicitIdRange = idTok.range;
        }
        const sources = this.parseIdentList("source");
        if (!sources) return;
        const segments: Array<{ kind: any; opTok: any; targets: any[] }> = [];
        while (true) {
            const op = this.parseEdgeOp();
            if (!op) {
                if (segments.length === 0) {
                    const lastSrc = sources[sources.length - 1];
                    this.diagnostics.push(diag("error", "E005", `Missing '->', '--', '<->' or '==>' after source identifier '${lastSrc.lexeme}'`, lastSrc.range));
                    this.synchronize();
                    return;
                }
                break;
            }
            // Expect target list after op
            if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
                this.diagnostics.push(diag("error", "E009", `Missing edge target after '${op.opTok.lexeme}'`, op.opTok.range));
                const firstSrc = sources[0];
                this.diagnostics.push(diag("error", "E006", `Incomplete edge: expected target identifier after '${op.opTok.lexeme}'`, { start: firstSrc.range.start, end: op.opTok.range.end }));
                return;
            }
            if (this.check("UNKNOWN")) {
                const bad = this.advance();
                const isDigitStart = /^[0-9]/.test(bad.lexeme);
                this.diagnostics.push(diag("error", isDigitStart ? "E002" : "E007", isDigitStart
                    ? `Invalid identifier '${bad.lexeme}' for edge target: must start with a letter or underscore`
                    : `Invalid character '${bad.lexeme}' for edge target`, bad.range));
                this.synchronize();
                return;
            }
            if (!this.check("IDENT")) {
                const tok = this.advance();
                this.diagnostics.push(diag("error", "E005", `Unexpected token '${tok.lexeme}' after '${op.opTok.lexeme}'; expected target identifier`, tok.range));
                this.synchronize();
                return;
            }
            const targets = this.parseIdentList("target");
            if (!targets) return;
            segments.push({ kind: op.kind, opTok: op.opTok, targets });
        }
        let label;
        let labelRange;
        let labelEndPos: any = null;
        let colonPresent = false;
        if (this.check("COLON")) {
            const colon = this.advance();
            colonPresent = true;
            labelEndPos = colon.range.end;
            if (this.check("NEWLINE") || this.check("COMMENT") || this.check("EOF") || this.check("RBRACE")) {
                this.diagnostics.push(diag("error", "E010", `Empty edge label after ':'`, colon.range));
            }
            else {
                if (this.check("STRING")) {
                    const lblTok = this.advance();
                    label = lblTok.lexeme;
                    labelRange = lblTok.range;
                    labelEndPos = lblTok.range.end;
                    if (label.trim().length === 0) {
                        this.diagnostics.push(diag("error", "E010", `Empty edge label after ':'`, colon.range));
                        label = undefined;
                        labelRange = undefined;
                    }
                    // A quoted label ends the statement; anything after it is unexpected.
                    if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
                        const extra = this.peek();
                        this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after edge label`, extra.range));
                        this.synchronize();
                    }
                }
                else {
                    const firstOffset = colon.range.end.offset;
                    const labelTokens = [];
                    let lastTok = null;
                    let firstTok = null;
                    while (!this.isAtEnd() &&
                        !this.check("NEWLINE") &&
                        !this.check("COMMENT") &&
                        !this.check("EOF") &&
                        !this.check("RBRACE")) {
                        const t = this.advance();
                        labelTokens.push(t);
                        lastTok = t;
                        if (!firstTok)
                            firstTok = t;
                    }
                    if (labelTokens.length === 0) {
                        this.diagnostics.push(diag("error", "E010", `Empty edge label after ':'`, colon.range));
                    }
                    else {
                        // Unquoted labels keep the raw text after the colon.
                        const endOffset = lastTok.range.end.offset;
                        const rawSlice = this.source.slice(firstOffset, endOffset);
                        const trimmed = rawSlice.trim();
                        if (trimmed.length === 0) {
                            this.diagnostics.push(diag("error", "E010", `Empty edge label after ':'`, colon.range));
                        }
                        else {
                            label = trimmed;
                            labelRange = {
                                start: firstTok.range.start,
                                end: lastTok.range.end,
                            };
                            labelEndPos = lastTok.range.end;
                        }
                    }
                }
            }
        }
        if (!this.check("NEWLINE") && !this.check("COMMENT") && !this.check("EOF") && !this.check("RBRACE")) {
            const extra = this.peek();
            this.diagnostics.push(diag("error", this.codeForUnexpected(extra), `Unexpected token '${extra.lexeme}' after edge`, extra.range));
            this.synchronize();
        }
        // Expand segments: cross product per step, chained through each target list.
        // A label applies to the last segment only.
        // An explicit `ID:` prefix needs exactly one edge.
        if (explicitId !== null) {
            const multiSource = sources.length > 1;
            const multiSeg = segments.length > 1 || (segments[0] && segments[0].targets.length > 1);
            if (multiSource || multiSeg) {
                this.diagnostics.push(diag("error", "E005", `Explicit edge id '${explicitId}' requires a single edge: no lists or chaining (use one 'A -> B' per id)`, explicitIdRange));
                this.synchronize();
                return;
            }
        }
        let currentSources = sources;
        const seenIds = new Set<string>(sources.map((s: any) => s.lexeme));
        segments.forEach((seg: any, segIdx: number) => {
            const isLast = segIdx === segments.length - 1;
            const segLabel = isLast ? label : undefined;
            const segLabelRange = isLast ? labelRange : undefined;
            for (const s of currentSources) {
                for (const t of seg.targets) {
                    seenIds.add(t.lexeme);
                    const useEnd = (isLast && colonPresent && labelEndPos) ? labelEndPos : t.range.end;
                    const startPos = explicitId !== null && segIdx === 0 ? explicitIdRange.start : s.range.start;
                    const edgeRange = {
                        start: startPos,
                        end: useEnd,
                    };
                    this.edges.push({
                        id: explicitId !== null ? explicitId : "",
                        source: s.lexeme,
                        target: t.lexeme,
                        label: segLabel,
                        kind: seg.kind,
                        range: edgeRange,
                        sourceRange: s.range,
                        targetRange: t.range,
                        labelRange: segLabelRange,
                        idRange: explicitId !== null ? explicitIdRange : undefined,
                    });
                }
            }
            currentSources = seg.targets;
        });
        // Edge endpoints inside a group belong to it, including implicit nodes.
        const cur = this.currentGroup();
        if (cur) {
            for (const id of seenIds) {
                if (!cur.nodeIds.includes(id)) cur.nodeIds.push(id);
            }
        }
    }
}
/**
 * Convenience parse function — raw parse without semantic validation
 * For full validation use `parseFloe` from index.
 */
export function parse(source) {
    return new Parser(source).parse();
}
/**
 * Raw parse alias for validator integration
 */
export function parseRaw(source) {
    return new Parser(source).parse();
}
