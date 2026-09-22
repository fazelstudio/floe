import { tokenize } from "../lexer.js";
import { getTokenAtOffset, positionAt } from "./utils.js";
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
 * Hover — may expose node ID, type, label, incoming/outgoing edges, metadata
 */
export function getHover(source, offset) {
    const tokens = tokenize(source);
    const tok = getTokenAtOffset(tokens, offset);
    let word = "";
    let targetToken = tok;
    if (!tok) {
        // A cursor in whitespace right after an identifier still hovers that identifier.
        const ch = source[offset];
        if (ch === undefined || /\s/.test(ch)) {
            // Accept the identifier directly before the cursor on the same line.
            for (let i = tokens.length - 1; i >= 0; i--) {
                const t = tokens[i];
                if (t.range.end.offset <= offset && t.type === "IDENT") {
                    const pos = positionAt(source, offset);
                    const tPos = t.range.end;
                    if (tPos.line === pos.line && offset - t.range.end.offset <= 1) {
                        targetToken = t;
                        break;
                    }
                }
            }
            if (!targetToken || targetToken.type !== "IDENT")
                return null;
        }
        else {
            return null;
        }
    }
    // Hover covers identifiers; keywords and strings get a one-line summary.
    if (!targetToken || targetToken.type !== "IDENT") {
        if (targetToken && (targetToken.type === "DIRECTION_KW" || targetToken.type === "GROUP_KW" || targetToken.type === "META_KW" || targetToken.type === "NOTE_KW" || targetToken.type === "LINK_KW")) {
            return {
                contents: [`Keyword \`${targetToken.lexeme}\``],
                range: targetToken.range,
            };
        }
        if (targetToken && targetToken.type === "STRING") {
            return {
                contents: [`Label: "${targetToken.lexeme}"`],
                range: targetToken.range,
            };
        }
        return null;
    }
    word = targetToken.lexeme;
    const { diagram } = parseFloe(source);
    const edgeOp = (k) => k === "directed" ? "->" : k === "undirected" ? "--" : k === "bidirectional" ? "<->" : "==>";
    // Explicit edge ids (`E1: A -> B`) resolve before node/group lookup.
    const namedEdge = diagram.edges.find((e) => e.id === word && e.idRange);
    if (namedEdge) {
        const contents = [];
        contents.push(`**Edge \`${namedEdge.id}\`**`);
        contents.push(`${namedEdge.source} ${edgeOp(namedEdge.kind)} ${namedEdge.target}${namedEdge.label ? ` : ${namedEdge.label}` : ""}`);
        if (namedEdge.kind)
            contents.push(`Kind: \`${namedEdge.kind}\``);
        if (namedEdge.style && Object.keys(namedEdge.style).length > 0)
            contents.push(`Style: ${JSON.stringify(namedEdge.style)}`);
        if (namedEdge.metadata && Object.keys(namedEdge.metadata).length > 0)
            contents.push(`Metadata: ${JSON.stringify(namedEdge.metadata)}`);
        const anns = diagram.annotations.filter((a) => a.target === word);
        if (anns.length > 0)
            contents.push(`Annotations: ${anns.map((a) => `"${a.text}"`).join(", ")}`);
        const elink = namedEdge.link ?? diagram.links.find((l) => l.target === word)?.url;
        if (elink)
            contents.push(`Link: ${elink}`);
        return { contents, range: targetToken.range };
    }
    // Find node where id == word
    const node = diagram.nodes.find((n) => n.id === word);
    const group = findGroup(diagram.groups, word);
    const incoming = diagram.edges.filter((e) => e.target === word);
    const outgoing = diagram.edges.filter((e) => e.source === word);
    // If it's a node
    if (node) {
        const contents = [];
        contents.push(`**Node \`${node.id}\`**`);
        if (node.type)
            contents.push(`Type: \`${node.type}\``);
        if (node.label)
            contents.push(`Label: "${node.label}"`);
        else
            contents.push(`Label: "${node.id}" (default)`);
        // incoming/outgoing
        if (outgoing.length > 0) {
            contents.push(`Outgoing: ${outgoing.map((e) => `${e.source} ${edgeOp(e.kind)} ${e.target}${e.label ? ` : ${e.label}` : ""}`).join(", ")}`);
        }
        else {
            contents.push(`Outgoing: (none)`);
        }
        if (incoming.length > 0) {
            contents.push(`Incoming: ${incoming.map((e) => `${e.source} ${edgeOp(e.kind)} ${e.target}${e.label ? ` : ${e.label}` : ""}`).join(", ")}`);
        }
        else {
            contents.push(`Incoming: (none)`);
        }
        // Metadata: if node belongs to group, show group membership
        const membership = findGroupsContainingNode(diagram.groups, word);
        if (membership.length > 0) {
            contents.push(`Groups: ${membership.map((g) => g.id).join(", ")}`);
        }
        // Diagram-level metadata applies to every node.
        if (diagram.metadata && Object.keys(diagram.metadata).length > 0) {
            contents.push(`Diagram metadata: ${JSON.stringify(diagram.metadata)}`);
        }
        if (group && group.metadata && Object.keys(group.metadata).length > 0) {
            contents.push(`Group metadata: ${JSON.stringify(group.metadata)}`);
        }
        // Annotations for this node
        const anns = diagram.annotations.filter((a) => a.target === word);
        if (anns.length > 0) {
            contents.push(`Annotations: ${anns.map((a) => `"${a.text}"`).join(", ")}`);
        }
        const link = node.link ?? diagram.links.find((l) => l.target === word);
        if (link) {
            contents.push(`Link: ${typeof link === "string" ? link : link.url}`);
        }
        if (node.style && Object.keys(node.style).length > 0) {
            contents.push(`Style: ${JSON.stringify(node.style)}`);
        }
        if (node.metadata && Object.keys(node.metadata).length > 0) {
            contents.push(`Metadata: ${JSON.stringify(node.metadata)}`);
        }
        return { contents, range: targetToken.range };
    }
    // If it's a group
    if (group) {
        const contents = [];
        contents.push(`**Group \`${group.id}\`**`);
        if (group.type)
            contents.push(`Type: \`${group.type}\``);
        if (group.label)
            contents.push(`Label: "${group.label}"`);
        if (group.nodeIds.length > 0)
            contents.push(`Members: ${group.nodeIds.join(", ")}`);
        else
            contents.push(`Members: (none direct)`);
        if (group.groups.length > 0)
            contents.push(`Nested groups: ${group.groups.map((g) => g.id).join(", ")}`);
        if (group.metadata && Object.keys(group.metadata).length > 0)
            contents.push(`Metadata: ${JSON.stringify(group.metadata)}`);
        if (group.style && Object.keys(group.style).length > 0)
            contents.push(`Style: ${JSON.stringify(group.style)}`);
        if (group.annotations.length > 0)
            contents.push(`Annotations: ${group.annotations.map((a) => `"${a.text}"`).join(", ")}`);
        if (group.link)
            contents.push(`Link: ${group.link}`);
        // Edges that mention the group id directly (rare).
        if (incoming.length > 0)
            contents.push(`Incoming edges: ${incoming.length}`);
        if (outgoing.length > 0)
            contents.push(`Outgoing edges: ${outgoing.length}`);
        return { contents, range: targetToken.range };
    }
    // Identifiers used only inside edges describe implicit nodes.
    if (incoming.length > 0 || outgoing.length > 0) {
        const contents = [];
        contents.push(`**Node \`${word}\`** (implicit)`);
        contents.push(`Outgoing: ${outgoing.map((e) => `${e.source} ${edgeOp(e.kind)} ${e.target}`).join(", ") || "(none)"}`);
        contents.push(`Incoming: ${incoming.map((e) => `${e.source} ${edgeOp(e.kind)} ${e.target}`).join(", ") || "(none)"}`);
        return { contents, range: targetToken.range };
    }
    // Diagram-level metadata keys.
    if (diagram.metadata && diagram.metadata[word] !== undefined) {
        return {
            contents: [`Metadata \`${word}\` = "${diagram.metadata[word]}"`],
            range: targetToken.range,
        };
    }
    // Fallback: generic identifier
    return {
        contents: [`\`${word}\``],
        range: targetToken.range,
    };
}
function findGroup(groups, id) {
    for (const g of groups) {
        if (g.id === id)
            return g;
        const child = findGroup(g.groups, id);
        if (child)
            return child;
    }
    return undefined;
}
function findGroupsContainingNode(groups, nodeId) {
    const result = [];
    function traverse(arr) {
        for (const g of arr) {
            if (g.nodeIds.includes(nodeId))
                result.push(g);
            traverse(g.groups);
        }
    }
    traverse(groups);
    return result;
}
