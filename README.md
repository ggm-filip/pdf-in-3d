# PDF in 3D

Source code of the "PDF in 3D" tool on the website of Grafische Groep Matthys (`/pdf-in-3d/`).

A PDF is read in the browser with [MuPDF.js](https://mupdf.com) 1.28.6 (AGPL-3.0). Every page is split into
print (CMYK), foil, gold and SpotUV varnish by spot ink name; die lines (cut and crease) are collected as vectors.
The result is shown as a 3D brochure, or, when the PDF has a dieline, as a sheet that folds itself (three.js).
Nothing is uploaded: everything runs in the visitor's browser.

## Files

- `lib/pdf3d/separate.ts`: renders a page per pass through a filter device (print, varnish, gold, foil) and collects die lines.
- `lib/pdf3d/worker.ts`: the Web Worker that loads MuPDF and renders the pages.
- `lib/pdf3d/fold.ts`: finds the panels and hinges in the dieline and builds the fold tree.
- `lib/pdf3d/copy-mupdf.mjs`: copies MuPDF's browser files into `public/mupdf/` (postinstall).
- `components/PdfTool.tsx`, `FoldViewer.tsx`, `BrochureViewer.tsx`, `Icons.tsx`: the React components (Next.js, React 19, three.js, gsap).
- `lib/tools.ts`: the texts of the tools on the site.
- `app/pdf3d.css`: the styles.

These files are part of a Next.js website; they are published here as the corresponding source under the AGPL.

## Licence

GNU Affero General Public License v3.0, see `LICENSE`.
