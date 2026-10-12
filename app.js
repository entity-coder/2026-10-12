/* SnapConvert — all processing happens locally on a <canvas>.
 * No uploads, no servers: the images never leave this tab. */

"use strict";

const state = {
  items: [], // {id, file, name, origBytes, origW, origH, outBlob, outBytes, outW, outH, thumb, error}
  nextId: 1,
  converting: false,
};

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  browseBtn: document.getElementById("browseBtn"),
  quality: document.getElementById("quality"),
  qualityVal: document.getElementById("qualityVal"),
  maxdim: document.getElementById("maxdim"),
  maxdimVal: document.getElementById("maxdimVal"),
  summary: document.getElementById("summary"),
  sumFiles: document.getElementById("sumFiles"),
  sumOrig: document.getElementById("sumOrig"),
  sumOut: document.getElementById("sumOut"),
  sumSaved: document.getElementById("sumSaved"),
  zipBtn: document.getElementById("zipBtn"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  webpOpt: document.getElementById("webpOpt"),
};

/* ---------- helpers ---------- */

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "–";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

function getSettings() {
  const format = document.querySelector('input[name="format"]:checked').value;
  return {
    format,
    // quality is meaningless for PNG (lossless) — pass undefined so the encoder uses its default
    quality: format === "image/png" ? undefined : els.quality.value / 100,
    maxDim: Number(els.maxdim.value),
  };
}

function extFor(format) {
  return format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";
}

function outName(name, format) {
  const base = name.replace(/\.[a-z0-9]+$/i, "") || "image";
  return `${base}-converted.${extFor(format)}`;
}

function setStatus(msg) {
  els.status.textContent = msg;
}

// Detect WebP encode support; hide the option where it can't be encoded.
function webpSupported() {
  try {
    const c = document.createElement("canvas");
    return c.toDataURL("image/webp").indexOf("data:image/webp") === 0;
  } catch {
    return false;
  }
}

/* ---------- image pipeline ---------- */

// Decode with EXIF-orientation respected (createImageBitmap), falling back to <img>.
async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to <img> fallback */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("could not decode image"));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scaleDims(w, h, maxDim) {
  const longEdge = Math.max(w, h);
  if (longEdge <= maxDim) return { w, h }; // never upscale
  const k = maxDim / longEdge;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

function canvasToBlob(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encoder failed"))),
      format,
      quality
    );
  });
}

async function convertItem(item, settings) {
  const bitmap = await decodeImage(item.file);
  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const { w, h } = scaleDims(srcW, srcH, settings.maxDim);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // JPEG has no alpha: paint a white backdrop so transparent PNGs don't turn black.
    if (settings.format === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvasToBlob(canvas, settings.format, settings.quality);
    item.outBlob = blob;
    item.outBytes = blob.size;
    item.outW = w;
    item.outH = h;
    item.origW = item.origW || srcW;
    item.origH = item.origH || srcH;
    item.error = null;
  } finally {
    if (bitmap.close) bitmap.close(); // frees GPU memory for ImageBitmap
  }
}

/* ---------- batch flow ---------- */

async function convertAll() {
  if (state.converting || state.items.length === 0) return;
  state.converting = true;
  setStatus("Converting…");
  els.zipBtn.disabled = true;
  const settings = getSettings();

  // Cap concurrency so a 50-photo batch doesn't balloon memory.
  const queue = state.items.filter((i) => !i.error || true);
  const CONCURRENCY = 3;
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < queue.length) {
      const item = queue[idx++];
      try {
        await convertItem(item, settings);
      } catch (e) {
        item.error = e.message || "conversion failed";
        item.outBlob = null;
      }
      render(); // progressive update as each file finishes
    }
  });
  await Promise.all(workers);

  state.converting = false;
  els.zipBtn.disabled = false;
  const ok = state.items.filter((i) => !i.error && i.outBlob).length;
  const failed = state.items.length - ok;
  setStatus(
    failed === 0
      ? `Done — ${ok} file${ok === 1 ? "" : "s"} converted.`
      : `Done — ${ok} converted, ${failed} failed (see cards).`
  );
  render();
}

function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (files.length === 0) {
    setStatus("No image files in that drop — try PNG, JPEG, WebP, GIF…");
    return;
  }
  for (const file of files) {
    // Skip exact duplicates already in the batch (same name+size+timestamp).
    const dup = state.items.some(
      (i) =>
        i.file.name === file.name &&
        i.file.size === file.size &&
        i.file.lastModified === file.lastModified
    );
    if (dup) continue;
    state.items.push({
      id: state.nextId++,
      file,
      name: file.name,
      origBytes: file.size,
      origW: 0,
      origH: 0,
      outBlob: null,
      outBytes: 0,
      outW: 0,
      outH: 0,
      thumb: URL.createObjectURL(file),
      error: null,
    });
  }
  render();
  convertAll();
}

/* ---------- rendering ---------- */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function render() {
  const { items } = state;
  els.summary.classList.toggle("hidden", items.length === 0);

  const done = items.filter((i) => !i.error && i.outBlob);
  const totalOrig = items.reduce((a, i) => a + i.origBytes, 0);
  const totalOut = done.reduce((a, i) => a + i.outBytes, 0);
  const saved = totalOrig - totalOut;

  els.sumFiles.textContent = items.length;
  els.sumOrig.textContent = fmtBytes(totalOrig);
  els.sumOut.textContent = done.length ? fmtBytes(totalOut) : "–";
  if (done.length && totalOrig > 0) {
    const pct = Math.round((saved / totalOrig) * 100);
    els.sumSaved.textContent = (saved >= 0 ? "−" : "+") + fmtBytes(Math.abs(saved)) + ` (${pct}%)`;
    els.sumSaved.className = saved >= 0 ? "good" : "";
  } else {
    els.sumSaved.textContent = "–";
    els.sumSaved.className = "";
  }

  els.grid.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card";

    if (item.error || !item.outBlob) {
      card.innerHTML = `
        <img src="${item.thumb}" alt="" />
        <div class="card-body">
          <div class="card-name">${escapeHtml(item.name)}</div>
          <div class="card-sizes">${fmtBytes(item.origBytes)}</div>
          <div class="card-error">⚠ ${escapeHtml(item.error || "converting…")}</div>
        </div>`;
    } else {
      const delta = item.origBytes - item.outBytes;
      const pct = item.origBytes > 0 ? Math.round((delta / item.origBytes) * 100) : 0;
      const grew = delta < 0;
      card.innerHTML = `
        <img src="${item.thumb}" alt="" />
        <div class="card-body">
          <div class="card-name">${escapeHtml(item.name)}</div>
          <div class="card-dims">${item.origW}×${item.origH} → ${item.outW}×${item.outH}</div>
          <div class="card-sizes">
            ${fmtBytes(item.origBytes)} <span class="arrow">→</span> ${fmtBytes(item.outBytes)}
            <span class="pill ${grew ? "grew" : "saved"}">${grew ? "+" : "−"}${Math.abs(pct)}%</span>
          </div>
          <div class="card-actions"><button type="button" data-id="${item.id}">⬇ Download</button></div>
        </div>`;
    }
    els.grid.appendChild(card);
  }

  els.grid.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => downloadOne(Number(btn.dataset.id)));
  });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadOne(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item || !item.outBlob) return;
  downloadBlob(item.outBlob, outName(item.name, getSettings().format));
}

async function downloadZip() {
  const done = state.items.filter((i) => !i.error && i.outBlob);
  if (done.length === 0) return;
  if (typeof JSZip === "undefined") {
    setStatus("ZIP library failed to load — use the per-file download buttons instead.");
    return;
  }
  setStatus("Building ZIP…");
  els.zipBtn.disabled = true;
  try {
    const zip = new JSZip();
    const format = getSettings().format;
    const used = new Set();
    for (const item of done) {
      let name = outName(item.name, format);
      // De-dupe names inside the archive (foo.png + foo.jpg → same base name).
      let n = 1;
      while (used.has(name)) {
        name = outName(item.name, format).replace(/(\.[a-z0-9]+)$/i, `-${++n}$1`);
      }
      used.add(name);
      zip.file(name, item.outBlob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    downloadBlob(blob, `snapconvert-${stamp}.zip`);
    setStatus(`ZIP downloaded (${done.length} file${done.length === 1 ? "" : "s"}).`);
  } catch (e) {
    setStatus("ZIP build failed — use the per-file download buttons instead.");
  } finally {
    els.zipBtn.disabled = false;
  }
}

function clearAll() {
  for (const item of state.items) URL.revokeObjectURL(item.thumb);
  state.items = [];
  setStatus("");
  render();
}

/* ---------- events ---------- */

let reconvertTimer = null;
function scheduleReconvert() {
  clearTimeout(reconvertTimer);
  reconvertTimer = setTimeout(convertAll, 400); // debounce slider drags
}

els.dropzone.addEventListener("click", (e) => {
  if (e.target !== els.browseBtn) els.fileInput.click();
});
els.browseBtn.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener("change", (e) => {
  addFiles(e.target.files);
  e.target.value = ""; // allow re-adding the same file after clearing
});

["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  })
);
els.dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

els.quality.addEventListener("input", () => {
  els.qualityVal.textContent = els.quality.value + "%";
  scheduleReconvert();
});
els.maxdim.addEventListener("input", () => {
  els.maxdimVal.textContent = els.maxdim.value + " px";
  scheduleReconvert();
});
document.querySelectorAll('input[name="format"]').forEach((r) =>
  r.addEventListener("change", scheduleReconvert)
);

els.zipBtn.addEventListener("click", downloadZip);
els.clearBtn.addEventListener("click", clearAll);

/* ---------- init ---------- */

if (!webpSupported()) {
  els.webpOpt.classList.add("disabled");
  const radio = els.webpOpt.querySelector("input");
  radio.disabled = true;
  radio.title = "WebP encoding not supported by this browser";
}

render();
