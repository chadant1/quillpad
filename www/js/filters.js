// Pixel filters for adjustments and the ColorDrop flood fill.
import { rgbToHsvFast, hsvToRgb } from './color.js';

export const ADJUSTMENTS = [
  { id: 'hsb', name: 'Hue, Saturation, Brightness', params: [['hue', 'Hue', -180, 180, 0], ['sat', 'Saturation', -100, 100, 0], ['bri', 'Brightness', -100, 100, 0]] },
  { id: 'blur', name: 'Gaussian Blur', params: [['radius', 'Radius', 0, 60, 0]] },
  { id: 'sharpen', name: 'Sharpen', params: [['amount', 'Amount', 0, 200, 0]] },
  { id: 'noise', name: 'Noise', params: [['amount', 'Amount', 0, 100, 0]] },
  { id: 'balance', name: 'Color Balance', params: [['r', 'Cyan ↔ Red', -100, 100, 0], ['g', 'Magenta ↔ Green', -100, 100, 0], ['b', 'Yellow ↔ Blue', -100, 100, 0]] },
  { id: 'contrast', name: 'Contrast', params: [['amount', 'Contrast', -100, 100, 0]] },
  { id: 'invert', name: 'Invert', params: [] },
  { id: 'posterize', name: 'Posterize', params: [['levels', 'Levels', 2, 32, 8]] },
];

// src, dst: Uint8ClampedArray RGBA (unpremultiplied)
export function runAdjustment(id, v, src, dst, w, h) {
  switch (id) {
    case 'hsb': return hsb(src, dst, v.hue || 0, (v.sat || 0) / 100, (v.bri || 0) / 100);
    case 'blur': return blur(src, dst, w, h, v.radius || 0);
    case 'sharpen': return sharpen(src, dst, w, h, (v.amount || 0) / 100);
    case 'noise': return noise(src, dst, (v.amount || 0) / 100);
    case 'balance': return balance(src, dst, v.r || 0, v.g || 0, v.b || 0);
    case 'contrast': return contrast(src, dst, (v.amount || 0) / 100);
    case 'invert': return invert(src, dst);
    case 'posterize': return posterize(src, dst, v.levels || 8);
    default: dst.set(src);
  }
}

function hsb(src, dst, dh, ds, db) {
  const t = [0, 0, 0];
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    dst[i + 3] = a;
    if (!a) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; continue; }
    rgbToHsvFast(src[i], src[i + 1], src[i + 2], t);
    let H = t[0] + dh, S = t[1], V = t[2];
    S = ds < 0 ? S * (1 + ds) : S + (1 - S) * ds;
    V = db < 0 ? V * (1 + db) : V + (1 - V) * db;
    const [r, g, b] = hsvToRgb(H, Math.min(1, Math.max(0, S)), Math.min(1, Math.max(0, V)));
    dst[i] = r; dst[i + 1] = g; dst[i + 2] = b;
  }
}

function invert(src, dst) {
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = 255 - src[i]; dst[i + 1] = 255 - src[i + 1]; dst[i + 2] = 255 - src[i + 2]; dst[i + 3] = src[i + 3];
  }
}

function noise(src, dst, amt) {
  const k = amt * 128;
  for (let i = 0; i < src.length; i += 4) {
    const n = (Math.random() * 2 - 1) * k;
    dst[i] = src[i] + n; dst[i + 1] = src[i + 1] + n; dst[i + 2] = src[i + 2] + n; dst[i + 3] = src[i + 3];
  }
}

function balance(src, dst, r, g, b) {
  const kr = r * 0.8, kg = g * 0.8, kb = b * 0.8;
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = src[i] + kr; dst[i + 1] = src[i + 1] + kg; dst[i + 2] = src[i + 2] + kb; dst[i + 3] = src[i + 3];
  }
}

function contrast(src, dst, amt) {
  const f = amt >= 0 ? 1 + amt * 2 : 1 + amt;
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = (src[i] - 128) * f + 128;
    dst[i + 1] = (src[i + 1] - 128) * f + 128;
    dst[i + 2] = (src[i + 2] - 128) * f + 128;
    dst[i + 3] = src[i + 3];
  }
}

function posterize(src, dst, levels) {
  const n = Math.max(2, Math.round(levels)) - 1;
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = Math.round((src[i] / 255) * n) * (255 / n);
    dst[i + 1] = Math.round((src[i + 1] / 255) * n) * (255 / n);
    dst[i + 2] = Math.round((src[i + 2] / 255) * n) * (255 / n);
    dst[i + 3] = src[i + 3];
  }
}

// Box blur passes on a premultiplied float buffer (edge pixels clamped)
function boxBlurH(s, d, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    for (let c = 0; c < 4; c++) {
      let val = 0;
      for (let k = -r; k <= r; k++) val += s[(base + Math.min(w - 1, Math.max(0, k))) * 4 + c];
      for (let x = 0; x < w; x++) {
        d[(base + x) * 4 + c] = val * iarr;
        const add = Math.min(w - 1, x + r + 1), sub = Math.max(0, x - r);
        val += s[(base + add) * 4 + c] - s[(base + sub) * 4 + c];
      }
    }
  }
}

function boxBlurV(s, d, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let val = 0;
      for (let k = -r; k <= r; k++) val += s[(x + Math.min(h - 1, Math.max(0, k)) * w) * 4 + c];
      for (let y = 0; y < h; y++) {
        d[(x + y * w) * 4 + c] = val * iarr;
        const add = Math.min(h - 1, y + r + 1), sub = Math.max(0, y - r);
        val += s[(x + add * w) * 4 + c] - s[(x + sub * w) * 4 + c];
      }
    }
  }
}

function blurFloat(src, w, h, radius) {
  const n = w * h * 4;
  let a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const al = src[i + 3] / 255;
    a[i] = src[i] * al; a[i + 1] = src[i + 1] * al; a[i + 2] = src[i + 2] * al; a[i + 3] = src[i + 3];
  }
  // three box blurs approximate a gaussian
  const sigma = radius;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  for (let i = 0; i < 3; i++) {
    const r = Math.max(0, ((i < m ? wl : wu) - 1) / 2);
    if (r < 1) continue;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  return a;
}

function blur(src, dst, w, h, radius) {
  if (radius < 0.5) { dst.set(src); return; }
  const a = blurFloat(src, w, h, radius);
  for (let i = 0; i < a.length; i += 4) {
    const al = a[i + 3];
    if (al < 0.5) { dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0; continue; }
    const k = 255 / al;
    dst[i] = a[i] * k; dst[i + 1] = a[i + 1] * k; dst[i + 2] = a[i + 2] * k; dst[i + 3] = al;
  }
}

function sharpen(src, dst, w, h, amount) {
  if (amount <= 0) { dst.set(src); return; }
  const tmp = new Uint8ClampedArray(src.length);
  blur(src, tmp, w, h, 1.6);
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = src[i] + (src[i] - tmp[i]) * amount;
    dst[i + 1] = src[i + 1] + (src[i + 1] - tmp[i + 1]) * amount;
    dst[i + 2] = src[i + 2] + (src[i + 2] - tmp[i + 2]) * amount;
    dst[i + 3] = src[i + 3];
  }
}

// ---- Flood fill (ColorDrop) ----
// Returns a Uint8Array mask (1 = fill) and its bounds, comparing against `ref` pixels.
export function floodMask(ref, w, h, sx, sy, threshold) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const mask = new Uint8Array(w * h);
  const o = (sy * w + sx) * 4;
  const tr = ref[o], tg = ref[o + 1], tb = ref[o + 2], ta = ref[o + 3];
  const match = (i) => {
    const j = i * 4;
    const a = ref[j + 3];
    if (ta < 8 && a < 8) return true;
    return Math.max(Math.abs(ref[j] - tr), Math.abs(ref[j + 1] - tg), Math.abs(ref[j + 2] - tb), Math.abs(a - ta)) <= threshold;
  };
  const stack = [sx, sy];
  let x0 = sx, x1 = sx, y0 = sy, y1 = sy;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    let l = x;
    while (l >= 0 && !mask[y * w + l] && match(y * w + l)) l--;
    l++;
    let r = x;
    while (r < w && !mask[y * w + r] && match(y * w + r)) r++;
    r--;
    if (l > r) continue;
    for (let i = l; i <= r; i++) mask[y * w + i] = 1;
    if (l < x0) x0 = l; if (r > x1) x1 = r; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (let i = l; i <= r; i++) {
        const idx = ny * w + i;
        const ok = !mask[idx] && match(idx);
        if (ok && !inRun) { stack.push(i, ny); inRun = true; } else if (!ok) inRun = false;
      }
    }
  }
  // dilate by one pixel to cover anti-aliased edges
  const out = new Uint8Array(mask);
  const bx0 = Math.max(0, x0 - 1), bx1 = Math.min(w - 1, x1 + 1), by0 = Math.max(0, y0 - 1), by1 = Math.min(h - 1, y1 + 1);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      if ((x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])) out[i] = 1;
    }
  }
  return { mask: out, x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
}
