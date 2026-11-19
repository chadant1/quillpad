// Undo / redo. Pixel edits store before/after ImageData for the changed rectangle only.
import { app, edited, makeCanvas } from './state.js';

const MAX_BYTES = 220e6;

function entryBytes(e) {
  if (!e) return 0;
  if (e.kind === 'pixels') return (e.before ? e.before.data.length : 0) + (e.after ? e.after.data.length : 0);
  if (e.kind === 'multi') return e.entries.reduce((s, x) => s + entryBytes(x), 0);
  return 64;
}

export const history = {
  undoStack: [],
  redoStack: [],
  bytes: 0,

  push(e) {
    if (!e) return;
    for (const r of this.redoStack) this.bytes -= entryBytes(r);
    this.redoStack = [];
    this.undoStack.push(e);
    this.bytes += entryBytes(e);
    while (this.bytes > MAX_BYTES && this.undoStack.length > 1) {
      this.bytes -= entryBytes(this.undoStack.shift());
    }
    updateButtons();
  },

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    apply(e, 'before');
    this.redoStack.push(e);
    updateButtons();
    edited();
    return true;
  },

  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    apply(e, 'after');
    this.undoStack.push(e);
    updateButtons();
    edited();
    return true;
  },

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    updateButtons();
  },
};

function updateButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.classList.toggle('disabled', !history.undoStack.length);
  if (r) r.classList.toggle('disabled', !history.redoStack.length);
}

function apply(e, which) {
  const d = app.doc;
  switch (e.kind) {
    case 'pixels':
      e.layer.ctx.putImageData(e[which], e.x, e.y);
      e.layer.touch();
      break;
    case 'struct':
      restoreStruct(e[which]);
      break;
    case 'bg':
      d.bgColor = e[which].color;
      d.bgVisible = e[which].visible;
      break;
    case 'multi': {
      const list = which === 'before' ? [...e.entries].reverse() : e.entries;
      list.forEach((x) => apply(x, which));
      break;
    }
  }
}

export function snapStruct() {
  const d = app.doc;
  return { layers: d.layers.map((l) => ({ layer: l, props: l.props() })), active: d.activeIndex };
}

function restoreStruct(s) {
  const d = app.doc;
  d.layers = s.layers.map((x) => { x.layer.setProps(x.props); x.layer.touch(); return x.layer; });
  d.activeIndex = Math.max(0, Math.min(s.active, d.layers.length - 1));
}

// Run fn() that changes layer list / layer properties and record it.
export function structChange(fn) {
  const before = snapStruct();
  const r = fn();
  const after = snapStruct();
  const e = { kind: 'struct', before, after };
  return { entry: e, result: r };
}

export function recordStruct(fn) {
  const { entry, result } = structChange(fn);
  history.push(entry);
  edited();
  return result;
}

// ---- pixel edit helpers ----

export function ensureBackup() {
  const d = app.doc;
  if (!app.backup || app.backup.width !== d.width || app.backup.height !== d.height) {
    app.backup = makeCanvas(d.width, d.height);
  }
  return app.backup;
}

export function beginPixels(layer) {
  const b = ensureBackup();
  const bc = b.getContext('2d');
  bc.globalCompositeOperation = 'source-over';
  bc.globalAlpha = 1;
  bc.clearRect(0, 0, b.width, b.height);
  bc.drawImage(layer.canvas, 0, 0);
}

export function restoreBackup(layer) {
  const c = layer.ctx;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  c.drawImage(app.backup, 0, 0);
  c.restore();
}

export function clampRect(r, W, H) {
  if (!r) return null;
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Creates a pixel history entry comparing app.backup to the current layer
export function endPixels(layer, rect) {
  const d = app.doc;
  const r = clampRect(rect || { x: 0, y: 0, w: d.width, h: d.height }, d.width, d.height);
  if (!r) return null;
  const before = app.backup.getContext('2d').getImageData(r.x, r.y, r.w, r.h);
  const after = layer.ctx.getImageData(r.x, r.y, r.w, r.h);
  layer.touch();
  return { kind: 'pixels', layer, x: r.x, y: r.y, before, after };
}

// Convenience: run a whole-layer pixel operation with undo
export function pixelOp(layer, fn, rect) {
  beginPixels(layer);
  fn(layer.ctx);
  const e = endPixels(layer, rect);
  history.push(e);
  edited();
}
