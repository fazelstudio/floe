import { diag } from "./diagnostics.js";
import { isValidIdentifier } from "./types.js";
/**
 * Semantic validator
 *
 * Detects:
 * - invalid direction (E001)
 * - invalid identifiers (E002)
 * - duplicate node declarations (E003)
 * - duplicate direction declarations (E004)
 * - malformed / invalid constructs (E005, E008, etc.)
 * - duplicate edge ids + id collisions (E015, v1.2)
 * - invalid style values (E013, v1.2)
 *
 * Keeps validation separate from parsing so the core model can be reused
 * without parser errors leaking into semantics.
 */
function isSafeColor(v) {
    if (typeof v !== "string") return false;
    const s = v.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true;
    return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s) && s.length <= 24;
}
export function validate(input) {
    const { diagram, explicitNodes, edges } = input;
    const out = [...input.diagnostics];
    const groups = (input.groups ?? diagram.groups ?? []);
    // ---- 1. Duplicate direction declarations ----
    if (input.directionDeclarations.length > 1) {
        // First one is considered primary, rest are duplicates
        for (let i = 1; i < input.directionDeclarations.length; i++) {
            const dup = input.directionDeclarations[i];
            out.push(diag("error", "E004", `Duplicate direction declaration: direction already set to '${input.directionDeclarations[0].value}'`, dup.range));
        }
    }
    // Also check invalid direction values that may have slipped (parser already flagged E001, but double-check)
    for (const d of input.directionDeclarations) {
        if (!["TB", "BT", "LR", "RL"].includes(d.value)) {
            // Parser already emitted E001/E002, avoid double. Only emit if not already present at same range
            const already = out.some((x) => x.range.start.offset === d.range.start.offset &&
                (x.code === "E001" || x.code === "E002"));
            if (!already) {
                out.push(diag("error", "E001", `Invalid direction '${d.value}'`, d.range));
            }
        }
    }
    // ---- 2. Invalid identifiers ----
    // Explicit nodes
    for (const n of explicitNodes) {
        if (!isValidIdentifier(n.id)) {
            // Avoid duplicate if parser already reported at same range
            const already = out.some((d) => d.range.start.offset === n.range.start.offset &&
                d.code === "E002");
            if (!already) {
                out.push(diag("error", "E002", `Invalid identifier '${n.id}': must match [A-Za-z_][A-Za-z0-9_-]*`, n.range));
            }
        }
        if (n.type !== undefined && !isValidIdentifier(n.type)) {
            const already = out.some((d) => d.code === "E002" && d.message.includes(n.type));
            if (!already) {
                // Find range for type: we stored node range covering brackets, but we can use node range
                out.push(diag("error", "E002", `Invalid node type '${n.type}': must match [A-Za-z_][A-Za-z0-9_-]*`, n.range));
            }
        }
    }
    // Edges sources/targets, including explicit edge ids.
    for (const e of edges) {
        if (e.id !== undefined && e.id !== "" && !isValidIdentifier(e.id)) {
            const already = out.some((d) => d.code === "E002" && d.message.includes(String(e.id)));
            if (!already) {
                out.push(diag("error", "E002", `Invalid edge id '${e.id}': must match [A-Za-z_][A-Za-z0-9_-]*`, e.idRange ?? e.range));
            }
        }
        if (!isValidIdentifier(e.source)) {
            const already = out.some((d) => d.range.start.offset === e.sourceRange.start.offset &&
                d.code === "E002");
            if (!already) {
                out.push(diag("error", "E002", `Invalid identifier '${e.source}'`, e.sourceRange));
            }
        }
        if (!isValidIdentifier(e.target)) {
            const already = out.some((d) => d.range.start.offset === e.targetRange.start.offset &&
                d.code === "E002");
            if (!already) {
                out.push(diag("error", "E002", `Invalid identifier '${e.target}'`, e.targetRange));
            }
        }
    }
    // ---- 3. Duplicate node declarations ----
    // Map id -> first occurrence range
    const seen = new Map();
    for (const n of explicitNodes) {
        const prev = seen.get(n.id);
        if (prev) {
            out.push(diag("error", "E003", `Duplicate node declaration for '${n.id}'`, n.range));
        }
        else {
            seen.set(n.id, n);
        }
    }
    // ---- 4. Malformed / invalid constructs ----
    // Empty labels are reported by the parser (E010); re-check for programmatically built diagrams.
    for (const e of edges) {
        if (e.label !== undefined && e.label.trim().length === 0) {
            const range = e.labelRange ?? e.range;
            const already = out.some((d) => d.code === "E010" && d.range.start.offset === range.start.offset);
            if (!already)
                out.push(diag("error", "E010", `Empty edge label`, range));
        }
        // Invalid node types already handled via invalid identifier above; E008 comes from the parser.
    }
    // ---- 5. Groups validation ----
    // Flatten groups for analysis
    const allGroups = [];
    function collectGroups(arr) {
        for (const g of arr) {
            allGroups.push(g);
            if (g.groups && g.groups.length > 0)
                collectGroups(g.groups);
        }
    }
    collectGroups(groups);
    // 5a. Invalid group identifiers and types
    for (const g of allGroups) {
        if (!isValidIdentifier(g.id)) {
            const already = out.some((d) => d.range.start.offset === g.range.start.offset && d.code === "E002");
            if (!already)
                out.push(diag("error", "E002", `Invalid group identifier '${g.id}': must match [A-Za-z_][A-Za-z0-9_-]*`, g.range));
        }
        if (g.type !== undefined && !isValidIdentifier(g.type)) {
            out.push(diag("error", "E002", `Invalid group type '${g.type}': must match [A-Za-z_][A-Za-z0-9_-]*`, g.range));
        }
    }
    // 5b. Duplicate group ids (E011)
    const seenGroups = new Map();
    for (const g of allGroups) {
        const prev = seenGroups.get(g.id);
        if (prev) {
            out.push(diag("error", "E011", `Duplicate group declaration for '${g.id}'`, g.range));
        }
        else {
            seenGroups.set(g.id, g);
        }
    }
    // 5c. Invalid annotation/link targets (E014), including edge ids.
    const nodeIds = new Set();
    for (const n of explicitNodes)
        nodeIds.add(n.id);
    for (const n of diagram.nodes)
        nodeIds.add(n.id);
    const groupIds = new Set(allGroups.map((g) => g.id));
    const edgeIds = new Set(edges.map((e) => e.id).filter(Boolean));
    const allIds = new Set([...nodeIds, ...groupIds, ...edgeIds]);
    // 5c-i. Duplicate edge ids (E015): explicit dupes + collisions with node/group ids.
    // Auto ids are generated collision-free, so only explicit (idRange present) can collide.
    const seenEdgeIds = new Map();
    for (const e of edges) {
        if (!e.idRange) continue; // auto id — parser guaranteed unique
        const prev = seenEdgeIds.get(e.id);
        if (prev) {
            out.push(diag("error", "E015", `Duplicate edge id '${e.id}'`, e.idRange));
        }
        else {
            seenEdgeIds.set(e.id, e);
            if (nodeIds.has(e.id) || groupIds.has(e.id)) {
                out.push(diag("error", "E015", `Edge id '${e.id}' collides with a node or group id`, e.idRange));
            }
        }
    }
    if (input.annotations) {
        for (const ann of input.annotations) {
            if (ann.target !== undefined && !allIds.has(ann.target)) {
                out.push(diag("error", "E014", `Annotation target '${ann.target}' does not exist`, ann.range));
            }
            if (ann.text.trim().length === 0) {
                const already = out.some((d) => d.code === "E014" && d.range.start.offset === ann.range.start.offset);
                if (!already)
                    out.push(diag("error", "E014", `Empty annotation text`, ann.range));
            }
        }
    }
    else if (diagram.annotations) {
        for (const ann of diagram.annotations) {
            if (ann.target !== undefined && !allIds.has(ann.target)) {
                out.push(diag("error", "E014", `Annotation target '${ann.target}' does not exist`, ann.range));
            }
        }
    }
    if (input.links) {
        const seenLinkTargets = new Set();
        for (const link of input.links) {
            if (!allIds.has(link.target)) {
                out.push(diag("error", "E014", `Link target '${link.target}' does not exist`, link.range));
            }
            if (!isValidIdentifier(link.target)) {
                out.push(diag("error", "E002", `Invalid link target '${link.target}'`, link.range));
            }
            if (link.url.trim().length === 0) {
                out.push(diag("error", "E014", `Empty link URL for target '${link.target}'`, link.range));
            }
            // Security: block javascript:, data:, vbscript: schemes
            if (/^(javascript|data|vbscript):/i.test(link.url.trim())) {
                out.push(diag("error", "E014", `Unsafe link URL scheme for target '${link.target}': javascript/data urls are not allowed`, link.range));
            }
            if (seenLinkTargets.has(link.target)) {
                const already = out.some((d) => d.code === "E014" && d.message.includes(link.target) && d.range.start.offset === link.range.start.offset);
                if (!already)
                    out.push(diag("error", "E014", `Duplicate link for target '${link.target}'`, link.range));
            }
            seenLinkTargets.add(link.target);
        }
    }
    else if (diagram.links) {
        const seenLinkTargets = new Set();
        for (const link of diagram.links) {
            if (!allIds.has(link.target)) {
                out.push(diag("error", "E014", `Link target '${link.target}' does not exist`, link.range));
            }
            if (seenLinkTargets.has(link.target))
                out.push(diag("error", "E014", `Duplicate link for target '${link.target}'`, link.range));
            seenLinkTargets.add(link.target);
        }
    }
    // 5d. Metadata validation (E013)
    // Keys are already validated as IDENT by parser; check empty values and duplicates already? Additional checks:
    for (const g of allGroups) {
        for (const [k, v] of Object.entries(g.metadata ?? {} as Record<string, string>)) {
            const vs = v as unknown as string;
            if (!isValidIdentifier(k)) {
                out.push(diag("error", "E002", `Invalid metadata key '${k}' in group '${g.id}'`, g.range));
            }
            if (vs.trim().length === 0) {
                out.push(diag("error", "E013", `Empty metadata value for key '${k}' in group '${g.id}'`, g.range));
            }
        }
    }
    for (const [k, v] of Object.entries(diagram.metadata ?? {} as Record<string, string>)) {
        const vs = v as unknown as string;
        if (!isValidIdentifier(k)) {
            out.push(diag("error", "E002", `Invalid metadata key '${k}'`, diagram.directionRange ?? { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } }));
        }
        if (vs.trim().length === 0) {
            out.push(diag("error", "E013", `Empty metadata value for key '${k}'`, diagram.directionRange ?? { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } }));
        }
    }
    // 5d-ii. Per-element style + metadata values from scoped `meta ID.key`.
    function checkStyle(style, range, owner) {
        if (!style) return;
        for (const [k, v] of Object.entries(style)) {
            if (k === "fill" || k === "stroke" || k === "fontColor") {
                if (typeof v !== "string" || !isSafeColor(v)) {
                    out.push(diag("error", "E013", `Invalid style value for '${owner}.${k}': expected a color (#hex or name)`, range));
                }
            }
            else if (k === "strokeWidth" || k === "fontSize") {
                if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
                    out.push(diag("error", "E013", `Invalid style value for '${owner}.${k}': must be a number > 0`, range));
                }
            }
            else if (k === "opacity") {
                if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
                    out.push(diag("error", "E013", `Invalid style value for '${owner}.${k}': opacity must be 0..1`, range));
                }
            }
        }
    }
    function checkElemMeta(meta, range, owner) {
        if (!meta) return;
        for (const [k, v] of Object.entries(meta)) {
            if (!isValidIdentifier(k)) {
                out.push(diag("error", "E002", `Invalid metadata key '${k}' for '${owner}'`, range));
            }
            if (typeof v !== "string" || v.trim().length === 0) {
                const already = out.some((d) => d.code === "E013" && d.range.start.offset === range.start.offset && d.message.includes(`'${owner}.${k}'`));
                if (!already)
                    out.push(diag("error", "E013", `Empty metadata value for '${owner}.${k}'`, range));
            }
        }
    }
    for (const n of diagram.nodes) {
        checkStyle(n.style, n.range, n.id);
        checkElemMeta(n.metadata, n.range, n.id);
    }
    for (const e of edges) {
        checkStyle(e.style, e.range, e.id || `${e.source}->${e.target}`);
        checkElemMeta(e.metadata, e.range, e.id || `${e.source}->${e.target}`);
    }
    for (const g of allGroups) {
        checkStyle(g.style, g.range, g.id);
    }
    // 5e. Edge kind validation: four kinds, anything else is malformed.
    for (const e of edges) {
        if (e.kind !== "directed" && e.kind !== "undirected" && e.kind !== "bidirectional" && e.kind !== "emphasis") {
            out.push(diag("error", "E005", `Invalid edge kind '${e.kind}' for edge ${e.source} -> ${e.target}`, e.range));
        }
    }
    // Sort diagnostics by offset for stable output
    out.sort((a, b) => a.range.start.offset - b.range.start.offset);
    // Diagram is already built (with deduplicated nodes). Validation does not mutate diagram structure for v0.1,
    // but could filter duplicates if needed. We keep diagram as is.
    // Ensure diagram nodes are deduplicated (parser already did). If validator found duplicates, diagram remains with first occurrence only.
    return { diagram, diagnostics: out };
}
