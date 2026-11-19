// Save / share a Blob on web, PWA, and native (Capacitor) builds.
import { toast } from './state.js';

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export async function saveBlob(blob, filename) {
  if (isNative()) {
    const P = window.Capacitor.Plugins || {};
    if (P.Filesystem && P.Share) {
      try {
        const data = await blobToBase64(blob);
        const res = await P.Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
        await P.Share.share({ title: filename, url: res.uri, dialogTitle: 'Save or share ' + filename });
        return;
      } catch (e) {
        if (String(e && e.message).toLowerCase().includes('cancel')) return;
        console.error(e);
        toast('Sharing failed: ' + (e.message || e));
        return;
      }
    }
  }
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export function safeName(name) {
  return (name || 'artwork').replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '-') || 'artwork';
}
