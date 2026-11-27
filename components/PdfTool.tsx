"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BrochureViewer, { FINISHES, type BrochureSource, type BrochureText } from "./BrochureViewer";
import FoldViewer from "./FoldViewer";
import { Arrow } from "./Icons";
import { LAMP_DEFAULT, LAMP_KINDS, lampCss, type LampSettings } from "./lamp";
import { buildFold, type Fold } from "@/lib/pdf3d/fold";
import { inkOf } from "@/lib/pdf3d/separate";
import type { PageMsg, WorkerIn, WorkerOut } from "@/lib/pdf3d/worker";
import type { Pdf3dText } from "@/lib/tools";

/*
 * PDF in 3D: drop a PDF, see it as a 3D brochure (leaf through) or, when it has a die line, as a sheet that
 * folds itself. Foil, gold foil, SpotUV, cut and crease lines are read from the spot colours (lib/pdf3d/separate.ts),
 * in a worker, in the browser: the file is never uploaded.
 */

type Page = PageMsg & { mapUrl: string; pbrUrl: string; embossUrl: string | null; holoUrl: string | null };
type Result = { pages: Page[]; total: number; fold: { index: number; fold: Fold; back: number | null } | null };

const MAX_PAGES = 60;

const Bulb = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />
  </svg>
);

/** the lamp under the pointer: which kind, and how strong (on the 3D view, top left) */
function LampPicker({ t, value, onChange }: { t: Pdf3dText["lamp"]; value: LampSettings; onChange: (v: LampSettings) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pct = Math.round(value.power * 100);
  return (
    <div ref={box} className={`lamp-pick${open ? " open" : ""}`}>
      <button type="button" className="lamp-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`lamp-swatch${value.kind === "off" ? " off" : ""}`} style={{ ["--lamp" as string]: lampCss(value.kind) }}><Bulb /></span>
        <span>{t.label}<span className="lamp-now">{t.kinds[value.kind]}</span></span>
      </button>
      {open && (
        <div className="lamp-panel" role="group" aria-label={t.label}>
          <div className="lamp-kinds">
            {LAMP_KINDS.map((k) => (
              <button key={k} type="button" className={value.kind === k ? "on" : ""} aria-pressed={value.kind === k} onClick={() => onChange({ ...value, kind: k })}>
                <span className={`lamp-swatch${k === "off" ? " off" : ""}`} style={{ ["--lamp" as string]: lampCss(k) }} />
                {t.kinds[k]}
              </button>
            ))}
          </div>
          <label className="pdf3d-slider lamp-power" style={{ ["--p" as string]: `${pct}%` }}>
            <span>{t.power}</span>
            <input type="range" min={5} max={100} value={Math.max(5, pct)} disabled={value.kind === "off"} onChange={(e) => onChange({ ...value, power: Number(e.target.value) / 100 })} />
          </label>
        </div>
      )}
    </div>
  );
}

export default function PdfTool({ t, book }: { t: Pdf3dText; book: BrochureText }) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [count, setCount] = useState({ n: 0, total: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const [mode, setMode] = useState<"fold" | "book">("fold");
  const [finish, setFinish] = useState<string>("auto");
  const [over, setOver] = useState(false);
  const [lamp, setLamp] = useState<LampSettings>(LAMP_DEFAULT);
  const [foldSlot, setFoldSlot] = useState<HTMLSpanElement | null>(null);

  // once a PDF is shown, the page title goes away (it only takes room above the 3D view)
  useEffect(() => {
    const on = phase === "done";
    document.documentElement.classList.toggle("pdf3d-open", on);
    if (on) window.scrollTo({ top: 0 });
    return () => document.documentElement.classList.remove("pdf3d-open");
  }, [phase]);
  const worker = useRef<Worker | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // a result's images are given back when the result is replaced; a running worker stops when the page closes
  useEffect(() => () => result?.pages.forEach((p) => { URL.revokeObjectURL(p.mapUrl); URL.revokeObjectURL(p.pbrUrl); if (p.embossUrl) URL.revokeObjectURL(p.embossUrl); if (p.holoUrl) URL.revokeObjectURL(p.holoUrl); }), [result]);
  useEffect(() => () => worker.current?.terminate(), []);

  const open = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setPhase("error"); setMessage(t.notPdf); return; }
    worker.current?.terminate();
    worker.current = null;
    setResult(null);
    setPhase("busy");
    setCount({ n: 0, total: 0 });
    const buf = await file.arrayBuffer();
    const w = new Worker(new URL("../lib/pdf3d/worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const pages: Page[] = [];
    let total = 0;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "info") { total = m.total; setCount({ n: 0, total: m.pages }); }
      else if (m.type === "page") {
        pages[m.index] = { ...m, mapUrl: URL.createObjectURL(m.map), pbrUrl: URL.createObjectURL(m.pbr), embossUrl: m.emboss ? URL.createObjectURL(m.emboss) : null, holoUrl: m.holo ? URL.createObjectURL(m.holo) : null };
        setCount((c) => ({ ...c, n: m.index + 1 }));
      } else if (m.type === "done") {
        w.terminate();
        worker.current = null;
        // the first page with crease lines can be folded; the next page of the same size is its back
        const fi = pages.findIndex((p) => p.crease.length > 0);
        let fold: Result["fold"] = null;
        if (fi >= 0) {
          const p = pages[fi];
          const f = buildFold(p.width, p.height, p.cut, p.crease);
          const nb = pages[fi + 1];
          const back = nb && Math.abs(nb.width - p.width) <= 2 && Math.abs(nb.height - p.height) <= 2 ? fi + 1 : null;
          if (f) fold = { index: fi, fold: f, back };
        }
        setResult({ pages, total, fold });
        setMode(fold ? "fold" : "book");
        setPhase("done");
      } else if (m.type === "error") {
        w.terminate();
        worker.current = null;
        setPhase("error");
        setMessage(t.failed);
      }
    };
    w.onerror = () => { setPhase("error"); setMessage(t.failed); };
    const small = Math.min(screen.width, screen.height) < 700;
    const msg: WorkerIn = { file: buf, maxSide: small ? 1024 : 2048, maxPages: MAX_PAGES };
    w.postMessage(msg, [buf]);
  };

  const finishFor = (p: Page | undefined) => (finish === "auto" ? p?.finish ?? null : finish);
  const finishes = useMemo(() => result?.pages.map((p) => finishFor(p)) ?? [], [result, finish]); // eslint-disable-line react-hooks/exhaustive-deps
  // the pages for the brochure view; stable per result, so changing the finish does not rebuild the scene
  const pagesSource = useMemo(() => {
    if (!result) return null;
    const ps = result.pages;
    const first = ps[0];
    return {
      pages: ps.length,
      aspect: first.height / first.width,
      map: (p: number) => ps[p - 1]?.mapUrl ?? null,
      pbr: (p: number) => ps[p - 1]?.pbrUrl ?? null,
      emboss: (p: number) => ps[p - 1]?.embossUrl ?? null,
      holo: (p: number) => ps[p - 1]?.holoUrl ?? null,
    };
  }, [result]);
  const source: BrochureSource | null = pagesSource ? { ...pagesSource, finishes } : null;
  const back = useMemo(() => {
    const b = result?.fold?.back;
    return b != null && result ? { map: result.pages[b].mapUrl, pbr: result.pages[b].pbrUrl, emboss: result.pages[b].embossUrl, holo: result.pages[b].holoUrl } : null;
  }, [result]);

  // what was found, by kind of ink
  const found = useMemo(() => {
    if (!result) return [];
    const names = new Set<string>();
    result.pages.forEach((p) => p.inks.forEach((n) => names.add(n)));
    const label: Record<string, string> = { foil: "folie", gold: "goudfolie", holo: "holografische folie", varnish: "SpotUV", emboss: "preeg", cut: "kapvorm", crease: "rillijnen" };
    return [...names].map((n) => `${n} (${label[inkOf(n) ?? ""] ?? "?"})`);
  }, [result]);

  return (
    <section className="section first brochure3d pdf3d">
      <div className="wrap">
        {phase !== "done" && (
          <div className="pdf3d-start">
            <label
              className={`pdf3d-drop${over ? " over" : ""}${phase === "busy" ? " busy" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && phase !== "busy") open(f); }}
            >
              <input ref={input} type="file" accept="application/pdf,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ""; }} disabled={phase === "busy"} />
              {phase === "busy" ? (
                <>
                  <strong>{t.reading}</strong>
                  {count.total > 0 && <span>{t.page} {count.n} {t.of} {count.total}</span>}
                  <span className="pdf3d-progress"><i style={{ width: `${count.total ? (count.n / count.total) * 100 : 4}%` }} /></span>
                </>
              ) : (
                <>
                  <strong>{t.drop}</strong>
                  <span className="pdf3d-choose">{t.choose}</span>
                </>
              )}
            </label>
            {phase === "error" && <p className="pdf3d-error" role="alert">{message}</p>}
            <p className="pdf3d-note">{t.privacy}</p>
            <p className="pdf3d-note">{t.names}</p>
          </div>
        )}

        {phase === "done" && result && source && (
          <>
            <div className="pdf3d-bar">
              {result.fold && (
                <div className="chips pdf3d-tabs" role="tablist">
                  <button type="button" role="tab" className={mode === "fold" ? "on" : ""} aria-selected={mode === "fold"} onClick={() => setMode("fold")}>{t.modeFold}</button>
                  <button type="button" role="tab" className={mode === "book" ? "on" : ""} aria-selected={mode === "book"} onClick={() => setMode("book")}>{t.modeBook}</button>
                </div>
              )}
              <span ref={setFoldSlot} className="pdf3d-foldslot" />
              <label className="pdf3d-select">
                <span>{t.finish}</span>
                <select value={finish} onChange={(e) => setFinish(e.target.value)}>
                  <option value="auto">{t.finishAuto}</option>
                  {Object.keys(FINISHES).map((k) => <option key={k} value={k}>{t.finishes[k] ?? k}</option>)}
                </select>
              </label>
              <LampPicker t={t.lamp} value={lamp} onChange={setLamp} />
              <button type="button" className="btn pdf3d-other" onClick={() => { setResult(null); setPhase("idle"); setTimeout(() => input.current?.click(), 0); }}>{t.other}<span className="arr"><Arrow /></span></button>
            </div>
            <p className="pdf3d-found">
              {found.length ? `${t.found}: ${found.join(", ")}` : t.nothing}
              {result.total > result.pages.length && <> {t.tooMany.replace("{n}", String(result.pages.length))}</>}
            </p>
            <div className="pdf3d-view">
            {mode === "fold" && result.fold ? (
              <FoldViewer
                t={t.fold}
                map={result.pages[result.fold.index].mapUrl}
                pbr={result.pages[result.fold.index].pbrUrl}
                emboss={result.pages[result.fold.index].embossUrl}
                holo={result.pages[result.fold.index].holoUrl}
                mm={result.pages[result.fold.index].mm}
                back={back}
                width={result.pages[result.fold.index].width}
                height={result.pages[result.fold.index].height}
                fold={result.fold.fold}
                finish={finishFor(result.pages[result.fold.index])}
                lamp={lamp}
                controls={foldSlot}
              />
            ) : (
              <BrochureViewer t={book} source={source} bare lamp={lamp} controls={foldSlot} />
            )}
            </div>
          </>
        )}
        <p className="pdf3d-license">{t.license} <a href={t.sourceUrl} target="_blank" rel="noopener">{t.source}</a></p>
      </div>
    </section>
  );
}
