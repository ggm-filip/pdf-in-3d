/**
 * From a die line (cut + crease segments, in pixels of the page image) to foldable panels:
 *   - the lines are drawn into a grid; the empty areas between them are the panels
 *     (with cut lines, areas touching the sheet edge are waste; small areas and holes are dropped);
 *   - a crease with a panel on each side is a hinge between them;
 *   - starting from the largest panel, every panel hangs on its parent by one hinge (a tree), so folding a
 *     panel takes its children along.
 * Packaging (with cut lines) folds 90°, a folder (creases only) folds flat (about 180°).
 */
import type { Seg } from "./separate";

export type Panel = {
  id: number;
  box: [number, number, number, number]; // x0, y0, x1, y1 in image pixels
  area: number; // in grid cells
  center: [number, number]; // image pixels
  mask: { w: number; h: number; data: Uint8Array }; // 255 inside the panel, grid cells over `box`
  parent: number; // index in panels, -1 for the root
  hinge: [number, number, number, number] | null; // the fold line to the parent: x0, y0, x1, y1 in image pixels
  depth: number;
  angle: number; // fold angle in radians (0 for the root)
};

export type Fold = { panels: Panel[]; packaging: boolean };

const GRID = 1024; // grid cells along the longest side
const RAD = 2; // half width of a drawn line, in cells (closes small gaps where lines nearly meet)

export function buildFold(w: number, h: number, cut: Seg[], crease: Seg[]): Fold | null {
  if (!crease.length) return null;
  const s = GRID / Math.max(w, h);
  const gw = Math.ceil(w * s) + 1, gh = Math.ceil(h * s) + 1;
  const LINE = -1;
  const lab = new Int32Array(gw * gh); // 0 = free, -1 = line, >0 = area id
  const creaseCell = new Uint8Array(gw * gh); // 1 where a crease line lies
  const stamp = (segs: Seg[], mark?: Uint8Array) => {
    for (const [x0, y0, x1, y1] of segs) {
      const len = Math.hypot(x1 - x0, y1 - y0) * s;
      const n = Math.max(1, Math.ceil(len * 2));
      for (let i = 0; i <= n; i++) {
        const cx = (x0 + ((x1 - x0) * i) / n) * s, cy = (y0 + ((y1 - y0) * i) / n) * s;
        for (let dy = -RAD; dy <= RAD; dy++) for (let dx = -RAD; dx <= RAD; dx++) {
          if (dx * dx + dy * dy > RAD * RAD + 0.5) continue;
          const x = Math.round(cx + dx), y = Math.round(cy + dy);
          if (x >= 0 && y >= 0 && x < gw && y < gh) { lab[y * gw + x] = LINE; if (mark) mark[y * gw + x] = 1; }
        }
      }
    }
  };
  stamp(cut);
  stamp(crease, creaseCell);

  // areas between the lines
  const areas: { id: number; n: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number; edge: boolean }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < lab.length; start++) {
    if (lab[start] !== 0) continue;
    const id = areas.length + 1;
    const a = { id, n: 0, x0: gw, y0: gh, x1: 0, y1: 0, sx: 0, sy: 0, edge: false };
    lab[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % gw, y = (i - x) / gw;
      a.n++; a.sx += x; a.sy += y;
      if (x < a.x0) a.x0 = x; if (x > a.x1) a.x1 = x; if (y < a.y0) a.y0 = y; if (y > a.y1) a.y1 = y;
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) a.edge = true;
      if (x > 0 && lab[i - 1] === 0) { lab[i - 1] = id; stack.push(i - 1); }
      if (x < gw - 1 && lab[i + 1] === 0) { lab[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && lab[i - gw] === 0) { lab[i - gw] = id; stack.push(i - gw); }
      if (y < gh - 1 && lab[i + gw] === 0) { lab[i + gw] = id; stack.push(i + gw); }
    }
    areas.push(a);
  }
  const packaging = cut.length > 0;
  const minArea = gw * gh * 0.002;
  const keep = new Set(areas.filter((a) => a.n >= minArea && !(packaging && a.edge)).map((a) => a.id));
  // small slivers inside the sheet that touch a crease (between a cut and a crease that run close together, or where
  // creases meet) are board, not holes: they go to the nearest panel like the lines do, so the print runs on under them.
  // A small piece closed in by cut lines only stays out: that is a real hole (a window, a hang hole).
  const touchesCrease = new Set<number>();
  for (let i = 0; i < lab.length; i++) {
    if (!creaseCell[i]) continue;
    const x = i % gw;
    for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, i - gw, i + gw]) if (j >= 0 && j < lab.length && lab[j] > 0) touchesCrease.add(lab[j]);
  }
  const sliver = new Set(areas.filter((a) => !keep.has(a.id) && !(packaging && a.edge) && touchesCrease.has(a.id)).map((a) => a.id));
  if (sliver.size) for (let i = 0; i < lab.length; i++) if (sliver.has(lab[i])) lab[i] = LINE;

  // hinges: look at both sides of every crease segment
  const at = (x: number, y: number) => {
    const gx = Math.round(x * s), gy = Math.round(y * s);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return 0;
    return lab[gy * gw + gx];
  };
  const pairs = new Map<string, { a: number; b: number; segs: Seg[] }>();
  const off = (RAD + 2) / s;
  for (const sg of crease) {
    const [x0, y0, x1, y1] = sg;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len * s < 2) continue;
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    for (const t of [0.5, 0.3, 0.7]) {
      const mx = x0 + (x1 - x0) * t, my = y0 + (y1 - y0) * t;
      const la = at(mx + nx * off, my + ny * off), lb = at(mx - nx * off, my - ny * off);
      if (la > 0 && lb > 0 && la !== lb && keep.has(la) && keep.has(lb)) {
        const key = la < lb ? `${la}-${lb}` : `${lb}-${la}`;
        if (!pairs.has(key)) pairs.set(key, { a: Math.min(la, lb), b: Math.max(la, lb), segs: [] });
        pairs.get(key)!.segs.push(sg);
        break;
      }
    }
  }
  if (!pairs.size) return null;

  // the line pixels go to the nearest panel, so neighbouring panels meet without a gap
  const queue: number[] = [];
  for (let i = 0; i < lab.length; i++) if (lab[i] > 0 && keep.has(lab[i])) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % gw;
    for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, i - gw, i + gw]) {
      if (j >= 0 && j < lab.length && lab[j] === LINE) { lab[j] = lab[i]; queue.push(j); }
    }
  }

  // the tree, from the largest panel that has a hinge
  const linked = new Set<number>();
  pairs.forEach((p) => { linked.add(p.a); linked.add(p.b); });
  const byId = new Map(areas.map((a) => [a.id, a]));
  const ids = [...linked].sort((p, q) => byId.get(q)!.n - byId.get(p)!.n);
  const root = ids[0];
  const parent = new Map<number, { p: number; segs: Seg[] }>();
  const depth = new Map<number, number>([[root, 0]]);
  const order = [root];
  for (let k = 0; k < order.length; k++) {
    const cur = order[k];
    pairs.forEach((p) => {
      const other = p.a === cur ? p.b : p.b === cur ? p.a : 0;
      if (other && !depth.has(other)) { depth.set(other, depth.get(cur)! + 1); parent.set(other, { p: cur, segs: p.segs }); order.push(other); }
    });
  }

  const index = new Map(order.map((id, i) => [id, i]));
  const panels: Panel[] = order.map((id) => {
    const a = byId.get(id)!;
    // grow the box by the line width (the line cells were added to the panel)
    const x0 = Math.max(0, a.x0 - RAD - 1), y0 = Math.max(0, a.y0 - RAD - 1), x1 = Math.min(gw - 1, a.x1 + RAD + 1), y1 = Math.min(gh - 1, a.y1 + RAD + 1);
    const mw = x1 - x0 + 1, mh = y1 - y0 + 1;
    const data = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (lab[(y + y0) * gw + x + x0] === id) data[y * mw + x] = 255;
    const pr = parent.get(id);
    let hinge: Panel["hinge"] = null;
    if (pr) {
      // the fold axis: along the longest crease piece, from the first to the last end point
      const longest = pr.segs.reduce((m, q) => (Math.hypot(q[2] - q[0], q[3] - q[1]) > Math.hypot(m[2] - m[0], m[3] - m[1]) ? q : m));
      const L = Math.hypot(longest[2] - longest[0], longest[3] - longest[1]);
      const dx = (longest[2] - longest[0]) / L, dy = (longest[3] - longest[1]) / L;
      let lo = Infinity, hi = -Infinity;
      for (const q of pr.segs) for (const [px, py] of [[q[0], q[1]], [q[2], q[3]]]) {
        const t = (px - longest[0]) * dx + (py - longest[1]) * dy;
        lo = Math.min(lo, t); hi = Math.max(hi, t);
      }
      hinge = [longest[0] + dx * lo, longest[1] + dy * lo, longest[0] + dx * hi, longest[1] + dy * hi];
    }
    return {
      id,
      box: [x0 / s, y0 / s, (x1 + 1) / s, (y1 + 1) / s],
      area: a.n,
      center: [a.sx / a.n / s, a.sy / a.n / s],
      mask: { w: mw, h: mh, data },
      parent: pr ? index.get(pr.p)! : -1,
      hinge,
      depth: depth.get(id)!,
      angle: 0,
    };
  });

  // how far each panel folds; the direction (away from the viewer, so the print ends up outside) is set by the viewer
  const full = packaging ? Math.PI / 2 : Math.PI * 0.985;
  for (const p of panels) if (p.hinge) p.angle = full;
  return { panels, packaging };
}
