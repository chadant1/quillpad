// Editor core: rendering, strokes, tools, transform, selection, adjustments and layer operations.
import {
  app, requestRender, edited, toast, makeCanvas, viewScale, screenToDoc, clamp, blobToImage,
} from './state.js';
import { Doc, selectionPath, clipToSelection, contentBounds, selectionBounds } from './doc.js';
import {
  history, beginPixels, endPixels, restoreBackup, recordStruct, structChange, pixelOp, clampRect, ensureBackup,
} from './history.js';
import { Stroke, getPreset } from './brush.js';
import { detectShape } from './quickshape.js';
import { hsvToHex, rgbToHsv, hexToRgb } from './color.js';
import { floodMask, runAdjustment } from './filters.js';

// ---------------------------------------------------------------- setup

export function attachDoc(doc) {
  app.doc = doc;
  const W = doc.width, H = doc.height;
  app.compCanvas = makeCanvas(W, H);
  app.strokeCanvas = makeCanvas(W, H);
  app.previewCanvas = makeCanvas(W, H);
  app.backup = makeCanvas(W, H);
  app.sample1 = makeCanvas(1, 1);
  app.stroke = null;
  app.xf = null;
  app.adjust = null;
  app.lasso = null;
  app.compDirty = true;
  history.clear();
  fitView();
}

export function resizeStage() {
  const s = app.stage;
  if (!s) return;
  const r = s.getBoundingClientRect();
  app.dpr = Math.min(window.devicePixelRatio || 1, 3);
  s.width = Math.max(1, Math.round(r.width * app.dpr));
  s.height = Math.max(1, Math.round(r.height * app.dpr));
  requestRender();
}

export function fitView() {
  const d = app.doc;
  if (!d || !app.stage) return;
  const r = app.stage.getBoundingClientRect();
  const W = r.width || window.innerWidth, H = r.height || window.innerHeight;
  const padX = 64, padTop = 64, padBottom = 24;
  const k = Math.min((W - padX * 2) / d.width, (H - padTop - padBottom) / d.height);
  const tx = (W - d.width * k) / 2;
  const ty = padTop + (H - padTop - padBottom - d.height * k) / 2;
  app.view = new DOMMatrix([k, 0, 0, k, tx, ty]);
  if (app.viewFlipped) app.view = app.view.multiply(flipMatrix());
  requestRender();
}

export function actualSize() {
  const d = app.doc;
  const r = app.stage.getBoundingClientRect();
  app.view = new DOMMatrix([1, 0, 0, 1, (r.width - d.width) / 2, (r.height - d.height) / 2]);
  if (app.viewFlipped) app.view = app.view.multiply(flipMatrix());
  requestRender();
}

function flipMatrix() {
  const W = app.doc.width;
  return new DOMMatrix().translate(W / 2, 0).scale(-1, 1).translate(-W / 2, 0);
}

export function toggleFlipView() {
  app.viewFlipped = !app.viewFlipped;
  app.view = app.view.multiply(flipMatrix());
  requestRender();
}

// ---------------------------------------------------------------- render

let checker = null;
function checkerPattern(ctx) {
  if (!checker) {
    const c = makeCanvas(16, 16);
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#d9d9de'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    checker = c;
  }
  return ctx.createPattern(checker, 'repeat');
}

export function rebuildComp() {
  const d = app.doc;
  const cc = app.compCanvas.getContext('2d');
  cc.setTransform(1, 0, 0, 1, 0, 0);
  cc.globalCompositeOperation = 'source-over';
  cc.globalAlpha = 1;
  cc.clearRect(0, 0, d.width, d.height);
  let ov = null;
  const pc = app.previewCanvas.getContext('2d');
  if (app.stroke && app.stroke.mode !== 'smudge') {
    const s = app.stroke;
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.globalCompositeOperation = 'source-over';
    pc.globalAlpha = 1;
    pc.clearRect(0, 0, d.width, d.height);
    pc.drawImage(s.layer.canvas, 0, 0);
    pc.globalAlpha = s.opacity;
    pc.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : (s.layer.alphaLock ? 'source-atop' : 'source-over');
    pc.drawImage(app.strokeCanvas, 0, 0);
    pc.globalAlpha = 1;
    pc.globalCompositeOperation = 'source-over';
    ov = new Map([[s.layer, app.previewCanvas]]);
  } else if (app.xf) {
    const x = app.xf;
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.globalCompositeOperation = 'source-over';
    pc.globalAlpha = 1;
    pc.clearRect(0, 0, d.width, d.height);
    pc.drawImage(x.layer.canvas, 0, 0);
    pc.setTransform(x.M);
    pc.imageSmoothingQuality = 'high';
    pc.drawImage(x.floating, 0, 0);
    pc.setTransform(1, 0, 0, 1, 0, 0);
    ov = new Map([[x.layer, app.previewCanvas]]);
  }
  d.composite(cc, ov);
}

export function render() {
  const d = app.doc;
  const s = app.stage;
  if (!d || !s || !app.editorVisible) return;
  if (app.compDirty || app.stroke || app.xf) {
    rebuildComp();
    app.compDirty = false;
  }
  const ctx = app.sctx, dpr = app.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#1a1a1d';
  ctx.fillRect(0, 0, s.width, s.height);
  const m = app.view;
  const k = viewScale();
  ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 28 * dpr;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, d.width, d.height);
  ctx.restore();
  if (!d.bgVisible) {
    const pat = checkerPattern(ctx);
    if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / k, 1 / k));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, d.width, d.height);
  }
  ctx.imageSmoothingEnabled = k < 2.5;
  ctx.imageSmoothingQuality = k < 1 ? 'medium' : 'low';
  ctx.drawImage(app.compCanvas, 0, 0);
  drawOverlays(ctx, k);
}

function drawOverlays(ctx, k) {
  const d = app.doc;
  const lw = 1 / k;
  // grid guide
  if (app.grid.on) {
    ctx.beginPath();
    const g = Math.max(4, app.grid.size);
    for (let x = g; x < d.width; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, d.height); }
    for (let y = g; y < d.height; y += g) { ctx.moveTo(0, y); ctx.lineTo(d.width, y); }
    ctx.strokeStyle = 'rgba(80,140,255,0.45)';
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  // symmetry guide
  if (app.symmetry !== 'off') {
    ctx.beginPath();
    const cx = d.width / 2, cy = d.height / 2;
    if (app.symmetry === 'vertical' || app.symmetry === 'quadrant') { ctx.moveTo(cx, 0); ctx.lineTo(cx, d.height); }
    if (app.symmetry === 'horizontal' || app.symmetry === 'quadrant') { ctx.moveTo(0, cy); ctx.lineTo(d.width, cy); }
    if (app.symmetry === 'radial') {
      const R = Math.hypot(d.width, d.height);
      for (let i = 0; i < 8; i++) { const t = (i * Math.PI) / 4; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); }
    }
    ctx.strokeStyle = 'rgba(64,170,255,0.85)';
    ctx.lineWidth = 1.5 * lw;
    ctx.stroke();
  }
  // selection
  if (d.selection && !app.xf) {
    const p = selectionPath(d.selection, d.width, d.height);
    const outside = new Path2D();
    outside.rect(0, 0, d.width, d.height);
    outside.addPath(p);
    ctx.fillStyle = 'rgba(20,20,30,0.28)';
    ctx.fill(outside, 'evenodd');
    ctx.lineWidth = lw * 1.2;
    ctx.setLineDash([5 * lw, 5 * lw]);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(p);
    ctx.lineDashOffset = 5 * lw;
    ctx.strokeStyle = '#111';
    ctx.stroke(p);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  // lasso in progress
  if (app.lasso) {
    const poly = lassoPolygon(app.lasso);
    if (poly.length > 1) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (const q of poly) ctx.lineTo(q.x, q.y);
      if (app.lasso.mode !== 'freehand') ctx.closePath();
      ctx.lineWidth = 1.5 * lw;
      ctx.setLineDash([6 * lw, 4 * lw]);
      ctx.strokeStyle = '#2f8cff';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // transform box
  if (app.xf) {
    const q = xfCornersScreen();
    const dpr = app.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#2f8cff';
    ctx.stroke();
    const rh = xfRotateHandle(q);
    ctx.beginPath(); ctx.moveTo((q[0].x + q[1].x) / 2, (q[0].y + q[1].y) / 2); ctx.lineTo(rh.x, rh.y); ctx.stroke();
    const dot = (p, fill) => { ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#2f8cff'; ctx.stroke(); };
    q.forEach((p) => dot(p, '#fff'));
    dot(rh, '#2f8cff');
  }
}

// ---------------------------------------------------------------- strokes

export function currentHex() { return hsvToHex(app.color); }

export function canPaint() {
  const l = app.doc && app.doc.active;
  if (!l) return false;
  if (!l.visible) { toast('This layer is hidden'); return false; }
  return true;
}

export function beginStroke(x, y, p) {
  const d = app.doc, layer = d.active;
  const tool = app.tool;
  const t = app.tools[tool];
  if (!t) return;
  const mode = tool === 'brush' ? 'paint' : tool === 'eraser' ? 'erase' : 'smudge';
  if (mode === 'smudge') beginPixels(layer);
  const clipPath = d.selection ? selectionPath(d.selection, d.width, d.height) : null;
  app.stroke = new Stroke({
    mode, preset: getPreset(t.preset), color: currentHex(), size: t.size, opacity: t.opacity,
    layer, doc: d, strokeCanvas: app.strokeCanvas, symmetry: app.symmetry, clipPath,
  });
  app.stroke.add(x, y, p);
  requestRender();
}

export function tryQuickShape() {
  const s = app.stroke;
  if (!s || s.shaped || s.mode === 'smudge' || !app.settings.quickShape || s.p.quickShape === false) return false;
  const sh = detectShape(s.points);
  if (!sh) return false;
  s.replaceWith(sh.pts);
  toast(sh.type);
  if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* ignore */ }
  requestRender();
  return true;
}

export function commitStroke() {
  const s = app.stroke;
  if (!s) return;
  s.finish();
  const b = s.end();
  app.stroke = null;
  const d = app.doc, layer = s.layer;
  if (!b) { app.compDirty = true; requestRender(); return; }
  if (s.mode === 'smudge') {
    history.push(endPixels(layer, b));
  } else {
    const r = clampRect(b, d.width, d.height);
    const sc = app.strokeCanvas.getContext('2d');
    if (r) {
      const before = layer.ctx.getImageData(r.x, r.y, r.w, r.h);
      const c = layer.ctx;
      c.save();
      c.globalAlpha = s.opacity;
      c.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : (layer.alphaLock ? 'source-atop' : 'source-over');
      c.drawImage(app.strokeCanvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      c.restore();
      const after = c.getImageData(r.x, r.y, r.w, r.h);
      layer.touch();
      history.push({ kind: 'pixels', layer, x: r.x, y: r.y, before, after });
    }
    sc.clearRect(0, 0, d.width, d.height);
    if (s.mode === 'paint') addRecentColor(s.color);
  }
  edited();
}

export function cancelStroke() {
  const s = app.stroke;
  if (!s) return;
  s.end();
  app.stroke = null;
  if (s.mode === 'smudge') restoreBackup(s.layer);
  else app.strokeCanvas.getContext('2d').clearRect(0, 0, app.doc.width, app.doc.height);
  app.compDirty = true;
  requestRender();
}

// ---------------------------------------------------------------- color

export function addRecentColor(hex) {
  const r = app.recentColors.filter((c) => c !== hex);
  r.unshift(hex);
  app.recentColors = r.slice(0, 10);
  try { localStorage.setItem('quillpad.recent', JSON.stringify(app.recentColors)); } catch (e) { /* ignore */ }
}

export function setColorHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  app.color = rgbToHsv(...rgb);
  if (app.onColor) app.onColor();
}

export function sampleAt(x, y) {
  const d = app.doc;
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return null;
  if (app.compDirty) { rebuildComp(); app.compDirty = false; }
  const c = app.sample1.getContext('2d', { willReadFrequently: true });
  c.clearRect(0, 0, 1, 1);
  c.drawImage(app.compCanvas, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
  const px = c.getImageData(0, 0, 1, 1).data;
  if (px[3] < 4) return null;
  return [px[0], px[1], px[2]];
}

// ColorDrop: flood fill at a document point using the current color
export function colorDrop(x, y) {
  const d = app.doc, layer = d.active;
  if (!canPaint()) return;
  const hex = currentHex();
  const [cr, cg, cb] = hexToRgb(hex);
  const W = d.width, H = d.height;
  if (d.selection) {
    pixelOp(layer, (ctx) => {
      ctx.save();
      clipToSelection(ctx, d);
      ctx.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    });
    addRecentColor(hex);
    toast('Filled selection');
    return;
  }
  const refLayer = d.layers.find((l) => l.reference && l !== layer);
  let refData;
  if (refLayer) refData = refLayer.ctx.getImageData(0, 0, W, H).data;
  else refData = layer.ctx.getImageData(0, 0, W, H).data;
  const res = floodMask(refData, W, H, x, y, app.settings.fillThreshold);
  if (!res) return;
  const { mask, x: bx, y: by, w: bw, h: bh } = res;
  const before = layer.ctx.getImageData(bx, by, bw, bh);
  const after = new ImageData(new Uint8ClampedArray(before.data), bw, bh);
  const ad = after.data;
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      if (!mask[(by + yy) * W + bx + xx]) continue;
      const i = (yy * bw + xx) * 4;
      if (layer.alphaLock) {
        if (ad[i + 3]) { ad[i] = cr; ad[i + 1] = cg; ad[i + 2] = cb; }
      } else {
        ad[i] = cr; ad[i + 1] = cg; ad[i + 2] = cb; ad[i + 3] = 255;
      }
    }
  }
  layer.ctx.putImageData(after, bx, by);
  layer.touch();
  history.push({ kind: 'pixels', layer, x: bx, y: by, before, after });
  addRecentColor(hex);
  edited();
}

// ---------------------------------------------------------------- selection

function ellipsePoly(x0, y0, x1, y1, n = 72) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const pts = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry }); }
  return pts;
}

export function lassoPolygon(l) {
  if (l.mode === 'freehand') return l.pts;
  const a = l.start, b = l.end || l.start;
  if (l.mode === 'rect') return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  return ellipsePoly(a.x, a.y, b.x, b.y);
}

export function selectionStart(x, y) {
  app.lasso = { mode: app.selectMode, pts: [{ x, y }], start: { x, y }, end: { x, y } };
  requestRender();
}

export function selectionMove(x, y) {
  const l = app.lasso;
  if (!l) return;
  if (l.mode === 'freehand') {
    const last = l.pts[l.pts.length - 1];
    if (Math.hypot(x - last.x, y - last.y) * viewScale() > 2) l.pts.push({ x, y });
  } else {
    l.end = { x, y };
  }
  requestRender();
}

export function selectionEnd() {
  const l = app.lasso;
  app.lasso = null;
  if (!l) return;
  const poly = lassoPolygon(l);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (poly.length < 3 || (x1 - x0) * viewScale() < 6 || (y1 - y0) * viewScale() < 6) {
    app.doc.selection = null;
  } else {
    app.doc.selection = { polys: [poly], inverted: false };
  }
  if (app.onSelectionChange) app.onSelectionChange();
  requestRender();
}

export function invertSelection() {
  const d = app.doc;
  if (!d.selection) return;
  d.selection = { ...d.selection, inverted: !d.selection.inverted };
  requestRender();
}

export function deselect() {
  app.doc.selection = null;
  if (app.onSelectionChange) app.onSelectionChange();
  requestRender();
}

export function selectAll() {
  const d = app.doc;
  d.selection = { polys: [[{ x: 0, y: 0 }, { x: d.width, y: 0 }, { x: d.width, y: d.height }, { x: 0, y: d.height }]], inverted: false };
  requestRender();
}

export function clearSelectionContents() {
  const d = app.doc, layer = d.active;
  pixelOp(layer, (ctx) => {
    ctx.save();
    if (d.selection) clipToSelection(ctx, d);
    ctx.clearRect(0, 0, d.width, d.height);
    ctx.restore();
  });
}

export function fillSelectionOrLayer() {
  const d = app.doc, layer = d.active;
  pixelOp(layer, (ctx) => {
    ctx.save();
    if (d.selection) clipToSelection(ctx, d);
    ctx.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
    ctx.fillStyle = currentHex();
    ctx.fillRect(0, 0, d.width, d.height);
    ctx.restore();
  });
}

export function copySelectionToLayer(cut = false) {
  const d = app.doc, src = d.active;
  if (d.layers.length >= d.maxLayers()) { toast('Layer limit reached'); return; }
  const l = d.newLayer(src.name + (cut ? ' cut' : ' copy'));
  l.ctx.save();
  if (d.selection) clipToSelection(l.ctx, d);
  l.ctx.drawImage(src.canvas, 0, 0);
  l.ctx.restore();
  const entries = [];
  if (cut) {
    beginPixels(src);
    src.ctx.save();
    if (d.selection) clipToSelection(src.ctx, d);
    src.ctx.clearRect(0, 0, d.width, d.height);
    src.ctx.restore();
    entries.push(endPixels(src));
  }
  const { entry } = structChange(() => { d.layers.splice(d.activeIndex + 1, 0, l); d.activeIndex++; });
  entries.push(entry);
  history.push({ kind: 'multi', entries });
  d.selection = null;
  edited();
  toast(cut ? 'Cut to new layer' : 'Copied to new layer');
}

// ---------------------------------------------------------------- transform

export function beginTransform() {
  const d = app.doc, layer = d.active;
  if (app.xf) return true;
  if (!layer.visible) { toast('This layer is hidden'); return false; }
  beginPixels(layer);
  const f = makeCanvas(d.width, d.height);
  const fc = f.getContext('2d');
  fc.drawImage(layer.canvas, 0, 0);
  if (d.selection) {
    fc.globalCompositeOperation = 'destination-in';
    fc.fillStyle = '#000';
    fc.fill(selectionPath(d.selection, d.width, d.height), 'evenodd');
    fc.globalCompositeOperation = 'source-over';
    layer.ctx.save();
    clipToSelection(layer.ctx, d);
    layer.ctx.clearRect(0, 0, d.width, d.height);
    layer.ctx.restore();
  } else {
    layer.ctx.clearRect(0, 0, d.width, d.height);
  }
  const box = contentBounds(f);
  if (!box) {
    restoreBackup(layer);
    toast('Nothing to transform on this layer');
    return false;
  }
  app.xf = { layer, floating: f, M: new DOMMatrix(), box, freeform: false, sel: d.selection };
  requestRender();
  return true;
}

export function xfLocalCorners(x) {
  const b = x.box;
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
}

export function xfCornersScreen() {
  const x = app.xf;
  return xfLocalCorners(x).map((p) => {
    const q = x.M.transformPoint(new DOMPoint(p.x, p.y));
    const s = app.view.transformPoint(q);
    return { x: s.x, y: s.y };
  });
}

export function xfRotateHandle(q) {
  const mx = (q[0].x + q[1].x) / 2, my = (q[0].y + q[1].y) / 2;
  const cx = (q[0].x + q[2].x) / 2, cy = (q[0].y + q[2].y) / 2;
  let dx = mx - cx, dy = my - cy;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  return { x: mx + dx * 36, y: my + dy * 36 };
}

export function xfSet(M) {
  if (!app.xf) return;
  app.xf.M = M;
  requestRender();
}

function xfCenterDoc() {
  const x = app.xf, b = x.box;
  return x.M.transformPoint(new DOMPoint(b.x + b.w / 2, b.y + b.h / 2));
}

export function xfFlip(h) {
  const x = app.xf;
  if (!x) return;
  const b = x.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  xfSet(x.M.translate(cx, cy).scale(h ? -1 : 1, h ? 1 : -1).translate(-cx, -cy));
}

export function xfRotate(deg) {
  const x = app.xf;
  if (!x) return;
  const c = xfCenterDoc();
  xfSet(new DOMMatrix().translate(c.x, c.y).rotate(deg).translate(-c.x, -c.y).multiply(x.M));
}

export function xfFit() {
  const x = app.xf, d = app.doc;
  if (!x) return;
  const b = x.box;
  const k = Math.min(d.width / b.w, d.height / b.h);
  xfSet(new DOMMatrix().translate(d.width / 2, d.height / 2).scale(k, k).translate(-(b.x + b.w / 2), -(b.y + b.h / 2)));
}

export function xfReset() { if (app.xf) xfSet(new DOMMatrix()); }

export function commitTransform() {
  const x = app.xf;
  if (!x) return;
  app.xf = null;
  const d = app.doc;
  if (x.M.isIdentity) {
    restoreBackup(x.layer);
    app.compDirty = true;
    requestRender();
    return;
  }
  const c = x.layer.ctx;
  c.save();
  c.setTransform(x.M);
  c.imageSmoothingQuality = 'high';
  c.drawImage(x.floating, 0, 0);
  c.restore();
  // changed area = original box ∪ transformed box
  const pts = xfLocalCorners(x).map((p) => x.M.transformPoint(new DOMPoint(p.x, p.y)));
  let x0 = x.box.x, y0 = x.box.y, x1 = x.box.x + x.box.w, y1 = x.box.y + x.box.h;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  history.push(endPixels(x.layer, { x: x0 - 2, y: y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 }));
  if (x.sel) {
    d.selection = {
      inverted: x.sel.inverted,
      polys: x.sel.polys.map((poly) => poly.map((p) => { const q = x.M.transformPoint(new DOMPoint(p.x, p.y)); return { x: q.x, y: q.y }; })),
    };
  }
  edited();
}

export function cancelTransform() {
  const x = app.xf;
  if (!x) return;
  app.xf = null;
  restoreBackup(x.layer);
  app.compDirty = true;
  requestRender();
}

// ---------------------------------------------------------------- adjustments

export function beginAdjust(def) {
  const d = app.doc, layer = d.active;
  if (!layer.visible) { toast('This layer is hidden'); return false; }
  beginPixels(layer);
  const src = app.backup.getContext('2d').getImageData(0, 0, d.width, d.height);
  const values = {};
  for (const [k, , , , def0] of def.params) values[k] = def0;
  app.adjust = { def, layer, src, dst: new ImageData(d.width, d.height), values, tmp: makeCanvas(d.width, d.height), pending: false };
  if (!def.params.length) {
    computeAdjust();
    commitAdjust();
    return false;
  }
  return true;
}

export function setAdjustValue(k, v) {
  const a = app.adjust;
  if (!a) return;
  a.values[k] = v;
  if (a.pending) return;
  a.pending = true;
  requestAnimationFrame(() => {
    if (!app.adjust) return;
    a.pending = false;
    computeAdjust();
  });
}

function computeAdjust() {
  const a = app.adjust, d = app.doc;
  runAdjustment(a.def.id, a.values, a.src.data, a.dst.data, d.width, d.height);
  const c = a.layer.ctx;
  if (d.selection) {
    a.tmp.getContext('2d').putImageData(a.dst, 0, 0);
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, d.width, d.height);
    c.drawImage(app.backup, 0, 0);
    clipToSelection(c, d);
    c.clearRect(0, 0, d.width, d.height);
    c.drawImage(a.tmp, 0, 0);
    c.restore();
  } else {
    c.putImageData(a.dst, 0, 0);
  }
  app.compDirty = true;
  requestRender();
}

export function commitAdjust() {
  const a = app.adjust;
  if (!a) return;
  if (a.pending) { a.pending = false; computeAdjust(); }
  app.adjust = null;
  history.push(endPixels(a.layer));
  edited();
}

export function cancelAdjust() {
  const a = app.adjust;
  if (!a) return;
  app.adjust = null;
  restoreBackup(a.layer);
  app.compDirty = true;
  requestRender();
}

// ---------------------------------------------------------------- layers

export function addLayer() {
  const d = app.doc;
  if (d.layers.length >= d.maxLayers()) { toast(`Layer limit reached (${d.maxLayers()} at this canvas size)`); return; }
  recordStruct(() => {
    const l = d.newLayer();
    d.layers.splice(d.activeIndex + 1, 0, l);
    d.activeIndex++;
  });
}

export function selectLayer(i) {
  app.doc.activeIndex = clamp(i, 0, app.doc.layers.length - 1);
  if (app.onLayerChange) app.onLayerChange();
}

export function deleteLayer(i) {
  const d = app.doc;
  if (d.layers.length <= 1) {
    clearLayer(i);
    return;
  }
  recordStruct(() => {
    d.layers.splice(i, 1);
    if (d.activeIndex >= d.layers.length) d.activeIndex = d.layers.length - 1;
    else if (d.activeIndex > i) d.activeIndex--;
  });
}

export function duplicateLayer(i) {
  const d = app.doc;
  if (d.layers.length >= d.maxLayers()) { toast('Layer limit reached'); return; }
  const src = d.layers[i];
  const l = d.newLayer(src.name + ' copy');
  l.setProps({ ...src.props(), name: src.name + ' copy' });
  l.ctx.drawImage(src.canvas, 0, 0);
  recordStruct(() => { d.layers.splice(i + 1, 0, l); d.activeIndex = i + 1; });
}

export function moveLayer(i, dir) {
  const d = app.doc;
  const j = i + dir;
  if (j < 0 || j >= d.layers.length) return;
  recordStruct(() => {
    const [l] = d.layers.splice(i, 1);
    d.layers.splice(j, 0, l);
    d.activeIndex = j;
  });
}

export function mergeDown(i) {
  const d = app.doc;
  if (i <= 0) { toast('No layer below to merge into'); return; }
  const upper = d.layers[i], lower = d.layers[i - 1];
  beginPixels(lower);
  if (upper.visible) {
    const c = lower.ctx;
    let src = upper.canvas;
    if (upper.clip) {
      const t = makeCanvas(d.width, d.height), tc = t.getContext('2d');
      tc.drawImage(upper.canvas, 0, 0);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(lower.canvas, 0, 0);
      src = t;
    }
    c.save();
    c.globalAlpha = upper.opacity;
    c.globalCompositeOperation = upper.blend;
    c.drawImage(src, 0, 0);
    c.restore();
  }
  const pe = endPixels(lower);
  const { entry } = structChange(() => {
    d.layers.splice(i, 1);
    d.activeIndex = i - 1;
  });
  history.push({ kind: 'multi', entries: [pe, entry] });
  edited();
}

export function clearLayer(i) {
  const d = app.doc, l = d.layers[i];
  pixelOp(l, (ctx) => {
    ctx.save();
    if (d.selection && i === d.activeIndex) clipToSelection(ctx, d);
    ctx.clearRect(0, 0, d.width, d.height);
    ctx.restore();
  });
}

export function setLayerProps(i, props) {
  const d = app.doc;
  recordStruct(() => { d.layers[i].setProps(props); d.layers[i].touch(); });
}

// live property change without history (opacity slider while dragging)
export function previewLayerProps(i, props) {
  app.doc.layers[i].setProps(props);
  app.compDirty = true;
  requestRender();
}

export function setBackground(color, visible) {
  const d = app.doc;
  const before = { color: d.bgColor, visible: d.bgVisible };
  d.bgColor = color;
  d.bgVisible = visible;
  history.push({ kind: 'bg', before, after: { color, visible } });
  edited();
}

export async function insertImage(file) {
  const d = app.doc;
  if (d.layers.length >= d.maxLayers()) { toast('Layer limit reached'); return false; }
  let img;
  try { img = await blobToImage(file); } catch (e) { toast('Could not read that image'); return false; }
  const iw = img.width, ih = img.height;
  const k = Math.min(1, d.width / iw, d.height / ih);
  const l = d.newLayer('Inserted image');
  l.ctx.imageSmoothingQuality = 'high';
  l.ctx.drawImage(img, (d.width - iw * k) / 2, (d.height - ih * k) / 2, iw * k, ih * k);
  recordStruct(() => { d.layers.splice(d.activeIndex + 1, 0, l); d.activeIndex++; });
  return true;
}

export function flipCanvas(horizontal) {
  const d = app.doc;
  const entries = [];
  for (const l of d.layers) {
    beginPixels(l);
    const c = l.ctx;
    c.save();
    c.setTransform(horizontal ? -1 : 1, 0, 0, horizontal ? 1 : -1, horizontal ? d.width : 0, horizontal ? 0 : d.height);
    c.globalCompositeOperation = 'copy';
    c.drawImage(app.backup, 0, 0);
    c.restore();
    entries.push(endPixels(l));
  }
  history.push({ kind: 'multi', entries });
  edited();
}

export function newDocument(w, h) {
  const d = new Doc(w, h);
  d.layers.push(d.newLayer('Layer 1'));
  return d;
}

export { ensureBackup, selectionBounds };
