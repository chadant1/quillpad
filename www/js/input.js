// Pointer, touch-gesture, mouse-wheel and keyboard handling for the canvas.
import { app, requestRender, screenToDoc, viewScale, toast } from './state.js';
import { history } from './history.js';
import {
  beginStroke, commitStroke, cancelStroke, tryQuickShape, canPaint, sampleAt,
  selectionStart, selectionMove, selectionEnd, xfCornersScreen, xfRotateHandle, xfLocalCorners, xfSet, fitView,
} from './editor.js';
import { rgbToHex } from './color.js';

const pointers = new Map();
let mode = 'idle'; // idle | draw | gesture | eyedrop | pan | select | xf
let drawId = null;
let drawType = '';
let drawStart = 0;
let holdTimer = 0;
let shapeTimer = 0;
let shapeAnchor = null;
let gesture = null;
let pan = null;
let eye = null;
let xfDrag = null;
let spaceDown = false;
let stage;

const STROKE_TOOLS = ['brush', 'eraser', 'smudge'];

function local(e) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pressureOf(e, speed) {
  if (e.pointerType === 'pen') {
    let p = e.pressure || 0;
    if (p <= 0) p = 0.05;
    return Math.pow(p, app.settings.pressureGamma);
  }
  if (e.pointerType === 'touch' && app.settings.speedPressure && speed != null) {
    return Math.max(0.2, Math.min(1, 1.15 - speed * 0.25));
  }
  return 1;
}

// Stylus tilt -> { alt, az } with azimuth converted into document space, or null
function tiltOf(e) {
  if (e.pointerType !== 'pen' || !app.settings.useTilt) return null;
  let alt = e.altitudeAngle, az = e.azimuthAngle;
  if (typeof alt !== 'number' || typeof az !== 'number') {
    const tx = ((e.tiltX || 0) * Math.PI) / 180, ty = ((e.tiltY || 0) * Math.PI) / 180;
    if (!tx && !ty) { alt = Math.PI / 2; az = 0; } else {
      const t = Math.hypot(Math.tan(tx), Math.tan(ty));
      alt = Math.atan(1 / t);
      az = Math.atan2(Math.tan(ty), Math.tan(tx));
    }
  }
  const v = app.view;
  const viewRot = Math.atan2(v.b, v.a);
  const flipped = v.a * v.d - v.b * v.c < 0;
  let docAz = az - viewRot;
  if (flipped) docAz = Math.PI - (az + viewRot);
  return { alt, az: docAz };
}

function touchCanDraw() {
  const s = app.settings.fingerDraw;
  if (s === 'on') return true;
  if (s === 'off') return false;
  return !app.penSeen;
}

function clearTimers() {
  clearTimeout(holdTimer); holdTimer = 0;
  clearTimeout(shapeTimer); shapeTimer = 0;
}

export function isBusy() { return mode !== 'idle'; }

export function armEyedropper(on) {
  app.eyedropArmed = on;
  const b = document.getElementById('btn-eyedrop');
  if (b) b.classList.toggle('active', !!on);
}

export function setupInput(el) {
  stage = el;
  el.addEventListener('pointerdown', onDown, { passive: false });
  el.addEventListener('pointermove', onMove, { passive: false });
  el.addEventListener('pointerup', onUp, { passive: false });
  el.addEventListener('pointercancel', onCancel, { passive: false });
  el.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) onUp(e); });
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // stop iOS Safari page zoom / callouts
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
  el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function onDown(e) {
  e.preventDefault();
  if (!app.doc) return;
  try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  if (e.pointerType === 'pen') app.penSeen = true;
  const pt = local(e);
  const now = performance.now();
  pointers.set(e.pointerId, { x: pt.x, y: pt.y, sx: pt.x, sy: pt.y, type: e.pointerType, t: now, lt: now });
  const touch = e.pointerType === 'touch';

  if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || spaceDown)) {
    if (mode === 'idle') { mode = 'pan'; pan = { pt, view: app.view }; }
    return;
  }
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  if (mode === 'gesture') { gestureAdd(e.pointerId); return; }

  if (touch && pointers.size >= 2) {
    // second finger: turn a fresh one-finger action into a gesture
    if (mode === 'draw') {
      if (drawType !== 'touch') { pointers.delete(e.pointerId); return; }
      if (now - drawStart < 450) cancelStroke();
      else { pointers.delete(e.pointerId); return; }
    } else if (mode === 'select') {
      app.lasso = null;
    } else if (mode === 'eyedrop') {
      endEyedrop(false);
    } else if (mode === 'xf') {
      xfDrag = null;
    } else if (mode !== 'idle') {
      return;
    }
    clearTimers();
    startGesture();
    return;
  }
  if (mode !== 'idle') return;

  if (touch && !touchCanDraw() && (STROKE_TOOLS.includes(app.tool) || app.tool === 'select')) {
    startGesture();
    return;
  }

  if (app.eyedropArmed) { startEyedrop(e.pointerId, pt); return; }

  const dp = screenToDoc(pt.x, pt.y);
  if (STROKE_TOOLS.includes(app.tool)) {
    if (!canPaint()) { if (touch) startGesture(); return; }
    if (app.onStrokeStart) app.onStrokeStart();
    mode = 'draw';
    drawId = e.pointerId;
    drawType = e.pointerType;
    drawStart = now;
    shapeAnchor = { ...pt };
    beginStroke(dp.x, dp.y, pressureOf(e, 0), tiltOf(e));
    if (touch) {
      holdTimer = setTimeout(() => {
        const p = pointers.get(drawId);
        if (p && mode === 'draw' && Math.hypot(p.x - p.sx, p.y - p.sy) < 8) {
          cancelStroke();
          startEyedrop(drawId, p);
        }
      }, 520);
    }
  } else if (app.tool === 'select') {
    mode = 'select';
    drawId = e.pointerId;
    selectionStart(dp.x, dp.y);
  } else if (app.tool === 'transform') {
    if (app.xf) { mode = 'xf'; drawId = e.pointerId; xfStart(pt); }
    else if (touch) startGesture();
  }
}

function onMove(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  const pt = local(e);
  const now = performance.now();
  const dt = Math.max(1, now - p.lt);
  const speed = Math.hypot(pt.x - p.x, pt.y - p.y) / dt;
  p.x = pt.x; p.y = pt.y; p.lt = now;

  switch (mode) {
    case 'draw': {
      if (e.pointerId !== drawId || !app.stroke) return;
      let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      const r = stage.getBoundingClientRect();
      for (const ev of evs) {
        const dp = screenToDoc(ev.clientX - r.left, ev.clientY - r.top);
        app.stroke.add(dp.x, dp.y, pressureOf(ev, speed), tiltOf(ev));
      }
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) { clearTimeout(holdTimer); holdTimer = 0; }
      if (!shapeAnchor || Math.hypot(pt.x - shapeAnchor.x, pt.y - shapeAnchor.y) > 3) {
        shapeAnchor = { ...pt };
        clearTimeout(shapeTimer);
        if (!app.stroke.shaped) shapeTimer = setTimeout(() => { if (mode === 'draw') tryQuickShape(); }, 600);
      }
      requestRender();
      break;
    }
    case 'eyedrop':
      if (eye && e.pointerId === eye.id) moveEyedrop(pt);
      break;
    case 'gesture':
      gestureMove();
      break;
    case 'pan':
      app.view = new DOMMatrix().translate(pt.x - pan.pt.x, pt.y - pan.pt.y).multiply(pan.view);
      requestRender();
      break;
    case 'select':
      if (e.pointerId === drawId) { const dp = screenToDoc(pt.x, pt.y); selectionMove(dp.x, dp.y); }
      break;
    case 'xf':
      if (e.pointerId === drawId) xfMove(pt);
      break;
  }
}

function onUp(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  switch (mode) {
    case 'draw':
      if (e.pointerId === drawId) { clearTimers(); commitStroke(); mode = 'idle'; drawId = null; }
      break;
    case 'eyedrop':
      if (eye && e.pointerId === eye.id) { endEyedrop(true); mode = 'idle'; }
      break;
    case 'gesture':
      gestureLift(e.pointerId);
      if (pointers.size === 0) endGesture();
      break;
    case 'pan':
      mode = 'idle';
      break;
    case 'select':
      if (e.pointerId === drawId) { selectionEnd(); mode = 'idle'; }
      break;
    case 'xf':
      if (e.pointerId === drawId) { xfDrag = null; mode = 'idle'; }
      break;
  }
  if (pointers.size === 0 && mode !== 'idle' && mode !== 'gesture') mode = 'idle';
}

function onCancel(e) { onUp(e); }

// ---------------------------------------------------------------- gestures

function startGesture() {
  mode = 'gesture';
  const ids = [...pointers.keys()];
  gesture = { start: performance.now(), maxCount: pointers.size, ids: ids.slice(0, 2), base: null, moved: 0, xf: !!app.xf };
  gestureBase();
}

function gestureBase() {
  const g = gesture;
  const pts = g.ids.map((id) => pointers.get(id)).filter(Boolean);
  g.base = {
    pts: pts.map((p) => ({ x: p.x, y: p.y })),
    view: app.view,
    M: app.xf ? app.xf.M : null,
  };
}

function gestureAdd(id) {
  const g = gesture;
  g.maxCount = Math.max(g.maxCount, pointers.size);
  if (g.ids.length < 2) { g.ids.push(id); gestureBase(); }
}

function gestureLift(id) {
  const g = gesture;
  if (!g) return;
  const i = g.ids.indexOf(id);
  if (i >= 0) {
    g.ids.splice(i, 1);
    for (const k of pointers.keys()) if (g.ids.length < 2 && !g.ids.includes(k)) g.ids.push(k);
    gestureBase();
  }
}

function gestureMove() {
  const g = gesture;
  if (!g || !g.base) return;
  for (const p of pointers.values()) g.moved = Math.max(g.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
  const cur = g.ids.map((id) => pointers.get(id)).filter(Boolean);
  const b = g.base;
  if (cur.length !== b.pts.length || !cur.length) return;
  let m0, m1, k = 1, th = 0;
  if (cur.length === 1) {
    m0 = b.pts[0]; m1 = cur[0];
  } else {
    const [p1, p2] = b.pts, [c1, c2] = cur;
    m0 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    m1 = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
    k = Math.hypot(c2.x - c1.x, c2.y - c1.y) / Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
    th = Math.atan2(c2.y - c1.y, c2.x - c1.x) - Math.atan2(p2.y - p1.y, p2.x - p1.x);
  }
  const deg = (th * 180) / Math.PI;
  if (g.xf && app.xf) {
    const inv = app.view.inverse();
    const d0 = inv.transformPoint(new DOMPoint(m0.x, m0.y));
    const d1 = inv.transformPoint(new DOMPoint(m1.x, m1.y));
    const v = app.view;
    const flip = v.a * v.d - v.b * v.c < 0 ? -1 : 1;
    xfSet(new DOMMatrix().translate(d1.x, d1.y).rotate(deg * flip).scale(k, k).translate(-d0.x, -d0.y).multiply(b.M));
    return;
  }
  const s0 = Math.hypot(b.view.a, b.view.b);
  k = Math.min(Math.max(k, 0.02 / s0), 60 / s0);
  app.view = new DOMMatrix().translate(m1.x, m1.y).rotate(deg).scale(k, k).translate(-m0.x, -m0.y).multiply(b.view);
  requestRender();
}

function endGesture() {
  const g = gesture;
  gesture = null;
  mode = 'idle';
  if (!g) return;
  const dt = performance.now() - g.start;
  if (app.settings.gestures && dt < 350 && g.moved < 18 && g.maxCount >= 2) {
    if (g.maxCount === 2) { if (history.undo()) toast('Undo'); }
    else if (g.maxCount === 3) { if (history.redo()) toast('Redo'); }
    else if (g.maxCount >= 4 && app.toggleUI) app.toggleUI();
    return;
  }
  if (g.xf) return;
  // quick pinch closed -> fit to screen
  const s0 = Math.hypot(g.base.view.a, g.base.view.b);
  if (dt < 320 && viewScale() < s0 * 0.65) { fitView(); return; }
  // snap rotation near multiples of 90°
  const v = app.view;
  if (v.a * v.d - v.b * v.c > 0) {
    const ang = (Math.atan2(v.b, v.a) * 180) / Math.PI;
    const target = Math.round(ang / 90) * 90;
    if (Math.abs(ang - target) < 6 && Math.abs(ang - target) > 0.01) {
      const r = stage.getBoundingClientRect();
      const cx = r.width / 2, cy = r.height / 2;
      app.view = new DOMMatrix().translate(cx, cy).rotate(target - ang).translate(-cx, -cy).multiply(v);
      requestRender();
    }
  }
}

// ---------------------------------------------------------------- eyedropper

function startEyedrop(id, pt) {
  mode = 'eyedrop';
  eye = { id, color: null };
  const l = document.getElementById('loupe');
  l.classList.remove('hidden');
  moveEyedrop(pt);
}

function moveEyedrop(pt) {
  const dp = screenToDoc(pt.x, pt.y);
  const c = sampleAt(dp.x, dp.y);
  if (c) eye.color = c;
  const l = document.getElementById('loupe');
  const r = stage.getBoundingClientRect();
  l.style.transform = `translate(${r.left + pt.x - 50}px, ${r.top + pt.y - 140}px)`;
  const top = eye.color ? rgbToHex(...eye.color) : 'transparent';
  l.style.setProperty('--sample', top);
  l.style.setProperty('--current', app.colorHex ? app.colorHex() : '#000');
}

function endEyedrop(apply) {
  document.getElementById('loupe').classList.add('hidden');
  if (apply && eye && eye.color && app.setColorRGB) app.setColorRGB(...eye.color);
  eye = null;
  armEyedropper(false);
}

// ---------------------------------------------------------------- transform drag

function xfStart(pt) {
  const x = app.xf;
  const q = xfCornersScreen();
  const near = (a, r = 26) => Math.hypot(a.x - pt.x, a.y - pt.y) < r;
  const dp = screenToDoc(pt.x, pt.y);
  const base = { pt, doc: dp, M: x.M };
  const rh = xfRotateHandle(q);
  if (near(rh)) { xfDrag = { ...base, type: 'rotate' }; return; }
  for (let i = 0; i < 4; i++) if (near(q[i])) { xfDrag = { ...base, type: 'scale', i }; return; }
  xfDrag = { ...base, type: 'move' };
}

function xfMove(pt) {
  const x = app.xf;
  const s = xfDrag;
  if (!x || !s) return;
  const dp = screenToDoc(pt.x, pt.y);
  const M0 = s.M;
  if (s.type === 'move') {
    xfSet(new DOMMatrix().translate(dp.x - s.doc.x, dp.y - s.doc.y).multiply(M0));
  } else if (s.type === 'rotate') {
    const b = x.box;
    const c = M0.transformPoint(new DOMPoint(b.x + b.w / 2, b.y + b.h / 2));
    let a = Math.atan2(dp.y - c.y, dp.x - c.x) - Math.atan2(s.doc.y - c.y, s.doc.x - c.x);
    let deg = (a * 180) / Math.PI;
    const snap = Math.round(deg / 15) * 15;
    if (Math.abs(deg - snap) < 2.5) deg = snap;
    xfSet(new DOMMatrix().translate(c.x, c.y).rotate(deg).translate(-c.x, -c.y).multiply(M0));
  } else if (s.type === 'scale') {
    const corners = xfLocalCorners(x);
    const la = corners[(s.i + 2) % 4], lc = corners[s.i];
    if (!x.freeform) {
      const A = M0.transformPoint(new DOMPoint(la.x, la.y));
      const C = M0.transformPoint(new DOMPoint(lc.x, lc.y));
      const d0 = Math.hypot(C.x - A.x, C.y - A.y) || 1;
      // project pointer onto the diagonal direction for stable uniform scaling
      const ux = (C.x - A.x) / d0, uy = (C.y - A.y) / d0;
      const proj = (dp.x - A.x) * ux + (dp.y - A.y) * uy;
      const k = Math.max(0.01, proj / d0);
      xfSet(new DOMMatrix().translate(A.x, A.y).scale(k, k).translate(-A.x, -A.y).multiply(M0));
    } else {
      const lp = M0.inverse().transformPoint(new DOMPoint(dp.x, dp.y));
      const dx = lc.x - la.x, dy = lc.y - la.y;
      let sx = dx ? (lp.x - la.x) / dx : 1, sy = dy ? (lp.y - la.y) / dy : 1;
      if (Math.abs(sx) < 0.01) sx = 0.01 * Math.sign(sx || 1);
      if (Math.abs(sy) < 0.01) sy = 0.01 * Math.sign(sy || 1);
      xfSet(M0.translate(la.x, la.y).scale(sx, sy).translate(-la.x, -la.y));
    }
  }
}

// ---------------------------------------------------------------- wheel

function onWheel(e) {
  e.preventDefault();
  if (!app.doc) return;
  const pt = local(e);
  const pinch = e.ctrlKey || e.metaKey;
  const trackpadPan = !pinch && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0.5 || Math.abs(e.deltaY) < 40);
  if (e.shiftKey && !pinch) {
    const deg = e.deltaY > 0 ? 5 : -5;
    app.view = new DOMMatrix().translate(pt.x, pt.y).rotate(deg).translate(-pt.x, -pt.y).multiply(app.view);
  } else if (trackpadPan) {
    app.view = new DOMMatrix().translate(-e.deltaX, -e.deltaY).multiply(app.view);
  } else {
    const f = Math.exp(-e.deltaY * (pinch ? 0.01 : 0.0015));
    const s = viewScale();
    const k = Math.min(Math.max(f, 0.02 / s), 60 / s);
    app.view = new DOMMatrix().translate(pt.x, pt.y).scale(k, k).translate(-pt.x, -pt.y).multiply(app.view);
  }
  requestRender();
}
