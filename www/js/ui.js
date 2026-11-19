// Editor UI: top bar, sidebar sliders, sheets (brushes, layers, color, actions, adjustments) and context bars.
import { app, $, $$, el, toast, requestRender, edited, clamp, viewScale, makeCanvas, canvasToBlob } from './state.js';
import { icon, hydrateIcons } from './icons.js';
import { presetList, getPreset, setPresetValue, resetPreset, renderPreview, BRUSH_SETTINGS } from './brush.js';
import { BLEND_MODES, blendInfo } from './doc.js';
import { hsvToHex, hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from './color.js';
import { ADJUSTMENTS } from './filters.js';
import { history, snapStruct } from './history.js';
import * as E from './editor.js';
import { armEyedropper } from './input.js';
import { saveBlob, safeName } from './share.js';
import { encodePSD } from './psd.js';
import { replayTimelapse, exportTimelapse } from './timelapse.js';
import { setAnimEnabled, openAnimSettings, exportAnimation } from './animation.js';

const PREFS_KEY = 'quillpad.prefs';

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      tools: app.tools, color: app.color, settings: app.settings, grid: app.grid,
    }));
  } catch (e) { /* ignore */ }
}

export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p) {
      if (p.tools) for (const k of Object.keys(app.tools)) Object.assign(app.tools[k], p.tools[k] || {});
      if (p.color) app.color = p.color;
      if (p.settings) Object.assign(app.settings, p.settings);
      if (p.grid) Object.assign(app.grid, p.grid);
    }
    app.recentColors = JSON.parse(localStorage.getItem('quillpad.recent') || '[]') || [];
  } catch (e) { /* ignore */ }
}

// ================================================================ sheets & modals

let sheetId = null;
let sheetBuild = null;

export function openSheet(id, title, build, opts = {}) {
  if (sheetId === id && !opts.force) { closeSheet(); return; }
  closeSheet();
  sheetId = id;
  sheetBuild = build;
  const sh = $('#sheet');
  sh.dataset.id = id;
  $('.sheet-title', sh).textContent = title;
  sh.classList.remove('hidden');
  $('#sheet-backdrop').classList.remove('hidden');
  build($('.sheet-body', sh));
  $$('#topbar [data-sheet]').forEach((b) => b.classList.toggle('open', b.dataset.sheet === id.split(':')[0]));
}

export function setSheetTitle(t) { $('#sheet .sheet-title').textContent = t; }

export function closeSheet() {
  sheetId = null;
  sheetBuild = null;
  editingPreset = null;
  layerExpand = null;
  colorUpdater = null;
  $('#sheet').classList.add('hidden');
  $('#sheet-backdrop').classList.add('hidden');
  $('#sheet .sheet-body').innerHTML = '';
  $$('#topbar [data-sheet]').forEach((b) => b.classList.remove('open'));
}

export function refreshSheet() {
  if (!sheetId || !sheetBuild) return;
  const body = $('#sheet .sheet-body');
  const st = body.scrollTop;
  body.innerHTML = '';
  sheetBuild(body);
  body.scrollTop = st;
}

export function currentSheet() { return sheetId; }

export function modal({ title, body, buttons, cls }) {
  return new Promise((res) => {
    const m = $('#modal');
    m.innerHTML = '';
    m.className = cls || '';
    const close = (v) => { m.classList.add('hidden'); m.innerHTML = ''; res(v); };
    const btns = el('div', { class: 'modal-buttons' }, buttons.map((b) => el('button', {
      class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
      onclick: () => close(b.value),
    }, b.label)));
    m.append(el('div', { class: 'modal-box' }, el('h3', {}, title), body || '', btns));
    m.classList.remove('hidden');
    m._close = close;
  });
}

export async function promptText(title, value = '') {
  const inp = el('input', { class: 'text-input', value, maxlength: 80 });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#modal')._close(true); } });
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
  const ok = await modal({ title, body: inp, buttons: [{ label: 'Cancel', value: false }, { label: 'OK', primary: true, value: true }] });
  return ok ? inp.value.trim() : null;
}

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return modal({ title, body: el('p', { class: 'modal-text' }, text), buttons: [{ label: 'Cancel', value: false }, { label: okLabel, primary: !danger, danger, value: true }] });
}

// small building blocks
function row(iconName, label, onclick, extra) {
  return el('button', { class: 'row', onclick }, el('span', { class: 'row-ic', html: icon(iconName) }), el('span', { class: 'row-label' }, label), extra || '');
}

function toggleRow(label, get, set) {
  const sw = el('span', { class: 'switch' + (get() ? ' on' : '') });
  const b = el('button', { class: 'row toggle', onclick: () => { set(!get()); sw.classList.toggle('on', get()); savePrefs(); } }, el('span', { class: 'row-label' }, label), sw);
  return b;
}

function segmented(options, get, set) {
  const wrap = el('div', { class: 'seg' });
  const draw = () => {
    wrap.innerHTML = '';
    for (const [v, label] of options) {
      wrap.append(el('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); draw(); savePrefs(); } }, label));
    }
  };
  draw();
  return wrap;
}

function sliderRow(label, min, max, step, get, set, fmt = (v) => v, onCommit) {
  const val = el('span', { class: 'slider-val' }, fmt(get()));
  const inp = el('input', { type: 'range', min, max, step, value: get() });
  inp.addEventListener('input', () => { set(parseFloat(inp.value)); val.textContent = fmt(parseFloat(inp.value)); });
  inp.addEventListener('change', () => { if (onCommit) onCommit(parseFloat(inp.value)); });
  return el('div', { class: 'slider-row' }, el('div', { class: 'slider-head' }, el('span', {}, label), val), inp);
}

function tabs(list, get, set) {
  const wrap = el('div', { class: 'tabs' });
  for (const [id, label] of list) wrap.append(el('button', { class: get() === id ? 'on' : '', onclick: () => { set(id); refreshSheet(); } }, label));
  return wrap;
}

// ================================================================ tools & top bar

export function setTool(t) {
  if (app.xf && t !== 'transform') E.commitTransform();
  if (app.adjust) E.commitAdjust();
  if (t === 'transform') {
    app.tool = 'transform';
    if (!E.beginTransform()) app.tool = 'brush';
  } else {
    app.tool = t;
    if (['brush', 'eraser', 'smudge'].includes(t)) app.lastPaintTool = t;
  }
  armEyedropper(false);
  updateToolButtons();
  updateSliders();
  renderContextBar();
  requestRender();
}

function updateToolButtons() {
  $$('#topbar .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === app.tool));
  $('#btn-select').classList.toggle('active', app.tool === 'select');
  $('#btn-transform').classList.toggle('active', app.tool === 'transform');
}

export function updateColorButton() {
  const hex = hsvToHex(app.color);
  $('#btn-color span').style.background = hex;
  if (colorUpdater) colorUpdater();
}

// ================================================================ sidebar sliders + HUD

const SIZE_MIN = 0.5, SIZE_RANGE = 1000;
const sizeToV = (s) => Math.log(Math.max(SIZE_MIN, s) / SIZE_MIN) / Math.log(SIZE_RANGE);
const vToSize = (v) => Math.round(SIZE_MIN * Math.pow(SIZE_RANGE, v) * 10) / 10;

let sizeUpdate = () => {}, opacityUpdate = () => {};

function toolState() {
  return app.tools[app.tool] || app.tools[app.lastPaintTool || 'brush'];
}

function vslider(node, get, set, hud) {
  const fill = $('.fill', node), thumb = $('.thumb', node);
  const update = () => {
    const v = clamp(get(), 0, 1);
    fill.style.height = v * 100 + '%';
    thumb.style.bottom = `calc(${v * 100}% - 10px)`;
  };
  let active = false;
  const move = (e) => {
    const r = node.getBoundingClientRect();
    set(clamp(1 - (e.clientY - r.top) / r.height, 0, 1));
    update();
    hud(true);
  };
  node.addEventListener('pointerdown', (e) => { e.preventDefault(); node.setPointerCapture(e.pointerId); active = true; move(e); });
  node.addEventListener('pointermove', (e) => { if (active) move(e); });
  const end = () => { if (!active) return; active = false; hud(false); savePrefs(); };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  update();
  return update;
}

function showHUD(kind, on) {
  const h = $('#hud');
  if (!on) { h.classList.add('hidden'); return; }
  const t = toolState();
  h.classList.remove('hidden');
  if (kind === 'size') {
    const px = Math.max(2, Math.min(260, t.size * viewScale()));
    h.innerHTML = `<div class="hud-dot" style="width:${px}px;height:${px}px"></div><div class="hud-label">${t.size >= 10 ? Math.round(t.size) : t.size} px</div>`;
  } else {
    h.innerHTML = `<div class="hud-dot" style="width:60px;height:60px;background:${hsvToHex(app.color)};opacity:${t.opacity}"></div><div class="hud-label">${Math.round(t.opacity * 100)}%</div>`;
  }
}

export function updateSliders() { sizeUpdate(); opacityUpdate(); }

function setupSidebar() {
  sizeUpdate = vslider($('#size-slider'), () => sizeToV(toolState().size), (v) => { toolState().size = Math.max(SIZE_MIN, vToSize(v)); }, (on) => showHUD('size', on));
  opacityUpdate = vslider($('#opacity-slider'), () => toolState().opacity, (v) => { toolState().opacity = Math.max(0.01, Math.round(v * 100) / 100); }, (on) => showHUD('opacity', on));

  $('#btn-eyedrop').addEventListener('click', () => armEyedropper(!app.eyedropArmed));
  holdRepeat($('#btn-undo'), () => { if (history.undo()) toast('Undo', 600); });
  holdRepeat($('#btn-redo'), () => { if (history.redo()) toast('Redo', 600); });
}

function holdRepeat(btn, fn) {
  let t1 = 0, t2 = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fn();
    t1 = setTimeout(() => { t2 = setInterval(fn, 90); }, 450);
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}

// ================================================================ brush library

let editingPreset = null;

function openBrushLibrary(tool) {
  editingPreset = null;
  const title = tool === 'brush' ? 'Brush Library' : tool === 'eraser' ? 'Eraser Brushes' : 'Smudge Brushes';
  openSheet('brush:' + tool, title, (b) => buildBrushes(b, tool));
}

function previewColor(tool) { return tool === 'brush' ? hsvToHex(app.color) : '#4a4a55'; }

function buildBrushes(body, tool) {
  if (editingPreset) { buildBrushSettings(body, tool, editingPreset); return; }
  setSheetTitle(tool === 'brush' ? 'Brush Library' : tool === 'eraser' ? 'Eraser Brushes' : 'Smudge Brushes');
  const t = app.tools[tool];
  const groups = new Map();
  for (const p of presetList()) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  for (const [g, list] of groups) {
    body.append(el('div', { class: 'group-title' }, g));
    for (const p of list) {
      const active = p.id === t.preset;
      const cv = makeCanvas(220 * 2, 46 * 2);
      cv.className = 'brush-preview';
      renderPreview(cv, Object.assign({}, p, { sizeDefault: p.sizeDefault * 2 }), previewColor(tool));
      const r = el('div', { class: 'brush-row' + (active ? ' active' : '') },
        el('div', { class: 'brush-name' }, p.name, active ? el('span', { class: 'brush-edit' }, 'Edit ›') : ''), cv);
      r.addEventListener('click', () => {
        if (active) { editingPreset = p.id; refreshSheet(); return; }
        t.preset = p.id;
        if (tool === 'brush') t.size = p.sizeDefault;
        updateSliders();
        savePrefs();
        refreshSheet();
      });
      body.append(r);
    }
  }
}

function buildBrushSettings(body, tool, id) {
  const p = getPreset(id);
  setSheetTitle(p.name);
  const cv = makeCanvas(640, 120);
  cv.className = 'brush-preview big';
  const redraw = () => renderPreview(cv, Object.assign({}, getPreset(id), { sizeDefault: getPreset(id).sizeDefault * 2.4 }), previewColor(tool));
  redraw();
  body.append(
    el('button', { class: 'back-btn', onclick: () => { editingPreset = null; refreshSheet(); } }, el('span', { html: icon('back') }), 'All brushes'),
    cv,
  );
  for (const [k, label, min, max, step] of BRUSH_SETTINGS) {
    body.append(sliderRow(label, min, max, step, () => getPreset(id)[k], (v) => { setPresetValue(id, k, v); redraw(); },
      (v) => (step >= 1 ? Math.round(v) + '°' : Math.round(v * 100) + '%')));
  }
  body.append(toggleRowNoPrefs('Rotate with stroke direction', () => getPreset(id).follow, (v) => { setPresetValue(id, 'follow', v); redraw(); }));
  body.append(toggleRowNoPrefs('QuickShape (hold at end of stroke)', () => getPreset(id).quickShape !== false, (v) => setPresetValue(id, 'quickShape', v)));
  body.append(el('button', { class: 'btn wide', onclick: () => { resetPreset(id); refreshSheet(); toast('Brush reset'); } }, 'Reset brush'));
}

function toggleRowNoPrefs(label, get, set) {
  const sw = el('span', { class: 'switch' + (get() ? ' on' : '') });
  return el('button', { class: 'row toggle', onclick: () => { set(!get()); sw.classList.toggle('on', !!get()); } }, el('span', { class: 'row-label' }, label), sw);
}

// ================================================================ layers

let layerExpand = null; // {i, kind:'menu'|'blend'}

export function openLayers() {
  layerExpand = null;
  openSheet('layers', 'Layers', buildLayers);
}

function layerThumb(l) {
  const d = app.doc;
  const S = 88;
  const k = Math.min(S / d.width, S / d.height);
  const c = makeCanvas(d.width * k, d.height * k);
  c.className = 'layer-thumb';
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(l.canvas, 0, 0, c.width, c.height);
  return c;
}

function buildLayers(body) {
  const d = app.doc;
  const addBtn = el('button', { class: 'icon-btn', title: 'Add layer', html: icon('plus'), onclick: () => { E.addLayer(); layerExpand = null; refreshSheet(); } });
  body.append(el('div', { class: 'sheet-toolbar' }, el('span', { class: 'muted' }, `${d.layers.length} / ${d.maxLayers()} layers`), addBtn));
  const list = el('div', { class: 'layer-list' });
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const l = d.layers[i];
    const active = i === d.activeIndex;
    const tags = [l.alphaLock && 'Alpha lock', l.clip && 'Clipping mask', l.reference && 'Reference', l.opacity < 1 && Math.round(l.opacity * 100) + '%'].filter(Boolean).join(' · ');
    const vis = el('input', { type: 'checkbox', class: 'vis-check' });
    vis.checked = l.visible;
    vis.addEventListener('click', (e) => e.stopPropagation());
    vis.addEventListener('change', () => { E.setLayerProps(i, { visible: vis.checked }); refreshSheet(); });
    const blendBtn = el('button', { class: 'blend-btn', onclick: (e) => { e.stopPropagation(); layerExpand = layerExpand && layerExpand.i === i && layerExpand.kind === 'blend' ? null : { i, kind: 'blend' }; refreshSheet(); } }, blendInfo(l.blend)[2]);
    const r = el('div', { class: 'layer-row' + (active ? ' active' : '') + (l.clip ? ' clipped' : '') + (l.visible ? '' : ' hidden-layer') },
      l.clip ? el('span', { class: 'clip-arrow' }, '↳') : '',
      el('div', { class: 'thumb-wrap' }, layerThumb(l)),
      el('div', { class: 'layer-info' }, el('div', { class: 'layer-name' }, l.name), tags ? el('div', { class: 'layer-sub' }, tags) : ''),
      blendBtn,
      el('label', { class: 'vis', onclick: (e) => e.stopPropagation() }, vis, el('span', { class: 'vis-box' })),
    );
    r.addEventListener('click', () => {
      if (active) layerExpand = layerExpand && layerExpand.i === i && layerExpand.kind === 'menu' ? null : { i, kind: 'menu' };
      else { E.selectLayer(i); layerExpand = null; }
      refreshSheet();
    });
    list.append(r);
    if (layerExpand && layerExpand.i === i) list.append(layerExpand.kind === 'menu' ? layerMenu(i) : blendPanel(i));
  }
  body.append(list);

  // background
  const bgVis = el('input', { type: 'checkbox', class: 'vis-check' });
  bgVis.checked = d.bgVisible;
  bgVis.addEventListener('change', () => { E.setBackground(d.bgColor, bgVis.checked); refreshSheet(); });
  const sw = el('span', { class: 'bg-swatch', style: { background: d.bgColor } });
  body.append(el('div', { class: 'layer-row bg-row' },
    el('div', { class: 'thumb-wrap' }, sw),
    el('div', { class: 'layer-info' }, el('div', { class: 'layer-name' }, 'Background color'), el('div', { class: 'layer-sub' }, 'Tap the swatch to use the current color')),
    el('label', { class: 'vis' }, bgVis, el('span', { class: 'vis-box' })),
  ));
  sw.addEventListener('click', () => { E.setBackground(hsvToHex(app.color), true); refreshSheet(); });
}

function layerMenu(i) {
  const d = app.doc, l = d.layers[i];
  const b = (ic, label, fn, on) => el('button', { class: 'menu-btn' + (on ? ' on' : ''), onclick: (e) => { e.stopPropagation(); fn(); } }, el('span', { html: icon(ic) }), label);
  const close = () => { layerExpand = null; refreshSheet(); };
  return el('div', { class: 'layer-menu' },
    b('rename', 'Rename', async () => { const n = await promptText('Rename layer', l.name); if (n) { E.setLayerProps(i, { name: n }); refreshSheet(); } }),
    b('copy', 'Duplicate', () => { E.duplicateLayer(i); close(); }),
    b('merge', 'Merge down', () => { E.mergeDown(i); close(); }),
    b('up', 'Move up', () => { E.moveLayer(i, 1); layerExpand = { i: Math.min(i + 1, d.layers.length - 1), kind: 'menu' }; refreshSheet(); }),
    b('down', 'Move down', () => { E.moveLayer(i, -1); layerExpand = { i: Math.max(i - 1, 0), kind: 'menu' }; refreshSheet(); }),
    b('alpha', 'Alpha lock', () => { E.setLayerProps(i, { alphaLock: !l.alphaLock }); refreshSheet(); }, l.alphaLock),
    b('clipmask', 'Clipping mask', () => { E.setLayerProps(i, { clip: !l.clip }); refreshSheet(); }, l.clip),
    b('lock', 'Reference', () => { d.layers.forEach((x, j) => { if (j !== i && x.reference) x.reference = false; }); E.setLayerProps(i, { reference: !l.reference }); toast(l.reference ? 'ColorDrop will use this layer\'s lines' : 'Reference off'); refreshSheet(); }, l.reference),
    b('fill', 'Fill layer', () => { E.fillSelectionOrLayer(); refreshSheet(); }),
    b('invert', 'Invert', () => { E.beginAdjust(ADJUSTMENTS.find((a) => a.id === 'invert')); refreshSheet(); }),
    b('close', 'Clear', () => { E.clearLayer(i); refreshSheet(); }),
    b('trash', 'Delete', async () => { if (await confirmBox('Delete layer?', `"${l.name}" will be removed. You can undo this.`, 'Delete', true)) { E.deleteLayer(i); close(); } }),
  );
}

function blendPanel(i) {
  const l = app.doc.layers[i];
  let before = null;
  const op = sliderRow('Opacity', 0, 100, 1, () => Math.round(l.opacity * 100),
    (v) => { if (!before) before = snapStruct(); E.previewLayerProps(i, { opacity: v / 100 }); },
    (v) => v + '%',
    () => {
      if (!before) return;
      l.touch();
      history.push({ kind: 'struct', before, after: snapStruct() });
      before = null;
      edited();
    });
  const modes = el('div', { class: 'blend-grid' });
  for (const [m, name] of BLEND_MODES) {
    modes.append(el('button', { class: l.blend === m ? 'on' : '', onclick: (e) => { e.stopPropagation(); E.setLayerProps(i, { blend: m }); refreshSheet(); } }, name));
  }
  const wrap = el('div', { class: 'layer-menu blend-panel' }, op, modes);
  wrap.addEventListener('click', (e) => e.stopPropagation());
  return wrap;
}

// ================================================================ color

let colorTab = 'disc';
let colorUpdater = null;

const DEFAULT_PALETTES = [
  ['Basics', ['#000000', '#3a3a3c', '#8e8e93', '#d1d1d6', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e']],
  ['Skin', ['#ffe0c7', '#f9c9a5', '#eab08a', '#d6966b', '#b97a52', '#9a5f3b', '#7a4527', '#5c311c', '#3f2213', '#2b170d']],
  ['Pastel', ['#ffd1dc', '#ffe5b4', '#fff5ba', '#c1f0c1', '#b5e8f7', '#c9c9ff', '#e5c7ff', '#ffc8e6', '#d9f2e6', '#f6e7d8']],
  ['Earth', ['#2f2a24', '#5b4636', '#8b6b4a', '#b38b59', '#d6b77d', '#6b7f4a', '#3f5b3a', '#7d8f8a', '#a4b6b8', '#e8dcc5']],
];

function loadPalette() {
  try { return JSON.parse(localStorage.getItem('quillpad.palette') || '[]') || []; } catch (e) { return []; }
}
function savePalette(p) { try { localStorage.setItem('quillpad.palette', JSON.stringify(p)); } catch (e) { /* ignore */ } }

export function openColor() {
  openSheet('color', 'Colors', buildColor);
}

function setHSV(h, s, v) {
  app.color = { h, s, v };
  updateColorButton();
  savePrefsSoon();
}

let prefsTimer = 0;
function savePrefsSoon() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefs, 400); }

function buildColor(body) {
  colorUpdater = null;
  const hex = hsvToHex(app.color);
  const cur = el('div', { class: 'color-current' }, el('span', { class: 'cc-swatch', style: { background: hex } }), el('span', { class: 'cc-hex' }, hex.toUpperCase()));
  body.append(tabs([['disc', 'Disc'], ['value', 'Value'], ['palettes', 'Palettes']], () => colorTab, (t) => { colorTab = t; }));
  body.append(cur);
  const recent = el('div', { class: 'swatches recent' });
  for (const c of app.recentColors) recent.append(el('button', { class: 'swatch', style: { background: c }, title: c, onclick: () => E.setColorHex(c) }));
  if (app.recentColors.length) body.append(el('div', { class: 'group-title' }, 'Recent'), recent);

  const updCur = () => {
    const h = hsvToHex(app.color);
    $('.cc-swatch', cur).style.background = h;
    $('.cc-hex', cur).textContent = h.toUpperCase();
  };
  let tabUpdate = () => {};
  if (colorTab === 'disc') tabUpdate = buildDisc(body);
  else if (colorTab === 'value') tabUpdate = buildValues(body);
  else buildPalettes(body);
  colorUpdater = () => { updCur(); tabUpdate(); };
}

function buildDisc(body) {
  const css = Math.min(300, window.innerWidth - 60);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const S = Math.round(css * dpr);
  const cv = makeCanvas(S, S);
  cv.className = 'color-disc';
  cv.style.width = cv.style.height = css + 'px';
  const ctx = cv.getContext('2d');
  const c = S / 2, R = S / 2 - 2 * dpr, r = R * 0.8;
  const side = r * Math.SQRT2 * 0.9, x0 = c - side / 2, y0 = c - side / 2;
  const ring = makeCanvas(S, S);
  const rx = ring.getContext('2d');
  for (let a = 0; a < 360; a++) {
    const a0 = ((a - 0.6) * Math.PI) / 180, a1 = ((a + 0.6) * Math.PI) / 180;
    rx.beginPath(); rx.arc(c, c, R, a0, a1); rx.arc(c, c, r, a1, a0, true); rx.closePath();
    rx.fillStyle = `hsl(${a},100%,50%)`; rx.fill();
  }
  const draw = () => {
    const { h, s, v } = app.color;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(ring, 0, 0);
    ctx.fillStyle = `hsl(${h},100%,50%)`;
    ctx.fillRect(x0, y0, side, side);
    let g = ctx.createLinearGradient(x0, 0, x0 + side, 0);
    g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, side, side);
    g = ctx.createLinearGradient(0, y0, 0, y0 + side);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, side, side);
    const ha = (h * Math.PI) / 180, hr = (R + r) / 2;
    ring_marker(ctx, c + Math.cos(ha) * hr, c + Math.sin(ha) * hr, (R - r) / 2 - 1 * dpr, `hsl(${h},100%,50%)`, dpr);
    ring_marker(ctx, x0 + s * side, y0 + (1 - v) * side, 9 * dpr, hsvToHex(app.color), dpr);
  };
  let dragging = null;
  const pick = (e) => {
    const b = cv.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * S, py = ((e.clientY - b.top) / b.height) * S;
    if (!dragging) {
      const dd = Math.hypot(px - c, py - c);
      dragging = dd > r * 0.95 ? 'hue' : 'sv';
    }
    if (dragging === 'hue') {
      let a = (Math.atan2(py - c, px - c) * 180) / Math.PI;
      if (a < 0) a += 360;
      setHSV(a, app.color.s, app.color.v);
    } else {
      setHSV(app.color.h, clamp((px - x0) / side, 0, 1), clamp(1 - (py - y0) / side, 0, 1));
    }
  };
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); dragging = null; pick(e); });
  cv.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
  const end = () => { if (dragging) { dragging = null; E.addRecentColor(hsvToHex(app.color)); } };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  draw();
  body.append(el('div', { class: 'disc-wrap' }, cv));
  return draw;
}

function ring_marker(ctx, x, y, r, fill, dpr) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.lineWidth = 1 * dpr; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
}

function buildValues(body) {
  const inputs = [];
  const mk = (label, min, max, get, set, fmt) => {
    const val = el('span', { class: 'slider-val' }, '');
    const inp = el('input', { type: 'range', min, max, step: 1 });
    inp.addEventListener('input', () => set(parseFloat(inp.value)));
    inp.addEventListener('change', () => E.addRecentColor(hsvToHex(app.color)));
    inputs.push(() => { inp.value = get(); val.textContent = fmt ? fmt(get()) : Math.round(get()); });
    body.append(el('div', { class: 'slider-row' }, el('div', { class: 'slider-head' }, el('span', {}, label), val), inp));
  };
  const rgb = () => hsvToRgb(app.color.h, app.color.s, app.color.v);
  mk('Hue', 0, 360, () => Math.round(app.color.h), (v) => setHSV(v, app.color.s, app.color.v), (v) => Math.round(v) + '°');
  mk('Saturation', 0, 100, () => Math.round(app.color.s * 100), (v) => setHSV(app.color.h, v / 100, app.color.v), (v) => v + '%');
  mk('Brightness', 0, 100, () => Math.round(app.color.v * 100), (v) => setHSV(app.color.h, app.color.s, v / 100), (v) => v + '%');
  const setRGB = (i, v) => { const c = rgb(); c[i] = v; const hsv = rgbToHsv(...c); if (hsv.s === 0) hsv.h = app.color.h; setHSV(hsv.h, hsv.s, hsv.v); };
  mk('Red', 0, 255, () => rgb()[0], (v) => setRGB(0, v));
  mk('Green', 0, 255, () => rgb()[1], (v) => setRGB(1, v));
  mk('Blue', 0, 255, () => rgb()[2], (v) => setRGB(2, v));
  const hexIn = el('input', { class: 'text-input hex-input', maxlength: 7, spellcheck: 'false', autocapitalize: 'off' });
  hexIn.addEventListener('change', () => { if (hexToRgb(hexIn.value)) { E.setColorHex(hexIn.value.startsWith('#') ? hexIn.value : '#' + hexIn.value); E.addRecentColor(hsvToHex(app.color)); } else toast('Enter a hex color like #3a7bd5'); });
  inputs.push(() => { if (document.activeElement !== hexIn) hexIn.value = hsvToHex(app.color).toUpperCase(); });
  body.append(el('div', { class: 'slider-row' }, el('div', { class: 'slider-head' }, el('span', {}, 'Hex')), hexIn));
  const upd = () => inputs.forEach((f) => f());
  upd();
  return upd;
}

function buildPalettes(body) {
  const mine = loadPalette();
  body.append(el('div', { class: 'group-title' }, 'My palette', el('span', { class: 'muted small' }, ' — tap + to save the current color, long-press to remove')));
  const grid = el('div', { class: 'swatches' });
  for (let i = 0; i < 30; i++) {
    const c = mine[i];
    if (c) {
      const sw = el('button', { class: 'swatch', style: { background: c } });
      let t = 0, long = false;
      sw.addEventListener('pointerdown', () => { long = false; t = setTimeout(() => { long = true; mine.splice(i, 1); savePalette(mine); refreshSheet(); toast('Removed from palette'); }, 600); });
      sw.addEventListener('pointerup', () => { clearTimeout(t); if (!long) E.setColorHex(c); });
      sw.addEventListener('pointerleave', () => clearTimeout(t));
      grid.append(sw);
    } else {
      grid.append(el('button', { class: 'swatch empty', html: icon('plus', 16), onclick: () => { mine.push(hsvToHex(app.color)); savePalette(mine); refreshSheet(); } }));
      break;
    }
  }
  body.append(grid);
  for (const [name, colors] of DEFAULT_PALETTES) {
    body.append(el('div', { class: 'group-title' }, name));
    const g = el('div', { class: 'swatches' });
    for (const c of colors) g.append(el('button', { class: 'swatch', style: { background: c }, onclick: () => { E.setColorHex(c); E.addRecentColor(c); } }));
    body.append(g);
  }
}

// ColorDrop: drag from the color button onto the canvas
function setupColorDrop() {
  const btn = $('#btn-color');
  const dot = $('#drag-dot');
  let start = null, dragging = false;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
    dragging = false;
  });
  btn.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 14) {
      dragging = true;
      dot.style.background = hsvToHex(app.color);
      dot.classList.remove('hidden');
      closeSheet();
    }
    if (dragging) dot.style.transform = `translate(${e.clientX - 18}px, ${e.clientY - 18}px)`;
  });
  const end = (e) => {
    if (!start) return;
    const wasDrag = dragging;
    start = null; dragging = false;
    dot.classList.add('hidden');
    if (!wasDrag) { openColor(); return; }
    btn.releasePointerCapture?.(e.pointerId);
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target.id === 'stage') {
      const r = app.stage.getBoundingClientRect();
      const p = app.view.inverse().transformPoint(new DOMPoint(e.clientX - r.left, e.clientY - r.top));
      E.colorDrop(p.x, p.y);
    }
  };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', () => { start = null; dragging = false; dot.classList.add('hidden'); });
}

// ================================================================ actions

let actionsTab = 'add';

export function openActions() { openSheet('actions', 'Actions', buildActions); }

function buildActions(body) {
  body.append(tabs([['add', 'Add'], ['canvas', 'Canvas'], ['share', 'Share'], ['video', 'Video'], ['prefs', 'Prefs']], () => actionsTab, (t) => { actionsTab = t; }));
  const d = app.doc;
  const box = el('div', { class: 'rows' });
  body.append(box);
  if (actionsTab === 'add') {
    box.append(row('image', 'Insert a photo', () => { closeSheet(); app.pickImage((f) => E.insertImage(f).then((ok) => { if (ok) setTool('transform'); })); }));
    if (d.selection) {
      box.append(row('copy', 'Copy selection to new layer', () => { E.copySelectionToLayer(false); closeSheet(); }));
      box.append(row('scissors', 'Cut selection to new layer', () => { E.copySelectionToLayer(true); closeSheet(); }));
    }
    box.append(row('plus', 'Add layer', () => { E.addLayer(); toast('Layer added'); }));
    box.append(row('select', 'Select all', () => { E.selectAll(); setTool('select'); closeSheet(); }));
  } else if (actionsTab === 'canvas') {
    box.append(row('fit', 'Fit canvas to screen', () => { E.fitView(); closeSheet(); }));
    box.append(row('canvas', 'Actual size (100%)', () => { E.actualSize(); closeSheet(); }));
    box.append(toggleRow('Animation Assist (frame-by-frame)', () => d.anim.enabled, (v) => setAnimEnabled(v)));
    if (d.anim.enabled) box.append(row('film', 'Animation settings & export', () => openAnimSettings()));
    box.append(toggleRow('Mirror view (non-destructive)', () => app.viewFlipped, () => E.toggleFlipView()));
    box.append(row('flipH', 'Flip canvas horizontally', () => E.flipCanvas(true)));
    box.append(row('flipV', 'Flip canvas vertically', () => E.flipCanvas(false)));
    box.append(toggleRow('Drawing guide: grid', () => app.grid.on, (v) => { app.grid.on = v; requestRender(); }));
    box.append(sliderRow('Grid size', 10, 400, 5, () => app.grid.size, (v) => { app.grid.size = v; requestRender(); }, (v) => v + ' px', savePrefs));
    box.append(el('div', { class: 'group-title' }, 'Symmetry'));
    box.append(segmented([['off', 'Off'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['quadrant', 'Quadrant'], ['radial', 'Radial']], () => app.symmetry, (v) => { app.symmetry = v; requestRender(); }));
    box.append(el('div', { class: 'info' }, `Canvas ${d.width} × ${d.height} px · ${d.layers.length} of ${d.maxLayers()} layers`));
  } else if (actionsTab === 'share') {
    const name = safeName(app.artName);
    const run = async (label, fn) => { toast(label + '…', 4000); try { await fn(); } catch (e) { console.error(e); toast('Export failed: ' + e.message); } };
    box.append(row('share', 'Share as PNG', () => run('Preparing PNG', async () => saveBlob(await flatBlob('image/png'), name + '.png'))));
    box.append(row('share', 'Share as JPEG', () => run('Preparing JPEG', async () => saveBlob(await flatBlob('image/jpeg', 0.92), name + '.jpg'))));
    box.append(row('layers', 'Share as layered PSD', () => run('Building PSD', async () => saveBlob(encodePSD(app.doc), name + '.psd'))));
    box.append(row('copy', 'Share current layer as PNG', () => run('Preparing layer', async () => saveBlob(await canvasToBlob(app.doc.active.canvas, 'image/png'), name + '-' + safeName(app.doc.active.name) + '.png'))));
  } else if (actionsTab === 'video') {
    box.append(el('div', { class: 'info' }, `${app.frames.length} time-lapse frames recorded for this artwork.`));
    if (d.anim.enabled) {
      box.append(row('film', 'Export animation as GIF', () => { closeSheet(); exportAnimation('gif'); }));
      box.append(row('film', 'Export animation as video', () => { closeSheet(); exportAnimation('video'); }));
    } else {
      box.append(row('film', 'Make an animation (turn on Animation Assist)', () => { setAnimEnabled(true); closeSheet(); }));
    }
    box.append(row('play', 'Time-lapse replay', () => { closeSheet(); replayTimelapse(); }));
    box.append(row('video', 'Export time-lapse video', () => { closeSheet(); exportTimelapse(); }));
  } else {
    box.append(el('div', { class: 'group-title' }, 'Finger painting'));
    box.append(segmented([['auto', 'Auto'], ['on', 'Always'], ['off', 'Never']], () => app.settings.fingerDraw, (v) => { app.settings.fingerDraw = v; }));
    box.append(el('div', { class: 'info small' }, 'Auto: fingers draw until a stylus is used, then fingers only navigate.'));
    box.append(toggleRow('Simulate pressure from finger speed', () => app.settings.speedPressure, (v) => { app.settings.speedPressure = v; }));
    box.append(toggleRow('Tap gestures (2-finger undo, 3-finger redo, 4-finger full screen)', () => app.settings.gestures, (v) => { app.settings.gestures = v; }));
    box.append(toggleRow('QuickShape', () => app.settings.quickShape, (v) => { app.settings.quickShape = v; }));
    box.append(toggleRow('Right-hand sidebar', () => app.settings.leftHanded, (v) => { app.settings.leftHanded = v; applyHandedness(); }));
    box.append(toggleRow('Stylus tilt shading (Apple Pencil, S Pen)', () => app.settings.useTilt, (v) => { app.settings.useTilt = v; }));
    box.append(sliderRow('Stylus pressure curve', 0.4, 2.5, 0.05, () => app.settings.pressureGamma, (v) => { app.settings.pressureGamma = v; }, (v) => (v < 1 ? 'Soft ' : v > 1 ? 'Firm ' : 'Linear ') + v.toFixed(2), savePrefs));
    box.append(sliderRow('ColorDrop threshold', 0, 120, 1, () => app.settings.fillThreshold, (v) => { app.settings.fillThreshold = v; }, (v) => Math.round((v / 120) * 100) + '%', savePrefs));
    box.append(el('div', { class: 'info small' }, 'Quillpad — open-source sketching & painting. Gestures: pinch to zoom/rotate, two-finger tap undo, three-finger tap redo, touch & hold for eyedropper, hold at end of a stroke for QuickShape, drag the color dot onto the canvas to fill. Animation Assist (Canvas tab) turns layers into frames with onion skins.'));
  }
}

async function flatBlob(type, q) {
  const d = app.doc;
  const c = makeCanvas(d.width, d.height);
  const x = c.getContext('2d');
  if (type === 'image/jpeg' && !d.bgVisible) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, d.width, d.height); }
  d.composite(x);
  return canvasToBlob(c, type, q);
}

export function applyHandedness() {
  document.body.classList.toggle('right-sidebar', !!app.settings.leftHanded);
}

// ================================================================ adjustments

export function openAdjustments() {
  openSheet('adjust', 'Adjustments', (body) => {
    body.append(el('div', { class: 'info small' }, 'Applies to the selected layer' + (app.doc.selection ? ' (inside the selection)' : '') + '.'));
    const box = el('div', { class: 'rows' });
    for (const a of ADJUSTMENTS) {
      box.append(row('adjust', a.name, () => {
        closeSheet();
        if (app.xf) E.commitTransform();
        if (app.tool === 'transform') { app.tool = 'brush'; updateToolButtons(); }
        if (E.beginAdjust(a)) renderContextBar();
      }));
    }
    body.append(box);
  });
}

// ================================================================ context bar

function cbtn(ic, label, fn, on) {
  return el('button', { class: 'cb-btn' + (on ? ' on' : ''), onclick: fn }, el('span', { html: icon(ic) }), el('span', { class: 'cb-label' }, label));
}

export function renderContextBar() {
  const cb = $('#contextbar');
  cb.innerHTML = '';
  cb.className = '';
  if (app.adjust) {
    const a = app.adjust;
    cb.classList.add('adjust');
    cb.append(el('div', { class: 'cb-title' }, a.def.name));
    for (const [k, label, min, max] of a.def.params) {
      cb.append(sliderRow(label, min, max, 1, () => a.values[k], (v) => E.setAdjustValue(k, v), (v) => Math.round(v)));
    }
    cb.append(el('div', { class: 'cb-row' },
      el('button', { class: 'btn', onclick: () => { E.cancelAdjust(); renderContextBar(); } }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: () => { E.commitAdjust(); renderContextBar(); } }, 'Apply')));
    return;
  }
  if (app.tool === 'transform' && app.xf) {
    const x = app.xf;
    cb.append(
      cbtn('transform', x.freeform ? 'Freeform' : 'Uniform', () => { x.freeform = !x.freeform; renderContextBar(); }, x.freeform),
      cbtn('flipH', 'Flip H', () => E.xfFlip(true)),
      cbtn('flipV', 'Flip V', () => E.xfFlip(false)),
      cbtn('rotate', 'Rotate 45°', () => E.xfRotate(45)),
      cbtn('fit', 'Fit', () => E.xfFit()),
      cbtn('back', 'Reset', () => E.xfReset()),
      el('span', { class: 'cb-sep' }),
      cbtn('close', 'Cancel', () => { E.cancelTransform(); setTool(app.lastPaintTool || 'brush'); }),
      cbtn('check', 'Done', () => { E.commitTransform(); setTool(app.lastPaintTool || 'brush'); }, true),
    );
    return;
  }
  if (app.tool === 'select') {
    const has = !!app.doc.selection;
    cb.append(
      cbtn('lasso', 'Freehand', () => { app.selectMode = 'freehand'; renderContextBar(); }, app.selectMode === 'freehand'),
      cbtn('rect', 'Rectangle', () => { app.selectMode = 'rect'; renderContextBar(); }, app.selectMode === 'rect'),
      cbtn('ellipse', 'Ellipse', () => { app.selectMode = 'ellipse'; renderContextBar(); }, app.selectMode === 'ellipse'),
      el('span', { class: 'cb-sep' }),
    );
    if (has) {
      cb.append(
        cbtn('invert', 'Invert', () => E.invertSelection()),
        cbtn('copy', 'Copy → layer', () => { E.copySelectionToLayer(false); renderContextBar(); }),
        cbtn('scissors', 'Cut → layer', () => { E.copySelectionToLayer(true); renderContextBar(); }),
        cbtn('fill', 'Fill', () => E.fillSelectionOrLayer()),
        cbtn('trash', 'Clear', () => E.clearSelectionContents()),
        cbtn('transform', 'Transform', () => setTool('transform')),
        cbtn('close', 'Deselect', () => { E.deselect(); renderContextBar(); }),
      );
    } else {
      cb.append(el('span', { class: 'cb-hint' }, 'Draw on the canvas to select'));
    }
    cb.append(el('span', { class: 'cb-sep' }), cbtn('check', 'Done', () => setTool(app.lastPaintTool || 'brush'), true));
    return;
  }
  cb.classList.add('hidden');
}

// ================================================================ wiring

export function setupUI() {
  hydrateIcons();
  setupSidebar();
  setupColorDrop();
  for (const b of $$('#topbar .tool')) {
    b.addEventListener('click', () => {
      const t = b.dataset.tool;
      if (app.tool === t) openBrushLibrary(t);
      else { closeSheet(); setTool(t); app.lastPaintTool = t; }
    });
  }
  $('#btn-layers').addEventListener('click', () => openLayers());
  $('#btn-actions').addEventListener('click', () => openActions());
  $('#btn-adjust').addEventListener('click', () => openAdjustments());
  $('#btn-select').addEventListener('click', () => { closeSheet(); setTool(app.tool === 'select' ? (app.lastPaintTool || 'brush') : 'select'); });
  $('#btn-transform').addEventListener('click', () => {
    closeSheet();
    if (app.tool === 'transform') { E.commitTransform(); setTool(app.lastPaintTool || 'brush'); } else setTool('transform');
  });
  $('#sheet-backdrop').addEventListener('pointerdown', (e) => { e.preventDefault(); closeSheet(); });
  $('#sheet .sheet-close').addEventListener('click', () => closeSheet());
  app.onSelectionChange = () => { if (app.tool === 'select') renderContextBar(); };
  app.onLayerChange = () => { if (app.onLayerChangeHook) app.onLayerChangeHook(); };
  applyHandedness();
  updateToolButtons();
  updateColorButton();
}

export function syncEditorUI() {
  updateToolButtons();
  updateSliders();
  updateColorButton();
  renderContextBar();
}

let refreshTimer = 0;
export function onDocChanged() {
  if (sheetId === 'layers') {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (sheetId === 'layers') refreshSheet(); }, 120);
  }
}
