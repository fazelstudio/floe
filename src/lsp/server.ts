/**
 * Floe LSP Server — editor-independent Language Server
 *
 * Architecture:
 *   Editor
 *     ↓ (LSP JSON-RPC over stdio)
 *   Floe LSP Server (this file)
 *     ↓
 *   Floe Language Services (src/language/*)
 *     ↓
 *   Parser / Semantic Model
 *
 * Capabilities:
 * - diagnostics (publishDiagnostics)
 * - completion
 * - hover
 * - go-to-definition
 * - references
 * - rename
 * - formatting
 * - symbols (documentSymbol)
 * - folding (foldingRange)
 *
 * Reuses existing language services rather than duplicate parser logic.
 * No editor-specific semantic implementation.
 * No eval / new Function — treat .floe as untrusted.
 */
import * as readline from "node:readline";
import { DocumentManager } from "./documents.js";
import { offsetToLspPosition, lspPositionToOffset, floeRangeToLspRange, severityToLsp } from "./utils.js";
// Reuse language services — these are editor-independent
import { getDiagnostics } from "../language/diagnosticsService.js";
import { getCompletions } from "../language/completion.js";
import { getHover } from "../language/hover.js";
import { getDefinition } from "../language/definitions.js";
import { getReferences } from "../language/references.js";
import { rename } from "../language/rename.js";
import { format } from "../language/formatting.js";
import { getSymbols } from "../language/symbols.js";
import { getFoldingRanges } from "../language/folding.js";
export class FloeLspServer {
    docs = new DocumentManager();
    input;
    output;
    buffer = "";
    nextId = 1;
    initialized = false;
    shutdownRequested = false;
    constructor(opts: any = {}) {
        this.input = opts.input ?? process.stdin;
        this.output = opts.output ?? process.stdout;
    }
    /**
     * Start server listening on stdio
     */
    async start() {
        this.input.on("data", (chunk) => {
            this.buffer += chunk.toString("utf-8");
            this.processBuffer();
        });
        this.input.on("end", () => {
            if (!this.shutdownRequested) {
                process.exit(0);
            }
        });
        // Handle errors without crashing; the event loop stays alive via stdin.
        this.input.on("error", (err) => {
            console.error(`LSP input error: ${err.message}`);
        });
    }
    processBuffer() {
        while (true) {
            // LSP header: Content-Length: <num>\r\n\r\n
            const headerEnd = this.buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1)
                break;
            const header = this.buffer.slice(0, headerEnd);
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                // Malformed header, discard
                this.buffer = this.buffer.slice(headerEnd + 4);
                continue;
            }
            const length = parseInt(match[1], 10);
            const totalLength = headerEnd + 4 + length;
            if (this.buffer.length < totalLength)
                break; // Wait for more data
            const body = this.buffer.slice(headerEnd + 4, totalLength);
            this.buffer = this.buffer.slice(totalLength);
            try {
                const msg = JSON.parse(body);
                this.handleMessage(msg);
            }
            catch (e) {
                this.sendError(null, -32700, `Parse error: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }
    send(msg) {
        const body = JSON.stringify(msg);
        const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
        this.output.write(header + body);
    }
    sendResponse(id, result) {
        this.send({ jsonrpc: "2.0", id, result });
    }
    sendError(id: any, code: number, message: string, data?: any) {
        this.send({ jsonrpc: "2.0", id, error: { code, message, data } });
    }
    sendNotification(method, params) {
        this.send({ jsonrpc: "2.0", method, params });
    }
    async handleMessage(msg) {
        if (msg.method) {
            // Request or notification
            if (msg.id !== undefined) {
                // Request - needs response
                await this.handleRequest(msg);
            }
            else {
                // Notification
                await this.handleNotification(msg);
            }
        }
        else if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
            // Response to our request (not used currently)
        }
    }
    async handleRequest(msg) {
        const method = msg.method;
        const id = msg.id ?? null;
        const params = msg.params;
        try {
            switch (method) {
                case "initialize": {
                    const result = this.handleInitialize(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "shutdown": {
                    this.shutdownRequested = true;
                    this.sendResponse(id, null);
                    break;
                }
                case "textDocument/completion": {
                    const result = this.handleCompletion(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/hover": {
                    const result = this.handleHover(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/definition": {
                    const result = this.handleDefinition(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/references": {
                    const result = this.handleReferences(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/rename": {
                    const result = this.handleRename(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/formatting": {
                    const result = this.handleFormatting(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/documentSymbol": {
                    const result = this.handleDocumentSymbol(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/prepareRename": {
                    const result = this.handlePrepareRename(params);
                    this.sendResponse(id, result);
                    break;
                }
                case "textDocument/foldingRange": {
                    const result = this.handleFoldingRange(params);
                    this.sendResponse(id, result);
                    break;
                }
                default: {
                    // Method not found
                    this.sendError(id, -32601, `Method not found: ${method}`);
                    break;
                }
            }
        }
        catch (e) {
            const msgText = e instanceof Error ? e.message : String(e);
            this.sendError(id, -32603, `Internal error: ${msgText}`);
        }
    }
    async handleNotification(msg) {
        const method = msg.method;
        const params = msg.params;
        switch (method) {
            case "initialized": {
                this.initialized = true;
                break;
            }
            case "exit": {
                process.exit(this.shutdownRequested ? 0 : 1);
                break;
            }
            case "textDocument/didOpen": {
                this.handleDidOpen(params);
                break;
            }
            case "textDocument/didChange": {
                this.handleDidChange(params);
                break;
            }
            case "textDocument/didClose": {
                this.handleDidClose(params);
                break;
            }
            case "textDocument/didSave": {
                // Re-validate on save
                if (params?.textDocument?.uri) {
                    this.publishDiagnostics(params.textDocument.uri);
                }
                break;
            }
            case "$/cancelRequest": {
                // Ignore
                break;
            }
            default: {
                // Unknown notification - ignore
                break;
            }
        }
    }
    handleInitialize(params) {
        // Client capabilities ignored for now; we advertise our capabilities
        return {
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                    change: 1, // Full
                    save: { includeText: false },
                },
                completionProvider: {
                    triggerCharacters: [" ", "[", "-", ">", ":", "<", "=", ",", "."],
                    resolveProvider: false,
                },
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                renameProvider: {
                    prepareProvider: true,
                },
                documentFormattingProvider: true,
                documentSymbolProvider: true,
                foldingRangeProvider: true,
                diagnosticProvider: {
                    interFileDependencies: false,
                    workspaceDiagnostics: false,
                },
            },
            serverInfo: {
                name: "floe-lsp",
                version: "1.0.0",
            },
        };
    }
    handleDidOpen(params) {
        const doc = params?.textDocument;
        if (!doc?.uri || typeof doc.text !== "string")
            return;
        const uri = doc.uri;
        const text = doc.text;
        const version = doc.version ?? 1;
        const languageId = doc.languageId ?? "floe";
        this.docs.open(uri, languageId, version, text);
        this.publishDiagnostics(uri);
    }
    handleDidChange(params) {
        const doc = params?.textDocument;
        const changes = params?.contentChanges;
        if (!doc?.uri || !Array.isArray(changes))
            return;
        const uri = doc.uri;
        const version = doc.version ?? 1;
        // A change with range is incremental, without range is a full replace.
        const hasRanges = changes.some((c) => c.range !== undefined);
        if (hasRanges) {
            this.docs.applyIncremental(uri, version, changes);
        }
        else {
            const text = changes[0]?.text ?? "";
            this.docs.update(uri, version, text);
        }
        this.publishDiagnostics(uri);
    }
    handleDidClose(params) {
        const uri = params?.textDocument?.uri;
        if (!uri)
            return;
        this.docs.close(uri);
        this.sendNotification("textDocument/publishDiagnostics", { uri, diagnostics: [] });
    }
    publishDiagnostics(uri) {
        const doc = this.docs.get(uri);
        if (!doc)
            return;
        const text = doc.text;
        let diagnostics = [];
        try {
            const floeDiags = getDiagnostics(text);
            diagnostics = floeDiags.map((d) => {
                const lspRange = floeRangeToLspRange(text, d.range);
                return {
                    range: lspRange,
                    severity: severityToLsp(d.severity),
                    code: d.code,
                    source: "floe",
                    message: d.message,
                };
            });
        }
        catch {
            diagnostics = [];
        }
        this.sendNotification("textDocument/publishDiagnostics", {
            uri,
            diagnostics,
        });
    }
    handleCompletion(params) {
        const uri = params?.textDocument?.uri;
        const pos = params?.position;
        if (!uri || !pos)
            return null;
        const doc = this.docs.get(uri);
        if (!doc)
            return null;
        const offset = lspPositionToOffset(doc.text, pos);
        try {
            const items = getCompletions(doc.text, offset);
            const lspItems = items.map((it) => ({
                label: it.label,
                kind: completionKindToLsp(it.kind),
                detail: it.detail,
                insertText: it.insertText ?? it.label,
                sortText: it.sortText,
            }));
            return {
                isIncomplete: false,
                items: lspItems,
            };
        }
        catch {
            return { isIncomplete: false, items: [] };
        }
    }
    handleHover(params) {
        const uri = params?.textDocument?.uri;
        const pos = params?.position;
        if (!uri || !pos)
            return null;
        const doc = this.docs.get(uri);
        if (!doc)
            return null;
        const offset = lspPositionToOffset(doc.text, pos);
        try {
            const hover = getHover(doc.text, offset);
            if (!hover)
                return null;
            const lspRange = hover.range ? floeRangeToLspRange(doc.text, hover.range) : undefined;
            return {
                contents: hover.contents.map((c) => ({ language: "markdown", value: c })),
                range: lspRange,
            };
        }
        catch {
            return null;
        }
    }
    handleDefinition(params) {
        const uri = params?.textDocument?.uri;
        const pos = params?.position;
        if (!uri || !pos)
            return null;
        const doc = this.docs.get(uri);
        if (!doc)
            return null;
        const offset = lspPositionToOffset(doc.text, pos);
        try {
            const def = getDefinition(doc.text, offset);
            if (!def)
                return null;
            const lspRange = floeRangeToLspRange(doc.text, def.range);
            return {
                uri,
                range: lspRange,
            };
        }
        catch {
            return null;
        }
    }
    handleReferences(params) {
        const uri = params?.textDocument?.uri;
        const pos = params?.position;
        if (!uri || !pos)
            return [];
        const doc = this.docs.get(uri);
        if (!doc)
            return [];
        const offset = lspPositionToOffset(doc.text, pos);
        try {
            const refs = getReferences(doc.text, offset);
            return refs.map((r) => ({
                uri,
                range: floeRangeToLspRange(doc.text, r.range),
            }));
        }
        catch {
            return [];
        }
    }
    handlePrepareRename(params) {
        const uri = params?.textDocument?.uri;
        const pos = params?.position;
        if (!uri || !pos)
            return null;
        const doc = this.docs.get(uri);
        if (!doc)
            return null;
        const offset = lspPositionToOffset(doc.text, pos);
        try {
            const refs = getReferences(doc.text, offset);
            if (refs.length === 0)
                return null;
            const def = getDefinition(doc.text, offset);
            if (!def)
                return null;
            return {
                range: floeRangeToLspRange(doc.text, def.range),
                placeholder: doc.text.slice(def.range.start.offset, def.range.end.offset),
            };
        }
        catch {
            return null;
        }
    }
    handleRename(params) {
        const uri = params?.textDocument?.uri;
        const pos = params?.position;
        const newName = params?.newName;
        if (!uri || !pos || typeof newName !== "string")
            return null;
        const doc = this.docs.get(uri);
        if (!doc)
            return null;
        const offset = lspPositionToOffset(doc.text, pos);
        try {
            const result = rename(doc.text, offset, newName);
            if (result.error) {
                return null;
            }
            const changes = {};
            changes[uri] = result.edits.map((e) => ({
                range: floeRangeToLspRange(doc.text, e.range),
                newText: e.newText,
            }));
            return { changes };
        }
        catch {
            return null;
        }
    }
    handleFormatting(params) {
        const uri = params?.textDocument?.uri;
        if (!uri)
            return null;
        const doc = this.docs.get(uri);
        if (!doc)
            return null;
        try {
            const formatted = format(doc.text);
            if (formatted === doc.text)
                return [];
            const start = { line: 0, character: 0 };
            const end = offsetToLspPosition(doc.text, doc.text.length);
            return [
                {
                    range: { start, end },
                    newText: formatted,
                },
            ];
        }
        catch {
            return null;
        }
    }
    handleDocumentSymbol(params) {
        const uri = params?.textDocument?.uri;
        if (!uri)
            return [];
        const doc = this.docs.get(uri);
        if (!doc)
            return [];
        try {
            const symbols = getSymbols(doc.text);
            // Convert to LSP DocumentSymbol (hierarchical)
            const toLspSymbol = (s: any): any => {
                const lspRange = floeRangeToLspRange(doc.text, s.range);
                const selectionRange = s.selectionRange ? floeRangeToLspRange(doc.text, s.selectionRange) : lspRange;
                const kind = symbolKindToLsp(s.kind);
                const result: any = {
                    name: s.name,
                    kind,
                    range: lspRange,
                    selectionRange,
                    detail: s.detail,
                };
                if (s.children && s.children.length > 0) {
                    result.children = s.children.map(toLspSymbol);
                }
                return result;
            };
            return symbols.map(toLspSymbol);
        }
        catch {
            return [];
        }
    }
    handleFoldingRange(params) {
        const uri = params?.textDocument?.uri;
        if (!uri)
            return [];
        const doc = this.docs.get(uri);
        if (!doc)
            return [];
        try {
            const ranges = getFoldingRanges(doc.text);
            return ranges.map((r) => ({
                startLine: r.startLine - 1,
                endLine: r.endLine - 1,
                startCharacter: r.startColumn ? r.startColumn - 1 : undefined,
                endCharacter: r.endColumn ? r.endColumn - 1 : undefined,
                kind: r.kind ?? "region",
                collapsedText: r.collapsedText,
            }));
        }
        catch {
            return [];
        }
    }
}
// Numbers are LSP CompletionItemKind values.
function completionKindToLsp(kind) {
    switch (kind) {
        case "keyword": return 14;
        case "type": return 8;
        case "variable": return 6;
        case "value": return 12;
        case "constant": return 21;
        default: return 1;
    }
}
// Numbers are LSP SymbolKind values.
function symbolKindToLsp(kind) {
    switch (kind) {
        case "node": return 5;
        case "group": return 4;
        case "edge": return 13;
        case "direction": return 14;
        case "meta": return 13;
        case "annotation": return 13;
        case "link": return 13;
        default: return 1;
    }
}
export async function startLspServer(opts = {}) {
    const server = new FloeLspServer(opts);
    await server.start();
    return server;
}
// If run directly via node
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
    const server = new FloeLspServer({ stdio: true });
    server.start();
}
