import * as fs from "node:fs";
import * as path from "node:path";
import { parseFloe } from "../index.js";
import { renderFloe } from "../pipeline.js";

export interface RenderOptions {
  output?: string;
  stdout?: boolean;
  json?: boolean;
  theme?: "light" | "dark" | "auto";
  background?: string;
  font?: string;
}

export function runRender(files: string[], opts: RenderOptions = {}): number {
  if (files.length === 0) {
    console.error("floe render: no input files");
    console.error("Usage: floe render <file.floe> [-o <output.svg>]");
    return 2;
  }
  if (files.length > 1 && opts.output) {
    console.error("floe render: -o/--output can only be used with a single input file");
    return 2;
  }
  let hadErrors = false;
  for (const f of files) {
    const resolved = path.resolve(f);
    if (!fs.existsSync(resolved)) {
      console.error(`floe render: file not found: ${f}`);
      return 2;
    }
    let source: string;
    try {
      source = fs.readFileSync(resolved, "utf-8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Cannot read file '${f}': ${msg}`);
      return 2;
    }
    let svg: string;
    let hasParseErrors = false;
    try {
      const parseResult = parseFloe(source);
      hasParseErrors = parseResult.diagnostics.some((d) => d.severity === "error");
      if (hasParseErrors) hadErrors = true;
      const result = renderFloe(source, {
        svgOptions: {
          ...(opts.theme ? { theme: opts.theme } : {}),
          ...(opts.background ? { background: opts.background } : {}),
          ...(opts.font ? { fontFamily: opts.font } : {}),
        },
      });
      svg = result.svg;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`floe render: failed to render '${f}': ${msg}`);
      return 1;
    }
    if (opts.output) {
      const outPath = path.resolve(opts.output);
      try {
        const dir = path.dirname(outPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outPath, svg, "utf-8");
        const rel = path.relative(process.cwd(), outPath);
        if (!opts.json) console.log(`rendered ${path.relative(process.cwd(), resolved)} -> ${rel}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Cannot write output '${opts.output}': ${msg}`);
        return 2;
      }
    } else {
      if (hasParseErrors && !opts.json) {
        const rel = path.relative(process.cwd(), resolved);
        console.error(`warning: ${rel} has parse errors, rendered best-effort SVG`);
      }
      process.stdout.write(svg);
      if (!svg.endsWith("\n")) process.stdout.write("\n");
    }
  }
  return hadErrors ? 1 : 0;
}
