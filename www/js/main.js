// Entry point: wires the gallery, editor, storage and input together.
import { app, $, toast, uid, edited, requestRender } from './state.js';
import { hsvToHex, rgbToHsv, rgbToHex } from './color.js';
import { history } from './history.js';
import * as E from './editor.js';
import { setupInput, armEyedropper } from './input.js';
import { setupUI, syncEditorUI, closeSheet, onDocChanged, loadPrefs, savePrefs, setTool, updateSliders, updateColorButton, renderContextBar } from './ui.js';
import { setupGallery, renderGallery } from './gallery.js';
import { saveCurrent, loadArtwork } from './storage.js';
import { scheduleFrame } from './timelapse.js';

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrent(), 1500);
}

function showScreen(which) {
  $('#gallery').classList.toggle('hidden', which !== 'gallery');
  $('#editor').classList.toggle('hidden', which !== 'editor');
  app.editorVisible = which === 'editor';
  if (which === 'editor') { E.resizeStage(); requestRender(); }
}

async function openArtwork(id) {
  toast('Opening…', 800);
  try {
    const { doc, name, created, frames } = await loadArtwork(id);
    app.artId = id;
    app.artName = name;
    app.created = created;
    app.frames = frames;
    enterEditor(doc);
  } catch (e) {
    console.error(e);
    toast('Could not open artwork: ' + e.message);
  }
}

function createArtwork(w, h, name, image) {
  const doc = E.newDocument(w, h);
  if (image) {
    doc.layers[0].name = 'Photo';
    doc.layers[0].ctx.drawImage(image, 0, 0, w, h);
  }
  app.artId = uid();
  app.artName = name || 'Untitled';
  app.created = Date.now();
  app.frames = [];
  enterEditor(doc);
  saveCurrent();
}

function enterEditor(doc) {
  showScreen('editor');
  E.attachDoc(doc);
  $('#art-title').textContent = app.artName;
  if (!['brush', 'eraser', 'smudge'].includes(app.tool)) app.tool = 'brush';
  syncEditorUI();
  edited.call(null);
  app.editVersion = 0;
  history.clear();
}

async function backToGallery() {
  if (app.stroke) E.commitStroke();
  if (app.xf) E.commitTransform();
  if (app.adjust) E.commitAdjust();
  closeSheet();
  clearTimeout(saveTimer);
  await saveCurrent();
  app.doc = null;
  app.frames = [];
  showScreen('gallery');
  renderGallery();
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!app.editorVisible || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) history.redo(); else history.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); history.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); saveCurrent().then(() => toast('Saved')); return; }
    if (mod && k === '0') { e.preventDefault(); E.fitView(); return; }
    if (mod) return;
    switch (k) {
      case 'b': setTool('brush'); break;
      case 'e': setTool('eraser'); break;
      case 's': setTool('smudge'); break;
      case 'v': setTool('transform'); break;
      case 'l': setTool('select'); break;
      case 'i': armEyedropper(true); break;
      case '[': case ']': {
        const tl = app.tools[app.tool];
        if (tl) { tl.size = Math.max(0.5, Math.min(1000, tl.size * (k === ']' ? 1.15 : 1 / 1.15))); updateSliders(); toast(Math.round(tl.size) + ' px', 500); savePrefs(); }
        break;
      }
      case 'enter': if (app.xf) { E.commitTransform(); setTool(app.lastPaintTool || 'brush'); } else if (app.adjust) { E.commitAdjust(); renderContextBar(); } break;
      case 'escape':
        if (app.xf) { E.cancelTransform(); setTool(app.lastPaintTool || 'brush'); } else if (app.adjust) { E.cancelAdjust(); renderContextBar(); } else if (app.doc && app.doc.selection) { E.deselect(); } else closeSheet();
        break;
      case 'tab': e.preventDefault(); app.toggleUI(); break;
    }
  });
}

function setupFilePicker() {
  const input = $('#file-input');
  let cb = null;
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (f && cb) cb(f);
    cb = null;
  });
  app.pickImage = (fn) => { cb = fn; input.click(); };
}

function init() {
  loadPrefs();
  app.stage = $('#stage');
  app.sctx = app.stage.getContext('2d');
  app.render = E.render;
  app.onEdit = () => { scheduleSave(); scheduleFrame(); onDocChanged(); };
  app.onColor = () => updateColorButton();
  app.colorHex = () => hsvToHex(app.color);
  app.setColorRGB = (r, g, b) => { app.color = rgbToHsv(r, g, b); updateColorButton(); E.addRecentColor(rgbToHex(r, g, b)); savePrefs(); };
  app.toggleUI = () => { app.uiHidden = !app.uiHidden; document.body.classList.toggle('ui-hidden', app.uiHidden); };
  app.onStrokeStart = () => closeSheet();

  setupFilePicker();
  setupUI();
  setupInput(app.stage);
  setupKeyboard();
  setupGallery({ open: openArtwork, create: createArtwork });

  $('#btn-gallery').addEventListener('click', backToGallery);
  $('#art-title').addEventListener('click', async () => {
    const { promptText } = await import('./ui.js');
    const n = await promptText('Rename artwork', app.artName);
    if (n) { app.artName = n; $('#art-title').textContent = n; saveCurrent(); }
  });

  window.addEventListener('resize', () => { E.resizeStage(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && app.doc) saveCurrent(); });
  window.addEventListener('pagehide', () => { if (app.doc) saveCurrent(); });

  showScreen('gallery');
  renderGallery();

  if ('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
