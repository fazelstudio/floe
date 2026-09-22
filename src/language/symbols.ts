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
/**
 * Symbols — discoverable symbols in document.
 * Provides hierarchical outline: groups, nodes, edges.
 */
export function getSymbols(source) {
    const { diagram } = parseFloe(source);
    const symbols = [];
    if (diagram.directionRange) {
        symbols.push({
            name: `direction ${diagram.direction}`,
            kind: "direction",
            range: diagram.directionRange,
            detail: diagram.direction,
        });
    }
    // Nodes inside groups already appear as group children,
    // so only ungrouped nodes become top-level symbols.
    for (const grp of diagram.groups) {
        symbols.push(groupToSymbol(grp));
    }
    const groupedNodeIds = new Set();
    function collectGroupedIds(groups) {
        for (const g of groups) {
            for (const nid of g.nodeIds)
                groupedNodeIds.add(nid);
            collectGroupedIds(g.groups);
        }
    }
    collectGroupedIds(diagram.groups);
    for (const node of diagram.nodes) {
        if (groupedNodeIds.has(node.id))
            continue;
        symbols.push({
            name: node.id,
            kind: "node",
            range: node.range,
            detail: node.type ? `[${node.type}]${node.label ? ` "${node.label}"` : ""}` : node.label ? `"${node.label}"` : undefined,
        });
    }
    // Edges as symbols (stable id first when explicit)
    for (const edge of diagram.edges) {
        const op = edge.kind === "directed" ? "->" : edge.kind === "undirected" ? "--" : edge.kind === "bidirectional" ? "<->" : "==>";
        symbols.push({
            name: edge.idRange ? `${edge.id}: ${edge.source} ${op} ${edge.target}` : `${edge.source} ${op} ${edge.target}`,
            kind: "edge",
            range: edge.range,
            detail: edge.label ? `: ${edge.label}` : undefined,
        });
    }
    for (const ann of diagram.annotations) {
        if (!ann.target) {
            symbols.push({
                name: `note "${ann.text.slice(0, 20)}"`,
                kind: "annotation",
                range: ann.range,
                detail: ann.text,
            });
        }
    }
    for (const link of diagram.links) {
        symbols.push({
            name: `link ${link.target}`,
            kind: "link",
            range: link.range,
            detail: link.url,
        });
    }
    return symbols;
}
function groupToSymbol(g) {
    const children = [];
    // Add nested groups
    for (const child of g.groups) {
        children.push(groupToSymbol(child));
    }
    // Member nodes use the group range; only ids are stored here.
    for (const nid of g.nodeIds) {
        children.push({
            name: nid,
            kind: "node",
            range: g.range,
            detail: "member",
        });
    }
    if (g.metadata) {
        for (const [k, v] of Object.entries(g.metadata)) {
            children.push({
                name: `meta ${k}`,
                kind: "meta",
                range: g.range,
                detail: `"${v}"`,
            });
        }
    }
    for (const ann of g.annotations) {
        children.push({
            name: ann.target ? `note ${ann.target}` : `note`,
            kind: "annotation",
            range: ann.range,
            detail: ann.text,
        });
    }
    if (g.link) {
        children.push({
            name: `link ${g.id}`,
            kind: "link",
            range: g.range,
            detail: g.link,
        });
    }
    return {
        name: g.id,
        kind: "group",
        range: g.range,
        detail: g.type ? `[${g.type}]${g.label ? ` "${g.label}"` : ""}` : g.label ? `"${g.label}"` : undefined,
        children: children.length > 0 ? children : undefined,
    };
}
/** Flat symbol list (non-hierarchical). */
export function getFlatSymbols(source) {
    const hierarchical = getSymbols(source);
    const flat = [];
    function walk(arr) {
        for (const s of arr) {
            flat.push(s);
            if (s.children)
                walk(s.children);
        }
    }
    walk(hierarchical);
    return flat;
}
