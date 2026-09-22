import type { Range, Position } from "./range.js";

export type TokenType =
  | "IDENT"
  | "DIRECTION_KW"
  | "GROUP_KW"
  | "META_KW"
  | "NOTE_KW"
  | "LINK_KW"
  | "ARROW"
  | "DASHDASH"
  | "BIDIR"
  | "EMPHASIS"
  | "COMMA"
  | "DOT"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "COLON"
  | "EQUALS"
  | "STRING"
  | "COMMENT"
  | "NEWLINE"
  | "EOF"
  | "UNKNOWN";

export interface Token {
  type: TokenType;
  lexeme: string;
  range: Range;
}

function isAlpha(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}
function isIdentStart(ch: string): boolean {
  return isAlpha(ch) || ch === "_";
}
function isIdentContinue(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch) || ch === "_" || ch === "-";
}

export class Lexer {
  private source: string;
  private len: number;
  private offset = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
    this.len = source.length;
  }

  private pos(): Position {
    return { line: this.line, column: this.column, offset: this.offset };
  }

  private peek(ahead = 0): string {
    const idx = this.offset + ahead;
    if (idx >= this.len) return "\0";
    return this.source[idx]!;
  }

  private advance(count = 1): string {
    let consumed = "";
    for (let i = 0; i < count; i++) {
      if (this.offset >= this.len) break;
      const ch = this.source[this.offset]!;
      consumed += ch;
      this.offset++;
      if (ch === "\n") {
        this.line++;
        this.column = 1;
      } else if (ch === "\r") {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
    }
    return consumed;
  }

  private makeToken(type: TokenType, lexeme: string, start: Position, end: Position): Token {
    return { type, lexeme, range: { start, end } };
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.offset < this.len) {
      const ch = this.peek();
      const start = this.pos();

      if (ch === "\r" && this.peek(1) === "\n") {
        this.advance(2);
        this.line--;
        const end = this.pos();
        tokens.push(this.makeToken("NEWLINE", "\r\n", start, end));
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        this.advance(1);
        const end = this.pos();
        tokens.push(this.makeToken("NEWLINE", ch, start, end));
        continue;
      }

      if (ch === " " || ch === "\t" || ch === "\v" || ch === "\f") {
        this.advance(1);
        continue;
      }

      if (ch === "/" && this.peek(1) === "/") {
        let lex = "";
        lex += this.advance(2);
        while (this.offset < this.len) {
          const c = this.peek();
          if (c === "\n" || c === "\r" || c === "\0") break;
          lex += this.advance(1);
        }
        const end = this.pos();
        tokens.push(this.makeToken("COMMENT", lex, start, end));
        continue;
      }

      if (ch === "<" && this.peek(1) === "-" && this.peek(2) === ">") {
        this.advance(3);
        const end = this.pos();
        tokens.push(this.makeToken("BIDIR", "<->", start, end));
        continue;
      }
      if (ch === "=" && this.peek(1) === "=" && this.peek(2) === ">") {
        this.advance(3);
        const end = this.pos();
        tokens.push(this.makeToken("EMPHASIS", "==>", start, end));
        continue;
      }
      if (ch === "=" && this.peek(1) === ">") {
        this.advance(2);
        const end = this.pos();
        tokens.push(this.makeToken("EMPHASIS", "=>", start, end));
        continue;
      }
      if (ch === ",") {
        this.advance(1);
        tokens.push(this.makeToken("COMMA", ",", start, this.pos()));
        continue;
      }
      if (ch === "-" && this.peek(1) === ">") {
        this.advance(2);
        const end = this.pos();
        tokens.push(this.makeToken("ARROW", "->", start, end));
        continue;
      }
      if (ch === "-" && this.peek(1) === "-") {
        this.advance(2);
        const end = this.pos();
        tokens.push(this.makeToken("DASHDASH", "--", start, end));
        continue;
      }

      if (ch === '"') {
        const strStart = this.pos();
        this.advance(1);
        let inner = "";
        let foundClosing = false;
        while (this.offset < this.len) {
          const c = this.peek();
          if (c === "\n" || c === "\r") break;
          if (c === "\0") break;
          if (c === "\\") {
            const nxt = this.peek(1);
            if (nxt === '"' || nxt === "\\") {
              inner += nxt;
              this.advance(2);
              continue;
            }
            if (nxt === "n") {
              inner += "\n";
              this.advance(2);
              continue;
            }
            if (nxt === "t") {
              inner += "\t";
              this.advance(2);
              continue;
            }
            if (nxt !== "\0" && nxt !== "\n" && nxt !== "\r") {
              inner += nxt;
              this.advance(2);
              continue;
            }
            inner += this.advance(1);
            continue;
          }
          if (c === '"') {
            this.advance(1);
            foundClosing = true;
            break;
          }
          inner += this.advance(1);
        }
        const end = this.pos();
        if (foundClosing) {
          tokens.push(this.makeToken("STRING", inner, strStart, end));
        } else {
          const raw = this.source.slice(strStart.offset, this.offset);
          tokens.push(this.makeToken("UNKNOWN", raw, strStart, end));
        }
        continue;
      }

      if (ch === "[") {
        this.advance(1);
        tokens.push(this.makeToken("LBRACKET", "[", start, this.pos()));
        continue;
      }
      if (ch === "]") {
        this.advance(1);
        tokens.push(this.makeToken("RBRACKET", "]", start, this.pos()));
        continue;
      }
      if (ch === "{") {
        this.advance(1);
        tokens.push(this.makeToken("LBRACE", "{", start, this.pos()));
        continue;
      }
      if (ch === "}") {
        this.advance(1);
        tokens.push(this.makeToken("RBRACE", "}", start, this.pos()));
        continue;
      }
      if (ch === ":") {
        this.advance(1);
        tokens.push(this.makeToken("COLON", ":", start, this.pos()));
        continue;
      }
      if (ch === ".") {
        this.advance(1);
        tokens.push(this.makeToken("DOT", ".", start, this.pos()));
        continue;
      }
      if (ch === "=") {
        this.advance(1);
        tokens.push(this.makeToken("EQUALS", "=", start, this.pos()));
        continue;
      }

      if (isIdentStart(ch)) {
        let lex = this.advance(1);
        while (this.offset < this.len && isIdentContinue(this.peek())) {
          if (this.peek() === "-" && (this.peek(1) === ">" || this.peek(1) === "-")) break;
          lex += this.advance(1);
        }
        const end = this.pos();
        if (lex === "direction") tokens.push(this.makeToken("DIRECTION_KW", lex, start, end));
        else if (lex === "group") tokens.push(this.makeToken("GROUP_KW", lex, start, end));
        else if (lex === "meta") tokens.push(this.makeToken("META_KW", lex, start, end));
        else if (lex === "note") tokens.push(this.makeToken("NOTE_KW", lex, start, end));
        else if (lex === "link") tokens.push(this.makeToken("LINK_KW", lex, start, end));
        else tokens.push(this.makeToken("IDENT", lex, start, end));
        continue;
      }

      if (isDigit(ch)) {
        let lex = this.advance(1);
        while (this.offset < this.len) {
          const c = this.peek();
          if (isAlpha(c) || isDigit(c) || c === "_" || c === "-") lex += this.advance(1);
          else break;
        }
        const end = this.pos();
        tokens.push(this.makeToken("UNKNOWN", lex, start, end));
        continue;
      }

      {
        const lex = this.advance(1);
        const end = this.pos();
        tokens.push(this.makeToken("UNKNOWN", lex, start, end));
        continue;
      }
    }

    const eofPos = this.pos();
    tokens.push(this.makeToken("EOF", "", eofPos, eofPos));
    return tokens;
  }
}

export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
