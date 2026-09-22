import type { LayoutResult } from "../layout/types.js";
import { renderNodeShape, shapeStyle, getShapeKind } from "./shapes.js";
import { sanitizeUrl } from "../security/url.js";

export interface SvgRenderOptions {
  padding?: number;
  background?: string;
  fontFamily?: string;
  debug?: boolean;
  css?: string;
  title?: string;
  desc?: string;
  responsive?: boolean;
  theme?: "light" | "dark" | "auto";
}

const DEFAULT_FONT = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";

export function renderSvg(layout: LayoutResult, opts?: SvgRenderOptions): string {
  const padding = opts?.padding ?? 0;
  const meta = layout.diagram.metadata ?? {};
  const background = opts?.background ?? (meta as any).background ?? "#ffffff";
  const fontFamily = opts?.fontFamily ?? (meta as any).font ?? DEFAULT_FONT;
  const responsive = opts?.responsive ?? true;
  const rawTheme = (opts?.theme ?? (meta as any).theme ?? "light").toLowerCase();
  const theme: "light" | "dark" | "auto" = rawTheme === "dark" ? "dark" : rawTheme === "auto" ? "auto" : "light";
  const isDark = theme === "dark";
  const isAuto = theme === "auto";
  const accent = sanitizeColor((meta as any).accent);

  const annotations = layout.diagram.annotations ?? [];
  const links = layout.diagram.links ?? [];
  const linkByTarget = new Map<string, string>();
  for (const l of links) {
    const safe = sanitizeUrl(l.url);
    if (safe && !linkByTarget.has(l.target)) linkByTarget.set(l.target, safe);
  }
  const notesByTarget = new Map<string, string[]>();
  for (const a of annotations) {
    if (a.target) {
      const arr = notesByTarget.get(a.target) ?? [];
      arr.push(a.text);
      notesByTarget.set(a.target, arr);
    }
  }
  const globalNotes = annotations.filter((a) => !a.target);

  // Document metadata stored by `meta` becomes SVG title, description, and footer.
  const title = opts?.title ?? meta.title ?? (meta as any).name;
  const desc = opts?.desc ?? meta.description ?? (meta as any).desc;
  const author = (meta as any).author;
  const version = (meta as any).version;
  const legendOn = ["true", "1", "yes"].includes(String((meta as any).legend ?? "").toLowerCase());

  const nodesSorted = [...layout.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edgesSorted = [...layout.edges].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    return (a.label ?? "").localeCompare(b.label ?? "");
  });
  const hasBidir = edgesSorted.some((e) => (e.data as any)?.kind === "bidirectional");

  // Palette stays light unless a dark theme is requested.
  const edgeStroke = accent ?? (isDark ? "#cbd5e1" : "#334155");
  const markerFill = edgeStroke;
  const nodeText = isDark ? "#f8fafc" : "#0f172a";
  const labelText = isDark ? "#e2e8f0" : "#334155";
  const labelFill = isDark ? "#1e293b" : "white";
  const labelStroke = isDark ? "#475569" : "#e2e8f0";
  const canvasFill = isDark ? "#0f172a" : background;

  // Footer stacks legend, global notes, and author/version below the diagram.
  const usedTypes = legendOn ? collectUsedTypes(nodesSorted) : [];
  const legendH = legendOn ? usedTypes.length * 18 + 30 : 0;
  const notesH = globalNotes.length > 0 ? globalNotes.length * 18 + 16 : 0;
  const provText = [author, version ? `v${version}` : null].filter(Boolean).join(" · ");
  const provH = provText ? 22 : 0;

  let width = Math.ceil(layout.width + padding * 2);
  let height = Math.ceil(layout.height + padding * 2);
  const footerH = legendH + notesH + provH;
  const totalHeight = height + footerH;
  const viewBox = `0 0 ${width} ${totalHeight}`;

  const ariaLabel = title ?? `Floe diagram: ${nodesSorted.length} nodes, ${edgesSorted.length} edges`;
  const parts: string[] = [];
  const styleAttr = responsive ? ` style="max-width:100%;height:auto;display:block"` : "";
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="${viewBox}" role="img" aria-label="${escapeAttr(ariaLabel)}" preserveAspectRatio="xMidYMid meet" font-family="${escapeAttr(fontFamily)}"${styleAttr}>`);
  if (title) parts.push(`<title>${escapeXml(title)}</title>`);
  if (desc) parts.push(`<desc>${escapeXml(desc)}</desc>`);
  if (canvasFill && canvasFill !== "transparent") {
    const canvasClass = isAuto ? ` class="canvas"` : "";
    parts.push(`<rect${canvasClass} width="${width}" height="${totalHeight}" fill="${escapeAttr(canvasFill)}" />`);
  }
  const css = opts?.css ?? defaultCss(isAuto);
  parts.push(`<style>${css}</style>`);
  parts.push(`<defs>`);
  parts.push(`<marker id="arrowhead" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="10" markerHeight="7" orient="auto" markerUnits="strokeWidth">`);
  parts.push(`<path d="M 0 0 L 10 3.5 L 0 7 z" fill="${escapeAttr(markerFill)}" />`);
  parts.push(`</marker>`);
  if (hasBidir) {
    parts.push(`<marker id="arrowhead-start" viewBox="0 0 10 7" refX="1" refY="3.5" markerWidth="10" markerHeight="7" orient="auto" markerUnits="strokeWidth">`);
    parts.push(`<path d="M 10 0 L 0 3.5 L 10 7 z" fill="${escapeAttr(markerFill)}" />`);
    parts.push(`</marker>`);
  }
  parts.push(`</defs>`);

  const offset = padding;
  if (offset !== 0) parts.push(`<g transform="translate(${offset} ${offset})">`);

  const groups = layout.groups ?? [];
  if (groups.length > 0) {
    parts.push(`<g class="groups">`);
    const flatGroups = flattenGroups(groups);
    for (const g of flatGroups) parts.push(renderGroupSvg(g, fontFamily));
    parts.push(`</g>`);
  }

  parts.push(`<g class="edges" stroke-linecap="round" stroke-linejoin="round">`);
  edgesSorted.forEach((e, idx) => {
    const d = pointsToPath(e.points);
    const edgeId = `edge-${escapeId(e.source)}-${escapeId(e.target)}${e.label ? "-" + hashLabel(e.label) : ""}-${idx}`;
    const kind = (e.data as any)?.kind ?? "directed";
    const estyle = (e.data as any)?.style as import("../types.js").FloeStyle | undefined;
    const isUndirected = kind === "undirected";
    const isBidir = kind === "bidirectional";
    const isEmph = kind === "emphasis";
    const dash = isUndirected ? ` stroke-dasharray="6 3"` : "";
    const baseSw = isEmph ? 2.8 : 1.6;
    const swNum = typeof estyle?.strokeWidth === "number" && Number.isFinite(estyle.strokeWidth) && estyle.strokeWidth > 0 ? estyle.strokeWidth : baseSw;
    const sw = fmt(swNum);
    const stroke = estyle?.stroke && isSafeColorStr(estyle.stroke) ? estyle.stroke : edgeStroke;
    const opNum = typeof estyle?.opacity === "number" && Number.isFinite(estyle.opacity) ? estyle.opacity : null;
    const op = opNum !== null && opNum >= 0 && opNum <= 1 ? ` opacity="${fmt(opNum)}"` : "";
    let marker = "";
    if (!isUndirected) {
      marker = isBidir ? ` marker-start="url(#arrowhead-start)" marker-end="url(#arrowhead)"` : ` marker-end="url(#arrowhead)"`;
    }
    const edgeLink = (e.data as any)?.link ? sanitizeUrl((e.data as any).link) : undefined;
    const pathSvg = `<path id="${edgeId}" d="${d}" fill="none" stroke="${escapeAttr(stroke)}" stroke-width="${sw}"${dash}${marker}${op} />`;
    if (edgeLink) {
      parts.push(`<a href="${escapeAttr(edgeLink)}" target="_blank" rel="noopener">`);
      parts.push(pathSvg);
      parts.push(`</a>`);
    } else {
      parts.push(pathSvg);
    }
  });
  parts.push(`</g>`);

  if (edgesSorted.some((e) => e.label)) {
    parts.push(`<g class="edge-labels">`);
    for (const e of edgesSorted) {
      if (!e.label) continue;
      const pos = e.labelPos ?? midpoint(e.points);
      const x = fmt(pos.x), y = fmt(pos.y);
      const estW = estimateTextWidth(e.label) + 8, estH = 16, rx = 4;
      parts.push(`<g class="edge-label" transform="translate(${x} ${y})">`);
      parts.push(`<rect x="${fmt(-estW / 2)}" y="${fmt(-estH / 2 + 1)}" width="${fmt(estW)}" height="${fmt(estH)}" rx="${rx}" ry="${rx}" fill="${escapeAttr(labelFill)}" stroke="${escapeAttr(labelStroke)}" stroke-width="0.8" />`);
      parts.push(`<text text-anchor="middle" dominant-baseline="middle" font-size="11" fill="${escapeAttr(labelText)}" font-family="${escapeAttr(fontFamily)}">${escapeXml(truncateLabel(e.label, 48))}</text>`);
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  }

  parts.push(`<g class="nodes">`);
  for (const n of nodesSorted) {
    const nstyle = (n.data as any)?.style as import("../types.js").FloeStyle | undefined;
    const shapeSvg = renderNodeShape(n, nstyle);
    const kindClass = n.type ? `node-${escapeId(n.type)}` : `node-default`;
    const rawHref = (n.data as any)?.link ?? linkByTarget.get(n.id);
    const href = typeof rawHref === "string" ? sanitizeUrl(rawHref) : undefined;
    const notes = notesByTarget.get(n.id);
    const tooltip = notes && notes.length > 0 ? notes.join(" \u2014 ") : undefined;
    const fontSize = typeof nstyle?.fontSize === "number" && Number.isFinite(nstyle.fontSize) && nstyle.fontSize > 0 ? nstyle.fontSize : 12;
    const fontFill = nstyle?.fontColor && isSafeColorStr(nstyle.fontColor) ? nstyle.fontColor : nodeText;
    const labelSvg = renderNodeLabel(n, fontFamily, fontFill, fontSize);
    const opNum = typeof nstyle?.opacity === "number" && Number.isFinite(nstyle.opacity) ? nstyle.opacity : null;
    const opAttr = opNum !== null && opNum >= 0 && opNum <= 1 ? ` opacity="${fmt(opNum)}"` : "";
    const inner: string[] = [];
    inner.push(`<g id="node-${escapeId(n.id)}" class="node ${kindClass}" data-node-id="${escapeAttr(n.id)}"${n.type ? ` data-node-type="${escapeAttr(n.type)}"` : ""}${opAttr}>`);
    if (tooltip) inner.push(`<title>${escapeXml(tooltip)}</title>`);
    inner.push(shapeSvg);
    inner.push(labelSvg);
    inner.push(`</g>`);
    const block = inner.join("\n");
    if (href) {
      parts.push(`<a href="${escapeAttr(href)}" target="_blank" rel="noopener">`);
      parts.push(block);
      parts.push(`</a>`);
    } else {
      parts.push(block);
    }
  }
  parts.push(`</g>`);

  let footerY = height + 12;
  if (legendOn && usedTypes.length > 0) {
    parts.push(`<g class="legend" font-family="${escapeAttr(fontFamily)}">`);
    parts.push(`<text x="16" y="${fmt(footerY)}" font-size="11" font-weight="600" fill="${escapeAttr(isDark ? "#e2e8f0" : "#475569")}">Legend</text>`);
    footerY += 16;
    for (const t of usedTypes) {
      const st = shapeStyle(getShapeKind(t === "default" ? undefined : t));
      parts.push(`<g transform="translate(16 ${fmt(footerY - 6)})">`);
      parts.push(`<rect x="0" y="-9" width="14" height="14" rx="3" fill="${escapeAttr(st.fill)}" stroke="${escapeAttr(st.stroke)}" stroke-width="1" />`);
      parts.push(`<text x="20" y="0" dominant-baseline="middle" font-size="11" fill="${escapeAttr(isDark ? "#cbd5e1" : "#334155")}">${escapeXml(t)}</text>`);
      parts.push(`</g>`);
      footerY += 18;
    }
    footerY += 4;
    parts.push(`</g>`);
  }
  if (globalNotes.length > 0) {
    parts.push(`<g class="annotations" font-family="${escapeAttr(fontFamily)}">`);
    globalNotes.forEach((a) => {
      parts.push(`<text x="16" y="${fmt(footerY)}" font-size="11" fill="#64748b">\u2139 ${escapeXml(truncateLabel(a.text, 90))}</text>`);
      footerY += 18;
    });
    parts.push(`</g>`);
    footerY += 4;
  }
  if (provText) {
    parts.push(`<g class="provenance" font-family="${escapeAttr(fontFamily)}">`);
    parts.push(`<text x="16" y="${fmt(footerY)}" font-size="10" fill="#94a3b8">${escapeXml(truncateLabel(provText, 90))}</text>`);
    parts.push(`</g>`);
  }

  if (offset !== 0) parts.push(`</g>`);

  if (opts?.debug) {
    parts.push(`<g class="debug">`);
    for (const n of nodesSorted) {
      const x = fmt(n.x - n.width / 2), y = fmt(n.y - n.height / 2);
      parts.push(`<rect x="${x}" y="${y}" width="${fmt(n.width)}" height="${fmt(n.height)}" fill="none" stroke="red" stroke-dasharray="3 3" stroke-width="0.5" />`);
    }
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

function renderNodeLabel(n: import("../layout/types.js").LayoutNode, fontFamily: string, fill = "#0f172a", fontSize = 12): string {
  const fs = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12;
  const scale = fs / 12;
  const label = n.label;
  const maxTextW = n.width - 20;
  const singleW = label.length * 6.2 * scale;
  if (singleW <= maxTextW || !label.includes(" ")) {
    const display = singleW <= maxTextW ? label : truncateWithEllipsis(label, maxTextW / scale);
    return `<text x="${fmt(n.x)}" y="${fmt(n.y)}" text-anchor="middle" dominant-baseline="middle" font-size="${fmt(fs)}" font-weight="500" fill="${escapeAttr(fill)}" font-family="${escapeAttr(fontFamily)}">${escapeXml(display)}</text>`;
  }
  const lines = wrapLabel(label, maxTextW, 3, scale);
  if (lines.length <= 1) {
    return `<text x="${fmt(n.x)}" y="${fmt(n.y)}" text-anchor="middle" dominant-baseline="middle" font-size="${fmt(fs)}" font-weight="500" fill="${escapeAttr(fill)}" font-family="${escapeAttr(fontFamily)}">${escapeXml(lines[0] ?? label)}</text>`;
  }
  const lineH = 14 * scale;
  const startY = n.y - ((lines.length - 1) * lineH) / 2;
  const tspans = lines
    .map((ln, i) => `<tspan x="${fmt(n.x)}" dy="${i === 0 ? 0 : fmt(lineH)}">${escapeXml(ln)}</tspan>`)
    .join("");
  return `<text x="${fmt(n.x)}" y="${fmt(startY)}" text-anchor="middle" dominant-baseline="middle" font-size="${fmt(fs)}" font-weight="500" fill="${escapeAttr(fill)}" font-family="${escapeAttr(fontFamily)}">${tspans}</text>`;
}

function wrapLabel(label: string, maxWidth: number, maxLines: number, scale = 1): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const maxChars = Math.max(4, Math.floor(maxWidth / (6.2 * (Number.isFinite(scale) && scale > 0 ? scale : 1))));
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, Math.max(1, maxChars - 1)) + "\u2026" : w;
      if (lines.length >= maxLines - 1) {
        const rest = words.slice(words.indexOf(w) + 1);
        let last = cur;
        for (const rw of rest) {
          const cand = last + " " + rw;
          if (cand.length <= maxChars) last = cand;
          else { last = last.slice(0, Math.max(1, maxChars - 1)) + "\u2026"; break; }
        }
        lines.push(last);
        return lines.slice(0, maxLines);
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function truncateWithEllipsis(s: string, maxWidth: number): string {
  const maxChars = Math.max(4, Math.floor(maxWidth / 6.2));
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)) + "\u2026";
}

function truncateLabel(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + "\u2026";
}

function defaultCss(auto = false): string {
  const base = `
  .node text { pointer-events: none; user-select: none; }
  .edge-label text { pointer-events: none; user-select: none; }
  svg a { cursor: pointer; }
  svg a:hover .node rect, svg a:hover .node polygon, svg a:hover .node ellipse, svg a:hover .node path { filter: brightness(0.96); }
  `;
  if (!auto) return base;
  return base + `
  @media (prefers-color-scheme: dark) {
    .canvas { fill: #0f172a; }
    .edges path { stroke: #cbd5e1; }
    .edge-label rect { fill: #1e293b; stroke: #475569; }
    .edge-label text { fill: #e2e8f0; }
    .node text { fill: #f8fafc; }
    .groups rect { fill: #1e293b; }
  }
  `;
}
function sanitizeColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(s) && s.length <= 24) return s;
  return undefined;
}
function isSafeColorStr(v: unknown): v is string {
  return sanitizeColor(v) !== undefined;
}
function collectUsedTypes(nodes: import("../layout/types.js").LayoutNode[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) set.add(n.type ?? "default");
  return [...set].sort((a, b) => a.localeCompare(b));
}
function pointsToPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`;
  const start = points[0]!;
  let d = `M ${fmt(start.x)} ${fmt(start.y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${fmt(points[i]!.x)} ${fmt(points[i]!.y)}`;
  return d;
}
function midpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  if (points.length === 2) return { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
  const mid = Math.floor(points.length / 2);
  return { x: (points[mid - 1]!.x + points[mid]!.x) / 2, y: (points[mid]!.y + points[mid]!.y) / 2 };
}
function estimateTextWidth(text: string): number { return text.length * 6.5; }
function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(2).replace(/\.?0+$/, "");
}
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function escapeAttr(s: string): string { return escapeXml(s); }
function escapeId(s: string): string { return s.replace(/[^A-Za-z0-9_-]/g, "_"); }
function hashLabel(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}
function renderGroupSvg(g: import("../layout/types.js").LayoutGroup, fontFamily: string): string {
  const x = fmt(g.x - g.width / 2), y = fmt(g.y - g.height / 2), w = fmt(g.width), h = fmt(g.height);
  const label = escapeXml(truncateLabel(g.label, 48)), gid = escapeId(g.id);
  const typeAttr = g.type ? ` data-group-type="${escapeAttr(g.type)}"` : "";
  const gstyle = (g.data as any)?.style as import("../types.js").FloeStyle | undefined;
  const fill = gstyle?.fill && isSafeColorStr(gstyle.fill) ? gstyle.fill : "#f8fafc";
  const stroke = gstyle?.stroke && isSafeColorStr(gstyle.stroke) ? gstyle.stroke : "#cbd5e1";
  const swNum = typeof gstyle?.strokeWidth === "number" && Number.isFinite(gstyle.strokeWidth) && gstyle.strokeWidth > 0 ? gstyle.strokeWidth : 1.2;
  const opNum = typeof gstyle?.opacity === "number" && Number.isFinite(gstyle.opacity) ? gstyle.opacity : null;
  const opAttr = opNum !== null && opNum >= 0 && opNum <= 1 ? ` opacity="${fmt(opNum)}"` : "";
  const headerH = 22;
  const parts: string[] = [];
  parts.push(`<g id="group-${gid}" class="group group-${gid}" data-group-id="${escapeAttr(g.id)}"${typeAttr}${opAttr}>`);
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(swNum)}" stroke-dasharray="8 4" />`);
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${fmt(headerH)}" rx="8" ry="8" fill="#e2e8f0" stroke="none" />`);
  parts.push(`<rect x="${x}" y="${fmt(g.y - g.height / 2 + headerH / 2)}" width="${w}" height="${fmt(headerH / 2)}" fill="#e2e8f0" stroke="none" />`);
  parts.push(`<text x="${fmt(g.x)}" y="${fmt(g.y - g.height / 2 + headerH / 2 + 1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="600" fill="#334155" font-family="${escapeAttr(fontFamily)}">${label}</text>`);
  parts.push(`</g>`);
  return parts.join("\n");
}
function flattenGroups(groups: import("../layout/types.js").LayoutGroup[]): import("../layout/types.js").LayoutGroup[] {
  const out: import("../layout/types.js").LayoutGroup[] = [];
  function dfs(arr: typeof groups) {
    const sorted = [...arr].sort((a, b) => a.id.localeCompare(b.id));
    for (const g of sorted) {
      out.push(g);
      if (g.children && g.children.length > 0) dfs(g.children);
    }
  }
  dfs(groups);
  return out;
}
