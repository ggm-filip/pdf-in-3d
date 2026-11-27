/*
 * The live settings of the PDF-in-3D tool, shared by both viewers and the pointer lamp.
 * The defaults are what everyone sees; the hidden "drukkerskamer" panel (the easter egg) changes them on the fly,
 * for this visit only. Every viewer reads them once per frame, so a slider works at once without a rebuild.
 */

export type TuneKey =
  | "foil" | "soft" | "holo" | "paper" | "ink" | "uv" | "coat"
  | "glint" | "pool" | "height" | "dim"
  | "key" | "env" | "exposure";

type Spec = { key: TuneKey; group: number; label: string; min: number; max: number; step: number; def: number; unit: "%" | "" };

// group: 0 = material, 1 = lamp, 2 = studio
export const TUNE_SPECS: Spec[] = [
  { key: "foil", group: 0, label: "Folie: glans", min: 0, max: 200, step: 5, def: 100, unit: "%" },
  { key: "soft", group: 0, label: "Folie: zachtheid (blur)", min: 0, max: 0.6, step: 0.01, def: 0.1, unit: "" },
  { key: "holo", group: 0, label: "Holografie: kleur", min: 0, max: 100, step: 5, def: 55, unit: "%" },
  { key: "paper", group: 0, label: "Helderheid druk", min: 40, max: 160, step: 5, def: 100, unit: "%" },
  { key: "ink", group: 0, label: "CMYK op folie", min: 0, max: 250, step: 5, def: 100, unit: "%" },
  { key: "uv", group: 0, label: "SpotUV", min: 0, max: 200, step: 5, def: 100, unit: "%" },
  { key: "coat", group: 0, label: "Lak / laminaat", min: 0, max: 200, step: 5, def: 100, unit: "%" },
  { key: "glint", group: 1, label: "Lamp: spiegeling", min: 0, max: 300, step: 5, def: 100, unit: "%" },
  { key: "pool", group: 1, label: "Lamp: lichtvlek", min: 0, max: 300, step: 5, def: 100, unit: "%" },
  { key: "height", group: 1, label: "Lamp: hoogte", min: 40, max: 250, step: 5, def: 100, unit: "%" },
  { key: "dim", group: 1, label: "Studio dimt mee", min: 0, max: 150, step: 5, def: 100, unit: "%" },
  { key: "key", group: 2, label: "Studiolamp", min: 0, max: 200, step: 5, def: 100, unit: "%" },
  { key: "env", group: 2, label: "Omgevingslicht", min: 0, max: 200, step: 5, def: 100, unit: "%" },
  { key: "exposure", group: 2, label: "Belichting", min: 50, max: 160, step: 5, def: 100, unit: "%" },
];

export const TUNE_GROUPS = ["Materiaal", "Lamp", "Studio"];

export const tune = Object.fromEntries(TUNE_SPECS.map((s) => [s.key, s.def])) as Record<TuneKey, number>;

/** a percentage setting as a factor (100% = 1) */
export const tf = (k: TuneKey) => tune[k] / 100;

export function resetTune() {
  TUNE_SPECS.forEach((s) => (tune[s.key] = s.def));
}
