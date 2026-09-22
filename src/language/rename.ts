import { tokenize } from "../lexer.js";
import { getTokenAtOffset } from "./utils.js";
import { isValidIdentifier } from "../types.js";
import { getReferencesForWord } from "./references.js";
import { Parser } from "../parser.js";
import { validate } from "../validator.js";
function collisionCode(source, oldName, newName) {
    try {
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
        const d = validated.diagram;
        if (newName === oldName) return null;
        const nodeIds = new Set(d.nodes.map((n) => n.id));
        const groupIds = new Set();
        const walk = (gs) => {
            for (const g of gs) {
                groupIds.add(g.id);
                walk(g.groups);
            }
        };
        walk(d.groups);
        const edgeIds = new Set(d.edges.map((e) => e.id).filter(Boolean));
        const isOldEdge = edgeIds.has(oldName);
        if (edgeIds.has(newName) && !isOldEdge) return "E015";
        if (nodeIds.has(newName) && newName !== oldName) return isOldEdge ? "E015" : "E003";
        if (groupIds.has(newName) && newName !== oldName) return isOldEdge ? "E015" : "E011";
        if (isOldEdge && (nodeIds.has(newName) || groupIds.has(newName))) return "E015";
    }
    catch {
        return null;
    }
    return null;
}
export function rename(source, offset, newName) {
    if (!isValidIdentifier(newName)) {
        return { error: `Invalid identifier '${newName}': must match [A-Za-z_][A-Za-z0-9_-]*`, code: "E002" };
    }
    const tokens = tokenize(source);
    const tok = getTokenAtOffset(tokens, offset);
    if (!tok || tok.type !== "IDENT") {
        return { error: `No identifier found at offset ${offset}` };
    }
    const oldName = tok.lexeme;
    if (oldName === newName) {
        return { edits: [] };
    }
    const collide = collisionCode(source, oldName, newName);
    if (collide) {
        return { error: `Rename would collide with existing '${newName}'`, code: collide };
    }
    const refs = getReferencesForWord(source, oldName);
    const edits = refs.map((loc) => ({
        range: loc.range,
        newText: newName,
    }));
    // Descending offsets keep later edits from shifting earlier ones.
    edits.sort((a, b) => b.range.start.offset - a.range.start.offset);
    return { edits, newSource: applyEdits(source, edits) };
}
export function applyEdits(source, edits) {
    // Apply edits in descending offset order to preserve correctness
    const sorted = [...edits].sort((a, b) => b.range.start.offset - a.range.start.offset);
    let out = source;
    for (const e of sorted) {
        const start = e.range.start.offset;
        const end = e.range.end.offset;
        out = out.slice(0, start) + e.newText + out.slice(end);
    }
    return out;
}
/** Convenience: rename word directly without offset, useful for tests */
export function renameWord(source, oldWord, newName) {
    if (!isValidIdentifier(newName)) {
        return { error: `Invalid identifier '${newName}'`, code: "E002" };
    }
    const collide = collisionCode(source, oldWord, newName);
    if (collide) {
        return { error: `Rename would collide with existing '${newName}'`, code: collide };
    }
    const refs = getReferencesForWord(source, oldWord);
    if (refs.length === 0)
        return { error: `No references found for '${oldWord}'` };
    const edits = refs.map((loc) => ({ range: loc.range, newText: newName }));
    edits.sort((a, b) => b.range.start.offset - a.range.start.offset);
    return { edits, newSource: applyEdits(source, edits) };
}
