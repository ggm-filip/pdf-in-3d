/**
 * Splits a PDF page into what the 3D viewer needs, with MuPDF.js (runs in the browser, in a worker):
 *   print  the CMYK (and other inks) without foil, SpotUV or die lines, as RGB
 *   pbr    R = SpotUV, G = gold foil, B = all foil (silver + gold)
 *   emboss the embossing (a relief, never printed), as grey
 *   lines  the cut and crease lines (die line) as line segments, in pixels of the print image
 *
 * MuPDF.js has no separations API, so every drawing call of the page goes through a filter device:
 * the print pass draws everything except the special inks; a mask pass draws only one special ink, as white on black.
 * Spot inks are recognised by name: the list in content/pdf3d-inks.json, which the owner keeps up to date in the CMS. Ink mixes (DeviceN, e.g. CMYK + foil in one colour) are split per ink.
 */
import type * as Mu from "mupdf";
import INK_NAMES from "@/content/pdf3d-inks.json";
import { inkUse, knockoutInks } from "./overprint";

type MuPDF = typeof Mu;
export type Ink = "foil" | "gold" | "varnish" | "emboss" | "cut" | "crease";
type Pass = "print" | "foil" | "gold" | "varnish" | "emboss";
export type Seg = [number, number, number, number];

// spot colour names (content/pdf3d-inks.json), compared without case, spaces, "_", "-" or "."; a name of 4 or more
// letters may also be part of a longer name ("gold" finds "Goldfoil 2", "foil" finds "Inline koudfoil")
const norm = (x: string) => x.toLowerCase().replace(/[\s_\-.]/g, "");
const list = (k: keyof typeof INK_NAMES) => (INK_NAMES[k] ?? []).map(norm).filter(Boolean);
const NAMES: Record<Ink, string[]> = {
  foil: list("foil"), gold: list("gold"), varnish: list("spotuv"), emboss: list("emboss"), cut: list("cut"), crease: list("crease"),
};
// die lines first, embossing before gold ("Gold emboss" is an embossing), gold before foil ("Goldfoil" is gold)
const ORDER: Ink[] = ["cut", "crease", "emboss", "gold", "varnish", "foil"];

export function inkOf(name: string): Ink | null {
  const n = norm(name);
  // process inks are never special ("Black 2" contains "lack")
  if (/^(cyan|magenta|yellow|black|process|all|none)/.test(n)) return null;
  for (const ink of ORDER) if (NAMES[ink].includes(n)) return ink;
  for (const ink of ORDER) if (NAMES[ink].some((x) => x.length >= 4 && n.includes(x))) return ink;
  return null;
}

const PROCESS = ["cyan", "magenta", "yellow", "black"];

/**
 * MuPDF.js gives no colour space for a gradient (shade). It is read from the shade's C struct
 * (fz_shade: storable 12 bytes, bbox 16 bytes, then the colorspace pointer), via the wasm module that
 * mupdf.js keeps in globalThis.$libmupdf_wasm_Module (set to {} before importing mupdf). Checked with mupdf 1.28.6.
 */
let shadeSpace: (sh: Mu.Shade) => Mu.ColorSpace | null = () => null;
export function initShadeSpace(mu: MuPDF) {
  const L = (globalThis as unknown as { $libmupdf_wasm_Module?: { HEAPU32?: Uint32Array; _wasm_keep_colorspace?: (p: number) => number } }).$libmupdf_wasm_Module;
  if (!L?.HEAPU32 || !L._wasm_keep_colorspace) return;
  shadeSpace = (sh) => {
    const ptr = L.HEAPU32![((sh as unknown as { pointer: number }).pointer + 28) >> 2];
    return ptr ? new mu.ColorSpace(L._wasm_keep_colorspace!(ptr) as never) : null;
  };
}

/** the ink names of a Separation or DeviceN colour space, or null for any other colour space */
function inks(cs: Mu.ColorSpace | null | undefined, cache: Map<string, string[] | null>): string[] | null {
  if (!cs || cs.getType() !== "Separation") return null;
  const name = cs.getName();
  if (cache.has(name)) return cache.get(name)!;
  const n = cs.getNumberOfComponents();
  const parts = name.replace(/\)\s*$/, "").split(",").map((s) => s.trim());
  const out = parts.slice(-n);
  cache.set(name, out);
  return out;
}

export type PageOut = {
  width: number; height: number;
  print: Mu.Pixmap; // RGB
  pbr: Mu.Pixmap; // RGB: R SpotUV, G gold, B foil
  inks: string[]; // every spot ink name met on the page
  emboss: Mu.Pixmap | null; // Gray: the embossing, or null when the page has none
  cut: Seg[]; crease: Seg[];
};

/**
 * Renders one page. maxSide limits the longest side of the images in pixels.
 * The TrimBox is used when the page has one (smaller than the page), so bleed is cut off.
 */
export function renderPage(mu: MuPDF, page: Mu.Page, maxSide: number, useTrim = true): PageOut {
  const media = page.getBounds();
  let box = media;
  if (useTrim) {
    try {
      const t = page.getBounds("TrimBox");
      if (t[2] - t[0] > 10 && t[3] - t[1] > 10 && (t[2] - t[0] < media[2] - media[0] - 0.5 || t[3] - t[1] < media[3] - media[1] - 0.5)) box = t;
    } catch { /* no TrimBox */ }
  }
  const bw = box[2] - box[0], bh = box[3] - box[1];
  const s = maxSide / Math.max(bw, bh);
  const w = Math.max(1, Math.round(bw * s)), h = Math.max(1, Math.round(bh * s));
  const ctm = mu.Matrix.concat(mu.Matrix.translate(-box[0], -box[1]), mu.Matrix.scale(s, s));
  const cache = new Map<string, string[] | null>();
  const seen = new Set<string>();
  const cut: Seg[] = [], crease: Seg[] = [];
  // foil that does not overprint knocks out the print under it (read from the PDF's graphics states)
  const knock = new Set([...knockoutInks(inkUse(page))].map(norm));

  const run = (pass: Pass, pix: Mu.Pixmap) => {
    const dev = new mu.DrawDevice(ctm, pix);
    let maskDepth = 0;
    const blends: boolean[] = []; // open groups: true when one blends (Multiply...), then nothing knocks out
    let blending = 0;
    const unown = (o: object) => (o.constructor as unknown as { _finalizer?: FinalizationRegistry<unknown> })._finalizer?.unregister(o);
    // decides how to draw something in this colour: calls draw() with the colour to use, or not at all
    const white = (cs: Mu.ColorSpace, color: number[], names: string[] | null) => {
      const eps = 0.002;
      if (names) return color.every((c) => c <= eps); // ink tints: 0 is no ink
      if (cs.isCMYK()) return color.every((c) => c <= eps);
      if (cs.isRGB() || cs.isGray()) return color.every((c) => c >= 1 - eps);
      return false;
    };
    const paint = (cs: Mu.ColorSpace, color: number[], draw: (cs: Mu.ColorSpace, color: Mu.Color) => void, path?: { p: Mu.Path; ctm: Mu.Matrix }) => {
      if (maskDepth) return draw(cs, color as Mu.Color);
      const names = inks(cs, cache);
      // white over a special ink knocks it out (a white mark in the foil leaves bare board), so in a mask pass it erases
      const knockout = () => { if (pass !== "print" && pass !== "emboss" && white(cs, color, names)) draw(mu.ColorSpace.DeviceGray, [0] as unknown as Mu.Color); };
      if (!names) { if (pass === "print") draw(cs, color as Mu.Color); else knockout(); return; }
      const kinds = names.map(inkOf);
      if (pass === "print") names.forEach((n) => { if (inkOf(n)) seen.add(n); });
      if (kinds.every((k) => !k)) { if (pass === "print") draw(cs, color as Mu.Color); else knockout(); return; }
      if (kinds.some((k) => k === "cut" || k === "crease")) {
        if (pass === "print" && path) collect(path.p, path.ctm, kinds.includes("cut") ? cut : crease);
        return; // die lines are not printed
      }
      if (pass === "print") {
        const v = [0, 0, 0, 0];
        let any = false;
        names.forEach((n, i) => { const j = PROCESS.indexOf(n.toLowerCase()); if (j >= 0 && color[i] > 0) { v[j] = color[i]; any = true; } });
        // a foil in knockout leaves bare foil: the print under it is erased (only its own CMYK part stays)
        const ko = !blending && names.some((n, i) => (kinds[i] === "foil" || kinds[i] === "gold") && color[i] > 0 && knock.has(norm(n)));
        if (any || ko) draw(mu.ColorSpace.DeviceCMYK, v as Mu.Color);
        return;
      }
      let t = 0;
      kinds.forEach((k, i) => { if (k === pass || (pass === "foil" && k === "gold")) t = Math.max(t, color[i] ?? 0); });
      if (t > 0) draw(mu.ColorSpace.DeviceGray, [t] as unknown as Mu.Color);
    };
    // an image in an ink mix: build a new image with only the inks of this pass
    const splitImage = (img: Mu.Image): Mu.Image | null => {
      const names = inks(img.getColorSpace(), cache);
      if (!names || names.every((n) => !inkOf(n))) return pass === "print" ? img : null;
      const kinds = names.map(inkOf);
      if (pass === "print") names.forEach((n) => { if (inkOf(n)) seen.add(n); });
      const src = img.toPixmap();
      const a = src.getAlpha(), sn = src.getNumberOfComponents(), n = sn - (a ? 1 : 0); // n counts the alpha channel too
      const out = new mu.Pixmap(pass === "print" ? mu.ColorSpace.DeviceCMYK : mu.ColorSpace.DeviceGray, src.getBounds() as Mu.Rect, !!a);
      out.clear(pass === "print" ? 255 : 0);
      const sp = src.getPixels(), op = out.getPixels();
      const on = out.getNumberOfComponents();
      const pick = pass === "print"
        ? names.map((nm) => PROCESS.indexOf(nm.toLowerCase()))
        : kinds.map((k) => (k === pass || (pass === "foil" && k === "gold") ? 0 : -1));
      const W = src.getWidth(), H = src.getHeight(), ss = src.getStride(), os = out.getStride();
      let anyInk = false;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const si = y * ss + x * sn, oi = y * os + x * on;
          for (let c = 0; c < n; c++) {
            const j = pick[c];
            if (j >= 0 && sp[si + c] > op[oi + j]) { op[oi + j] = sp[si + c]; anyInk = true; }
          }
          if (a) op[oi + on - 1] = sp[si + sn - 1];
        }
      }
      src.destroy();
      if (!anyInk) { out.destroy(); return null; }
      const mask = img.getMask();
      return mask ? new mu.Image(out, mask) : new mu.Image(out);
    };
    const filter = new mu.Device({
      fillPath: (p, eo, m, cs, c, al) => paint(cs, c, (cs2, c2) => dev.fillPath(p, eo, m, cs2, c2, al), { p, ctm: m }),
      strokePath: (p, st, m, cs, c, al) => paint(cs, c, (cs2, c2) => dev.strokePath(p, st, m, cs2, c2, al), { p, ctm: m }),
      fillText: (t, m, cs, c, al) => paint(cs, c, (cs2, c2) => dev.fillText(t, m, cs2, c2, al)),
      strokeText: (t, st, m, cs, c, al) => paint(cs, c, (cs2, c2) => dev.strokeText(t, st, m, cs2, c2, al)),
      clipPath: (p, eo, m) => dev.clipPath(p, eo, m),
      clipStrokePath: (p, st, m) => dev.clipStrokePath(p, st, m),
      clipText: (t, m) => dev.clipText(t, m),
      clipStrokeText: (t, st, m) => dev.clipStrokeText(t, st, m),
      ignoreText: (t, m) => dev.ignoreText(t, m),
      fillShade: (sh, m, al) => {
        unown(sh);
        if (maskDepth) return dev.fillShade(sh, m, al);
        const names = inks(shadeSpace(sh), cache);
        const kinds = names?.map(inkOf) ?? [];
        if (pass === "print") {
          if (!kinds.some(Boolean)) { dev.fillShade(sh, m, al); return; }
          names!.forEach((n) => { if (inkOf(n)) seen.add(n); });
          // a foil gradient in knockout: erase the print in its shape (the clip), like a flat foil
          if (!blending && names!.some((n, i) => (kinds[i] === "foil" || kinds[i] === "gold") && knock.has(norm(n)))) {
            const p = new mu.Path(); const b = sh.getBounds(); p.rect(b[0], b[1], b[2], b[3]);
            dev.fillPath(p, false, m, mu.ColorSpace.DeviceCMYK, [0, 0, 0, 0], al);
          }
          return;
        }
        // a gradient in a special ink: use its shape as the mask (the tint along the gradient is not followed)
        if (kinds.some((k) => k === pass || (pass === "foil" && k === "gold"))) { const p = new mu.Path(); const b = sh.getBounds(); p.rect(b[0], b[1], b[2], b[3]); dev.fillPath(p, false, m, mu.ColorSpace.DeviceGray, [1], al); }
      },
      fillImage: (img, m, al) => {
        unown(img);
        if (maskDepth) return dev.fillImage(img, m, al);
        const use = splitImage(img);
        if (use) dev.fillImage(use, m, al);
      },
      fillImageMask: (img, m, cs, c, al) => { unown(img); paint(cs, c, (cs2, c2) => dev.fillImageMask(img, m, cs2, c2, al)); },
      clipImageMask: (img, m) => { unown(img); dev.clipImageMask(img, m); },
      popClip: () => dev.popClip(),
      beginMask: (r, lum, cs, c) => { maskDepth++; dev.beginMask(r, lum, cs, c as Mu.Color); },
      endMask: () => { maskDepth--; dev.endMask(); },
      // in a mask pass every ink is drawn as white on black: blend modes such as Multiply would make it vanish
      // and a group that blends in CMYK would turn the grey mask into CMYK and back, so black came out as ~12% grey
      beginGroup: (r, cs, iso, ko, bm, al) => {
        const b = bm !== "Normal";
        blends.push(b);
        if (b) blending++;
        if (pass === "print" || maskDepth) dev.beginGroup(r, cs, iso, ko, bm, al);
        else dev.beginGroup(r, mu.ColorSpace.DeviceGray, iso, ko, "Normal", al);
      },
      endGroup: () => { if (blends.pop()) blending--; dev.endGroup(); },
      beginTile: (a, v, xs, ys, m, id, doc) => dev.beginTile(a, v, xs, ys, m, id, doc),
      endTile: () => dev.endTile(),
      beginLayer: (n) => dev.beginLayer(n),
      endLayer: () => dev.endLayer(),
    });
    page.run(filter, mu.Matrix.identity);
    filter.close();
    dev.close();
  };

  // die lines, flattened to segments in image pixels
  function collect(p: Mu.Path, m: Mu.Matrix, out: Seg[]) {
    const tr = (x: number, y: number): [number, number] => {
      const q = mu.Matrix.concat(m, ctm);
      return [q[0] * x + q[2] * y + q[4], q[1] * x + q[3] * y + q[5]];
    };
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const line = (x: number, y: number) => { const a = tr(cx, cy), b = tr(x, y); if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1], b[0], b[1]]); cx = x; cy = y; };
    p.walk({
      moveTo: (x, y) => { cx = sx = x; cy = sy = y; },
      lineTo: line,
      curveTo: (x1, y1, x2, y2, x3, y3) => {
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= 12; i++) {
          const t = i / 12, u = 1 - t;
          line(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
        }
      },
      closePath: () => line(sx, sy),
    });
  }

  const bbox: Mu.Rect = [0, 0, w, h];
  const cmyk = new mu.Pixmap(mu.ColorSpace.DeviceCMYK, bbox, false);
  cmyk.clear(255); // MuPDF clears CMYK as "white = 255" (0 would be full black)
  run("print", cmyk);
  const print = cmyk.convertToColorSpace(mu.ColorSpace.DeviceRGB);
  cmyk.destroy();

  const pbr = new mu.Pixmap(mu.ColorSpace.DeviceRGB, bbox, false);
  pbr.clear(0);
  const special = [...seen].map(inkOf);
  const passes: [Pass, number][] = [["varnish", 0], ["gold", 1], ["foil", 2]];
  for (const [pass, ch] of passes) {
    if (!special.some((k) => k === pass || (pass === "foil" && k === "gold"))) continue;
    const g = new mu.Pixmap(mu.ColorSpace.DeviceGray, bbox, false);
    g.clear(0);
    run(pass, g);
    // fetch the pixel views only now: they point into wasm memory, which may have grown (and moved) while drawing
    const gp = g.getPixels(), pp = pbr.getPixels(), gs = g.getStride(), ps = pbr.getStride();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pp[y * ps + x * 3 + ch] = gp[y * gs + x];
    g.destroy();
  }
  // embossing: only its shape counts (it is blind, the print under it stays as it is)
  let emboss: Mu.Pixmap | null = null;
  if (special.includes("emboss")) {
    emboss = new mu.Pixmap(mu.ColorSpace.DeviceGray, bbox, false);
    emboss.clear(0);
    run("emboss", emboss);
  }
  return { width: w, height: h, print, pbr, emboss, inks: [...seen], cut, crease };
}

/** the finish named on a page marker ("Gloss"/"Matt" + "Varnish"/"Laminated"), as in the brochure */
export function finishFromText(text: string): string | null {
  const lines = new Set(text.split(/\n/).map((l) => l.trim().toLowerCase()));
  const kind = lines.has("laminated") ? "laminated" : lines.has("varnish") ? "varnish" : null;
  const look = lines.has("gloss") ? "gloss" : lines.has("matt") || lines.has("mat") ? "matt" : null;
  return kind && look ? `${look}-${kind}` : null;
}
