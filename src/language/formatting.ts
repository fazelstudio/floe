/**
 * Formatter — create canonical formatting, deterministic.
 * Input:
 *   A->B
 *   B -> C: hello
 * Output:
 *   A -> B
 *   B -> C : hello
 *
 * Must be deterministic and preserve semantics.
 * Operates on Floe language model — line-oriented formatting with group indentation.
 */
const INDENT = "  ";
export function format(source: string, opts?: import("./types.js").FormattingOptions) {
    const indentStr = opts?.indentString ?? INDENT;
    const lines = source.split(/\r?\n/);
    const outLines = [];
    let indentLevel = 0;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] ?? "";
        const trimmed = raw.trim();
        // Handle blank lines - preserve but normalize to empty, collapse handled later
        if (trimmed === "") {
            outLines.push("");
            continue;
        }
        // Extract comment part respecting strings
        const { codePart, commentPart } = splitComment(trimmed);
        // If whole line is comment
        if (codePart === "" && commentPart !== "") {
            outLines.push(indentStr.repeat(indentLevel) + normalizeComment(commentPart));
            continue;
        }
        // Detect closing brace line before indent calculation
        const isClosingBrace = codePart.trim() === "}";
        if (isClosingBrace) {
            indentLevel = Math.max(0, indentLevel - 1);
            const formatted = formatCodePart(codePart, commentPart, indentLevel, indentStr);
            outLines.push(formatted);
            continue;
        }
        // Normal line
        const formatted = formatCodePart(codePart, commentPart, indentLevel, indentStr);
        outLines.push(formatted);
        // After formatting, check if line opens a group brace to increase indent for next lines
        // Need to detect if codePart contains "group ... {"
        if (isGroupOpening(codePart)) {
            indentLevel++;
        }
    }
    // Post-process: collapse multiple consecutive blank lines to at most one, trim trailing blanks, ensure final newline
    const collapsed = [];
    let prevBlank = false;
    for (const l of outLines) {
        const isBlank = l === "";
        if (isBlank && prevBlank)
            continue;
        collapsed.push(l);
        prevBlank = isBlank;
    }
    // Remove leading blank lines
    while (collapsed.length > 0 && collapsed[0] === "")
        collapsed.shift();
    // Remove trailing blank lines before ensuring final newline
    while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "")
        collapsed.pop();
    let result = collapsed.join("\n");
    if (result.length === 0)
        return opts?.insertFinalNewline === false ? "" : "";
    if (opts?.insertFinalNewline !== false) {
        if (!result.endsWith("\n"))
            result += "\n";
    }
    return result;
}
function normalizeComment(c) {
    const trim = c.trim();
    if (trim.startsWith("//")) {
        const content = trim.slice(2).trimStart();
        if (content === "")
            return "//";
        return `// ${content}`;
    }
    return trim;
}
function splitComment(line) {
    let inString = false;
    let escaped = false;
    for (let i = 0; i < line.length - 1; i++) {
        const ch = line[i];
        const nxt = line[i + 1];
        if (!inString && ch === '"' && !escaped) {
            inString = true;
            escaped = false;
            continue;
        }
        if (inString) {
            if (ch === "\\" && !escaped) {
                escaped = true;
                continue;
            }
            if (ch === '"' && !escaped) {
                inString = false;
            }
            escaped = false;
            continue;
        }
        if (!inString && ch === "/" && nxt === "/") {
            const code = line.slice(0, i).trimEnd();
            const comment = line.slice(i).trim();
            return { codePart: code, commentPart: comment };
        }
    }
    return { codePart: line.trimEnd(), commentPart: "" };
}
function isGroupOpening(code) {
    // Check if code ends with { and starts with group keyword
    const t = code.trim();
    return /^\s*group\b.*\{\s*$/.test(t);
}
function formatCodePart(codePart, commentPart, indentLevel, indentStr) {
    const indent = indentStr.repeat(indentLevel);
    let formattedCode = formatStatement(codePart.trim());
    if (commentPart) {
        const normComment = normalizeComment(commentPart);
        if (formattedCode === "") {
            formattedCode = normComment;
        }
        else {
            formattedCode = `${formattedCode} ${normComment}`;
        }
    }
    return indent + formattedCode;
}
function formatStatement(code) {
    if (code === "")
        return "";
    if (code === "}")
        return "}";
    // Try in order: direction, group, meta, note, link, edge, node
    // Direction: direction LR
    let m = code.match(/^direction\s+(\S+)\s*$/);
    if (m) {
        return `direction ${m[1]}`;
    }
    // Bare `direction` with no value formats as-is; validation reports E006.
    if (/^direction\s*$/.test(code)) {
        return "direction";
    }
    // Group header: group ID [type] "label" {
    // Pattern: group <id> ([<type>])? ("<label>")? {
    m = code.match(/^group\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\[\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\])?\s*(?:"((?:[^"\\]|\\.)*)")?\s*\{\s*$/);
    if (m) {
        const id = m[1];
        const type = m[2];
        const label = m[3];
        let out = `group ${id}`;
        if (type)
            out += ` [${type}]`;
        if (label !== undefined)
            out += ` "${escapeString(unescapeString(label))}"`;
        out += " {";
        return out;
    }
    // Group one-liner `group X { }` stays on one line.
    m = code.match(/^group\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\[\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\])?\s*(?:"((?:[^"\\]|\\.)*)")?\s*\{\s*\}\s*$/);
    if (m) {
        const id = m[1];
        const type = m[2];
        const label = m[3];
        let out = `group ${id}`;
        if (type)
            out += ` [${type}]`;
        if (label !== undefined)
            out += ` "${escapeString(unescapeString(label))}"`;
        out += " {";
        return out + " }";
    }
    // Meta: `meta key = "value"` or scoped `meta Target.key = "value"`.
    m = code.match(/^meta\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\.([A-Za-z_][A-Za-z0-9_-]*))?\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (m) {
        const key = m[1];
        const sub = m[2];
        const val = m[3] ?? "";
        const full = sub ? `${key}.${sub}` : key;
        return `meta ${full} = "${escapeString(unescapeString(val))}"`;
    }
    // Note: note [target] "text"
    m = code.match(/^note\s+(?:([A-Za-z_][A-Za-z0-9_-]*)\s+)?"((?:[^"\\]|\\.)*)"\s*$/);
    if (m) {
        const target = m[1];
        const text = m[2] ?? "";
        if (target)
            return `note ${target} "${escapeString(unescapeString(text))}"`;
        return `note "${escapeString(unescapeString(text))}"`;
    }
    // Link: link target "url"
    m = code.match(/^link\s+([A-Za-z_][A-Za-z0-9_-]*)\s+"((?:[^"\\]|\\.)*)"\s*$/);
    if (m) {
        const target = m[1];
        const url = m[2] ?? "";
        return `link ${target} "${escapeString(unescapeString(url))}"`;
    }
    // Edge: SourceList (EdgeOp TargetList)+ (: label)?
    // Operators: <->, ==>, ->, =>, --. Lists: A, B, C. Chains: A -> B -> C.
    const formattedEdge = tryFormatEdge(code);
    if (formattedEdge !== null) return formattedEdge;
    // Node: IDENT [type] "label"
    m = code.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\[\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\])?\s*(?:"((?:[^"\\]|\\.)*)")?\s*$/);
    if (m) {
        const id = m[1];
        const type = m[2];
        const label = m[3];
        let out = id;
        if (type)
            out += ` [${type}]`;
        if (label !== undefined)
            out += ` "${escapeString(unescapeString(label))}"`;
        return out;
    }
    // Fallback: normalize spacing for invalid lines, keeping them readable.
    let fallback = code.trim();
    // Longest operator first so `--` never splits `->`.
    fallback = fallback.replace(/\s*(<->|==>|->|=>|--)\s*/g, " $1 ");
    fallback = fallback.replace(/\s*,\s*/g, ", ");
    fallback = fallback.replace(/\s*:\s*/g, " : ");
    fallback = fallback.replace(/\s*\.\s*/g, ".");
    fallback = fallback.replace(/\s*\[\s*/g, " [");
    fallback = fallback.replace(/\s*\]\s*/g, "]");
    fallback = fallback.replace(/\s*=\s*/g, " = ");
    fallback = fallback.replace(/\s+/g, " ").trim();
    return fallback;
}
function tryFormatEdge(code: string): string | null {
    const ID = "[A-Za-z_][A-Za-z0-9_-]*";
    const LIST = `${ID}(?:\\s*,\\s*${ID})*`;
    const OP = "(?:<->|==>|->|=>|--)";
    const CHAIN = `${LIST}(?:\\s*${OP}\\s*${LIST})+`;
    const PREFIX = `(?:(${ID})\\s*:\\s*)?`;
    const withId = (id: string | undefined, chain: string, suffix: string) =>
        `${id ? `${id}: ` : ""}${chain}${suffix}`;
    // With label
    let m = code.match(new RegExp(`^${PREFIX}(${CHAIN})\\s*:\\s*(.+?)\\s*$`));
    if (m) {
        const id = m[1];
        const chainRaw = m[2] ?? "";
        const labelRaw = (m[3] ?? "").trim();
        const chain = normalizeEdgeChain(chainRaw);
        if (!chain) return null;
        // Explicit ids need a single edge, so multi-edge chains fall back untouched.
        if (id && !isSingleEdge(chain)) return null;
        if (labelRaw === "") return withId(id, chain, " :");
        if (labelRaw.startsWith('"') && labelRaw.endsWith('"') && labelRaw.length >= 2) {
            const inner = labelRaw.slice(1, -1);
            return withId(id, chain, ` : "${escapeString(unescapeString(inner))}"`);
        }
        return withId(id, chain, ` : ${labelRaw}`);
    }
    // Without label
    m = code.match(new RegExp(`^${PREFIX}(${CHAIN})\\s*$`));
    if (m) {
        const id = m[1];
        const chain = normalizeEdgeChain(m[2] ?? "");
        if (!chain) return null;
        if (id && !isSingleEdge(chain)) return null;
        return withId(id, chain, "");
    }
    // Empty label
    m = code.match(new RegExp(`^${PREFIX}(${CHAIN})\\s*:\\s*$`));
    if (m) {
        const id = m[1];
        const chain = normalizeEdgeChain(m[2] ?? "");
        if (!chain) return null;
        if (id && !isSingleEdge(chain)) return null;
        return withId(id, chain, " :");
    }
    return null;
}
function isSingleEdge(chain: string): boolean {
    const ops = chain.match(/<->|==>|->|=>|--/g) ?? [];
    if (ops.length !== 1) return false;
    if (chain.includes(",")) return false;
    return true;
}
function normalizeEdgeChain(chainRaw: string): string | null {
    // Split on operators while keeping them, then normalize each id list.
    const re = /(<->|==>|->|=>|--)/g;
    if (!re.test(chainRaw)) return null;
    const tokens: Array<{ kind: "list" | "op"; text: string }> = [];
    // Scan manually so `=>` never splits into `=` + `>`.
    const opAt = (s: string, pos: number): string | null => {
        if (s.startsWith("<->", pos)) return "<->";
        if (s.startsWith("==>", pos)) return "==>";
        if (s.startsWith("->", pos)) return "->";
        if (s.startsWith("=>", pos)) return "=>";
        if (s.startsWith("--", pos)) return "--";
        return null;
    };
    let i = 0;
    let buf = "";
    while (i < chainRaw.length) {
        const op = opAt(chainRaw, i);
        if (op) {
            tokens.push({ kind: "list", text: buf });
            tokens.push({ kind: "op", text: op });
            buf = "";
            i += op.length;
        } else {
            buf += chainRaw[i];
            i++;
        }
    }
    tokens.push({ kind: "list", text: buf });
    // Lists and operators must strictly alternate, starting and ending with a list.
    if (tokens.length < 3 || tokens.length % 2 === 0) return null;
    const normLists: string[] = [];
    const normOps: string[] = [];
    for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k]!;
        if (k % 2 === 0) {
            // list
            const ids = t.text.split(",").map((s) => s.trim()).filter(Boolean);
            if (ids.length === 0) return null;
            for (const id of ids) {
                if (!new RegExp(`^${"[A-Za-z_][A-Za-z0-9_-]*"}$`).test(id)) return null;
            }
            normLists.push(ids.join(", "));
        } else {
            if (t.kind !== "op") return null;
            // Canonical operator for emphasis is `==>`.
            const canonical = t.text === "=>" ? "==>" : t.text;
            normOps.push(canonical);
        }
    }
    let out = normLists[0] ?? "";
    for (let k = 0; k < normOps.length; k++) {
        out += ` ${normOps[k]} ${normLists[k + 1]}`;
    }
    return out;
}
function escapeString(s) {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
function unescapeString(s) {
    return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}
/** Check if formatted output is idempotent — formatting twice yields same result */
export function isFormatted(source) {
    return format(source) === source;
}
