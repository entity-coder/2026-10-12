# SnapConvert — bulk image compressor & resizer

Drop in a batch of photos, get shrunken copies back. Built for the everyday
chore of shrinking images before uploading them to forms, portfolios, or
WhatsApp — without wrecking quality.

**100% client-side.** Open `index.html` in any modern browser. No server, no
signup, no uploads — your photos never leave the tab.

## Features

- **Batch input** — drag & drop a whole folder's worth of images, or browse. Exact duplicates (same name + size + timestamp) are skipped.
- **Per-file before → after readout** — each card shows original vs. converted size, dimensions (e.g. `4032×3024 → 1920×1440`), and a saved/grew % pill.
- **Quality slider** (10–100%) for JPEG/WebP; the slider is ignored for PNG (lossless — the UI says so).
- **Max-dimension slider** (480–4000 px) — caps the long edge, keeps aspect ratio, never upscales.
- **Format picker** — JPEG / PNG / WebP. WebP is auto-detected and greyed out if the browser can't encode it.
- **One-click ZIP** of the whole batch (`snapconvert-YYYYMMDDHHMM.zip`), plus per-file download buttons.
- **Live re-conversion** — dragging a slider re-processes the batch (debounced, 3-at-a-time so a 50-photo batch doesn't spike memory).
- **Honest numbers** — if a PNG conversion comes out *bigger* than the original, the card says so (+% pill) instead of hiding it.
- EXIF orientation is respected (`createImageBitmap` with `imageOrientation: "from-image"`, with an `<img>` fallback); transparent images get a white backdrop when converting to JPEG (JPEG has no alpha channel).

## How to run

1. Download/clone this repo.
2. Open `index.html` in Chrome, Edge, or Firefox.
3. Drop images in, tweak the sliders, hit **Download all as ZIP**.

Works offline after the first load — `lib/jszip.min.js` (JSZip 3.10.1, MIT) is
bundled in the repo, so no CDN is needed.

## File map

| File | What it does |
|---|---|
| `index.html` | Page structure: drop zone, settings panel, summary bar, results grid |
| `styles.css` | Dark photo-lab theme, responsive down to phones |
| `app.js` | All logic: decode → resize on `<canvas>` → `toBlob()` encode → ZIP |
| `lib/jszip.min.js` | Bundled JSZip 3.10.1 (MIT) for ZIP generation |

## Privacy note

Everything runs in the browser. The canvas pipeline also strips metadata
(EXIF, GPS) from outputs — good for privacy, but it means the shrunken
copies won't carry the original's camera/location data.

## Interview notes

**What it is:** A single-page, dependency-free (except bundled JSZip) tool that
batch-resizes and re-encodes images entirely in the browser.

**Why client-side canvas instead of a server?** Three reasons: (1) privacy —
people compress personal photos, so "never uploads" is a real selling point;
(2) cost — no server, no bandwidth bills, no API keys, it runs forever as a
static page; (3) speed — no round trip per image. The trade-off is that it's
limited to what the browser's encoders can do: JPEG/PNG/WebP only, no AVIF
encoding on most browsers, no HEIC input.

**Why bundle JSZip instead of a CDN?** One bundled 97 KB file means the page
works fully offline (open the file, done). A CDN link would be one less file
in the repo, but breaks the "no network needed" promise. Kept the MIT license
header intact in `lib/jszip.min.js`.

**Key technical decisions:**
- `createImageBitmap(file, { imageOrientation: "from-image" })` for decoding —
  phone photos with EXIF rotation come out the right way up, which naive
  `<img>`-based resizers get wrong. The `<img>` fallback keeps it working where
  `createImageBitmap` is missing.
- Never upscale: if the image is already under the max dimension it's passed
  through at original resolution (only re-encoded).
- Concurrency capped at 3 simultaneous conversions so large batches don't
  balloon memory; cards render progressively as each file finishes.
- White backdrop fill before JPEG encode — JPEG has no alpha, and without the
  fill transparent PNGs would come out with black backgrounds.
- The quality slider is deliberately a no-op for PNG, and the UI says so,
  because a quality slider that silently does nothing is a worse lie than a
  disabled-looking control.

**Trade-offs / limitations:**
- Output metadata is stripped (see Privacy note) — photographers who want EXIF
  preserved would need a different tool.
- No folder structure in the ZIP — flat file list, with automatic name
  de-duping (`photo-converted-2.jpg`) when two inputs share a base name.
- Animated GIFs: only the first frame is kept (canvas rasterizes one frame).
- Very large source images (e.g. 50 MP panoramas) can still be slow/memory-heavy
  on low-end phones — canvas size limits are browser-dependent.

**How I'd extend it:** preset buttons ("WhatsApp-friendly 1600px", "Portfolio
2048px WebP"), per-file format overrides, drag-to-reorder, a PWA manifest +
service worker so it installs like an app, and AVIF output where the browser
encoder supports it.
