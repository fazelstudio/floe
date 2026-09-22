import type { FloeDiagram, Direction } from "../types.js";
import type { LayoutEngine, LayoutResult, LayoutNode, LayoutEdge, LayoutOptions, LayoutGroup } from "./types.js";

const DEFAULT_OPTS: Required<LayoutOptions> = {
  nodeWidth: 120,
  nodeHeight: 48,
  rankSep: 80,
  nodeSep: 32,
  margin: 32,
  minNodeWidth: 80,
  maxNodeWidth: 200,
};

/**
 * Deterministic, zero-dependency layered layout.
 * - No random, no timestamps, no nondeterministic ordering
 * - Supports TB, BT, LR, RL via coordinate transform
 * - Handles cycles via Kahn's topological longest-path (deterministic)
 */
export class SimpleLayoutEngine implements LayoutEngine {
  private opts: Required<LayoutOptions>;

  constructor(opts?: LayoutOptions) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  layout(diagram: FloeDiagram): LayoutResult {
    // An empty diagram still reports a minimal deterministic canvas.
    if (diagram.nodes.length === 0 && (diagram.groups?.length ?? 0) === 0) {
      return {
        diagram,
        direction: diagram.direction,
        nodes: [],
        edges: [],
        groups: [],
        width: this.opts.margin * 2 + 100,
        height: this.opts.margin * 2 + 60,
      };
    }

    const edgesSorted = [...diagram.edges].sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      if (a.target !== b.target) return a.target.localeCompare(b.target);
      return (a.label ?? "").localeCompare(b.label ?? "");
    });

    const nodeSizes = new Map<string, { w: number; h: number }>();
    for (const n of diagram.nodes) {
      const label = n.label ?? n.id;
      const fs = typeof (n as any).style?.fontSize === "number" ? (n as any).style.fontSize : 12;
      const size = estimateNodeSize(label, n.type, this.opts, fs);
      nodeSizes.set(n.id, size);
    }

    const ranks = this.computeRanks(diagram.nodes, edgesSorted);

    const rankGroups = new Map<number, string[]>();
    for (const [id, rank] of ranks.entries()) {
      const arr = rankGroups.get(rank) ?? [];
      arr.push(id);
      rankGroups.set(rank, arr);
    }
    const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b);
    /**
    Group-clustered barycenter ordering, deterministic.
    Ungrouped diagrams stay alphabetical; grouped members stay together;
    one barycenter pass reduces crossings while keeping ties stable.
    */
    const groupOf = this.buildTopGroupMap(diagram.groups ?? []);
    for (const r of sortedRanks) {
      rankGroups.get(r)!.sort((a, b) => {
        const ga = groupOf.get(a) ?? "";
        const gb = groupOf.get(b) ?? "";
        if (ga !== gb) return ga.localeCompare(gb);
        return a.localeCompare(b);
      });
    }
    this.applyBarycenter(rankGroups, sortedRanks, edgesSorted, groupOf);

    /**
    TB/BT use centered rows; LR/RL use columns so the horizontal
    gap stays rankSep instead of collapsing.
    */
    let positioned: Map<string, { x: number; y: number }>;
    if (diagram.direction === "LR" || diagram.direction === "RL") {
      const lrPos = this.assignLrPositions(rankGroups, sortedRanks, nodeSizes);
      positioned = this.applyDirectionLr(lrPos, diagram.direction, nodeSizes);
    } else {
      const tbPositions = this.assignTbPositions(rankGroups, sortedRanks, nodeSizes);
      positioned = this.applyDirection(tbPositions, diagram.direction, nodeSizes);
    }

    const layoutNodes: LayoutNode[] = diagram.nodes
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => {
        const p = positioned.get(n.id)!;
        const sz = nodeSizes.get(n.id)!;
        return {
          id: n.id,
          label: n.label ?? n.id,
          type: n.type,
          x: p.x,
          y: p.y,
          width: sz.w,
          height: sz.h,
          data: n,
        };
      });

    let width: number;
    let height: number;
    if (positioned.size === 0) {
      width = this.opts.margin * 2 + 100;
      height = this.opts.margin * 2 + 60;
    } else {
      let maxX = -Infinity, maxY = -Infinity;
      for (const [id, pos] of positioned.entries()) {
        const sz = nodeSizes.get(id)!;
        const right = pos.x + sz.w / 2;
        const bottom = pos.y + sz.h / 2;
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
      }
      width = Math.ceil(maxX + this.opts.margin);
      height = Math.ceil(maxY + this.opts.margin);
      if (width < this.opts.margin * 2 + 100) width = this.opts.margin * 2 + 100;
      if (height < this.opts.margin * 2 + 60) height = this.opts.margin * 2 + 60;
    }

    const nodePosMap = positioned;
    // Parallel edges between the same pair spread apart instead of overlapping.
    const parallelIndex = new Map<string, number>();
    const layoutEdges: LayoutEdge[] = edgesSorted.map((e) => {
      const srcPos = nodePosMap.get(e.source);
      const tgtPos = nodePosMap.get(e.target);
      if (!srcPos || !tgtPos) {
        return {
          source: e.source,
          target: e.target,
          label: e.label,
          points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
          data: e,
        };
      }
      const srcSize = nodeSizes.get(e.source)!;
      const tgtSize = nodeSizes.get(e.target)!;
      const key = `${e.source}\0${e.target}`;
      const idx = parallelIndex.get(key) ?? 0;
      parallelIndex.set(key, idx + 1);
      const points = this.computeEdgePoints(
        { x: srcPos.x, y: srcPos.y, w: srcSize.w, h: srcSize.h },
        { x: tgtPos.x, y: tgtPos.y, w: tgtSize.w, h: tgtSize.h },
        diagram.direction,
        srcPos,
        tgtPos,
        idx,
      );
      let labelPos: { x: number; y: number } | undefined;
      if (e.label) labelPos = this.computeLabelPos(points, idx);
      return { source: e.source, target: e.target, label: e.label, points, labelPos, data: e };
    });

    const layoutGroups = this.computeGroups(diagram.groups ?? [], positioned, nodeSizes);

    let finalWidth = width;
    let finalHeight = height;
    for (const lg of layoutGroups) {
      const all = flattenGroups([lg]);
      for (const g of all) {
        const right = g.x + g.width / 2;
        const bottom = g.y + g.height / 2;
        if (right + this.opts.margin > finalWidth) finalWidth = Math.ceil(right + this.opts.margin);
        if (bottom + this.opts.margin > finalHeight) finalHeight = Math.ceil(bottom + this.opts.margin);
      }
    }
    /**
    Grow the canvas for edge-label badges, then shift everything right/down
    when a label would stick out past the left/top margin.
    */
    let minLabelLeft = Infinity;
    let minLabelTop = Infinity;
    for (const e of layoutEdges) {
      if (!e.label || !e.labelPos) continue;
      // Truncated length matches the renderer (48 chars), so bounds match visuals.
      const visLen = Math.min(e.label.length, 48);
      const estW = visLen * 6.5 + 8;
      const estH = 16;
      const right = e.labelPos.x + estW / 2;
      const bottom = e.labelPos.y + estH / 2;
      const left = e.labelPos.x - estW / 2;
      const top = e.labelPos.y - estH / 2;
      if (right + this.opts.margin > finalWidth) finalWidth = Math.ceil(right + this.opts.margin);
      if (bottom + this.opts.margin > finalHeight) finalHeight = Math.ceil(bottom + this.opts.margin);
      if (left < minLabelLeft) minLabelLeft = left;
      if (top < minLabelTop) minLabelTop = top;
    }
    let shiftX = 0;
    let shiftY = 0;
    if (minLabelLeft !== Infinity && minLabelLeft < this.opts.margin) shiftX = Math.ceil(this.opts.margin - minLabelLeft);
    if (minLabelTop !== Infinity && minLabelTop < this.opts.margin) shiftY = Math.ceil(this.opts.margin - minLabelTop);
    if (shiftX !== 0 || shiftY !== 0) {
      for (const [id, p] of positioned.entries()) {
        p.x = round2(p.x + shiftX);
        p.y = round2(p.y + shiftY);
      }
      for (const e of layoutEdges) {
        for (const pt of e.points) {
          pt.x = round2(pt.x + shiftX);
          pt.y = round2(pt.y + shiftY);
        }
        if (e.labelPos) {
          e.labelPos.x = round2(e.labelPos.x + shiftX);
          e.labelPos.y = round2(e.labelPos.y + shiftY);
        }
      }
      // Rebuild node and group positions from the shifted map.
      for (const ln of layoutNodes) {
        const p = positioned.get(ln.id)!;
        ln.x = p.x;
        ln.y = p.y;
      }
      const shiftedGroups = this.computeGroups(diagram.groups ?? [], positioned, nodeSizes);
      layoutGroups.length = 0;
      layoutGroups.push(...shiftedGroups);
      // Groups moved with the shift, so re-expand for their new extents.
      for (const lg of layoutGroups) {
        const all = flattenGroups([lg]);
        for (const g of all) {
          const right = g.x + g.width / 2;
          const bottom = g.y + g.height / 2;
          if (right + this.opts.margin > finalWidth) finalWidth = Math.ceil(right + this.opts.margin);
          if (bottom + this.opts.margin > finalHeight) finalHeight = Math.ceil(bottom + this.opts.margin);
        }
      }
      finalWidth += shiftX;
      finalHeight += shiftY;
      // Labels moved too, so confirm the right edge once more.
      for (const e of layoutEdges) {
        if (!e.label || !e.labelPos) continue;
        const visLen = Math.min(e.label.length, 48);
        const estW = visLen * 6.5 + 8;
        const right = e.labelPos.x + estW / 2;
        if (right + this.opts.margin > finalWidth) finalWidth = Math.ceil(right + this.opts.margin);
      }
    }

    return {
      diagram,
      direction: diagram.direction,
      nodes: layoutNodes,
      edges: layoutEdges,
      groups: layoutGroups,
      width: finalWidth,
      height: finalHeight,
    };
  }

  private computeRanks(
    nodes: FloeDiagram["nodes"],
    edges: FloeDiagram["edges"],
  ): Map<string, number> {
    const ranks = new Map<string, number>();
    for (const n of nodes) ranks.set(n.id, 0);

    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) {
      indeg.set(n.id, 0);
      adj.set(n.id, []);
    }
    const sortedEdges = [...edges].sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      if (a.target !== b.target) return a.target.localeCompare(b.target);
      return (a.label ?? "").localeCompare(b.label ?? "");
    });
    for (const e of sortedEdges) {
      if (!indeg.has(e.target) || !adj.has(e.source)) continue;
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      adj.get(e.source)!.push(e.target);
    }
    for (const list of adj.values()) list.sort((a, b) => a.localeCompare(b));

    const queue: string[] = [];
    for (const [id, d] of indeg.entries()) if (d === 0) queue.push(id);
    queue.sort((a, b) => a.localeCompare(b));

    const processed = new Set<string>();
    while (queue.length > 0) {
      const u = queue.shift()!;
      processed.add(u);
      const uRank = ranks.get(u) ?? 0;
      const neighbors = adj.get(u) ?? [];
      for (const v of neighbors) {
        const cur = ranks.get(v) ?? 0;
        const proposed = uRank + 1;
        if (proposed > cur) ranks.set(v, proposed);
        const newDeg = (indeg.get(v) ?? 1) - 1;
        indeg.set(v, newDeg);
        if (newDeg === 0) {
          queue.push(v);
          queue.sort((a, b) => a.localeCompare(b));
        }
      }
    }

    if (processed.size < nodes.length) {
      const remaining = nodes
        .map((n) => n.id)
        .filter((id) => !processed.has(id))
        .sort((a, b) => a.localeCompare(b));
      let maxRank = 0;
      for (const v of ranks.values()) if (v > maxRank) maxRank = v;
      for (const id of remaining) {
        let maxPred = -1;
        for (const e of sortedEdges) {
          if (e.target === id) {
            const predRank = ranks.get(e.source);
            if (predRank !== undefined && predRank > maxPred) maxPred = predRank;
          }
        }
        if (maxPred >= 0) {
          const proposed = maxPred + 1;
          ranks.set(id, proposed);
          if (proposed > maxRank) maxRank = proposed;
        } else {
          const proposed = maxRank + 1;
          ranks.set(id, proposed);
          maxRank = proposed;
        }
      }
    }

    const minRank = Math.min(...Array.from(ranks.values()));
    if (minRank !== 0) {
      for (const [k, v] of ranks.entries()) ranks.set(k, v - minRank);
    }

    return ranks;
  }

  private buildTopGroupMap(groups: import("../types.js").FloeGroup[]): Map<string, string> {
    const map = new Map<string, string>();
    const walk = (arr: import("../types.js").FloeGroup[], top?: string) => {
      const sorted = [...arr].sort((a, b) => a.id.localeCompare(b.id));
      for (const g of sorted) {
        const curTop = top ?? g.id;
        for (const nid of g.nodeIds ?? []) {
          if (!map.has(nid)) map.set(nid, curTop);
        }
        if (g.groups && g.groups.length > 0) walk(g.groups, curTop);
      }
    };
    walk(groups);
    return map;
  }

  private applyBarycenter(
    rankGroups: Map<number, string[]>,
    sortedRanks: number[],
    edges: FloeDiagram["edges"],
    groupOf: Map<string, string>,
  ): void {
    // One barycenter pass over predecessor order; ties keep current order.
    const preds = new Map<string, string[]>();
    for (const e of edges) {
      const arr = preds.get(e.target) ?? [];
      arr.push(e.source);
      preds.set(e.target, arr);
    }
    const orderIndex = new Map<string, number>();
    for (const r of sortedRanks) {
      const ids = rankGroups.get(r)!;
      ids.forEach((id, i) => orderIndex.set(id, i));
    }
    for (const r of sortedRanks) {
      const ids = rankGroups.get(r)!;
      if (ids.length <= 1) continue;
      const scored = ids.map((id, origIdx) => {
        const ps = preds.get(id) ?? [];
        if (ps.length === 0) return { id, score: -1, origIdx, group: groupOf.get(id) ?? "" };
        let sum = 0;
        let cnt = 0;
        for (const p of ps) {
          const oi = orderIndex.get(p);
          if (oi !== undefined) { sum += oi; cnt++; }
        }
        const score = cnt > 0 ? sum / cnt : -1;
        return { id, score, origIdx, group: groupOf.get(id) ?? "" };
      });
      scored.sort((a, b) => {
        if (a.group !== b.group) return a.group.localeCompare(b.group);
        if (a.score !== b.score) return a.score - b.score;
        return a.origIdx - b.origIdx;
      });
      const reordered = scored.map((s) => s.id);
      rankGroups.set(r, reordered);
      reordered.forEach((id, i) => {
        orderIndex.set(id, i);
      });
    }
  }

  private assignTbPositions(
    rankGroups: Map<number, string[]>,
    sortedRanks: number[],
    nodeSizes: Map<string, { w: number; h: number }>,
  ): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    const { nodeHeight, rankSep, nodeSep, margin } = this.opts;

    let maxGroupWidth = 0;
    for (const r of sortedRanks) {
      const ids = rankGroups.get(r)!;
      let w = 0;
      for (const id of ids) w += nodeSizes.get(id)!.w;
      w += Math.max(0, ids.length - 1) * nodeSep;
      if (w > maxGroupWidth) maxGroupWidth = w;
    }

    for (const rank of sortedRanks) {
      const ids = rankGroups.get(rank)!;
      let groupWidth = 0;
      for (const id of ids) groupWidth += nodeSizes.get(id)!.w;
      groupWidth += Math.max(0, ids.length - 1) * nodeSep;

      const y = margin + rank * (nodeHeight + rankSep) + nodeHeight / 2;
      const startX = margin + (maxGroupWidth - groupWidth) / 2;

      let cursor = startX;
      for (const id of ids) {
        const sz = nodeSizes.get(id)!;
        const x = cursor + sz.w / 2;
        pos.set(id, { x: round2(x), y: round2(y) });
        cursor += sz.w + nodeSep;
      }
    }

    return pos;
  }

  private assignLrPositions(
    rankGroups: Map<number, string[]>,
    sortedRanks: number[],
    nodeSizes: Map<string, { w: number; h: number }>,
  ): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    const { rankSep, nodeSep, margin } = this.opts;
    // Column widths and heights per rank
    const colWidths = new Map<number, number>();
    const colHeights = new Map<number, number>();
    let maxColHeight = 0;
    for (const r of sortedRanks) {
      const ids = rankGroups.get(r)!;
      let maxW = 0;
      let totalH = 0;
      for (const id of ids) {
        const sz = nodeSizes.get(id)!;
        if (sz.w > maxW) maxW = sz.w;
        totalH += sz.h;
      }
      totalH += Math.max(0, ids.length - 1) * nodeSep;
      colWidths.set(r, maxW);
      colHeights.set(r, totalH);
      if (totalH > maxColHeight) maxColHeight = totalH;
    }
    let cursorX = margin;
    for (const rank of sortedRanks) {
      const ids = rankGroups.get(rank)!;
      const colW = colWidths.get(rank)!;
      const colH = colHeights.get(rank)!;
      const startY = margin + (maxColHeight - colH) / 2;
      let cursorY = startY;
      for (const id of ids) {
        const sz = nodeSizes.get(id)!;
        // Center within column horizontally
        const cx = cursorX + colW / 2;
        const cy = cursorY + sz.h / 2;
        pos.set(id, { x: round2(cx), y: round2(cy) });
        cursorY += sz.h + nodeSep;
      }
      cursorX += colW + rankSep;
    }
    return pos;
  }

  private applyDirectionLr(
    lrPos: Map<string, { x: number; y: number }>,
    direction: Direction,
    nodeSizes: Map<string, { w: number; h: number }>,
  ): Map<string, { x: number; y: number }> {
    if (direction === "LR") return lrPos;
    // RL: mirror horizontally around content bounds
    let maxX = -Infinity;
    for (const [id, p] of lrPos.entries()) {
      const sz = nodeSizes.get(id)!;
      const right = p.x + sz.w / 2;
      if (right > maxX) maxX = right;
    }
    const contentWidth = maxX + this.opts.margin;
    const result = new Map<string, { x: number; y: number }>();
    for (const [id, p] of lrPos.entries()) {
      result.set(id, { x: round2(contentWidth - p.x), y: round2(p.y) });
    }
    return result;
  }

  private applyDirection(
    tbPos: Map<string, { x: number; y: number }>,
    direction: Direction,
    nodeSizes: Map<string, { w: number; h: number }>,
  ): Map<string, { x: number; y: number }> {
    if (direction === "TB") return tbPos;

    let maxX = -Infinity, maxY = -Infinity;
    for (const [id, p] of tbPos.entries()) {
      const sz = nodeSizes.get(id)!;
      const right = p.x + sz.w / 2;
      const bottom = p.y + sz.h / 2;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    const tbHeight = maxY + this.opts.margin;

    const result = new Map<string, { x: number; y: number }>();
    for (const [id, p] of tbPos.entries()) {
      let x = p.x;
      let y = p.y;
      if (direction === "BT") y = tbHeight - y;
      else if (direction === "LR") { const tmp = x; x = y; y = tmp; }
      else if (direction === "RL") { const tmp = x; x = tbHeight - y; y = tmp; }
      result.set(id, { x: round2(x), y: round2(y) });
    }

    return result;
  }

  private computeEdgePoints(
    src: { x: number; y: number; w: number; h: number },
    tgt: { x: number; y: number; w: number; h: number },
    direction: Direction,
    srcPos: { x: number; y: number },
    tgtPos: { x: number; y: number },
    parallelIdx = 0,
  ): Array<{ x: number; y: number }> {
    let isBackward = false;
    if (direction === "TB") isBackward = srcPos.y > tgtPos.y;
    else if (direction === "BT") isBackward = srcPos.y < tgtPos.y;
    else if (direction === "LR") isBackward = srcPos.x > tgtPos.x;
    else if (direction === "RL") isBackward = srcPos.x < tgtPos.x;

    const sameRank =
      (direction === "TB" || direction === "BT") ? Math.abs(srcPos.y - tgtPos.y) < 1 : Math.abs(srcPos.x - tgtPos.x) < 1;

    let sx: number, sy: number, tx: number, ty: number;

    if (sameRank) {
      if (srcPos.x < tgtPos.x) { sx = src.x + src.w / 2; sy = src.y; tx = tgt.x - tgt.w / 2; ty = tgt.y; }
      else { sx = src.x - src.w / 2; sy = src.y; tx = tgt.x + tgt.w / 2; ty = tgt.y; }
      if (direction === "LR" || direction === "RL") {
        if (srcPos.y < tgtPos.y) { sx = src.x; sy = src.y + src.h / 2; tx = tgt.x; ty = tgt.y - tgt.h / 2; }
        else { sx = src.x; sy = src.y - src.h / 2; tx = tgt.x; ty = tgt.y + tgt.h / 2; }
      }
    } else if (direction === "TB") {
      if (!isBackward) { sx = src.x; sy = src.y + src.h / 2; tx = tgt.x; ty = tgt.y - tgt.h / 2; }
      else { sx = src.x; sy = src.y - src.h / 2; tx = tgt.x; ty = tgt.y + tgt.h / 2; }
    } else if (direction === "BT") {
      if (!isBackward) { sx = src.x; sy = src.y - src.h / 2; tx = tgt.x; ty = tgt.y + tgt.h / 2; }
      else { sx = src.x; sy = src.y + src.h / 2; tx = tgt.x; ty = tgt.y - tgt.h / 2; }
    } else if (direction === "LR") {
      if (!isBackward) { sx = src.x + src.w / 2; sy = src.y; tx = tgt.x - tgt.w / 2; ty = tgt.y; }
      else { sx = src.x - src.w / 2; sy = src.y; tx = tgt.x + tgt.w / 2; ty = tgt.y; }
    } else {
      if (!isBackward) { sx = src.x - src.w / 2; sy = src.y; tx = tgt.x + tgt.w / 2; ty = tgt.y; }
      else { sx = src.x + src.w / 2; sy = src.y; tx = tgt.x - tgt.w / 2; ty = tgt.y; }
    }

    sx = round2(sx); sy = round2(sy); tx = round2(tx); ty = round2(ty);

    if (src.x === tgt.x && src.y === tgt.y) {
      const loopSize = 24;
      return [
        { x: sx, y: sy },
        { x: sx + loopSize, y: sy },
        { x: sx + loopSize, y: sy + loopSize },
        { x: src.x, y: src.y + src.h / 2 },
      ];
    }

    /**
    Backward edges bend around the forward line instead of overlapping it.
    Side and offset are deterministic; parallel edges bend further apart.
    */
    if (isBackward && !sameRank) {
      const dx0 = tx - sx;
      const dy0 = ty - sy;
      const len0 = Math.hypot(dx0, dy0) || 1;
      const nx0 = -dy0 / len0;
      const ny0 = dx0 / len0;
      const bend = 26 + Math.ceil(parallelIdx / 2) * 8;
      const side = parallelIdx % 2 === 0 ? 1 : -1;
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const bx = round2(mx + nx0 * bend * side);
      const by = round2(my + ny0 * bend * side);
      let ftx = tx;
      let fty = ty;
      {
        const dx = ftx - bx;
        const dy = fty - by;
        const len = Math.hypot(dx, dy);
        if (len > 4) {
          const gap = 2;
          ftx = round2(ftx - (dx / len) * gap);
          fty = round2(fty - (dy / len) * gap);
        }
      }
      return [{ x: sx, y: sy }, { x: bx, y: by }, { x: ftx, y: fty }];
    }

    // Parallel edges spread perpendicular; the target pulls back 2px
    // so the arrow marker stays visible outside the node border.
    if (parallelIdx > 0) {
      const dx = tx - sx;
      const dy = ty - sy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const off = (parallelIdx % 2 === 1 ? 1 : -1) * Math.ceil(parallelIdx / 2) * 7;
      sx = round2(sx + nx * off);
      sy = round2(sy + ny * off);
      tx = round2(tx + nx * off);
      ty = round2(ty + ny * off);
    }
    {
      const dx = tx - sx;
      const dy = ty - sy;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        const gap = 2;
        tx = round2(tx - (dx / len) * gap);
        ty = round2(ty - (dy / len) * gap);
      }
    }

    return [{ x: sx, y: sy }, { x: tx, y: ty }];
  }

  private computeLabelPos(points: Array<{ x: number; y: number }>, parallelIdx = 0): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return { x: points[0]!.x, y: points[0]!.y };
    if (points.length === 2) {
      const a = points[0]!, b = points[1]!;
      // Parallel edge labels stack vertically instead of overlapping.
      const yOff = parallelIdx > 0 ? (parallelIdx % 2 === 1 ? 6 : -6) * Math.ceil(parallelIdx / 2) : 0;
      return { x: round2((a.x + b.x) / 2), y: round2((a.y + b.y) / 2 - 8 + yOff) };
    }
    const mid = Math.floor(points.length / 2);
    const a = points[mid - 1]!, b = points[mid]!;
    return { x: round2((a.x + b.x) / 2), y: round2((a.y + b.y) / 2 - 8) };
  }

  private computeGroups(
    groups: import("../types.js").FloeGroup[],
    positioned: Map<string, { x: number; y: number }>,
    nodeSizes: Map<string, { w: number; h: number }>,
  ): LayoutGroup[] {
    const groupPadding = 20;
    const headerHeight = 24;
    const recurse = (grp: import("../types.js").FloeGroup): LayoutGroup => {
      const childLayouts = grp.groups.map(recurse);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasContent = false;
      for (const nid of grp.nodeIds) {
        const pos = positioned.get(nid);
        const sz = nodeSizes.get(nid);
        if (!pos || !sz) continue;
        hasContent = true;
        const l = pos.x - sz.w / 2, r = pos.x + sz.w / 2, t = pos.y - sz.h / 2, b = pos.y + sz.h / 2;
        if (l < minX) minX = l;
        if (r > maxX) maxX = r;
        if (t < minY) minY = t;
        if (b > maxY) maxY = b;
      }
      for (const cl of childLayouts) {
        hasContent = true;
        const l = cl.x - cl.width / 2, r = cl.x + cl.width / 2, t = cl.y - cl.height / 2, b = cl.y + cl.height / 2;
        if (l < minX) minX = l;
        if (r > maxX) maxX = r;
        if (t < minY) minY = t;
        if (b > maxY) maxY = b;
      }
      if (!hasContent) {
        const cx = this.opts.margin + 50;
        const cy = this.opts.margin + 30;
        return {
          id: grp.id,
          label: grp.label ?? grp.id,
          type: grp.type,
          x: round2(cx),
          y: round2(cy),
          width: 100,
          height: 60,
          data: grp,
          memberIds: [...grp.nodeIds],
          children: childLayouts,
        };
      }
      minX -= groupPadding;
      maxX += groupPadding;
      minY -= groupPadding + headerHeight;
      maxY += groupPadding;
      const w = maxX - minX;
      const h = maxY - minY;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return {
        id: grp.id,
        label: grp.label ?? grp.id,
        type: grp.type,
        x: round2(cx),
        y: round2(cy),
        width: round2(w),
        height: round2(h),
        data: grp,
        memberIds: [...grp.nodeIds],
        children: childLayouts,
      };
    };
    const sorted = [...groups].sort((a, b) => a.id.localeCompare(b.id));
    return sorted.map(recurse);
  }
}

function estimateNodeSize(label: string, type: string | undefined, opts: Required<LayoutOptions>, fontSize = 12): { w: number; h: number } {
  const fs = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12;
  const scale = fs / 12;
  const charW = 7 * scale;
  const paddingX = 24;
  let minW = opts.minNodeWidth;
  let maxW = opts.maxNodeWidth;
  let h = opts.nodeHeight * (fs === 12 ? 1 : scale);
  const t = (type ?? "").toLowerCase();
  if (t === "database" || t === "db") { minW = Math.max(minW, 90); h = 48 * scale; }
  else if (t === "person") { minW = Math.max(minW, 80); h = 48 * scale; }
  else if (t === "decision" || t === "diamond" || t === "conditional" || t === "choice") {
    minW = Math.max(minW, 96);
    h = 56 * scale;
  } else if (t === "document" || t === "doc") { minW = Math.max(minW, 88); h = 52 * scale; }
  else if (t === "start" || t === "end" || t === "terminator") { minW = Math.max(minW, 84); h = 48 * scale; }
  const textW = label.length * charW + paddingX;
  // Long labels wrap to at most 3 lines; short labels keep exact v1.0 size.
  if (textW <= maxW) {
    const w = Math.max(minW, Math.min(maxW, textW));
    return { w: Math.round(w), h: Math.round(h) };
  }
  const lines = Math.min(3, Math.ceil(textW / maxW));
  const w = Math.max(minW, maxW);
  const wrappedH = h + (lines - 1) * 14 * scale;
  return { w: Math.round(w), h: Math.round(wrappedH) };
}

function flattenGroups(groups: LayoutGroup[]): LayoutGroup[] {
  const out: LayoutGroup[] = [];
  for (const g of groups) {
    out.push(g);
    if (g.children.length > 0) out.push(...flattenGroups(g.children));
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
