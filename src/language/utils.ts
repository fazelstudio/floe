import { tokenize } from "../lexer.js";
/** Convert offset (0-indexed) to Position (1-indexed line/col) */
export function positionAt(source, offset) {
    let line = 1;
    let column = 1;
    let cur = 0;
    const len = source.length;
    const off = Math.max(0, Math.min(offset, len));
    while (cur < off) {
        const ch = source[cur];
        if (ch === "\n") {
            line++;
            column = 1;
            cur++;
        }
        else if (ch === "\r") {
            if (source[cur + 1] === "\n") {
                line++;
                column = 1;
                cur += 2;
            }
            else {
                line++;
                column = 1;
                cur++;
            }
        }
        else {
            column++;
            cur++;
        }
    }
    return { line, column, offset: off };
}
export function offsetAt(source, pos) {
    // A carried offset is authoritative; otherwise derive it from line/column.
    if (typeof pos.offset === "number")
        return pos.offset;
    let line = 1;
    let column = 1;
    let offset = 0;
    while (offset < source.length) {
        if (line === pos.line && column === pos.column)
            return offset;
        const ch = source[offset];
        if (ch === "\n") {
            line++;
            column = 1;
        }
        else if (ch === "\r") {
            if (source[offset + 1] === "\n")
                offset++; // will increment below
            line++;
            column = 1;
        }
        else {
            column++;
        }
        offset++;
    }
    return source.length;
}
export function getLineText(source, lineNumber) {
    const lines = source.split(/\r?\n/);
    return lines[lineNumber - 1] ?? "";
}
export function getLineCount(source) {
    if (source === "")
        return 1;
    return source.split(/\r?\n/).length;
}
/** Return the token containing offset, if any. */
export function getTokenAtOffset(tokens, offset) {
    for (const t of tokens) {
        if (t.range.start.offset <= offset && offset < t.range.end.offset)
            return t;
    }
    return undefined;
}
/** Find token immediately before offset (skipping whitespace which not in tokens) */
export function getTokenBeforeOffset(tokens, offset) {
    let best;
    for (const t of tokens) {
        if (t.range.end.offset <= offset) {
            if (!best || t.range.end.offset > best.range.end.offset)
                best = t;
        }
    }
    return best;
}
export function isOffsetInRange(range, offset) {
    return range.start.offset <= offset && offset < range.end.offset;
}
export function rangeContains(range, offset) {
    return isOffsetInRange(range, offset);
}
export function getWordAtOffset(source, offset) {
    if (offset < 0 || offset > source.length)
        return null;
    const isWordChar = (ch) => /[A-Za-z0-9_-]/.test(ch);
    // expand left
    let start = offset;
    while (start > 0 && isWordChar(source[start - 1]))
        start--;
    let end = offset;
    while (end < source.length && isWordChar(source[end]))
        end++;
    if (start === end)
        return null;
    return { word: source.slice(start, end), start, end };
}
export function tokenizeSource(source) {
    return tokenize(source);
}
/** Helpers to get lines with offsets */
export function getLineStartOffset(source, lineNumber) {
    let curLine = 1;
    let curOffset = 0;
    while (curOffset < source.length && curLine < lineNumber) {
        const ch = source[curOffset];
        if (ch === "\r" && source[curOffset + 1] === "\n") {
            curLine++;
            curOffset += 2;
        }
        else if (ch === "\n" || ch === "\r") {
            curLine++;
            curOffset++;
        }
        else {
            curOffset++;
        }
    }
    return curOffset;
}
/** Check if identifier at offset is inside string or comment – useful for rename guard */
export function isOffsetInStringOrComment(tokens, offset) {
    const tok = getTokenAtOffset(tokens, offset);
    if (!tok)
        return false;
    return tok.type === "STRING" || tok.type === "COMMENT";
}
