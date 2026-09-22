// @ts-nocheck
/**
 * Floe v1.2 — portable advance: named edges, scoped styles/data, edge notes/links.
 * Plus environment portability invariants (zero-dep core, deterministic, XSS-safe).
 */
import { describe, it, expect } from "vitest";
import { parseFloe } from "../src/index.js";
import { renderFloe } from "../src/pipeline.js";
import { format, isFormatted } from "../src/language/formatting.js";
import { getCompletions } from "../src/language/completion.js";
import { getHighlightTokens } from "../src/language/highlighting.js";
import { getDefinitionForWord } from "../src/language/definitions.js";
import { tokenize } from "../src/lexer.js";

describe("v1.2 — named edges", () => {
  it("parses explicit id", () => {
    const { diagram, diagnostics } = parseFloe("E1: A -> B : ok");
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(diagram.edges).toHaveLength(1);
    expect(diagram.edges[0].id).toBe("E1");
    expect(diagram.edges[0].idRange).toBeDefined();
    expect(diagram.edges[0].source).toBe("A");
  });

  it("auto ids are deterministic and collision-free", () => {
    const a = parseFloe("A -> B\nB -> C");
    expect(a.diagram.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    const b = parseFloe("A -> B\nB -> C");
    expect(b.diagram.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    // node named e1 forces auto to skip
    const c = parseFloe("e1\nA -> B");
    expect(c.diagram.edges[0].id).not.toBe("e1");
  });

  it("explicit id requires single edge (E005)", () => {
    expect(parseFloe("E1: A -> B, C").diagnostics.some((d) => d.code === "E005")).toBe(true);
    expect(parseFloe("E1: A -> B -> C").diagnostics.some((d) => d.code === "E005")).toBe(true);
  });

  it("duplicate edge ids are E015, collisions with nodes are E015", () => {
    expect(parseFloe("E1: A -> B\nE1: B -> C").diagnostics.some((d) => d.code === "E015")).toBe(true);
    expect(parseFloe("E1\nE1: A -> B").diagnostics.some((d) => d.code === "E015")).toBe(true);
  });

  it("old `ID : ...` malformed case still E005 (not silently named edge)", () => {
    const { diagnostics } = parseFloe("User : label");
    expect(diagnostics.some((d) => d.code === "E005")).toBe(true);
  });
});

describe("v1.2 — scoped metadata (styles + data)", () => {
  it("style keys land on element.style", () => {
    const { diagram, diagnostics } = parseFloe('API\nmeta API.fill = "#dbeafe"\nmeta API.strokeWidth = "2"');
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    const api = diagram.nodes.find((n) => n.id === "API");
    expect(api.style).toMatchObject({ fill: "#dbeafe", strokeWidth: 2 });
  });

  it("non-style keys land on element metadata", () => {
    const { diagram } = parseFloe('API\nmeta API.owner = "payments"');
    expect(diagram.nodes.find((n) => n.id === "API").metadata).toMatchObject({ owner: "payments" });
  });

  it("unknown scoped target is E014, bad numerics are E013", () => {
    expect(parseFloe('meta Ghost.fill = "#fff"').diagnostics.some((d) => d.code === "E014")).toBe(true);
    expect(parseFloe('A\nmeta A.strokeWidth = "huge"').diagnostics.some((d) => d.code === "E013")).toBe(true);
    expect(parseFloe('A\nmeta A.opacity = "5"').diagnostics.some((d) => d.code === "E013")).toBe(true);
  });

  it("plain meta still works (diagram-level)", () => {
    const { diagram } = parseFloe('meta title = "T"\nA -> B');
    expect(diagram.metadata.title).toBe("T");
  });
});

describe("v1.2 — edge notes/links + resolved element links", () => {
  it("note/link may target edge ids", () => {
    const src = 'E1: A -> B : ok\nnote E1 "warms on deploy"\nlink E1 "https://x.example.com"';
    const { diagram, diagnostics } = parseFloe(src);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(diagram.edges[0].link).toBe("https://x.example.com");
    const { svg } = renderFloe(src);
    expect(svg).toContain('href="https://x.example.com"');
  });

  it("node links still resolve as before", () => {
    const { diagram } = parseFloe('API\nlink API "https://x.example.com"');
    expect(diagram.nodes.find((n) => n.id === "API").link).toBe("https://x.example.com");
  });
});

describe("v1.2 — styles render (portable SVG)", () => {
  it("node fill override appears, invalid colors fall back safely", () => {
    const { svg } = renderFloe('API\nmeta API.fill = "#dbeafe"');
    expect(svg).toContain("#dbeafe");
    const bad = renderFloe('API\nmeta API.fill = "\"><script>alert(1)</script>"');
    expect(bad.svg).not.toContain("<script>");
    expect(bad.svg).toContain("<svg");
  });

  it("unstyled diagrams are byte-stable (no empty style attrs)", () => {
    const { svg } = renderFloe("A -> B");
    expect(svg).not.toContain("opacity=");
    expect(svg).not.toContain("arrowhead-start");
  });
});

describe("v1.2 — editor services for new syntax", () => {
  it("formats named edges + scoped meta idempotently", () => {
    expect(format("E1:A->B")).toBe("E1: A -> B\n");
    expect(format('meta  API.fill="x"')).toBe('meta API.fill = "x"\n');
    const src = 'E1: A -> B : ok\nmeta API.fill = "#fff"\n';
    expect(format(src)).toBe(src);
    expect(isFormatted(src)).toBe(true);
  });

  it("completion after `meta API.` suggests style keys", () => {
    const src = "API\nmeta API.";
    const items = getCompletions(src, src.length).map((i) => i.label);
    expect(items).toContain("fill");
    expect(items).toContain("strokeWidth");
  });

  it("DOT tokenizes + highlights as punctuation", () => {
    expect(tokenize("meta A.fill").map((t) => t.type)).toContain("DOT");
    expect(getHighlightTokens("meta A.fill").find((t) => t.lexeme === ".").scope).toBe("punctuation");
  });

  it("edge id has definition", () => {
    expect(getDefinitionForWord("E1: A -> B", "E1")).not.toBeNull();
  });
});

describe("v1.2 — portability invariants (any environment)", () => {
  it("core has zero node:/DOM deps (cli/lsp/dagre excluded)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const bad = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "cli" || ent.name === "lsp") continue;
          walk(p);
        } else if (ent.name.endsWith(".ts")) {
          if (p.endsWith("layout/dagre.ts")) continue; // optional Node-only engine
          const c = fs.readFileSync(p, "utf-8");
          const lines = c.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
          const code = lines.join("\n");
          if (/from\s+["']node:/.test(code)) bad.push(`${p}: node: import`);
          if (/(^|[^\w])require\s*\(/.test(code)) bad.push(`${p}: require()`);
          if (/(^|[^\w])window\./.test(code)) bad.push(`${p}: window`);
          if (/(^|[^\w])document\./.test(code)) bad.push(`${p}: document`);
          if (/\beval\s*\(/.test(code)) bad.push(`${p}: eval`);
          if (/\bnew\s+Function\s*\(/.test(code)) bad.push(`${p}: new Function`);
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(bad).toEqual([]);
  });

  it("render is deterministic + XSS-safe with style values", () => {
    const src = 'E1: A -> B : ok\nmeta A.fill = "#fff"';
    expect(renderFloe(src).svg).toBe(renderFloe(src).svg);
    const evil = renderFloe('A\nmeta A.fill = "\"><script>alert(1)</script>"\nA -> B : <b>hi</b> & bye');
    expect(evil.svg).not.toContain("<script>");
    expect(evil.svg).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(evil.svg).toContain('id="arrowhead"');
  });

  it("never crashes on DOT-heavy malformed input", () => {
    for (const src of ["meta .", "meta A.", "meta .fill", "E1:", "E1: ", "A . B", "meta A.fill", ".", "..", "E1: A ->"]) {
      expect(() => parseFloe(src)).not.toThrow();
      expect(() => format(src)).not.toThrow();
    }
  });
});
