// Animated GIF encoder: median-cut global palette + LZW. No dependencies.
// frames: [{ data: Uint8ClampedArray (RGBA), delay: centiseconds }]

function buildPalette(frames, w, h, maxColors) {
  // sample pixels across all frames
  const total = frames.length * w * h;
  const step = Math.max(1, Math.floor(total / 240000));
  const samples = [];
  let k = 0;
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4, k++) {
      if (k % step || d[i + 3] < 128) continue;
      samples.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
  }
  if (!samples.length) samples.push(0);
  const ch = (c, s) => (c >> (16 - 8 * s)) & 255; // s: 0=r 1=g 2=b
  let boxes = [samples];
  while (boxes.length < maxColors) {
    let best = -1, bestScore = -1, bestCh = 0;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      if (box.length < 2) continue;
      for (let s = 0; s < 3; s++) {
        let lo = 255, hi = 0;
        for (let i = 0; i < box.length; i += Math.max(1, box.length >> 10)) {
          const v = ch(box[i], s);
          if (v < lo) lo = v; if (v > hi) hi = v;
        }
        const score = (hi - lo) * Math.sqrt(box.length);
        if (score > bestScore) { bestScore = score; best = b; bestCh = s; }
      }
    }
    if (best < 0 || bestScore <= 0) break;
    const box = boxes[best];
    box.sort((a, b) => ch(a, bestCh) - ch(b, bestCh));
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((box) => {
    let r = 0, g = 0, b = 0;
    for (const c of box) { r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; }
    const n = box.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function lzw(indices, minCode, out) {
  const clear = 1 << minCode, eoi = clear + 1;
  let next = eoi + 1, size = minCode + 1;
  let table = new Map();
  let cur = 0, shift = 0;
  const bytes = [];
  const emit = (code) => {
    cur |= code << shift;
    shift += size;
    while (shift >= 8) { bytes.push(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minCode + 1;
      table = new Map();
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) bytes.push(cur & 255);
  out.push(minCode);
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(bytes[i + j]);
  }
  out.push(0);
}

class ByteOut {
  constructor() { this.buf = new Uint8Array(1 << 20); this.length = 0; }
  push(...vals) {
    if (this.length + vals.length > this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.length + vals.length));
      nb.set(this.buf.subarray(0, this.length));
      this.buf = nb;
    }
    for (const v of vals) this.buf[this.length++] = v;
  }
  bytes() { return this.buf.subarray(0, this.length); }
}

export async function encodeGIF(frames, w, h, { transparent = false, loop = true, onProgress } = {}) {
  const pal = buildPalette(frames, w, h, transparent ? 255 : 256);
  while (pal.length < 256) pal.push([0, 0, 0]);
  const tIndex = 255;
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let v = cache.get(key);
    if (v !== undefined) return v;
    let best = 0, bd = Infinity;
    const n = transparent ? 255 : 256;
    for (let i = 0; i < n; i++) {
      const p = pal[i];
      const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
      const dd = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (dd < bd) { bd = dd; best = i; }
    }
    cache.set(key, best);
    return best;
  };
  const out = new ByteOut();
  const str = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  const u16 = (v) => { out.push(v & 255, (v >> 8) & 255); };
  str('GIF89a');
  u16(w); u16(h);
  out.push(0xf7, 0, 0);
  for (const p of pal) out.push(p[0], p[1], p[2]);
  if (loop) { out.push(0x21, 0xff, 0x0b); str('NETSCAPE2.0'); out.push(3, 1); u16(0); out.push(0); }
  const idx = new Uint8Array(w * h);
  for (let f = 0; f < frames.length; f++) {
    const d = frames[f].data;
    for (let i = 0, j = 0; i < idx.length; i++, j += 4) {
      idx[i] = transparent && d[j + 3] < 128 ? tIndex : nearest(d[j], d[j + 1], d[j + 2]);
    }
    // graphic control extension: dispose to background so transparent frames don't stack
    out.push(0x21, 0xf9, 4, (2 << 2) | (transparent ? 1 : 0));
    u16(Math.max(2, Math.round(frames[f].delay)));
    out.push(transparent ? tIndex : 0, 0);
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0);
    lzw(idx, 8, out);
    if (onProgress) onProgress(f + 1, frames.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  out.push(0x3b);
  return new Blob([out.bytes()], { type: 'image/gif' });
}
