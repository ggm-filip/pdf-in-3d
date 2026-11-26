/// <reference lib="webworker" />
/**
 * Worker for the PDF-in-3D tool: reads the uploaded PDF with MuPDF (from /mupdf/, copied there by
 * lib/pdf3d/copy-mupdf.mjs) and sends back, page by page, the print and the foil/SpotUV map as image blobs,
 * plus the cut and crease lines. The PDF never leaves the browser.
 */
import type * as Mu from "mupdf";
import { finishFromText, initShadeSpace, renderPage, type Seg } from "./separate";

export type WorkerIn = { file: ArrayBuffer; maxSide: number; maxPages: number };
export type PageMsg = {
  type: "page"; index: number; width: number; height: number; map: Blob; pbr: Blob; emboss: Blob | null;
  inks: string[]; cut: Seg[]; crease: Seg[]; finish: string | null;
};
export type WorkerOut =
  | { type: "info"; pages: number; total: number }
  | PageMsg
  | { type: "done" }
  | { type: "error"; message: string };

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function toBlob(pix: Mu.Pixmap, type: string): Promise<Blob> {
  const w = pix.getWidth(), h = pix.getHeight(), n = pix.getNumberOfComponents(), st = pix.getStride();
  const src = pix.getPixels();
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * st + x * n, o = (y * w + x) * 4;
      if (n === 1) rgba[o] = rgba[o + 1] = rgba[o + 2] = src[i];
      else { rgba[o] = src[i]; rgba[o + 1] = src[i + 1]; rgba[o + 2] = src[i + 2]; }
      rgba[o + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.convertToBlob(type === "image/webp" ? { type, quality: 0.92 } : { type });
}

/** softens a grey mask (box blur, twice), so an embossing gets sloped edges like a real relief */
function soften(pix: Mu.Pixmap, r: number) {
  const w = pix.getWidth(), h = pix.getHeight(), st = pix.getStride();
  const px = pix.getPixels();
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = px[y * st + x];
  const pass = (src: Float32Array, dst: Float32Array, dx: number, dy: number) => {
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k * dx)), yy = Math.min(h - 1, Math.max(0, y + k * dy));
        sum += src[yy * w + xx];
      }
      dst[y * w + x] = sum / n;
    }
  };
  for (let i = 0; i < 2; i++) { pass(a, b, 1, 0); pass(b, a, 0, 1); }
  const out = pix.getPixels(); // fetched again: wasm memory may have moved
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * st + x] = a[y * w + x];
}

let mupdf: typeof Mu | null = null;

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    if (!mupdf) {
      // mupdf.js keeps its wasm module here, so separate.ts can read a gradient's colour space
      (globalThis as unknown as { $libmupdf_wasm_Module: object }).$libmupdf_wasm_Module = {};
      const url = "/mupdf/mupdf.js";
      mupdf = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as typeof Mu;
      initShadeSpace(mupdf);
    }
    const mu = mupdf;
    const doc = mu.Document.openDocument(e.data.file, "application/pdf");
    const total = doc.countPages();
    const pages = Math.min(total, e.data.maxPages);
    post({ type: "info", pages, total });
    for (let i = 0; i < pages; i++) {
      const page = doc.loadPage(i);
      let r = renderPage(mu, page, e.data.maxSide);
      // a dieline often runs on or past the trim edge: render such a page whole, so no flap is cut off
      if (r.cut.length > 0) {
        r.print.destroy();
        r.pbr.destroy();
        r.emboss?.destroy();
        r = renderPage(mu, page, e.data.maxSide, false);
      }
      let finish: string | null = null;
      try { finish = finishFromText(page.toStructuredText("").asText()); } catch { /* no text */ }
      if (r.emboss) soften(r.emboss, Math.max(1, Math.round(e.data.maxSide / 1000)));
      const [map, pbr, emboss] = await Promise.all([
        toBlob(r.print, "image/webp"), toBlob(r.pbr, "image/png"), r.emboss ? toBlob(r.emboss, "image/png") : Promise.resolve(null),
      ]);
      r.print.destroy();
      r.pbr.destroy();
      r.emboss?.destroy();
      page.destroy();
      post({ type: "page", index: i, width: r.width, height: r.height, map, pbr, emboss, inks: r.inks, cut: r.cut, crease: r.crease, finish });
    }
    doc.destroy();
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
