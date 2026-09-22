import type { LayoutNode } from "../layout/types.js";

/**
 * Semantic type to shape mapping.
 * Unknown types fall back to the default rect; existing kinds keep exact colors.
 */
export type NodeShapeKind =
  | "default"
  | "person"
  | "service"
  | "database"
  | "client"
  | "decision"
  | "start"
  | "end"
  | "process"
  | "document"
  | "queue"
  | "store"
  | "gateway"
  | "system"
  | "external"
  | "subsystem"
  | "container"
  | "component"
  | "ellipse"
  | "circle"
  | "cloud";

const ALIASES: Record<string, NodeShapeKind> = {
  person: "person",
  service: "service",
  database: "database",
  db: "database",
  client: "client",
  decision: "decision",
  diamond: "decision",
  conditional: "decision",
  choice: "decision",
  start: "start",
  terminator: "start",
  oval: "start",
  begin: "start",
  end: "end",
  finish: "end",
  stop: "end",
  process: "process",
  step: "process",
  task: "process",
  document: "document",
  doc: "document",
  file: "document",
  queue: "queue",
  fifo: "queue",
  store: "store",
  storage: "store",
  datastore: "store",
  gateway: "gateway",
  router: "gateway",
  proxy: "gateway",
  system: "system",
  external: "external",
  subsystem: "subsystem",
  container: "container",
  component: "component",
  ellipse: "ellipse",
  circle: "circle",
  round: "circle",
  cloud: "cloud",
};

export function getShapeKind(type?: string): NodeShapeKind {
  if (!type) return "default";
  const t = type.toLowerCase();
  return ALIASES[t] ?? "default";
}

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  rx?: number;
}

function isSafeColorStr(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true;
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s) && s.length <= 24;
}

export function shapeStyle(kind: NodeShapeKind): ShapeStyle {
  switch (kind) {
    case "person": return { fill: "#fef3c7", stroke: "#d97706", strokeWidth: 1.5, rx: 24 };
    case "service": return { fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 1.5, rx: 6 };
    case "database": return { fill: "#dcfce7", stroke: "#16a34a", strokeWidth: 1.5 };
    case "client": return { fill: "#f3e8ff", stroke: "#9333ea", strokeWidth: 1.5, rx: 6 };
    case "decision": return { fill: "#fef9c3", stroke: "#ca8a04", strokeWidth: 1.5 };
    case "start": return { fill: "#dcfce7", stroke: "#16a34a", strokeWidth: 1.5, rx: 24 };
    case "end": return { fill: "#fee2e2", stroke: "#dc2626", strokeWidth: 1.5, rx: 24 };
    case "process": return { fill: "#e0f2fe", stroke: "#0284c7", strokeWidth: 1.5, rx: 6 };
    case "document": return { fill: "#f5f3ff", stroke: "#7c3aed", strokeWidth: 1.5, rx: 2 };
    case "queue": return { fill: "#ffedd5", stroke: "#ea580c", strokeWidth: 1.5, rx: 6 };
    case "store": return { fill: "#ecfdf5", stroke: "#059669", strokeWidth: 1.5, rx: 6 };
    case "gateway": return { fill: "#fdf2f8", stroke: "#db2777", strokeWidth: 1.5 };
    case "system": return { fill: "#eef2ff", stroke: "#4f46e5", strokeWidth: 1.5, rx: 6 };
    case "external": return { fill: "#f8fafc", stroke: "#64748b", strokeWidth: 1.5, rx: 6 };
    case "subsystem": return { fill: "#f1f5f9", stroke: "#475569", strokeWidth: 1.5, rx: 6 };
    case "container": return { fill: "#ecfeff", stroke: "#0891b2", strokeWidth: 1.5, rx: 6 };
    case "component": return { fill: "#faf5ff", stroke: "#7e22ce", strokeWidth: 1.5, rx: 6 };
    case "ellipse": return { fill: "#e0e7ff", stroke: "#4338ca", strokeWidth: 1.5 };
    case "circle": return { fill: "#fef3c7", stroke: "#b45309", strokeWidth: 1.5 };
    case "cloud": return { fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 };
    default: return { fill: "#f1f5f9", stroke: "#334155", strokeWidth: 1.5, rx: 6 };
  }
}

export function renderNodeShape(node: LayoutNode, override?: import("../types.js").FloeStyle): string {
  const kind = getShapeKind(node.type);
  const base = shapeStyle(kind);
  const style = { ...base };
  if (override) {
    if (override.fill && isSafeColorStr(override.fill)) style.fill = override.fill;
    if (override.stroke && isSafeColorStr(override.stroke)) style.stroke = override.stroke;
    if (typeof override.strokeWidth === "number" && Number.isFinite(override.strokeWidth) && override.strokeWidth > 0)
      style.strokeWidth = override.strokeWidth;
  }
  const x = fmt(node.x - node.width / 2);
  const y = fmt(node.y - node.height / 2);
  const w = fmt(node.width);
  const h = fmt(node.height);
  const fill = style.fill, stroke = style.stroke, sw = style.strokeWidth;

  if (kind === "database") return renderDatabaseShape(node, fill, stroke, sw);
  if (kind === "decision") return renderDiamondShape(node, fill, stroke, sw);
  if (kind === "start" || kind === "end") {
    const rx = fmt(node.height / 2);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  }
  if (kind === "person") {
    const rx = fmt(node.height / 2);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  }
  if (kind === "document") return renderDocumentShape(node, fill, stroke, sw);
  if (kind === "gateway") return renderHexagonShape(node, fill, stroke, sw);
  if (kind === "ellipse" || kind === "circle" || kind === "cloud") {
    return `<ellipse cx="${fmt(node.x)}" cy="${fmt(node.y)}" rx="${fmt(node.width / 2)}" ry="${fmt(node.height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  }
  const rx = fmt(style.rx ?? 6);
  const ry = rx;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
}

function renderDatabaseShape(node: LayoutNode, fill: string, stroke: string, sw: number): string {
  const cx = node.x, cy = node.y, w = node.width, h = node.height;
  const left = cx - w / 2, right = cx + w / 2, top = cy - h / 2, bottom = cy + h / 2;
  const ellipseH = Math.min(10, h * 0.22);
  const rx = w / 2, ry = ellipseH;
  const x1 = fmt(left), x2 = fmt(right), yTop = fmt(top + ry), yBottom = fmt(bottom - ry);
  const d = [`M ${x1} ${yTop}`, `L ${x1} ${yBottom}`, `A ${fmt(rx)} ${fmt(ry)} 0 0 0 ${x2} ${yBottom}`, `L ${x2} ${yTop}`, `A ${fmt(rx)} ${fmt(ry)} 0 0 0 ${x1} ${yTop}`].join(" ");
  const topEllipse = `<ellipse cx="${fmt(cx)}" cy="${fmt(top + ry)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  const body = `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  const bottomEllipse = `<ellipse cx="${fmt(cx)}" cy="${fmt(bottom - ry)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  return `${body}\n${topEllipse}\n${bottomEllipse}`;
}

function renderDiamondShape(node: LayoutNode, fill: string, stroke: string, sw: number): string {
  const cx = node.x, cy = node.y;
  const hw = node.width / 2, hh = node.height / 2;
  const points = `${fmt(cx)},${fmt(cy - hh)} ${fmt(cx + hw)},${fmt(cy)} ${fmt(cx)},${fmt(cy + hh)} ${fmt(cx - hw)},${fmt(cy)}`;
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
}

function renderDocumentShape(node: LayoutNode, fill: string, stroke: string, sw: number): string {
  const left = node.x - node.width / 2;
  const right = node.x + node.width / 2;
  const top = node.y - node.height / 2;
  const bottom = node.y + node.height / 2;
  const wave = Math.min(10, node.height * 0.18);
  const d = [
    `M ${fmt(left)} ${fmt(top)}`,
    `L ${fmt(right)} ${fmt(top)}`,
    `L ${fmt(right)} ${fmt(bottom)}`,
    `C ${fmt(right - node.width * 0.25)} ${fmt(bottom - wave)} ${fmt(right - node.width * 0.35)} ${fmt(bottom + wave * 0.4)} ${fmt(node.x)} ${fmt(bottom)}`,
    `C ${fmt(node.x - node.width * 0.25)} ${fmt(bottom - wave * 0.4)} ${fmt(left + node.width * 0.2)} ${fmt(bottom - wave)} ${fmt(left)} ${fmt(bottom)}`,
    "Z",
  ].join(" ");
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
}

function renderHexagonShape(node: LayoutNode, fill: string, stroke: string, sw: number): string {
  const cx = node.x, cy = node.y;
  const hw = node.width / 2, hh = node.height / 2;
  const insetX = node.width * 0.18;
  const points = [
    `${fmt(cx - hw + insetX)},${fmt(cy - hh)}`,
    `${fmt(cx + hw - insetX)},${fmt(cy - hh)}`,
    `${fmt(cx + hw)},${fmt(cy)}`,
    `${fmt(cx + hw - insetX)},${fmt(cy + hh)}`,
    `${fmt(cx - hw + insetX)},${fmt(cy + hh)}`,
    `${fmt(cx - hw)},${fmt(cy)}`,
  ].join(" ");
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
}

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(2).replace(/\.?0+$/, "");
}
