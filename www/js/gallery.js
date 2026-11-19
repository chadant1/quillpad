// Gallery screen: list, create, import, rename, duplicate, delete artworks.
import { app, $, el, toast, uid, blobToImage } from './state.js';
import { icon } from './icons.js';
import { listArtworks, deleteArtwork, renameArtwork, duplicateArtwork } from './storage.js';
import { modal, promptText, confirmBox } from './ui.js';

let urls = [];
let hooks = {};

export function setupGallery(h) {
  hooks = h;
  $('#g-new').addEventListener('click', () => newCanvasDialog());
  $('#g-import').addEventListener('click', () => app.pickImage(async (file) => {
    try {
      const img = await blobToImage(file);
      let w = img.width, h = img.height;
      const max = 4096;
      const k = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      hooks.create(w, h, (file.name || 'Imported').replace(/\.[^.]+$/, ''), img);
    } catch (e) { toast('Could not open that image'); }
  }));
}

export async function renderGallery() {
  const grid = $('#g-grid');
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  let list = [];
  try { list = await listArtworks(); } catch (e) { console.error(e); toast('Storage is unavailable in this browser mode'); }
  grid.innerHTML = '';
  if (!list.length) {
    grid.append(el('div', { class: 'g-empty' },
      el('div', { class: 'g-empty-title' }, 'Start your first artwork'),
      el('p', {}, 'Tap + to create a canvas, or import a photo.'),
      el('button', { class: 'btn primary', onclick: () => newCanvasDialog() }, 'New canvas')));
    return;
  }
  for (const m of list) {
    const url = m.thumb ? URL.createObjectURL(m.thumb) : '';
    if (url) urls.push(url);
    const more = el('button', { class: 'g-more', html: icon('more'), title: 'Options' });
    more.addEventListener('click', (e) => { e.stopPropagation(); cardMenu(m); });
    const card = el('div', { class: 'g-card' },
      el('div', { class: 'g-thumb' }, url ? el('img', { src: url, alt: '' }) : ''),
      el('div', { class: 'g-meta' },
        el('div', {}, el('div', { class: 'g-name' }, m.name), el('div', { class: 'g-size' }, `${m.width} × ${m.height}`)),
        more));
    card.addEventListener('click', () => hooks.open(m.id));
    grid.append(card);
  }
}

async function cardMenu(m) {
  const choice = await modal({
    title: m.name,
    body: el('p', { class: 'modal-text' }, `${m.width} × ${m.height} px · edited ${new Date(m.modified).toLocaleString()}`),
    buttons: [
      { label: 'Rename', value: 'rename' },
      { label: 'Duplicate', value: 'dup' },
      { label: 'Delete', value: 'delete', danger: true },
      { label: 'Close', value: null, primary: true },
    ],
  });
  if (choice === 'rename') {
    const n = await promptText('Rename artwork', m.name);
    if (n) { await renameArtwork(m.id, n); renderGallery(); }
  } else if (choice === 'dup') {
    await duplicateArtwork(m.id, uid());
    renderGallery();
  } else if (choice === 'delete') {
    if (await confirmBox('Delete artwork?', `"${m.name}" will be permanently deleted from this device.`, 'Delete', true)) {
      await deleteArtwork(m.id);
      renderGallery();
    }
  }
}

function screenPreset() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let w = Math.round(window.screen.width * dpr), h = Math.round(window.screen.height * dpr);
  if (w > h) [w, h] = [h, w];
  const k = Math.min(1, 2732 / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

export async function newCanvasDialog() {
  const [sw, sh] = screenPreset();
  const presets = [
    ['Screen size', sw, sh],
    ['Square', 2048, 2048],
    ['4K', 3840, 2160],
    ['A4 (150 dpi)', 1240, 1754],
    ['Instagram portrait', 1080, 1350],
    ['Comic page', 1988, 3075],
    ['Pixel art', 128, 128],
  ];
  let chosen = null;
  const wIn = el('input', { class: 'text-input small', type: 'number', min: 16, max: 8192, value: 2048, inputmode: 'numeric' });
  const hIn = el('input', { class: 'text-input small', type: 'number', min: 16, max: 8192, value: 2048, inputmode: 'numeric' });
  const list = el('div', { class: 'preset-list' });
  for (const [name, w, h] of presets) {
    list.append(el('button', { class: 'preset', onclick: () => { chosen = [w, h, name]; $('#modal')._close('create'); } },
      el('span', { class: 'preset-name' }, name), el('span', { class: 'preset-size' }, `${w} × ${h}`)));
  }
  const body = el('div', {}, list, el('div', { class: 'group-title' }, 'Custom size'),
    el('div', { class: 'custom-size' }, wIn, el('span', {}, '×'), hIn, el('span', { class: 'muted' }, 'px')));
  const r = await modal({ title: 'New canvas', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Create custom', value: 'custom', primary: true }] });
  if (r === 'custom') {
    const w = Math.round(Number(wIn.value)), h = Math.round(Number(hIn.value));
    if (!(w >= 16 && h >= 16 && w <= 8192 && h <= 8192)) { toast('Size must be between 16 and 8192 px'); return; }
    if (w * h > 36e6) { toast('That canvas is too large for a phone — keep it under 36 megapixels'); return; }
    chosen = [w, h, 'Untitled'];
  }
  if (chosen) hooks.create(chosen[0], chosen[1], 'Untitled');
}
