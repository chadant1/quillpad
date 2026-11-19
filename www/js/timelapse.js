// Time-lapse recording (a small JPEG frame after each edit), replay and video export.
import { app, el, $, toast, makeCanvas, canvasToBlob, blobToImage } from './state.js';
import { saveBlob, safeName } from './share.js';

const MAX_SIDE = 720;
const MAX_FRAMES = 1800;
let pending = false;

export function scheduleFrame() {
  if (pending || !app.doc) return;
  pending = true;
  setTimeout(captureFrame, 350);
}

async function captureFrame() {
  pending = false;
  const d = app.doc;
  if (!d) return;
  const k = Math.min(1, MAX_SIDE / Math.max(d.width, d.height));
  const c = makeCanvas(d.width * k, d.height * k);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.scale(k, k);
  d.composite(x);
  try {
    const b = await canvasToBlob(c, 'image/jpeg', 0.72);
    if (app.doc !== d) return;
    app.frames.push(b);
    if (app.frames.length > MAX_FRAMES) app.frames = app.frames.filter((_, i) => i % 2 === 0);
  } catch (e) { /* ignore */ }
}

function overlay(title) {
  const m = $('#modal');
  m.innerHTML = '';
  m.className = 'fullscreen';
  const cv = makeCanvas(10, 10);
  cv.className = 'lapse-canvas';
  const status = el('div', { class: 'lapse-status' }, '');
  const bar = el('div', { class: 'lapse-bar' });
  const box = el('div', { class: 'lapse' }, el('div', { class: 'lapse-head' }, el('h3', {}, title), bar), el('div', { class: 'lapse-stage' }, cv), status);
  m.append(box);
  m.classList.remove('hidden');
  return { m, cv, status, bar, close: () => { m.classList.add('hidden'); m.innerHTML = ''; m.className = ''; } };
}

function sizeCanvas(cv, img) {
  cv.width = img.width;
  cv.height = img.height;
}

export async function replayTimelapse() {
  const frames = app.frames.slice();
  if (frames.length < 2) { toast('Draw a few strokes first — time-lapse frames are recorded as you paint'); return; }
  const o = overlay('Time-lapse replay');
  let stop = false;
  o.bar.append(
    el('button', { class: 'btn', onclick: () => { stop = true; o.close(); exportTimelapse(); } }, 'Export video'),
    el('button', { class: 'btn primary', onclick: () => { stop = true; o.close(); } }, 'Done'),
  );
  const ctx = o.cv.getContext('2d');
  const fps = Math.max(24, frames.length / 18);
  const play = async () => {
    for (let i = 0; i < frames.length && !stop; i++) {
      const t0 = performance.now();
      const img = await blobToImage(frames[i]);
      if (stop) return;
      if (i === 0) sizeCanvas(o.cv, img);
      ctx.drawImage(img, 0, 0, o.cv.width, o.cv.height);
      o.status.textContent = `${i + 1} / ${frames.length}`;
      const wait = 1000 / fps - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    if (!stop) { await new Promise((r) => setTimeout(r, 1500)); if (!stop) play(); }
  };
  play();
}

function pickMime() {
  if (!window.MediaRecorder) return null;
  const options = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const o of options) { try { if (MediaRecorder.isTypeSupported(o)) return o; } catch (e) { /* ignore */ } }
  return null;
}

export async function exportTimelapse() {
  const frames = app.frames.slice();
  if (frames.length < 2) { toast('Not enough time-lapse frames yet'); return; }
  const mime = pickMime();
  const o = overlay('Exporting time-lapse');
  let cancelled = false;
  o.bar.append(el('button', { class: 'btn', onclick: () => { cancelled = true; o.close(); } }, 'Cancel'));
  if (!mime || !o.cv.captureStream) {
    o.status.textContent = 'Video recording is not supported in this browser. Try Chrome, Edge, Safari 14.5+ or the Android app.';
    return;
  }
  const first = await blobToImage(frames[0]);
  // even dimensions keep H.264 encoders happy
  o.cv.width = first.width - (first.width % 2);
  o.cv.height = first.height - (first.height % 2);
  const ctx = o.cv.getContext('2d');
  ctx.drawImage(first, 0, 0, o.cv.width, o.cv.height);
  const fps = 30;
  const stream = o.cv.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(500);
  // keep the video under ~30 s
  const step = Math.max(1, Math.ceil(frames.length / (fps * 30)));
  const list = frames.filter((_, i) => i % step === 0);
  list.push(frames[frames.length - 1]);
  for (let i = 0; i < list.length && !cancelled; i++) {
    const t0 = performance.now();
    const img = await blobToImage(list[i]);
    ctx.drawImage(img, 0, 0, o.cv.width, o.cv.height);
    o.status.textContent = `Recording frame ${i + 1} of ${list.length}…`;
    const wait = 1000 / fps - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  // hold the finished artwork for 2 seconds
  for (let i = 0; i < fps * 2 && !cancelled; i++) {
    ctx.drawImage(o.cv, 0, 0);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await done;
  if (cancelled) return;
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  o.status.textContent = 'Done!';
  o.close();
  await saveBlob(blob, safeName(app.artName) + '-timelapse.' + ext);
}
