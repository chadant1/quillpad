// Shared application state and small helpers used by every module.

export const app = {
  doc: null,
  artId: null,
  artName: 'Untitled',
  created: 0,

  // view: DOMMatrix mapping document px -> stage CSS px
  view: new DOMMatrix(),
  stage: null,
  sctx: null,
  dpr: 1,

  tool: 'brush', // brush | eraser | smudge | select | transform
  tools: {
    brush: { preset: 'studio-pen', size: 14, opacity: 1 },
    eraser: { preset: 'soft-airbrush', size: 60, opacity: 1 },
    smudge: { preset: 'soft-airbrush', size: 50, opacity: 0.7 },
  },
  color: { h: 210, s: 0.75, v: 0.35 },
  recentColors: [],

  symmetry: 'off', // off | vertical | horizontal | quadrant | radial
  grid: { on: false, size: 100 },
  viewFlipped: false,

  settings: {
    fingerDraw: 'auto', // auto (off once a stylus is seen) | on | off
    speedPressure: false,
    gestures: true,
    leftHanded: false,
    pressureGamma: 1,
    fillThreshold: 28,
    quickShape: true,
    useTilt: true,
  },

  // working canvases (document sized)
  compCanvas: null,
  strokeCanvas: null,
  previewCanvas: null,
  backup: null,

  compDirty: true,
  stroke: null,
  xf: null, // active transform
  adjust: null, // active adjustment
  lasso: null, // selection being drawn
  selectMode: 'freehand',
  uiHidden: false,
  penSeen: false,
  frames: [],
  editVersion: 0,

  // hooks wired in main.js
  render: null,
  onEdit: null,
};

let rafPending = false;
export function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (app.render) app.render();
  });
}

export function edited() {
  app.compDirty = true;
  app.editVersion++;
  if (app.onEdit) app.onEdit();
  requestRender();
}

let toastTimer = 0;
export function toast(msg, ms = 1300) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasToBlob(canvas, type = 'image/png', q) {
  return new Promise((res, rej) => {
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, q);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load image'));
    img.src = src;
  });
}

export async function blobToImage(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function viewScale() {
  const m = app.view;
  return Math.hypot(m.a, m.b);
}

export function screenToDoc(x, y) {
  const p = app.view.inverse().transformPoint(new DOMPoint(x, y));
  return { x: p.x, y: p.y };
}

export function docToScreen(x, y) {
  const p = app.view.transformPoint(new DOMPoint(x, y));
  return { x: p.x, y: p.y };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
