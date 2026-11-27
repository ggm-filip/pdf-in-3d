"use client";
import { useEffect, useState } from "react";
import { TUNE_GROUPS, TUNE_SPECS, resetTune, tune, type TuneKey } from "./tuning";

/*
 * The easter egg: every setting of the 3D view on sliders. It hides behind a registration mark (the little cross
 * printers use to line up the inks) in the corner of the 3D view; typing "cmyk" opens it too.
 * The mark first wobbles out of register when you hover it, and snaps back into register when it opens.
 */

const Mark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {["#00a0e0", "#e6007e", "#ffd800", "#1d1d1d"].map((c, i) => (
      <g key={c} stroke={c} className={`reg reg-${i}`} fill="none" strokeWidth="1.3">
        <circle cx="12" cy="12" r="5.5" />
        <path d="M12 2v20M2 12h20" />
      </g>
    ))}
  </svg>
);

export default function TunePanel() {
  const [open, setOpen] = useState(false);
  const [, redraw] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let typed = "";
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "Escape") { setOpen(false); return; }
      typed = (typed + e.key.toLowerCase()).slice(-4);
      if (typed === "cmyk") { setOpen((o) => !o); typed = ""; }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const set = (k: TuneKey, v: number) => { tune[k] = v; redraw((n) => n + 1); };
  const copy = async () => {
    const text = TUNE_SPECS.map((s) => `${s.label}: ${tune[s.key]}${s.unit}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* no clipboard */ }
  };
  const changed = TUNE_SPECS.some((s) => tune[s.key] !== s.def);

  return (
    <>
      <button type="button" className={`tune-mark${open ? " on" : ""}`} aria-label="Drukkerskamer" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Mark />
      </button>
      {open && (
        <div className="tune-panel" role="dialog" aria-label="Drukkerskamer">
          <div className="tune-head">
            <b>Drukkerskamer</b>
            <button type="button" className="tune-x" aria-label="Sluiten" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="tune-body">
            {TUNE_GROUPS.map((g, gi) => (
              <fieldset key={g}>
                <legend>{g}</legend>
                {TUNE_SPECS.filter((s) => s.group === gi).map((s) => (
                  <label key={s.key} className={tune[s.key] !== s.def ? "moved" : ""}>
                    <span>{s.label}</span>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={tune[s.key]} onChange={(e) => set(s.key, Number(e.target.value))} onDoubleClick={() => set(s.key, s.def)} />
                    <output>{s.unit === "%" ? `${tune[s.key]}%` : tune[s.key].toFixed(2)}</output>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="tune-foot">
            <button type="button" className="chip" disabled={!changed} onClick={() => { resetTune(); redraw((n) => n + 1); }}>Standaard</button>
            <button type="button" className="chip" onClick={copy}>{copied ? "Gekopieerd" : "Kopieer waarden"}</button>
          </div>
        </div>
      )}
    </>
  );
}
