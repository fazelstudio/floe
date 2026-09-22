import { tokenize } from "../lexer.js";
import { getTokenBeforeOffset, getTokenAtOffset, positionAt } from "./utils.js";
import { Parser } from "../parser.js";
import { validate } from "../validator.js";
function parseFloe(source) {
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
    return { diagram: validated.diagram, diagnostics: validated.diagnostics };
}
const DIRECTIONS = ["TB", "BT", "LR", "RL"];
const KNOWN_TYPES = [
    "person",
    "service",
    "database",
    "client",
    "decision",
    "start",
    "end",
    "process",
    "document",
    "queue",
    "store",
    "gateway",
    "system",
    "external",
    "subsystem",
    "container",
    "component",
    "ellipse",
    "circle",
    "cloud",
];
const TOP_LEVEL_KEYWORDS = ["direction", "group", "meta", "note", "link"];
function prefixFilter(items, prefix) {
    if (!prefix)
        return items;
    const lower = prefix.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().startsWith(lower));
}
function getPrefixAtOffset(source, offset) {
    let start = offset;
    while (start > 0 && /[A-Za-z0-9_-]/.test(source[start - 1]))
        start--;
    return source.slice(start, offset);
}
/**
 * Context-aware completion — operates on semantic model, not random.
 */
export function getCompletions(source, offset) {
    const tokens = tokenize(source);
    const before = getTokenBeforeOffset(tokens, offset);
    const at = getTokenAtOffset(tokens, offset);
    const pos = positionAt(source, offset);
    const textBefore = source.slice(0, offset);
    const prefix = getPrefixAtOffset(source, offset);
    // If inside string or comment, no completions (avoid invalid syntax)
    if (at && (at.type === "STRING" || at.type === "COMMENT")) {
        return [];
    }
    // Helper to detect context requiring completion
    const trimmedBefore = textBefore.trimEnd();
    const lines = source.slice(0, offset).split(/\r?\n/);
    const currentLinePrefix = lines[lines.length - 1] ?? "";
    const trimmedLine = currentLinePrefix.trimStart();
    // 1) After "direction" keyword => suggest directions
    // Detect if last keyword before offset is "direction" and no direction value yet consumed
    // Check tokens: look backward for nearest DIRECTION_KW not followed by IDENT before offset
    {
        // Find last DIRECTION_KW before offset
        let lastDirIdx = -1;
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.type === "DIRECTION_KW" && t.range.end.offset <= offset)
                lastDirIdx = i;
        }
        if (lastDirIdx !== -1) {
            const dirTok = tokens[lastDirIdx];
            // Check tokens after direction until offset: if there is no IDENT after it (direction value) then suggest
            let hasValue = false;
            let valueToken;
            for (let i = lastDirIdx + 1; i < tokens.length; i++) {
                const t = tokens[i];
                if (t.range.start.offset >= offset)
                    break;
                if (t.type === "NEWLINE" || t.type === "COMMENT")
                    break;
                if (t.type === "IDENT" || t.type === "UNKNOWN") {
                    hasValue = true;
                    valueToken = t;
                    break;
                }
            }
            if (!hasValue) {
                const items = DIRECTIONS.map((d) => ({
                    label: d,
                    kind: "value",
                    detail: "direction",
                }));
                // When cursor is directly after keyword (offset at token end), prefix is empty for value completion
                // Don't use keyword prefix; check if we are inside a partial value token at cursor
                let valuePrefix = "";
                if (at && at.type === "IDENT" && at.range.start.offset > dirTok.range.end.offset) {
                    valuePrefix = source.slice(at.range.start.offset, offset);
                }
                else if (at && at.type === "UNKNOWN" && at.range.start.offset > dirTok.range.end.offset) {
                    valuePrefix = source.slice(at.range.start.offset, offset);
                }
                return prefixFilter(items, valuePrefix);
            }
            else {
                // A value exists but the cursor may sit inside it while editing.
                if (valueToken) {
                    const idx = tokens.indexOf(valueToken);
                    const prevIsDir = idx > 0 && tokens[idx - 1]?.type === "DIRECTION_KW";
                    if (prevIsDir && offset >= valueToken.range.start.offset && offset <= valueToken.range.end.offset + 1) {
                        const valuePrefix = source.slice(valueToken.range.start.offset, offset);
                        const items = DIRECTIONS.map((d) => ({
                            label: d,
                            kind: "value",
                            detail: "direction",
                        }));
                        return prefixFilter(items, valuePrefix);
                    }
                }
                // Cursor inside a partial direction value still completes it.
                if (at && at.type === "IDENT") {
                    const isValueToken = valueToken && at.range.start.offset === valueToken.range.start.offset;
                    const prevIsDir = (() => {
                        const idx = tokens.indexOf(at);
                        return idx > 0 && tokens[idx - 1]?.type === "DIRECTION_KW";
                    })();
                    if (isValueToken || prevIsDir) {
                        const items = DIRECTIONS.map((d) => ({
                            label: d,
                            kind: "value",
                            detail: "direction",
                        }));
                        const valuePrefix = source.slice(at.range.start.offset, offset);
                        return prefixFilter(items, valuePrefix);
                    }
                }
                if (at && at.type === "UNKNOWN" && valueToken && at.range.start.offset === valueToken.range.start.offset) {
                    const items = DIRECTIONS.map((d) => ({
                        label: d,
                        kind: "value",
                        detail: "direction",
                    }));
                    const valuePrefix = source.slice(at.range.start.offset, offset);
                    return prefixFilter(items, valuePrefix);
                }
            }
        }
    }
    // 1b) After `meta Target.` suggest style + data keys.
    {
        const m = currentLinePrefix.match(/meta\s+[A-Za-z_][A-Za-z0-9_-]*\.\s*[A-Za-z0-9_-]*$/);
        if (m) {
            const keys = [
                "fill",
                "stroke",
                "strokeWidth",
                "fontSize",
                "fontColor",
                "opacity",
                "owner",
                "title",
                "description",
            ];
            const items = keys.map((k) => ({
                label: k,
                kind: "property",
                detail: ["fill", "stroke", "strokeWidth", "fontSize", "fontColor", "opacity"].includes(k) ? "style key" : "metadata key",
            }));
            return prefixFilter(items, prefix);
        }
    }
    // 2) Inside `[...]` suggest known node types.
    {
        let lastLbIdx = -1;
        let lastRbIdx = -1;
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.range.end.offset > offset)
                break;
            if (t.type === "LBRACKET")
                lastLbIdx = i;
            if (t.type === "RBRACKET")
                lastRbIdx = i;
        }
        if (lastLbIdx !== -1 && lastLbIdx > lastRbIdx) {
            const items = KNOWN_TYPES.map((t) => ({
                label: t,
                kind: "type",
                detail: "node type",
            }));
            return prefixFilter(items, prefix);
        }
    }
    // 3) After an edge operator or comma suggest node ids.
    {
        let lastOpIdx = -1;
        for (let i = tokens.length - 1; i >= 0; i--) {
            const t = tokens[i];
            if (t.range.end.offset <= offset && (t.type === "ARROW" || t.type === "DASHDASH" || t.type === "BIDIR" || t.type === "EMPHASIS")) {
                lastOpIdx = i;
                break;
            }
            if (t.type === "NEWLINE" && t.range.start.offset < offset) {
                break;
            }
        }
        if (lastOpIdx !== -1) {
            const opTok = tokens[lastOpIdx];
            let hasTarget = false;
            for (let i = lastOpIdx + 1; i < tokens.length; i++) {
                const t = tokens[i];
                if (t.range.start.offset >= offset)
                    break;
                if (t.type === "NEWLINE" || t.type === "COMMENT" || t.type === "RBRACE")
                    break;
                if (t.type === "IDENT") {
                    hasTarget = true;
                    if (at && at.type === "IDENT" && at.range.start.offset > opTok.range.end.offset) {
                        hasTarget = false;
                    }
                    break;
                }
            }
            if (!hasTarget) {
                try {
                    const { diagram } = parseFloe(source);
                    const ids = diagram.nodes.map((n) => n.id);
                    const collectGroups = (gs) => {
                        const out = [];
                        for (const g of gs) {
                            out.push(g.id);
                            out.push(...collectGroups(g.groups));
                        }
                        return out;
                    };
                    const groupIds = collectGroups(diagram.groups);
                    const allIds = Array.from(new Set([...ids, ...groupIds]));
                    const items = allIds.map((id) => ({
                        label: id,
                        kind: "variable",
                        detail: "node",
                    }));
                    if (items.length === 0) {
                        return [];
                    }
                    return prefixFilter(items, prefix);
                }
                catch {
                    return [];
                }
            }
        }
        // After a comma inside an edge line (`A, B -> C`, `A -> B, C`) suggest ids.
        if (before && before.type === "COMMA") {
            try {
                const { diagram } = parseFloe(source);
                const ids = diagram.nodes.map((n) => n.id);
                const collectGroups = (gs: any[]): string[] => {
                    const out: string[] = [];
                    for (const g of gs) {
                        out.push(g.id);
                        out.push(...collectGroups(g.groups));
                    }
                    return out;
                };
                const groupIds = collectGroups(diagram.groups);
                const allIds = Array.from(new Set([...ids, ...groupIds]));
                const items = allIds.map((id) => ({ label: id, kind: "variable", detail: "node" }));
                if (items.length === 0) return [];
                return prefixFilter(items, prefix);
            } catch {
                return [];
            }
        }
    }
    // 4) At line start suggest top-level keywords, else existing node ids.
    {
        const lineTrim = trimmedLine;
        if (lineTrim === "" || /^[A-Za-z]*$/.test(prefix) && lineTrim.length <= prefix.length + 10) {
            const keywordItems = TOP_LEVEL_KEYWORDS.map((k) => ({
                label: k,
                kind: "keyword",
                detail: "keyword",
            }));
            const filteredKeywords = prefixFilter(keywordItems, prefix);
            if (filteredKeywords.length > 0) {
                return filteredKeywords;
            }
            // No keyword matches: complete an edge source from existing node ids.
            if (prefix.length > 0) {
                try {
                    const { diagram } = parseFloe(source);
                    const ids = Array.from(new Set(diagram.nodes.map((n) => n.id)));
                    const idItems = ids.map((id) => ({
                        label: id,
                        kind: "variable",
                        detail: "node id",
                    }));
                    const filteredIds = prefixFilter(idItems, prefix);
                    if (filteredIds.length > 0)
                        return filteredIds;
                }
                catch { }
            }
            return filteredKeywords;
        }
    }
    // 5) After `group` a new id is expected: no suggestions.
    {
        if (before && before.type === "GROUP_KW") {
            return [];
        }
        if (trimmedBefore.endsWith("group") || trimmedBefore.match(/\bgroup\s+$/)) {
            return [];
        }
    }
    // 6) After `meta`, `note`, `link` suggest identifiers.
    {
        if (before && before.type === "META_KW") {
            return [];
        }
        if (before && before.type === "NOTE_KW") {
            try {
                const { diagram } = parseFloe(source);
                const ids = Array.from(new Set([...diagram.nodes.map((n) => n.id), ...collectGroupIds(diagram.groups)]));
                const items = ids.map((id) => ({
                    label: id,
                    kind: "variable",
                    detail: "note target",
                }));
                if (items.length > 0)
                    return prefixFilter(items, prefix);
            }
            catch { }
        }
        if (before && before.type === "LINK_KW") {
            try {
                const { diagram } = parseFloe(source);
                const ids = Array.from(new Set([...diagram.nodes.map((n) => n.id), ...collectGroupIds(diagram.groups)]));
                const items = ids.map((id) => ({
                    label: id,
                    kind: "variable",
                    detail: "link target",
                }));
                return prefixFilter(items, prefix);
            }
            catch { }
        }
    }
    return [];
}
function collectGroupIds(groups) {
    const out = [];
    for (const g of groups) {
        out.push(g.id);
        out.push(...collectGroupIds(g.groups));
    }
    return out;
}
