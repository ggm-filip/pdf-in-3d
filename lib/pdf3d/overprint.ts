/**
 * Which spot inks of a page are printed in overprint (or with a blend mode such as Multiply), read from the PDF itself.
 *
 * MuPDF.js's device calls say which colour an object has, but not whether it overprints. So the page's content stream
 * (and the forms it uses) is read here: every object painted in a spot ink is counted as overprint or knockout,
 * by the graphics state in force (ExtGState /op, /OP and /BM). An ink used mostly in knockout knocks out what lies
 * under it, like on the press: a foil that does not overprint leaves no print under it.
 */
import type * as Mu from "mupdf";

type Obj = Mu.PDFObject;
type State = { opF: boolean; opS: boolean; blend: boolean; fill: string[] | null; stroke: string[] | null; tf: number[]; ts: number[]; tr: number };
export type InkUse = Map<string, { op: number; ko: number }>;

const DEVICE = new Set(["DeviceGray", "DeviceRGB", "DeviceCMYK", "G", "RGB", "CMYK", "Pattern"]);

/** the ink names of a colour space object: Separation, DeviceN, or the base of an Indexed space */
function inksOf(cs: Obj | null): string[] | null {
  if (!cs) return null;
  cs = cs.resolve();
  if (!cs.isArray()) return null;
  const kind = cs.get(0).resolve();
  const k = kind.isName() ? kind.asName() : "";
  if (k === "Separation") { const n = cs.get(1).resolve(); return n.isName() ? [n.asName()] : null; }
  if (k === "DeviceN") {
    const out: string[] = [];
    cs.get(1).resolve().forEach((v: Obj) => { const n = v.resolve(); if (n.isName()) out.push(n.asName()); });
    return out;
  }
  if (k === "Indexed" || k === "I") return inksOf(cs.get(1));
  return null;
}

const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;

/** reads one content stream; calls op(name, operands) for every operator */
function lex(src: string, op: (name: string, args: (string | number)[]) => void) {
  let i = 0;
  const n = src.length;
  let args: (string | number)[] = [];
  while (i < n) {
    const c = src.charCodeAt(i);
    if (isSpace(c)) { i++; continue; }
    const ch = src[i];
    if (ch === "%") { while (i < n && src[i] !== "\n" && src[i] !== "\r") i++; continue; }
    if (ch === "/") {
      let j = i + 1;
      while (j < n && !isSpace(src.charCodeAt(j)) && !DELIM.has(src[j])) j++;
      args.push("/" + src.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
      i = j; continue;
    }
    if (ch === "(") { // string, with nesting and escapes
      let depth = 1; i++;
      while (i < n && depth) { const d = src[i]; if (d === "\\") i++; else if (d === "(") depth++; else if (d === ")") depth--; i++; }
      args.push("()"); continue;
    }
    if (ch === "<" && src[i + 1] === "<") { args.push("<<"); i += 2; continue; }
    if (ch === ">" && src[i + 1] === ">") { args.push(">>"); i += 2; continue; }
    if (ch === "<") { while (i < n && src[i] !== ">") i++; i++; args.push("<>"); continue; }
    if (ch === "[" || ch === "]" || ch === "{" || ch === "}") { args.push(ch); i++; continue; }
    let j = i;
    while (j < n && !isSpace(src.charCodeAt(j)) && !DELIM.has(src[j])) j++;
    if (j === i) { i++; continue; }
    const tok = src.slice(i, j);
    i = j;
    const num = Number(tok);
    if (!Number.isNaN(num) && /^[+\-.\d]/.test(tok)) { args.push(num); continue; }
    if (tok === "true" || tok === "false" || tok === "null") { args.push(tok); continue; }
    if (tok === "ID") { // inline image data: skip to EI
      const m = /\sEI(?=[\s]|$)/g;
      m.lastIndex = i + 1;
      const r = m.exec(src);
      i = r ? r.index + 3 : n;
      args = []; continue;
    }
    op(tok, args);
    args = [];
  }
}

export function inkUse(page: Mu.Page): InkUse {
  const use: InkUse = new Map();
  const obj = (page as unknown as { getObject?: () => Obj }).getObject?.();
  if (!obj) return use;
  const count = (inks: string[] | null, tints: number[], over: boolean) => {
    if (!inks) return;
    inks.forEach((name, k) => {
      const t = tints.length ? tints[k] : 1; // a new spot colour space starts at full tint
      if (!(t > 0)) return; // tint 0 paints nothing
      const u = use.get(name) ?? { op: 0, ko: 0 };
      if (over) u.op++; else u.ko++;
      use.set(name, u);
    });
  };
  const run = (content: string, res: Obj | null, start: State, depth: number) => {
    let st: State = { ...start };
    const stack: State[] = [];
    const lookup = (cat: string, name: string): Obj | null => {
      if (!res) return null;
      const d = res.get(cat);
      if (!d || d.isNull()) return null;
      const o = d.get(name);
      return o && !o.isNull() ? o : null;
    };
    const space = (arg: string | number | undefined) => {
      if (typeof arg !== "string" || !arg.startsWith("/")) return null;
      const nm = arg.slice(1);
      if (DEVICE.has(nm)) return null;
      return inksOf(lookup("ColorSpace", nm));
    };
    const tints = (args: (string | number)[]) => args.filter((a): a is number => typeof a === "number");
    const fill = () => count(st.fill, st.tf, st.opF || st.blend);
    const stroke = () => count(st.stroke, st.ts, st.opS || st.blend);
    lex(content, (op, a) => {
      switch (op) {
        case "q": stack.push({ ...st }); break;
        case "Q": st = stack.pop() ?? st; break;
        case "gs": {
          const g = typeof a[0] === "string" ? lookup("ExtGState", a[0].slice(1))?.resolve() : null;
          if (!g) break;
          const OP = g.get("OP"), opf = g.get("op"), bm = g.get("BM");
          if (OP && OP.isBoolean()) { st.opS = OP.asBoolean(); if (!(opf && opf.isBoolean())) st.opF = st.opS; }
          if (opf && opf.isBoolean()) st.opF = opf.asBoolean();
          if (bm && !bm.isNull()) {
            const b = bm.resolve();
            const name = b.isName() ? b.asName() : b.isArray() ? b.get(0).resolve().asName() : "Normal";
            st.blend = name !== "Normal" && name !== "Compatible";
          }
          break;
        }
        case "cs": st.fill = space(a[0]); st.tf = []; break;
        case "CS": st.stroke = space(a[0]); st.ts = []; break;
        case "sc": case "scn": st.tf = tints(a); break;
        case "SC": case "SCN": st.ts = tints(a); break;
        case "g": case "rg": case "k": st.fill = null; break;
        case "G": case "RG": case "K": st.stroke = null; break;
        case "Tr": st.tr = typeof a[0] === "number" ? a[0] : 0; break;
        case "f": case "F": case "f*": fill(); break;
        case "S": case "s": stroke(); break;
        case "B": case "B*": case "b": case "b*": fill(); stroke(); break;
        case "Tj": case "TJ": case "'": case "\"":
          if (st.tr === 0 || st.tr === 2 || st.tr === 4 || st.tr === 6) fill();
          if (st.tr === 1 || st.tr === 2 || st.tr === 5 || st.tr === 6) stroke();
          break;
        case "Do": {
          const nm = typeof a[0] === "string" ? a[0].slice(1) : "";
          const xo = lookup("XObject", nm);
          if (!xo) break;
          const x = xo.resolve();
          const sub = x.get("Subtype");
          const kind = sub && sub.isName() ? sub.asName() : "";
          if (kind === "Image") {
            const mask = x.get("ImageMask");
            if (mask && mask.isBoolean() && mask.asBoolean()) fill();
            else { const inks = inksOf(x.get("ColorSpace")); if (inks) count(inks, inks.map(() => 1), st.opF || st.blend); }
          } else if (kind === "Form" && depth < 12) {
            const r = x.get("Resources");
            let text = "";
            try { text = xo.readStream().asString(); } catch { break; }
            // a transparency group with its own blend mode is handled by its gs; the form inherits the state
            run(text, r && !r.isNull() ? r.resolve() : res, st, depth + 1);
          }
          break;
        }
      }
    });
  };
  try {
    const res = obj.getInheritable ? obj.getInheritable("Resources") : obj.get("Resources");
    const c = obj.get("Contents");
    if (!c || c.isNull()) return use;
    const cr = c.resolve();
    let text = "";
    // a stream is read through its reference (resolving it gives only its dictionary)
    if (cr.isArray()) cr.forEach((s: Obj) => { text += s.readStream().asString() + "\n"; });
    else text = c.readStream().asString();
    run(text, res && !res.isNull() ? res.resolve() : null, { opF: false, opS: false, blend: false, fill: null, stroke: null, tf: [], ts: [], tr: 0 }, 0);
  } catch { /* an unreadable page: no knockout information */ }
  return use;
}

/** the inks that knock out what lies under them: used mostly without overprint or blend mode */
export function knockoutInks(use: InkUse): Set<string> {
  const out = new Set<string>();
  use.forEach((u, name) => { if (u.ko > 0 && u.ko >= u.op) out.add(name); });
  return out;
}
