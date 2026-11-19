// IndexedDB persistence for the gallery, artworks and time-lapse frames.
import { app, canvasToBlob, makeCanvas, blobToImage } from './state.js';
import { Doc, Layer } from './doc.js';

const DB_NAME = 'quillpad';
const DB_VER = 1;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('art')) d.createObjectStore('art', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('lapse')) d.createObjectStore('lapse', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export function listArtworks() {
  return tx('meta', 'readonly', (s) => s.getAll()).then((all) => (all || []).sort((a, b) => b.modified - a.modified));
}

export function getArt(id) { return tx('art', 'readonly', (s) => s.get(id)); }
export function getLapse(id) { return tx('lapse', 'readonly', (s) => s.get(id)); }
export function getMeta(id) { return tx('meta', 'readonly', (s) => s.get(id)); }

export async function deleteArtwork(id) {
  await tx('meta', 'readwrite', (s) => s.delete(id));
  await tx('art', 'readwrite', (s) => s.delete(id));
  await tx('lapse', 'readwrite', (s) => s.delete(id));
}

export async function renameArtwork(id, name) {
  const m = await getMeta(id);
  if (!m) return;
  m.name = name;
  await tx('meta', 'readwrite', (s) => s.put(m));
  const a = await getArt(id);
  if (a) { a.name = name; await tx('art', 'readwrite', (s) => s.put(a)); }
}

export async function duplicateArtwork(id, newId) {
  const [m, a, l] = await Promise.all([getMeta(id), getArt(id), getLapse(id)]);
  if (!m || !a) return;
  const now = Date.now();
  await tx('meta', 'readwrite', (s) => s.put({ ...m, id: newId, name: m.name + ' copy', modified: now }));
  await tx('art', 'readwrite', (s) => s.put({ ...a, id: newId, name: m.name + ' copy', modified: now }));
  if (l) await tx('lapse', 'readwrite', (s) => s.put({ ...l, id: newId }));
}

export async function makeThumb(doc, max = 420) {
  const k = Math.min(1, max / Math.max(doc.width, doc.height));
  const c = makeCanvas(doc.width * k, doc.height * k);
  const x = c.getContext('2d');
  x.scale(k, k);
  if (!doc.bgVisible) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, doc.width, doc.height); }
  doc.composite(x);
  return canvasToBlob(c, 'image/jpeg', 0.85);
}

let saving = Promise.resolve();
export function saveCurrent() {
  saving = saving.then(doSave).catch((e) => console.error('save failed', e));
  return saving;
}

async function doSave() {
  const d = app.doc;
  if (!d || !app.artId) return;
  const layers = [];
  for (const l of d.layers) {
    if (!l.blob || l.savedVersion !== l.version) {
      const v = l.version;
      l.blob = await canvasToBlob(l.canvas, 'image/png');
      l.savedVersion = v;
    }
    layers.push({ ...l.props(), png: l.blob });
  }
  const now = Date.now();
  const thumb = await makeThumb(d);
  const art = {
    id: app.artId, name: app.artName, width: d.width, height: d.height, created: app.created || now, modified: now,
    bgColor: d.bgColor, bgVisible: d.bgVisible, activeIndex: d.activeIndex, layers,
  };
  await tx('art', 'readwrite', (s) => s.put(art));
  await tx('meta', 'readwrite', (s) => s.put({ id: app.artId, name: app.artName, width: d.width, height: d.height, modified: now, thumb }));
  await tx('lapse', 'readwrite', (s) => s.put({ id: app.artId, frames: app.frames.slice() }));
}

export async function loadArtwork(id) {
  const a = await getArt(id);
  if (!a) throw new Error('Artwork not found');
  const d = new Doc(a.width, a.height);
  d.bgColor = a.bgColor || '#ffffff';
  d.bgVisible = a.bgVisible !== false;
  for (const ld of a.layers) {
    const l = new Layer(a.width, a.height, ld.name);
    l.setProps({ visible: ld.visible !== false, opacity: ld.opacity ?? 1, blend: ld.blend || 'source-over', alphaLock: !!ld.alphaLock, clip: !!ld.clip, reference: !!ld.reference });
    if (ld.png) {
      const img = await blobToImage(ld.png);
      l.ctx.drawImage(img, 0, 0);
      l.blob = ld.png;
      l.savedVersion = l.version;
    }
    d.layers.push(l);
  }
  if (!d.layers.length) d.layers.push(d.newLayer('Layer 1'));
  d.activeIndex = Math.min(a.activeIndex || 0, d.layers.length - 1);
  const lapse = await getLapse(id);
  return { doc: d, name: a.name, created: a.created, frames: (lapse && lapse.frames) || [] };
}
