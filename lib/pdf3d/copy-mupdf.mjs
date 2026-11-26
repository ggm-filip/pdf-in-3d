/**
 * Copies MuPDF.js (and its wasm) from node_modules to public/mupdf/, so the PDF-in-3D tool's worker can load it
 * as a plain file, untouched by the bundler. Runs after every `npm install` (also on Vercel).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// lives in lib/pdf3d/ (not in scripts/, which Vercel leaves out of the build)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const from = path.join(root, "node_modules/mupdf/dist");
const to = path.join(root, "public/mupdf");
if (!fs.existsSync(from)) process.exit(0);
fs.mkdirSync(to, { recursive: true });
for (const f of ["mupdf.js", "mupdf-wasm.js", "mupdf-wasm.wasm"]) fs.copyFileSync(path.join(from, f), path.join(to, f));
fs.copyFileSync(path.join(root, "node_modules/mupdf/LICENSE"), path.join(to, "LICENSE.txt"));
console.log("copied MuPDF to public/mupdf");
