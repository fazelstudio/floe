import { tokenize } from "../lexer.js";
/**
 * Syntax highlighting information — independent from any editor.
 * Operates on Floe language model (lexer tokens + ranges).
 */
export function getHighlightTokens(source) {
    const tokens = tokenize(source);
    const out = [];
    for (const tok of tokens) {
        if (tok.type === "NEWLINE" || tok.type === "EOF")
            continue;
        let scope;
        switch (tok.type) {
            case "DIRECTION_KW":
            case "GROUP_KW":
            case "META_KW":
            case "NOTE_KW":
            case "LINK_KW":
                scope = "keyword";
                break;
            case "IDENT":
                scope = "variableName";
                break;
            case "STRING":
                scope = "string";
                break;
            case "COMMENT":
                scope = "comment";
                break;
            case "ARROW":
            case "DASHDASH":
            case "BIDIR":
            case "EMPHASIS":
                scope = "operator";
                break;
            case "COMMA":
            case "DOT":
                scope = "punctuation";
                break;
            case "LBRACKET":
            case "RBRACKET":
            case "LBRACE":
            case "RBRACE":
            case "COLON":
            case "EQUALS":
                scope = "punctuation";
                break;
            case "UNKNOWN":
                scope = "invalid";
                break;
            default:
                scope = "plain";
        }
        out.push({
            type: tok.type,
            lexeme: tok.lexeme,
            range: tok.range,
            scope,
        });
    }
    // Enhance: inside brackets [type] — type identifier should be typeName not variableName
    // Find pattern LBRACKET IDENT RBRACKET and override scope
    const enhanced = [...out];
    for (let i = 0; i < enhanced.length; i++) {
        const t = enhanced[i];
        if (t.type === "LBRACKET") {
            const next = enhanced[i + 1];
            const next2 = enhanced[i + 2];
            if (next && next.type === "IDENT" && next2 && next2.type === "RBRACKET") {
                next.scope = "typeName";
            }
        }
    }
    return enhanced;
}
/** For CodeMirror or other editors that expect classifications per line */
export function getHighlightingInfo(source) {
    return getHighlightTokens(source);
}
