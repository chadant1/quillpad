// Animation Assist: every top-level layer is a frame. Timeline, onion skins, playback, export.
import { app, $, el, toast, requestRender, edited, makeCanvas, clamp } from './state.js';
import { icon } from './icons.js';
import { recordStruct } from './history.js';
import { openSheet, refreshSheet, modal } from './ui.js';
import { encodeGIF } from './gif.js';
import { saveBlob, safeName } from './share.js';

let rafId = 0;

// ---------------------------------------------------------------- state

export function setAnimEnabled(on) {
  const d = app.doc;
  stopPlayback();
  d.anim.enabled = on;
  document.body.classList.toggle('anim-on', on);
  if (on) {
    d.syncAnimFrame();
    toast('Animation on: each layer is a frame. Tap + to add frames.', 2600);
  }
  app.compDirty = true;
  renderTimeline();
  edited();
}

export function syncAnimUI() {
  const on = !!(app.doc && app.doc.anim.enabled);
  document.body.classList.toggle('anim-on', on);
  if (!on) stopPlayback();
  renderTimeline();
}

function frames() { return app.doc.animParts().frames; }

export function goToFrame(i) {
  const d = app.doc;
  const fr = frames();
  if (!fr.length) return;
  i = clamp(i, 0, fr.length - 1);
  d.anim.current = i;
  d.activeIndex = fr[i].start;
  app.compDirty = true;
  requestRender();
  renderTimeline();
  if (app.onLayerChange) app.onLayerChange();
}

// ---------------------------------------------------------------- frame operations

export function addFrame() {
  const d = app.doc;
  if (d.layers.length >= d.maxLayers()) { toast(`Frame limit reached (${d.maxLayers()} at this canvas size)`); return; }
  const fr = frames();
  const cur = fr[d.anim.current];
  const at = cur ? cur.end : d.layers.length;
  const n = fr.length + 1;
  recordStruct(() => {
    const l = d.newLayer('Frame ' + n);
    d.layers.splice(at, 0, l);
    d.activeIndex = at;
  });
  d.syncAnimFrame();
  renderTimeline();
}

export function duplicateFrame(i) {
  const d = app.doc;
  const fr = frames()[i];
  if (!fr) return;
  const count = fr.end - fr.start;
  if (d.layers.length + count > d.maxLayers()) { toast('Frame limit reached'); return; }
  const copies = [];
  for (let k = fr.start; k < fr.end; k++) {
    const src = d.layers[k];
    const l = d.newLayer(src.name + ' copy');
    l.setProps({ ...src.props(), name: src.name + ' copy' });
    l.ctx.drawImage(src.canvas, 0, 0);
    copies.push(l);
  }
  recordStruct(() => { d.layers.splice(fr.end, 0, ...copies); d.activeIndex = fr.end; });
  d.syncAnimFrame();
  renderTimeline();
}

export function deleteFrame(i) {
  const d = app.doc;
  const all = frames();
  const fr = all[i];
  if (!fr) return;
  if (all.length <= 1) { toast('An animation needs at least one frame'); return; }
  recordStruct(() => {
    d.layers.splice(fr.start, fr.end - fr.start);
    d.activeIndex = Math.max(0, Math.min(fr.start, d.layers.length - 1));
  });
  d.anim.current = Math.max(0, Math.min(i, frames().length - 1));
  goToFrame(d.anim.current);
}

function holdOf(fr) { return Math.max(1, app.doc.layers[fr.start].hold || 1); }

// ---------------------------------------------------------------- playback

function sequence(n, mode) {
  const seq = [];
  for (let i = 0; i < n; i++) seq.push(i);
  if (mode === 'pingpong') for (let i = n - 2; i >= 1; i--) seq.push(i);
  return seq;
}

export function togglePlayback() {
  if (app.animPlaying) stopPlayback(); else startPlayback();
}

export function startPlayback() {
  const d = app.doc;
  const fr = frames();
  if (fr.length < 2) { toast('Add at least two frames to play'); return; }
  app.animPlaying = true;
  const seq = sequence(fr.length, d.anim.loop);
  let pos = Math.max(0, seq.indexOf(d.anim.current));
  if (d.anim.loop === 'once' && pos >= seq.length - 1) pos = 0;
  let last = performance.now();
  app.playFrame = seq[pos];
  const tick = (now) => {
    if (!app.animPlaying) return;
    const dur = (1000 / d.anim.fps) * holdOf(fr[seq[pos]]);
    if (now - last >= dur) {
      last = now;
      pos++;
      if (pos >= seq.length) {
        if (d.anim.loop === 'once') { stopPlayback(); return; }
        pos = 0;
      }
      app.playFrame = seq[pos];
      app.compDirty = true;
      requestRender();
      highlightPlaying();
    }
    rafId = requestAnimationFrame(tick);
  };
  app.compDirty = true;
  requestRender();
  rafId = requestAnimationFrame(tick);
  renderTimeline();
}

export function stopPlayback() {
  if (!app.animPlaying) return;
  app.animPlaying = false;
  cancelAnimationFrame(rafId);
  app.compDirty = true;
  requestRender();
  renderTimeline();
}

function highlightPlaying() {
  const items = document.querySelectorAll('#timeline .tl-frame');
  items.forEach((n, i) => n.classList.toggle('playing', i === app.playFrame));
}

// ---------------------------------------------------------------- timeline UI

function frameThumb(fr, size = 52) {
  const d = app.doc;
  const k = Math.min(size / d.width, size / d.height);
  const c = makeCanvas(Math.max(1, d.width * k), Math.max(1, d.height * k));
  const x = c.getContext('2d');
  if (d.bgVisible) { x.fillStyle = d.bgColor; x.fillRect(0, 0, c.width, c.height); }
  x.scale(k, k);
  x.imageSmoothingQuality = 'high';
  d.drawRange(x, fr.start, fr.end);
  return c;
}

let tlTimer = 0;
export function scheduleTimeline() {
  if (!app.doc || !app.doc.anim.enabled) return;
  clearTimeout(tlTimer);
  tlTimer = setTimeout(renderTimeline, 150);
}

export function renderTimeline() {
  const tl = $('#timeline');
  if (!tl) return;
  const d = app.doc;
  if (!d || !d.anim.enabled) { tl.innerHTML = ''; return; }
  d.syncAnimFrame();
  tl.innerHTML = '';
  const { bg, fg, frames: fr } = d.animParts();
  const playBtn = el('button', { class: 'tl-btn' + (app.animPlaying ? ' on' : ''), title: app.animPlaying ? 'Pause' : 'Play', html: icon(app.animPlaying ? 'pause' : 'play'), onclick: togglePlayback });
  const setBtn = el('button', { class: 'tl-btn', title: 'Animation settings', html: icon('prefs'), onclick: openAnimSettings });
  const list = el('div', { class: 'tl-frames' });
  const chip = (label, grp) => {
    const b = el('button', { class: 'tl-frame tl-fixed' + (d.activeIndex >= grp.start && d.activeIndex < grp.end ? ' active' : '') }, frameThumb(grp), el('span', { class: 'tl-num' }, label));
    b.addEventListener('click', () => { stopPlayback(); d.activeIndex = grp.start; app.compDirty = true; requestRender(); renderTimeline(); });
    return b;
  };
  if (bg) list.append(chip('BG', bg));
  fr.forEach((f, i) => {
    const active = i === d.anim.current && d.frameIndexOfLayer(d.activeIndex) === i;
    const hold = holdOf(f);
    const b = el('button', { class: 'tl-frame' + (active ? ' active' : '') + (app.animPlaying && app.playFrame === i ? ' playing' : '') },
      frameThumb(f), el('span', { class: 'tl-num' }, String(i + 1)), hold > 1 ? el('span', { class: 'tl-hold' }, '×' + hold) : '');
    b.addEventListener('click', () => {
      stopPlayback();
      if (active) frameMenu(i); else goToFrame(i);
    });
    list.append(b);
  });
  if (fg) list.append(chip('FG', fg));
  const addBtn = el('button', { class: 'tl-btn add', title: 'Add frame', html: icon('plus'), onclick: () => { stopPlayback(); addFrame(); } });
  tl.append(playBtn, setBtn, list, addBtn);
  const act = list.querySelector('.active');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function frameMenu(i) {
  const d = app.doc;
  const fr = frames()[i];
  const base = d.layers[fr.start];
  const val = el('span', { class: 'slider-val' }, String(base.hold || 1));
  const inp = el('input', { type: 'range', min: 1, max: 24, step: 1, value: base.hold || 1 });
  inp.addEventListener('input', () => { base.hold = parseInt(inp.value, 10); base.touch(); val.textContent = inp.value; });
  const body = el('div', {},
    el('div', { class: 'slider-row' }, el('div', { class: 'slider-head' }, el('span', {}, 'Hold duration (frames)'), val), inp),
    el('p', { class: 'modal-text small' }, `Layer: ${base.name}. Draw on this frame like any layer; the Layers panel lets you add clipped layers to it.`));
  const r = await modal({
    title: `Frame ${i + 1}`, body,
    buttons: [{ label: 'Duplicate', value: 'dup' }, { label: 'Delete', value: 'del', danger: true }, { label: 'Done', value: null, primary: true }],
  });
  if (r === 'dup') duplicateFrame(i);
  else if (r === 'del') deleteFrame(i);
  edited();
  renderTimeline();
}

// ---------------------------------------------------------------- settings

export function openAnimSettings() {
  openSheet('anim', 'Animation', buildSettings);
}

function slider(label, min, max, step, get, set, fmt) {
  const val = el('span', { class: 'slider-val' }, fmt(get()));
  const inp = el('input', { type: 'range', min, max, step, value: get() });
  inp.addEventListener('input', () => { set(parseFloat(inp.value)); val.textContent = fmt(parseFloat(inp.value)); app.compDirty = true; requestRender(); });
  inp.addEventListener('change', () => edited());
  return el('div', { class: 'slider-row' }, el('div', { class: 'slider-head' }, el('span', {}, label), val), inp);
}

function toggle(label, get, set) {
  const sw = el('span', { class: 'switch' + (get() ? ' on' : '') });
  return el('button', { class: 'row toggle', onclick: () => { set(!get()); sw.classList.toggle('on', !!get()); app.compDirty = true; requestRender(); renderTimeline(); edited(); } }, el('span', { class: 'row-label' }, label), sw);
}

function buildSettings(body) {
  const a = app.doc.anim;
  const seg = el('div', { class: 'seg' });
  for (const [v, label] of [['loop', 'Loop'], ['pingpong', 'Ping-Pong'], ['once', 'One Shot']]) {
    seg.append(el('button', { class: a.loop === v ? 'on' : '', onclick: () => { a.loop = v; edited(); refreshSheet(); } }, label));
  }
  body.append(
    toggle('Animation Assist', () => a.enabled, (v) => setAnimEnabled(v)),
    el('div', { class: 'group-title' }, 'Playback'),
    seg,
    slider('Frames per second', 1, 60, 1, () => a.fps, (v) => { a.fps = v; }, (v) => v + ' fps'),
    el('div', { class: 'group-title' }, 'Onion skin'),
    slider('Onion skin frames', 0, 6, 1, () => a.onionCount, (v) => { a.onionCount = v; }, (v) => (v ? v + ' each side' : 'Off')),
    slider('Onion skin opacity', 0.05, 1, 0.01, () => a.onionOpacity, (v) => { a.onionOpacity = v; }, (v) => Math.round(v * 100) + '%'),
    toggle('Color onion skins (red = before, green = after)', () => a.onionTint, (v) => { a.onionTint = v; }),
    el('div', { class: 'group-title' }, 'Layers'),
    toggle('Bottom layer is a fixed background', () => a.bgBottom, (v) => { a.bgBottom = v; app.doc.syncAnimFrame(); }),
    toggle('Top layer is a fixed foreground', () => a.fgTop, (v) => { a.fgTop = v; app.doc.syncAnimFrame(); }),
    el('div', { class: 'group-title' }, 'Export'),
    el('button', { class: 'row', onclick: () => exportAnimation('gif') }, el('span', { class: 'row-ic', html: icon('share') }), el('span', { class: 'row-label' }, 'Export animated GIF')),
    el('button', { class: 'row', onclick: () => exportAnimation('video') }, el('span', { class: 'row-ic', html: icon('video') }), el('span', { class: 'row-label' }, 'Export video (MP4 / WebM)')),
    el('div', { class: 'info small' }, `${frames().length} frames · ${(frames().reduce((s, f) => s + holdOf(f), 0) / a.fps).toFixed(1)} s per loop. Two-finger tap still undoes; tap the current frame for hold, duplicate and delete.`),
  );
}

// ---------------------------------------------------------------- export

function renderFrame(i, w, h, flatten) {
  const d = app.doc;
  const c = makeCanvas(w, h);
  const x = c.getContext('2d');
  if (flatten && !d.bgVisible) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); }
  x.scale(w / d.width, h / d.height);
  x.imageSmoothingQuality = 'high';
  d.composite(x, null, true, { frame: i });
  return c;
}

function progressModal(title) {
  const status = el('p', { class: 'modal-text' }, 'Preparing…');
  let cancelled = false;
  modal({ title, body: status, buttons: [{ label: 'Cancel', value: 'cancel' }] }).then((v) => { if (v === 'cancel') cancelled = true; });
  return {
    set: (t) => { status.textContent = t; },
    get cancelled() { return cancelled; },
    close: () => { const m = $('#modal'); if (m._close && !cancelled) m._close(null); },
  };
}

function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const o of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(o)) return o; } catch (e) { /* ignore */ }
  }
  return null;
}

export async function exportAnimation(kind) {
  stopPlayback();
  const d = app.doc;
  const fr = frames();
  if (fr.length < 2) { toast('Add at least two frames first'); return; }
  const a = d.anim;
  const seq = sequence(fr.length, a.loop);
  const maxSide = kind === 'gif' ? 1080 : 1920;
  const k = Math.min(1, maxSide / Math.max(d.width, d.height));
  let w = Math.max(2, Math.round(d.width * k)), h = Math.max(2, Math.round(d.height * k));
  if (kind === 'video') { w -= w % 2; h -= h % 2; }
  const name = safeName(app.artName);
  const p = progressModal(kind === 'gif' ? 'Exporting GIF' : 'Exporting video');
  try {
    if (kind === 'gif') {
      const data = [];
      for (let i = 0; i < seq.length; i++) {
        if (p.cancelled) return;
        p.set(`Rendering frame ${i + 1} of ${seq.length}…`);
        const c = renderFrame(seq[i], w, h, false);
        data.push({ data: c.getContext('2d').getImageData(0, 0, w, h).data, delay: (100 / a.fps) * holdOf(fr[seq[i]]) });
        await new Promise((r) => setTimeout(r, 0));
      }
      const transparent = !d.bgVisible;
      const blob = await encodeGIF(data, w, h, {
        transparent, loop: a.loop !== 'once',
        onProgress: (n, t) => p.set(`Encoding frame ${n} of ${t}…`),
      });
      if (p.cancelled) return;
      p.close();
      await saveBlob(blob, name + '.gif');
    } else {
      const mime = pickMime();
      const cv = makeCanvas(w, h);
      if (!mime || !cv.captureStream) { p.set('Video recording is not supported here. Export a GIF instead.'); return; }
      const ctx = cv.getContext('2d');
      const imgs = seq.map((i) => renderFrame(i, w, h, true));
      ctx.drawImage(imgs[0], 0, 0);
      const stream = cv.captureStream(Math.min(60, Math.max(a.fps, 12)));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((r) => { rec.onstop = r; });
      rec.start(250);
      const loopMs = seq.reduce((s, i) => s + (1000 / a.fps) * holdOf(fr[i]), 0);
      const repeats = a.loop === 'once' ? 1 : Math.max(1, Math.min(10, Math.ceil(4000 / loopMs)));
      for (let r = 0; r < repeats && !p.cancelled; r++) {
        for (let i = 0; i < seq.length && !p.cancelled; i++) {
          ctx.drawImage(imgs[i], 0, 0);
          p.set(`Recording… pass ${r + 1} of ${repeats}`);
          await new Promise((res) => setTimeout(res, (1000 / a.fps) * holdOf(fr[seq[i]])));
        }
      }
      rec.stop();
      await done;
      if (p.cancelled) return;
      p.close();
      await saveBlob(new Blob(chunks, { type: mime.split(';')[0] }), name + '-animation.' + (mime.includes('mp4') ? 'mp4' : 'webm'));
    }
  } catch (e) {
    console.error(e);
    p.set('Export failed: ' + e.message);
  }
}
