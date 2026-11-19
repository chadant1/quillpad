// Document model: layers, background and compositing.
import { makeCanvas } from './state.js';

export const BLEND_MODES = [
  ['source-over', 'Normal', 'N'],
  ['multiply', 'Multiply', 'M'],
  ['darken', 'Darken', 'D'],
  ['color-burn', 'Color Burn', 'Cb'],
  ['screen', 'Screen', 'S'],
  ['lighten', 'Lighten', 'L'],
  ['color-dodge', 'Color Dodge', 'Cd'],
  ['lighter', 'Add', 'A'],
  ['overlay', 'Overlay', 'O'],
  ['soft-light', 'Soft Light', 'Sl'],
  ['hard-light', 'Hard Light', 'Hl'],
  ['difference', 'Difference', 'Di'],
  ['exclusion', 'Exclusion', 'E'],
  ['hue', 'Hue', 'H'],
  ['saturation', 'Saturation', 'Sa'],
  ['color', 'Color', 'C'],
  ['luminosity', 'Luminosity', 'Lu'],
];

export function blendInfo(mode) {
  return BLEND_MODES.find((b) => b[0] === mode) || BLEND_MODES[0];
}

let nextId = 1;

export class Layer {
  constructor(w, h, name = 'Layer') {
    this.id = nextId++;
    this.name = name;
    this.canvas = makeCanvas(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.visible = true;
    this.opacity = 1;
    this.blend = 'source-over';
    this.alphaLock = false;
    this.clip = false;
    this.reference = false;
    this.hold = 1; // animation: how many frame-durations this frame is shown
    this.version = 1;
    this.savedVersion = 0;
    this.blob = null;
  }
  props() {
    return {
      name: this.name, visible: this.visible, opacity: this.opacity,
      blend: this.blend, alphaLock: this.alphaLock, clip: this.clip, reference: this.reference, hold: this.hold,
    };
  }
  setProps(p) { Object.assign(this, p); }
  touch() { this.version++; }
}

export class Doc {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.layers = [];
    this.activeIndex = 0;
    this.bgColor = '#ffffff';
    this.bgVisible = true;
    this.selection = null; // { polys: [[{x,y}...]], inverted }
    this.anim = defaultAnim();
    this._s1 = null;
    this._s2 = null;
    this._s3 = null;
  }

  // ---- animation helpers: every top-level layer (plus layers clipped to it) is one frame
  groups() {
    const L = this.layers, out = [];
    for (let i = 0; i < L.length;) {
      let j = i + 1;
      while (j < L.length && L[j].clip) j++;
      out.push({ start: i, end: j });
      i = j;
    }
    return out;
  }

  animParts() {
    let frames = this.groups();
    let bg = null, fg = null;
    if (this.anim.bgBottom && frames.length > 1) { bg = frames[0]; frames = frames.slice(1); }
    if (this.anim.fgTop && frames.length > 1) { fg = frames[frames.length - 1]; frames = frames.slice(0, -1); }
    return { bg, fg, frames };
  }

  frameIndexOfLayer(i) {
    return this.animParts().frames.findIndex((f) => i >= f.start && i < f.end);
  }

  syncAnimFrame() {
    if (!this.anim.enabled) return;
    const fi = this.frameIndexOfLayer(this.activeIndex);
    if (fi >= 0) this.anim.current = fi;
    const n = this.animParts().frames.length;
    if (this.anim.current >= n) this.anim.current = Math.max(0, n - 1);
  }

  get active() { return this.layers[this.activeIndex]; }

  scratch(n) {
    const k = '_s' + n;
    if (!this[k]) this[k] = makeCanvas(this.width, this.height);
    return this[k];
  }

  // Rough memory budget so phones don't run out of RAM.
  maxLayers() {
    const per = this.width * this.height * 4;
    return Math.max(3, Math.min(60, Math.floor(380e6 / per)));
  }

  newLayer(name) { return new Layer(this.width, this.height, name || this.nextLayerName()); }

  nextLayerName() {
    const names = new Set(this.layers.map((l) => l.name));
    let n = 1;
    while (names.has('Layer ' + n)) n++;
    return 'Layer ' + n;
  }

  // Composite into ctx (document coordinate space).
  // overrides: Map(layer -> canvas) used for live previews.
  // opts: { frame, onion } for animation mode.
  composite(ctx, overrides = null, background = true, opts = {}) {
    const W = this.width, H = this.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (background && this.bgVisible) {
      ctx.fillStyle = this.bgColor;
      ctx.fillRect(0, 0, W, H);
    }
    const a = this.anim;
    const parts = a.enabled ? this.animParts() : null;
    if (parts && parts.frames.length) {
      const { bg, fg, frames } = parts;
      const cur = Math.max(0, Math.min(frames.length - 1, opts.frame ?? a.current));
      if (bg) this.drawRange(ctx, bg.start, bg.end, overrides);
      if (opts.onion && a.onionCount > 0) {
        for (let d = a.onionCount; d >= 1; d--) {
          const alpha = a.onionOpacity * (1 - (d - 1) / (a.onionCount + 0.5));
          if (frames[cur - d]) this.drawOnion(ctx, frames[cur - d], overrides, alpha, a.onionTint ? '#ff3b55' : null);
          if (frames[cur + d]) this.drawOnion(ctx, frames[cur + d], overrides, alpha, a.onionTint ? '#26c281' : null);
        }
      }
      this.drawRange(ctx, frames[cur].start, frames[cur].end, overrides);
      if (fg) this.drawRange(ctx, fg.start, fg.end, overrides);
    } else {
      this.drawRange(ctx, 0, this.layers.length, overrides);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  drawOnion(ctx, fr, overrides, alpha, tint) {
    const s = this.scratch(3), sc = s.getContext('2d');
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.clearRect(0, 0, this.width, this.height);
    this.drawRange(sc, fr.start, fr.end, overrides);
    if (tint) {
      sc.globalCompositeOperation = 'source-atop';
      sc.globalAlpha = 0.6;
      sc.fillStyle = tint;
      sc.fillRect(0, 0, this.width, this.height);
      sc.globalCompositeOperation = 'source-over';
      sc.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.drawImage(s, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Draw layers [a, b) with clipping groups, opacity and blend modes
  drawRange(ctx, a, b, overrides = null) {
    const W = this.width, H = this.height;
    const L = this.layers;
    const src = (l) => (overrides && overrides.get(l)) || l.canvas;
    for (let i = a; i < b; i++) {
      const base = L[i];
      let j = i + 1;
      while (j < b && L[j].clip) j++;
      if (base.visible && base.opacity > 0) {
        const clips = [];
        for (let k = i + 1; k < j; k++) if (L[k].visible && L[k].opacity > 0) clips.push(L[k]);
        if (!clips.length) {
          drawWith(ctx, src(base), base.opacity, base.blend);
        } else {
          const g = this.scratch(1), gc = g.getContext('2d');
          const t = this.scratch(2), tc = t.getContext('2d');
          gc.globalCompositeOperation = 'source-over'; gc.globalAlpha = 1;
          gc.clearRect(0, 0, W, H);
          gc.drawImage(src(base), 0, 0);
          for (const c of clips) {
            tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1;
            tc.clearRect(0, 0, W, H);
            tc.drawImage(src(c), 0, 0);
            tc.globalCompositeOperation = 'destination-in';
            tc.drawImage(src(base), 0, 0);
            tc.globalCompositeOperation = 'source-over';
            gc.globalCompositeOperation = c.blend;
            gc.globalAlpha = c.opacity;
            gc.drawImage(t, 0, 0);
          }
          gc.globalCompositeOperation = 'source-over'; gc.globalAlpha = 1;
          drawWith(ctx, g, base.opacity, base.blend);
        }
      }
      i = j - 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

export function defaultAnim() {
  return { enabled: false, fps: 12, loop: 'loop', onionCount: 2, onionOpacity: 0.45, onionTint: true, bgBottom: false, fgTop: false, current: 0 };
}

function drawWith(ctx, src, alpha, blend) {
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend;
  ctx.drawImage(src, 0, 0);
}

// ---- Selection helpers -------------------------------------------------

export function selectionPath(sel, W, H) {
  const p = new Path2D();
  if (!sel) return p;
  if (sel.inverted) p.rect(0, 0, W, H);
  for (const poly of sel.polys) {
    if (poly.length < 3) continue;
    p.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) p.lineTo(poly[i].x, poly[i].y);
    p.closePath();
  }
  return p;
}

export function clipToSelection(ctx, doc) {
  if (!doc.selection) return;
  ctx.clip(selectionPath(doc.selection, doc.width, doc.height), 'evenodd');
}

export function selectionBounds(sel, W, H) {
  if (!sel) return null;
  if (sel.inverted) return { x: 0, y: 0, w: W, h: H };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of sel.polys) for (const p of poly) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (!isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Bounding box of non-transparent pixels in a canvas (or null when empty)
export function contentBounds(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3;
    for (let x = 0; x < w; x++, row += 4) {
      if (d[row] > 2) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
