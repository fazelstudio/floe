import { tokenize } from "../lexer.js";
/**
 * Folding information — where applicable, groups with braces.
 */
export function getFoldingRanges(source) {
    const tokens = tokenize(source);
    const stack = [];
    const ranges = [];
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.type === "LBRACE") {
            stack.push({ line: tok.range.start.line, column: tok.range.start.column, offset: tok.range.start.offset });
        }
        else if (tok.type === "RBRACE") {
            const open = stack.pop();
            if (open) {
                const startLine = open.line;
                const endLine = tok.range.end.line;
                if (endLine > startLine) {
                    ranges.push({
                        startLine,
                        endLine,
                        startColumn: open.column,
                        endColumn: tok.range.end.column,
                        kind: "group",
                        collapsedText: "…",
                    });
                }
            }
        }
    }
    // Unclosed groups still fold, from the opening brace to end of file.
    if (stack.length > 0) {
        const lines = source.split(/\r?\n/);
        const endLine = lines.length;
        for (const open of stack) {
            if (endLine > open.line) {
                ranges.push({
                    startLine: open.line,
                    endLine,
                    startColumn: open.column,
                    endColumn: 1,
                    kind: "group",
                    collapsedText: "…",
                });
            }
        }
    }
    // Sort by startLine
    ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    return ranges;
}
/** Folding info alias, same shape as getFoldingRanges. */
export function getFoldingInfo(source) {
    return getFoldingRanges(source);
}
