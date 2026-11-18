// Strodano VJ (web) - shared core for every front end (desktop ui.js, phone mobileui.js). GPL-3.0.
// DOM helpers, the selection, small widgets, autosave and the per-frame show pipeline. Loaded before the engine and
// every module, so the globals here ($, el, sel, fld...) exist whichever page loads them.
'use strict';
const $ = id => document.getElementById(id);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) { if (k === 'style') Object.assign(e.style, props[k]); else if (k === 'dataset') Object.assign(e.dataset, props[k]); else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]); else e[k] = props[k]; }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const sel = { l: 0, c: -1 };
let drag = null;            // what is being dragged inside the page: {kind:'media'|'gen'|'fx'|'clip', ...}
let propTab = 'layer', browserTab = 'files';
const fmt2 = v => v.toFixed(2);

function fld(label, min, max, step, get, set, fmt = fmt2) {
  const i = el('input', { type: 'range', min, max, step, value: get() }), o = el('output', { textContent: fmt(get()) });
  i.addEventListener('input', () => { set(+i.value); o.textContent = fmt(+i.value); });
  const r = el('div', { className: 'fld' }, el('label', { textContent: label, title: label }), i, o);
  r.slider = i;
  return r;
}
function tabs(names, cur, pick) {
  return el('div', { className: 'tabs' }, ...names.map(([id, label]) => el('button', { textContent: label, className: id === cur ? 'on' : '', onclick: () => pick(id) })));
}
function dropTarget(node, accept, onDrop) {
  node.addEventListener('dragover', e => { if (accept(e)) { e.preventDefault(); node.classList.add('over'); } });
  node.addEventListener('dragleave', () => node.classList.remove('over'));
  node.addEventListener('drop', e => { node.classList.remove('over'); if (accept(e)) { e.preventDefault(); e.stopPropagation(); onDrop(e); } });
}
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
function draggable(node, payload) {
  node.draggable = true;
  node.addEventListener('dragstart', e => { drag = payload; e.dataTransfer.setData('text/plain', 'strodano'); e.dataTransfer.effectAllowed = 'copyMove'; });
  node.addEventListener('dragend', () => { drag = null; });
}
// Destructive buttons take two clicks: the first arms it (red, "click again"), the second within 2.5 s acts.
// A stray click during a show then costs nothing.
function armThen(btn, what, fn) {
  if (btn.classList.contains('armed')) { clearTimeout(btn.armT); btn.classList.remove('armed'); fn(); return; }
  btn.classList.add('armed'); setStatus('Click again to ' + what);
  btn.armT = setTimeout(() => btn.classList.remove('armed'), 2500);
}
const TRASH_SVG = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

// ---------- autosave (the phone edition sets window.VJ_AUTOSAVE_KEY before this file, so it keeps its own) ----------
const AUTOSAVE = window.VJ_AUTOSAVE_KEY || 'strodano-vj-autosave';
let lastSaved = '';
function autosave() {
  try { const s = JSON.stringify(compToJSON()); if (s !== lastSaved) { localStorage.setItem(AUTOSAVE, s); lastSaved = s; } } catch (e) {}
}

// ---------- one frame of the show, shared by every front end ----------
// Music and inputs, clock, safety / clip options / snapshots, the composition, output windows, NDI and web link.
// The front end draws its own monitors and UI after this.
function coreTick(t0, dt, realDt) {
  audioTick();
  camTick(); handsTick();
  update(dt, realDt);
  vjTick(realDt);   // blackout fade, clip in / out / beat sync, snapshot on the bar (safety.js, clipopts.js, snapshots.js)
  renderComp();
  for (const s of liveScreens()) { const c = s.ctx.canvas; renderScreen(s, c.width, c.height); s.ctx.drawImage(glc, 0, glc.height - c.height, c.width, c.height, 0, 0, c.width, c.height); }
  ndiTick(t0);   // NDI screens: render, async read-back, send (ndi.js)
  vdoTick(t0);   // web link screens: render into the published canvas (vdo.js)
}

// A generator clip's grid thumbnail: one frame of its shader at 160 x 90 (front ends call it for clips with needThumb).
function genThumbFor(c) {
  const d = DEFS.gen.get(c.gen), prog = d && defProg(d);
  c.needThumb = false;
  if (!prog) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, 160, 90);
  gl.useProgram(prog.p);
  setDefUniforms(d, prog, c.params, { w: 160, h: 90, time: 1.3, beats: 0.1, frame: 1 });
  tri();
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 90;
  grab(cv.getContext('2d'), 160, 90);
  c.thumb = cv.toDataURL('image/jpeg', 0.7);
  ui.gridDirty = true;
}
