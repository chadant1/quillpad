// Brush library + stamp-based stroke engine (paint, erase, smudge).
import { makeCanvas } from './state.js';

const DEG = Math.PI / 180;
export const TIP = 256;

const BASE = {
  shape: 'round', hardness: 0.8, grain: 0, spacing: 0.08, sizeMin: 0.2, opacityPressure: 0,
  flow: 1, jitterSize: 0, jitterAngle: 0, scatter: 0, angle: 0, follow: false, roundness: 1,
  streamline: 0.3, taper: 0, sizeDefault: 14, quickShape: true,
  tiltSize: 0, tiltOpacity: 0, tiltShape: 0, tiltThreshold: 60,
};

export const BRUSH_SETTINGS = [
  ['streamline', 'StreamLine', 0, 1, 0.01],
  ['spacing', 'Spacing', 0.01, 1, 0.01],
  ['hardness', 'Hardness', 0, 1, 0.01],
  ['flow', 'Flow', 0.01, 1, 0.01],
  ['sizeMin', 'Min size (pressure)', 0, 1, 0.01],
  ['opacityPressure', 'Opacity by pressure', 0, 1, 0.01],
  ['taper', 'Start taper', 0, 1, 0.01],
  ['jitterSize', 'Size jitter', 0, 1, 0.01],
  ['jitterAngle', 'Rotation jitter', 0, 180, 1],
  ['scatter', 'Scatter', 0, 2, 0.01],
  ['grain', 'Grain', 0, 1, 0.01],
  ['angle', 'Angle', 0, 180, 1],
  ['roundness', 'Roundness', 0.05, 1, 0.01],
  ['tiltSize', 'Tilt → size', 0, 1, 0.01],
  ['tiltOpacity', 'Tilt → opacity', 0, 1, 0.01],
  ['tiltShape', 'Tilt → shading shape', 0, 1, 0.01],
  ['tiltThreshold', 'Tilt starts below', 20, 85, 1],
];

const RAW_PRESETS = [
  { id: 'studio-pen', name: 'Studio Pen', group: 'Inking', hardness: 1, spacing: 0.04, sizeMin: 0.12, streamline: 0.55, taper: 0.4 },
  { id: 'tech-pen', name: 'Technical Pen', group: 'Inking', hardness: 1, spacing: 0.04, sizeMin: 1, streamline: 0.4 },
  { id: 'monoline', name: 'Monoline', group: 'Inking', hardness: 1, spacing: 0.04, sizeMin: 1, streamline: 0.85 },
  { id: 'calligraphy', name: 'Calligraphy', group: 'Inking', hardness: 1, spacing: 0.03, sizeMin: 0.35, roundness: 0.22, angle: 40, streamline: 0.45 },
  { id: 'pencil', name: 'Sketch Pencil', group: 'Sketching', shape: 'round', hardness: 0.75, grain: 0.75, spacing: 0.1, sizeMin: 0.55, opacityPressure: 0.8, flow: 0.55, jitterAngle: 180, streamline: 0.15, sizeDefault: 6, tiltSize: 0.9, tiltOpacity: 0.55, tiltShape: 0.8 },
  { id: 'charcoal', name: 'Charcoal', group: 'Sketching', shape: 'charcoal', hardness: 0.5, spacing: 0.12, sizeMin: 0.5, opacityPressure: 0.7, flow: 0.7, jitterAngle: 180, scatter: 0.08, streamline: 0.1, sizeDefault: 24, tiltSize: 0.8, tiltOpacity: 0.35, tiltShape: 0.7 },
  { id: 'marker', name: 'Marker', group: 'Painting', hardness: 0.92, spacing: 0.05, sizeMin: 0.85, flow: 1, streamline: 0.3, sizeDefault: 26, tiltSize: 0.4, tiltShape: 0.5 },
  { id: 'gouache', name: 'Gouache', group: 'Painting', shape: 'bristle', hardness: 0.6, spacing: 0.04, sizeMin: 0.6, opacityPressure: 0.3, flow: 0.8, angle: 90, follow: true, streamline: 0.25, sizeDefault: 40, tiltSize: 0.4 },
  { id: 'wash', name: 'Watercolor Wash', group: 'Painting', hardness: 0.25, spacing: 0.06, sizeMin: 0.7, opacityPressure: 0.6, flow: 0.06, grain: 0.35, streamline: 0.3, sizeDefault: 70, tiltSize: 0.5, tiltOpacity: 0.2 },
  { id: 'soft-airbrush', name: 'Soft Airbrush', group: 'Airbrushing', hardness: 0, spacing: 0.08, sizeMin: 1, opacityPressure: 1, flow: 0.07, streamline: 0.2, sizeDefault: 90, quickShape: false, tiltSize: 0.6, tiltOpacity: 0.3, tiltShape: 0.4 },
  { id: 'hard-airbrush', name: 'Hard Airbrush', group: 'Airbrushing', hardness: 0.92, spacing: 0.06, sizeMin: 1, opacityPressure: 1, flow: 0.18, streamline: 0.2, sizeDefault: 40, tiltSize: 0.5, tiltShape: 0.4 },
  { id: 'spray', name: 'Spray Paint', group: 'Airbrushing', shape: 'spatter', hardness: 1, spacing: 0.25, sizeMin: 0.6, opacityPressure: 0.5, flow: 0.9, jitterSize: 0.4, jitterAngle: 180, scatter: 0.3, streamline: 0.1, sizeDefault: 70, quickShape: false },
  { id: 'square', name: 'Pixel Square', group: 'Retro', shape: 'square', hardness: 1, spacing: 0.25, sizeMin: 1, streamline: 0, sizeDefault: 8 },
];

const LS_KEY = 'quillpad.brushOverrides';
let overrides = {};
try { overrides = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { overrides = {}; }

export function presetList() {
  return RAW_PRESETS.map((p) => getPreset(p.id));
}

export function getPreset(id) {
  const raw = RAW_PRESETS.find((p) => p.id === id) || RAW_PRESETS[0];
  return Object.assign({}, BASE, raw, overrides[raw.id] || {});
}

export function setPresetValue(id, key, value) {
  overrides[id] = Object.assign({}, overrides[id] || {}, { [key]: value });
  try { localStorage.setItem(LS_KEY, JSON.stringify(overrides)); } catch (e) { /* ignore */ }
}

export function resetPreset(id) {
  delete overrides[id];
  try { localStorage.setItem(LS_KEY, JSON.stringify(overrides)); } catch (e) { /* ignore */ }
}

// ---- Tip generation ----

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shapeKey(p) { return `${p.shape}|${p.hardness.toFixed(2)}|${p.grain.toFixed(2)}`; }

const shapeCache = new Map();
export function shapeCanvas(p) {
  const key = shapeKey(p);
  if (shapeCache.has(key)) return shapeCache.get(key);
  const c = makeCanvas(TIP, TIP);
  const x = c.getContext('2d');
  const r = TIP / 2;
  x.fillStyle = '#000';
  switch (p.shape) {
    case 'square':
      x.fillRect(TIP * 0.08, TIP * 0.08, TIP * 0.84, TIP * 0.84);
      break;
    case 'spatter': {
      const R = rng(7);
      for (let i = 0; i < 110; i++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r * 0.88, s = 1.5 + R() * R() * r * 0.11;
        x.globalAlpha = 0.55 + 0.45 * R();
        x.beginPath(); x.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, s, 0, Math.PI * 2); x.fill();
      }
      break;
    }
    case 'charcoal': {
      const R = rng(11);
      for (let i = 0; i < 700; i++) {
        const a = R() * Math.PI * 2, d = Math.pow(R(), 0.7) * r * 0.92, s = 1 + R() * r * 0.05;
        x.globalAlpha = 0.12 + 0.45 * R();
        x.beginPath(); x.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, s, 0, Math.PI * 2); x.fill();
      }
      break;
    }
    case 'bristle': {
      const R = rng(5);
      for (let i = 0; i < 46; i++) {
        const px = r + (R() * 2 - 1) * r * 0.86;
        const py = r + (R() * 2 - 1) * r * 0.16;
        const s = r * (0.04 + R() * 0.08);
        x.globalAlpha = 0.35 + 0.65 * R();
        x.beginPath(); x.arc(px, py, s, 0, Math.PI * 2); x.fill();
      }
      break;
    }
    default: {
      const h = p.hardness;
      if (h >= 0.99) {
        x.beginPath(); x.arc(r, r, r - 1, 0, Math.PI * 2); x.fill();
      } else {
        const g = x.createRadialGradient(r, r, 0, r, r, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(Math.max(0.001, h * 0.97), 'rgba(0,0,0,1)');
        const mid = h + (1 - h) * 0.45;
        g.addColorStop(Math.min(0.999, mid), `rgba(0,0,0,${0.35 + 0.3 * h})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, TIP, TIP);
      }
    }
  }
  x.globalAlpha = 1;
  if (p.grain > 0) {
    const img = x.getImageData(0, 0, TIP, TIP);
    const d = img.data;
    const R = rng(3);
    for (let i = 3; i < d.length; i += 4) {
      const n = R();
      d[i] = d[i] * (1 - p.grain * (n * n));
    }
    x.putImageData(img, 0, 0);
  }
  if (shapeCache.size > 30) shapeCache.clear();
  shapeCache.set(key, c);
  return c;
}

// mip levels of a tinted tip: [256,128,64,32,16]
const tipCache = new Map();
function tintedLevels(p, color) {
  const key = shapeKey(p) + '#' + color;
  let levels = tipCache.get(key);
  if (levels) return levels;
  const base = makeCanvas(TIP, TIP);
  const bx = base.getContext('2d');
  bx.drawImage(shapeCanvas(p), 0, 0);
  bx.globalCompositeOperation = 'source-in';
  bx.fillStyle = color;
  bx.fillRect(0, 0, TIP, TIP);
  levels = [base];
  let prev = base;
  for (let s = TIP / 2; s >= 16; s /= 2) {
    const c = makeCanvas(s, s);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(prev, 0, 0, s, s);
    levels.push(c);
    prev = c;
  }
  if (tipCache.size > 24) tipCache.clear();
  tipCache.set(key, levels);
  return levels;
}

function pickLevel(levels, diam) {
  for (let i = levels.length - 1; i >= 0; i--) if (levels[i].width >= diam) return levels[i];
  return levels[0];
}

// ---- Symmetry ----

export function symmetryFns(mode, W, H) {
  const cx = W / 2, cy = H / 2;
  const id = (x, y, a) => [x, y, a, 1];
  const v = (x, y, a) => [W - x, y, Math.PI - a, -1];
  const h = (x, y, a) => [x, H - y, -a, -1];
  const vh = (x, y, a) => [W - x, H - y, a + Math.PI, 1];
  switch (mode) {
    case 'vertical': return [id, v];
    case 'horizontal': return [id, h];
    case 'quadrant': return [id, v, h, vh];
    case 'radial': {
      const fns = [];
      const n = 8;
      for (let k = 0; k < n; k++) {
        const t = (k * 2 * Math.PI) / n, c = Math.cos(t), s = Math.sin(t);
        fns.push((x, y, a) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c, a + t, 1]);
      }
      return fns;
    }
    default: return [id];
  }
}

// ---- Stroke ----

export class Stroke {
  /**
   * opts: { mode, preset, color, size, opacity, layer, doc, strokeCanvas, symmetry, clipPath }
   */
  constructor(o) {
    Object.assign(this, o);
    this.p = o.preset;
    this.points = [];
    this.bounds = null;
    this.sm = null;
    this.smP = 0;
    this.last = null;
    this.sinceLast = 0;
    this.travel = 0;
    this.shaped = null;
    this.startTime = performance.now();
    this.sym = this.mode === 'smudge' ? symmetryFns('off') : symmetryFns(o.symmetry, o.doc.width, o.doc.height);
    if (this.mode === 'smudge') {
      this.ctx = this.layer.ctx;
      this.shape = shapeCanvas(this.p);
      const B = Math.ceil(this.size) + 4;
      this.B = B;
      this.buf = makeCanvas(B, B);
      this.bctx = this.buf.getContext('2d');
      this.tmp = makeCanvas(B, B);
      this.tctx = this.tmp.getContext('2d');
      this.bufReady = false;
    } else {
      this.ctx = this.strokeCanvas.getContext('2d');
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.clearRect(0, 0, this.strokeCanvas.width, this.strokeCanvas.height);
      this.levels = tintedLevels(this.p, this.mode === 'erase' ? '#000000' : this.color);
    }
    this.ctx.save();
    if (this.clipPath) this.ctx.clip(this.clipPath, 'evenodd');
  }

  diam(p) {
    const pr = this.p;
    return this.size * (pr.sizeMin + (1 - pr.sizeMin) * p);
  }

  // tilt: { alt, az } in radians (altitude above the screen, azimuth in document space) or null
  add(x, y, pressure, tilt) {
    if (this.shaped) return;
    if (tilt) {
      if (!this.tiltS) this.tiltS = { alt: tilt.alt, cx: Math.cos(tilt.az), cy: Math.sin(tilt.az) };
      else {
        const k = 0.35;
        this.tiltS.alt += (tilt.alt - this.tiltS.alt) * k;
        this.tiltS.cx += (Math.cos(tilt.az) - this.tiltS.cx) * k;
        this.tiltS.cy += (Math.sin(tilt.az) - this.tiltS.cy) * k;
      }
    }
    const s = this.p.streamline;
    if (!this.sm) {
      this.sm = { x, y };
      this.smP = pressure;
    } else {
      const k = 1 - Math.min(0.94, s * 0.93);
      this.sm.x += (x - this.sm.x) * k;
      this.sm.y += (y - this.sm.y) * k;
      this.smP += (pressure - this.smP) * 0.45;
    }
    this.rawLast = { x, y, p: pressure };
    const pt = { x: this.sm.x, y: this.sm.y, p: this.smP };
    this.points.push(pt);
    this.segmentTo(pt.x, pt.y, pt.p);
  }

  // Catch the smoothed position up to the final raw point at stroke end
  finish() {
    if (this.shaped || !this.rawLast || !this.sm) return;
    const { x, y, p } = this.rawLast;
    const d = Math.hypot(x - this.sm.x, y - this.sm.y);
    if (d > 0.5) {
      const steps = Math.ceil(d / 2);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const px = this.sm.x + (x - this.sm.x) * t, py = this.sm.y + (y - this.sm.y) * t;
        this.points.push({ x: px, y: py, p });
        this.segmentTo(px, py, p);
      }
    }
  }

  segmentTo(x, y, p) {
    if (!this.last) {
      this.last = { x, y, p };
      this.stamp(x, y, p, 0);
      return;
    }
    const L = this.last;
    const dx = x - L.x, dy = y - L.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) { L.p = p; return; }
    const dir = Math.atan2(dy, dx);
    let pos = 0;
    const sp = this.p.spacing;
    for (let guard = 0; guard < 100000; guard++) {
      const pr = L.p + (p - L.p) * (pos / d);
      const step = Math.max(0.5, this.diam(pr) * sp);
      const need = step - this.sinceLast;
      if (pos + need > d) { this.sinceLast += d - pos; break; }
      pos += need;
      this.sinceLast = 0;
      const t = pos / d;
      this.travelAt = this.travel + pos;
      this.stamp(L.x + dx * t, L.y + dy * t, L.p + (p - L.p) * t, dir);
    }
    this.travel += d;
    this.last = { x, y, p };
  }

  stamp(x, y, p, dir) {
    const pr = this.p;
    let diam = this.diam(p);
    if (pr.taper > 0) {
      const len = pr.taper * this.size * 4;
      const t = Math.min(1, (this.travelAt || 0) / len);
      diam *= 0.15 + 0.85 * t;
    }
    if (pr.jitterSize) diam *= 1 - pr.jitterSize * Math.random();
    let alpha = pr.flow * (1 - pr.opacityPressure + pr.opacityPressure * p);
    let ang = pr.angle * DEG + (pr.follow ? dir : 0);
    let round = pr.roundness;
    // stylus tilt: lay the pencil down to shade with its side
    const tf = this.tiltFactor();
    if (tf > 0) {
      diam *= 1 + pr.tiltSize * 2.2 * tf;
      alpha *= 1 - pr.tiltOpacity * 0.75 * tf;
      if (pr.tiltShape > 0) {
        round *= 1 - pr.tiltShape * 0.7 * tf;
        ang = Math.atan2(this.tiltS.cy, this.tiltS.cx);
      }
    }
    if (diam < 0.25) return;
    if (pr.jitterAngle) ang += (Math.random() * 2 - 1) * pr.jitterAngle * DEG;
    let ox = x, oy = y;
    if (pr.scatter) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * pr.scatter * diam;
      ox += Math.cos(a) * r; oy += Math.sin(a) * r;
    }
    for (const f of this.sym) {
      const [mx, my, ma, flip] = f(ox, oy, ang);
      if (this.mode === 'smudge') this.smudgeDab(mx, my, diam, p);
      else this.dab(mx, my, diam, alpha, ma, flip, round);
    }
  }

  // 0 = pen upright (or no tilt data), 1 = pen laid nearly flat
  tiltFactor() {
    const t = this.tiltS;
    if (!t) return 0;
    const pr = this.p;
    if (!(pr.tiltSize || pr.tiltOpacity || pr.tiltShape)) return 0;
    const altDeg = t.alt / DEG;
    const thr = pr.tiltThreshold;
    if (altDeg >= thr) return 0;
    return Math.min(1, (thr - altDeg) / Math.max(5, thr - 15));
  }

  dab(x, y, diam, alpha, ang, flip, round = this.p.roundness) {
    const ctx = this.ctx;
    const tip = pickLevel(this.levels, diam);
    const s = diam / tip.width;
    const sy = s * round * flip;
    const c = Math.cos(ang), si = Math.sin(ang);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.setTransform(c * s, si * s, -si * sy, c * sy, x, y);
    ctx.drawImage(tip, -tip.width / 2, -tip.height / 2);
    this.grow(x, y, diam * 0.75 + 2);
  }

  smudgeDab(x, y, diam, p) {
    const B = this.B, h = B / 2;
    const lc = this.ctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.bufReady) {
      this.bctx.clearRect(0, 0, B, B);
      this.bctx.drawImage(this.layer.canvas, x - h, y - h, B, B, 0, 0, B, B);
      this.bufReady = true;
      this.grow(x, y, h + 2);
      return;
    }
    const strength = Math.min(1, this.opacity * (0.35 + 0.65 * p));
    const t = this.tctx;
    t.globalCompositeOperation = 'source-over';
    t.globalAlpha = 1;
    t.clearRect(0, 0, B, B);
    t.drawImage(this.buf, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(this.shape, h - diam / 2, h - diam / 2, diam, diam);
    t.globalCompositeOperation = 'source-over';
    lc.globalAlpha = strength * 0.6;
    lc.globalCompositeOperation = this.layer.alphaLock ? 'source-atop' : 'source-over';
    lc.drawImage(this.tmp, x - h, y - h);
    lc.globalCompositeOperation = 'source-over';
    // pick up a little paint from the new location
    this.bctx.globalAlpha = 0.22;
    this.bctx.drawImage(this.layer.canvas, x - h, y - h, B, B, 0, 0, B, B);
    this.bctx.globalAlpha = 1;
    this.grow(x, y, h + 2);
  }

  grow(x, y, r) {
    const b = this.bounds;
    if (!b) { this.bounds = { x0: x - r, y0: y - r, x1: x + r, y1: y + r }; return; }
    if (x - r < b.x0) b.x0 = x - r;
    if (y - r < b.y0) b.y0 = y - r;
    if (x + r > b.x1) b.x1 = x + r;
    if (y + r > b.y1) b.y1 = y + r;
  }

  // Replace the stroke with a perfect shape (QuickShape)
  replaceWith(pts) {
    const avgP = this.points.length ? this.points.reduce((s, q) => s + q.p, 0) / this.points.length : 1;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.strokeCanvas.width, this.strokeCanvas.height);
    ctx.restore();
    this.bounds = null;
    this.last = null;
    this.sinceLast = 0;
    this.travel = 0;
    this.travelAt = 0;
    const savedTaper = this.p.taper;
    this.p = Object.assign({}, this.p, { taper: 0, jitterSize: Math.min(this.p.jitterSize, 0.1) });
    // densify so that interpolated pressure stays constant
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      this.segmentTo(a.x, a.y, avgP);
    }
    this.p.taper = savedTaper;
    this.shaped = pts;
  }

  end() {
    try { this.ctx.restore(); } catch (e) { /* ignore */ }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    const b = this.bounds;
    if (!b) return null;
    return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  }
}

// Render a sample stroke of a preset into a canvas (for the brush library)
export function renderPreview(canvas, preset, color) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const sc = makeCanvas(W, H);
  const fakeDoc = { width: W, height: H };
  const size = Math.min(H * 0.55, Math.max(4, preset.sizeDefault * 0.6));
  const s = new Stroke({
    mode: 'paint', preset: Object.assign({}, preset, { streamline: 0 }), color, size, opacity: 1,
    layer: null, doc: fakeDoc, strokeCanvas: sc, symmetry: 'off', clipPath: null,
  });
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = W * 0.08 + t * W * 0.84;
    const y = H / 2 + Math.sin(t * Math.PI * 2) * H * 0.22;
    const p = Math.sin(t * Math.PI);
    s.add(x, y, 0.15 + 0.85 * p);
  }
  s.end();
  ctx.drawImage(sc, 0, 0);
}
