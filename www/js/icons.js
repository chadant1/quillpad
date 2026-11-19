// Original line icons (24x24, stroke = currentColor).
const P = {
  gallery: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  actions: '<path d="M14.8 3.6a4.6 4.6 0 0 0-5.6 5.9L3.6 15.1a2.1 2.1 0 0 0 3 3l5.6-5.6a4.6 4.6 0 0 0 5.9-5.6l-2.7 2.7-2.5-.5-.5-2.5z"/>',
  adjust: '<path d="M4 20 14.5 9.5"/><path d="M13 8l3 3"/><path d="M17 3.5v3M15.5 5h3M20 10v2.5M18.8 11.2h2.4M9 3.5v2M8 4.5h2"/>',
  select: '<path d="M7.2 17.6C4.4 16.4 3 14.2 3.6 11.8 4.6 7.9 9.4 5.4 14.2 5.9c4.2.4 6.9 3 6.1 6-.8 3.1-5.2 5.2-9.8 5" stroke-dasharray="2.6 2.4"/><path d="M7.4 17.5c-.6 1.6.2 3 1.9 3"/>',
  transform: '<path d="M5.5 3.5 18.5 10l-6.2 1.8-2.4 6.2z"/>',
  brush: '<path d="M20.5 3.5c-3.3 1.2-8.2 5.6-10.6 8.6l2 2c3-2.4 7.4-7.3 8.6-10.6z"/><path d="M9.5 12.8c-2.1 0-3.6 1.6-3.6 3.6 0 1.4-.9 2.4-2.4 2.6 1 .9 2.5 1.5 4 1.5 2.6 0 4.3-1.8 4.3-4z"/>',
  smudge: '<path d="M9 13.5V5.2a1.6 1.6 0 0 1 3.2 0v6.3"/><path d="M12.2 10.8a1.6 1.6 0 0 1 3.2 0v1.5"/><path d="M15.4 11.6a1.6 1.6 0 0 1 3.2 0v3.6a6 6 0 0 1-6 6h-.9a6 6 0 0 1-4.6-2.2l-2.6-3.1a1.6 1.6 0 0 1 2.4-2.1L9 15.8"/>',
  eraser: '<path d="M9 20.5h11"/><path d="M4.4 14.7 13.6 5.5a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L10.5 20.2H8.4l-4-4a1 1 0 0 1 0-1.5z"/><path d="M9.2 9.9l5.8 5.8"/>',
  layers: '<path d="M12 3.2 21 8.2l-9 5-9-5z"/><path d="M3 12.4l9 5 9-5"/><path d="M3 16.4l9 5 9-5"/>',
  eyedrop: '<path d="M14.6 4.3a2.2 2.2 0 0 1 3.1 0l2 2a2.2 2.2 0 0 1 0 3.1l-2.6 2.6-5.1-5.1z"/><path d="M12.6 7.3 5 14.9V19h4.1l7.6-7.6"/>',
  undo: '<path d="M9 14.5 4 9.5l5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14.5l5-5-5-5"/><path d="M20 9.5H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2h-7.5a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  flipH: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6.5 3 17.5h6zM15 6.5l6 11h-6z"/>',
  flipV: '<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M6.5 9 17.5 3v6zM6.5 15l11 6v-6z"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3.5v5h-5"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  merge: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M4 19.5h16"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  symmetry: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6.5C5.5 7.5 4 11 5 15.5M15 6.5c3.5 1 5 4.5 4 9"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5 21 7.5v9l-5-3"/>',
  canvas: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  prefs: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  lasso: '<path d="M6 17C3.6 15.5 3 13 4 10.6 5.6 7 10 5.3 14.2 5.8c4 .5 6.4 3.1 5.6 5.9-.8 3-5 5-9.6 4.8"/><path d="M6.2 17c-.6 1.6.2 3 1.9 3"/>',
  invert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8.2 8.3 20 17M8.2 15.7 20 7"/>',
  fill: '<path d="M5 11.5 11.5 5l7 7-6.5 6.5a2 2 0 0 1-2.8 0L5 14.3a2 2 0 0 1 0-2.8z"/><path d="M5 12h13.5"/><path d="M20 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/>',
  text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  rename: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>',
  alpha: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 12h8.5V3.5M12 12h8.5M12 12v8.5" /><path d="M3.5 3.5h8.5v8.5H3.5zM12 12h8.5v8.5H12z" fill="currentColor" stroke="none" opacity=".35"/>',
  clipmask: '<path d="M7 5v9.5a2.5 2.5 0 0 0 2.5 2.5H18"/><path d="M15 14l3 3-3 3"/>',
};

export function icon(name, size = 24) {
  const body = P[name] || '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => {
    if (n.dataset.iconDone) return;
    n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon));
    n.dataset.iconDone = '1';
  });
}
