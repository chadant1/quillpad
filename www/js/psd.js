// Minimal layered PSD writer (8-bit RGB, uncompressed). Opens in Photoshop, Procreate, Krita, Photopea, GIMP.
import { makeCanvas } from './state.js';

const BLEND_KEYS = {
  'source-over': 'norm', multiply: 'mul ', darken: 'dark', 'color-burn': 'idiv', screen: 'scrn', lighten: 'lite',
  'color-dodge': 'div ', lighter: 'lddg', overlay: 'over', 'soft-light': 'sLit', 'hard-light': 'hLit',
  difference: 'diff', exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ',
};

class Writer {
  constructor() { this.parts = []; this.length = 0; }
  bytes(u8) { this.parts.push(u8); this.length += u8.length; }
  u8(v) { this.bytes(new Uint8Array([v & 255])); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); this.bytes(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); this.bytes(b); }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); this.bytes(b); }
  str(s) { this.bytes(new TextEncoder().encode(s)); }
  zeros(n) { if (n > 0) this.bytes(new Uint8Array(n)); }
}

function alphaBounds(d, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function pascalName(name) {
  const ascii = (name || 'Layer').replace(/[^\x20-\x7e]/g, '_').slice(0, 255);
  const len = ascii.length;
  const total = Math.ceil((len + 1) / 4) * 4;
  const out = new Uint8Array(total);
  out[0] = len;
  for (let i = 0; i < len; i++) out[i + 1] = ascii.charCodeAt(i);
  return out;
}

export function encodePSD(doc) {
  const W = doc.width, H = doc.height;
  const layerInfos = [];
  for (const l of doc.layers) {
    const d = l.ctx.getImageData(0, 0, W, H).data;
    const b = alphaBounds(d, W, H);
    const channels = [];
    if (b) {
      const n = b.w * b.h;
      const A = new Uint8Array(n), R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n);
      let k = 0;
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++, k++) {
          const i = (y * W + x) * 4;
          R[k] = d[i]; G[k] = d[i + 1]; B[k] = d[i + 2]; A[k] = d[i + 3];
        }
      }
      channels.push([-1, A], [0, R], [1, G], [2, B]);
    } else {
      channels.push([-1, new Uint8Array(0)], [0, new Uint8Array(0)], [1, new Uint8Array(0)], [2, new Uint8Array(0)]);
    }
    layerInfos.push({ l, b: b || { x: 0, y: 0, w: 0, h: 0 }, channels });
  }

  // ---- layer records + channel data
  const li = new Writer();
  li.i16(layerInfos.length);
  for (const { l, b, channels } of layerInfos) {
    li.i32(b.y); li.i32(b.x); li.i32(b.y + b.h); li.i32(b.x + b.w);
    li.u16(channels.length);
    for (const [id, data] of channels) { li.i16(id); li.u32(2 + data.length); }
    li.str('8BIM');
    li.str(BLEND_KEYS[l.blend] || 'norm');
    li.u8(Math.round(l.opacity * 255));
    li.u8(l.clip ? 1 : 0);
    let flags = 0;
    if (l.alphaLock) flags |= 1;
    if (!l.visible) flags |= 2;
    li.u8(flags);
    li.u8(0);
    const name = pascalName(l.name);
    li.u32(4 + 4 + name.length);
    li.u32(0); // layer mask data
    li.u32(0); // blending ranges
    li.bytes(name);
  }
  for (const { channels } of layerInfos) {
    for (const [, data] of channels) { li.u16(0); li.bytes(data); }
  }
  if (li.length % 2) li.u8(0);

  // ---- merged composite
  const comp = makeCanvas(W, H);
  const cctx = comp.getContext('2d');
  cctx.fillStyle = doc.bgVisible ? doc.bgColor : '#ffffff';
  cctx.fillRect(0, 0, W, H);
  doc.composite(cctx, null, false);
  const cd = cctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const planes = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let i = 0, j = 0; i < n; i++, j += 4) { planes[0][i] = cd[j]; planes[1][i] = cd[j + 1]; planes[2][i] = cd[j + 2]; }

  const w = new Writer();
  w.str('8BPS'); w.u16(1); w.zeros(6); w.u16(3); w.u32(H); w.u32(W); w.u16(8); w.u16(3);
  w.u32(0); // color mode data
  w.u32(0); // image resources
  w.u32(4 + li.length + 4); // layer & mask section
  w.u32(li.length);
  for (const p of li.parts) w.bytes(p);
  w.u32(0); // global layer mask info
  w.u16(0); // raw image data
  for (const p of planes) w.bytes(p);
  return new Blob(w.parts, { type: 'image/vnd.adobe.photoshop' });
}
