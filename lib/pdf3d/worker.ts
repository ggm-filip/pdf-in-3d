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
  type: "page"; index: number; width: number; height: number; map: Blob; pbr: Blob;
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
      rgba[o] = src[i]; rgba[o + 1] = src[i + 1]; rgba[o + 2] = src[i + 2]; rgba[o + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.convertToBlob(type === "image/webp" ? { type, quality: 0.92 } : { type });
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
        r = renderPage(mu, page, e.data.maxSide, false);
      }
      let finish: string | null = null;
      try { finish = finishFromText(page.toStructuredText("").asText()); } catch { /* no text */ }
      const [map, pbr] = await Promise.all([toBlob(r.print, "image/webp"), toBlob(r.pbr, "image/png")]);
      r.print.destroy();
      r.pbr.destroy();
      page.destroy();
      post({ type: "page", index: i, width: r.width, height: r.height, map, pbr, inks: r.inks, cut: r.cut, crease: r.crease, finish });
    }
    doc.destroy();
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
