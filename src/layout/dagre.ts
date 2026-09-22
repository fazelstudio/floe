/**
 * Dagre-based layout engine — optional, replaceable.
 * If `dagre` is not installed, layout() will throw with helpful message.
 * This keeps core independent: dagre is only loaded when this engine is used.
 */
import type { FloeDiagram } from "../types.js";
import type { LayoutEngine, LayoutResult, LayoutNode, LayoutEdge, LayoutOptions } from "./types.js";

export class DagreLayoutEngine implements LayoutEngine {
  private opts: Required<LayoutOptions>;

  constructor(opts?: LayoutOptions) {
    this.opts = {
      nodeWidth: 120,
      nodeHeight: 48,
      rankSep: 80,
      nodeSep: 32,
      margin: 32,
      minNodeWidth: 80,
      maxNodeWidth: 200,
      ...opts,
    };
  }

  layout(diagram: FloeDiagram): LayoutResult {
    let dagre: any;
    try {
      const req = (Function('return typeof require !== "undefined" ? require : null')()) as any;
      if (req) dagre = req("dagre");
      else throw new Error("Dagre not available in ESM without require");
    } catch (e) {
      throw new Error(
        "DagreLayoutEngine requires 'dagre' package. Install with: npm install dagre  — or use SimpleLayoutEngine as fallback. Original error: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: directionToRankdir(diagram.direction),
      ranksep: this.opts.rankSep,
      nodesep: this.opts.nodeSep,
      marginx: this.opts.margin,
      marginy: this.opts.margin,
    });
    g.setDefaultEdgeLabel(() => ({}));

    const nodesSorted = [...diagram.nodes].sort((a, b) => a.id.localeCompare(b.id));
    const edgesSorted = [...diagram.edges].sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      if (a.target !== b.target) return a.target.localeCompare(b.target);
      return (a.label ?? "").localeCompare(b.label ?? "");
    });

    const nodeSizes = new Map<string, { w: number; h: number }>();
    for (const n of nodesSorted) {
      const label = n.label ?? n.id;
      const fs = typeof (n as any).style?.fontSize === "number" ? (n as any).style.fontSize : 12;
      const size = estimateNodeSize(label, n.type, this.opts, fs);
      nodeSizes.set(n.id, size);
      g.setNode(n.id, { width: size.w, height: size.h, label: n.id });
    }
    for (const e of edgesSorted) g.setEdge(e.source, e.target, { label: e.label ?? "" });

    dagre.layout(g);

    const layoutNodes: LayoutNode[] = [];
    let maxX = 0, maxY = 0;
    for (const n of nodesSorted) {
      const pos = g.node(n.id) as { x: number; y: number };
      const sz = nodeSizes.get(n.id)!;
      const x = round2(pos.x);
      const y = round2(pos.y);
      layoutNodes.push({ id: n.id, label: n.label ?? n.id, type: n.type, x, y, width: sz.w, height: sz.h, data: n });
      const right = x + sz.w / 2;
      const bottom = y + sz.h / 2;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }

    const width = Math.ceil(maxX + this.opts.margin);
    const height = Math.ceil(maxY + this.opts.margin);

    const layoutEdges: LayoutEdge[] = edgesSorted.map((e) => {
      const edgeInfo = g.edge(e.source, e.target) as { points: Array<{ x: number; y: number }> };
      const points: Array<{ x: number; y: number }> = (edgeInfo?.points ?? []).map((p) => ({ x: round2(p.x), y: round2(p.y) }));
      let pts = points;
      if (pts.length === 0) {
        const s = layoutNodes.find((n) => n.id === e.source);
        const t = layoutNodes.find((n) => n.id === e.target);
        if (s && t) pts = [{ x: s.x, y: s.y }, { x: t.x, y: t.y }];
      }
      let labelPos: { x: number; y: number } | undefined;
      if (e.label && pts.length >= 2) {
        if (pts.length % 2 === 0) {
          const a = pts[pts.length / 2 - 1]!, b = pts[pts.length / 2]!;
          labelPos = { x: round2((a.x + b.x) / 2), y: round2((a.y + b.y) / 2 - 8) };
        } else {
          const mid = pts[Math.floor(pts.length / 2)]!;
          labelPos = { x: round2(mid.x), y: round2(mid.y - 8) };
        }
      }
      return { source: e.source, target: e.target, label: e.label, points: pts, labelPos, data: e };
    });

    // Groups fallback via simple bounds
    const groups = (diagram.groups ?? []) as import("../types.js").FloeGroup[];
    const layoutGroups: import("./types.js").LayoutGroup[] = [];
    if (groups.length > 0) {
      const positioned = new Map<string, { x: number; y: number }>();
      for (const n of layoutNodes) positioned.set(n.id, { x: n.x, y: n.y });
      const tmpOpts = this.opts;
      const compute = (grps: typeof groups) => {
        const gp = 20, hdr = 24;
        const rec = (grp: typeof groups[0]): import("./types.js").LayoutGroup => {
          const childL = (grp.groups ?? []).map(rec);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          let has = false;
          for (const nid of grp.nodeIds ?? []) {
            const pos = positioned.get(nid);
            const sz = nodeSizes.get(nid);
            if (!pos || !sz) continue;
            has = true;
            const l = pos.x - sz.w / 2, r = pos.x + sz.w / 2, t = pos.y - sz.h / 2, b = pos.y + sz.h / 2;
            if (l < minX) minX = l; if (r > maxX) maxX = r; if (t < minY) minY = t; if (b > maxY) maxY = b;
          }
          for (const cl of childL) {
            has = true;
            const l = cl.x - cl.width / 2, r = cl.x + cl.width / 2, t = cl.y - cl.height / 2, b = cl.y + cl.height / 2;
            if (l < minX) minX = l; if (r > maxX) maxX = r; if (t < minY) minY = t; if (b > maxY) maxY = b;
          }
          if (!has) {
            const cx = tmpOpts.margin + 50, cy = tmpOpts.margin + 30;
            return { id: grp.id, label: grp.label ?? grp.id, type: grp.type, x: cx, y: cy, width: 100, height: 60, data: grp, memberIds: [...(grp.nodeIds ?? [])], children: childL };
          }
          minX -= gp; maxX += gp; minY -= gp + hdr; maxY += gp;
          const w = maxX - minX, h = maxY - minY, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
          return { id: grp.id, label: grp.label ?? grp.id, type: grp.type, x: Math.round(cx * 100) / 100, y: Math.round(cy * 100) / 100, width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100, data: grp, memberIds: [...(grp.nodeIds ?? [])], children: childL };
        };
        return [...grps].sort((a, b) => a.id.localeCompare(b.id)).map(rec);
      };
      layoutGroups.push(...compute(groups));
    }

    return {
      diagram,
      direction: diagram.direction,
      nodes: layoutNodes,
      edges: layoutEdges,
      groups: layoutGroups,
      width: Math.max(width, this.opts.margin * 2 + 100),
      height: Math.max(height, this.opts.margin * 2 + 60),
    };
  }
}

function directionToRankdir(dir: import("../types.js").Direction): string {
  switch (dir) {
    case "TB": return "TB";
    case "BT": return "BT";
    case "LR": return "LR";
    case "RL": return "RL";
    default: return "TB";
  }
}

function estimateNodeSize(label: string, type: string | undefined, opts: Required<LayoutOptions>, fontSize = 12): { w: number; h: number } {
  const fs = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12;
  const scale = fs / 12;
  const charW = 7 * scale, paddingX = 24;
  let minW = opts.minNodeWidth, maxW = opts.maxNodeWidth, h = opts.nodeHeight * (fs === 12 ? 1 : scale);
  const t = (type ?? "").toLowerCase();
  if (t === "database" || t === "db") { minW = Math.max(minW, 90); h = 48 * scale; }
  else if (t === "person") { minW = Math.max(minW, 80); h = 48 * scale; }
  else if (t === "decision" || t === "diamond" || t === "conditional") { minW = Math.max(minW, 96); h = 56 * scale; }
  else if (t === "document" || t === "doc") { minW = Math.max(minW, 88); h = 52 * scale; }
  const textW = label.length * charW + paddingX;
  if (textW <= maxW) {
    const w = Math.max(minW, Math.min(maxW, textW));
    return { w: Math.round(w), h: Math.round(h) };
  }
  const lines = Math.min(3, Math.ceil(textW / maxW));
  return { w: Math.round(Math.max(minW, maxW)), h: Math.round(h + (lines - 1) * 14 * scale) };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
