// Strodano VJ mobile - the phone front end (mobile.html). GPL-3.0.
// Same engine, Agent, listening and web link as the desktop page (index.html + ui.js); this file replaces ui.js with a
// one-thumb interface: the output monitor on top and five tabs.
//   Perform    scenes (columns), layers with their clips, hold-to-apply effect pads, snapshots, master
//   Build      tap a slot to put media / visuals / 3D / text / camera in it; tap a clip or a layer to change it
//   Library    photos and videos imported into the phone's storage (medialib.js)
//   Auto       the Agent driven by the microphone (or a music file): Start, vibe, rules, scene moods
//   Broadcast  the web link (vdo.js): Go live, QR code, share; and how to get it to NDI through the desktop app
// Nothing is dragged (touch screens have no reliable drag and drop): every placement is tap a slot, then pick.
// Rendering the view: a tab is rebuilt only when its structure changes (layerSig); thumbnails, the playing clip, levels,
// progress bars and meters are updated in place every frame (tickUI), so the page never rebuilds under a finger.
'use strict';

// ---------- what other modules expect from a front end (ui.js defines these on the desktop) ----------
let cellEls = [];                       // mix.js marks clip cells while a launch waits for the beat
const outUI = { screen: 0 };            // vdo.js / ndi.js read the Advanced Output selection
function syncOutBtn() { M.badge = null; M.dirty = true; }
function renderProps() { M.dirty = true; }
window.addEventListener('strodano-plan', () => { M.dirty = true; if (M.sheet && M.sheet.title === 'Settings') refreshSheet(); });   // plan.js: the plan in force may have changed
const holding = () => false;

const PREFS_KEY = 'strodano-vj-mobile-prefs';
const M = {
  tab: 'perform', dirty: true, sheet: null, latch: false, held: new Map(), listen: 'mic', lastEvent: '', sig: '',
  statusAt: 0, statusShown: '', install: null, mon: $('mon').getContext('2d', { alpha: false }),
  tiles: [], snapBtns: [], meters: [], levels: [], scenes: [], layerCards: [], goBtn: null, badge: null, beatSeen: -1,
  prefs: { fpsCap: 60, welcomeDone: false, slowDismissed: false, monSmall: false }, slow: 0, slowFps: 0,
};
try { Object.assign(M.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(M.prefs)); } catch (e) {} };
const VDO_SCREEN = 0;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const buzz = (ms = 8) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

// ---------- icons (24x24 line icons) ----------
const SVG = d => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const ICONS = {
  perform: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>',
  build: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="12" width="11" height="8" rx="1.5"/><path d="M19 13v6M16 16h6"/></svg>',
  library: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 15.5l5-4.5 4 3.5 3-2.5 6 5"/><circle cx="15.5" cy="9.5" r="1.5"/></svg>',
  // Auto: sparkles (the Agent working by itself), not a microphone: it can also follow a music file or tapped tempo
  auto: '<svg viewBox="0 0 24 24"><path d="M10 3.5l1.9 5.1 5.1 1.9-5.1 1.9L10 17.5l-1.9-5.1L3 10.5l5.1-1.9z"/><path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/><path d="M18.5 3v3M17 4.5h3"/></svg>',
  broadcast: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>',
};
const I = {
  eye: SVG('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
  eyeOff: SVG('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.1 3.6M6.3 7.4C3.6 9.1 2 12 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.3-1"/>'),
  x: SVG('<path d="M6 6l12 12M18 6L6 18"/>'),
  gear: SVG('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  sliders: SVG('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
  stopSq: SVG('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'),
  chevUp: SVG('<path d="M6 15l6-6 6 6"/>'),
  play: SVG('<path d="M7 4.5v15l12-7.5z"/>'),
  share: SVG('<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  copy: SVG('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  ext: SVG('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14"/>'),
  photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 15.5l5-4.5 4 3.5 3-2.5 6 5"/><circle cx="15.5" cy="9.5" r="1.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
};
const TABS = [['perform', 'Perform'], ['build', 'Build'], ['library', 'Library'], ['auto', 'Auto'], ['broadcast', 'Live']];   // the broadcast tab is called Live: it is where you go on air
const MOOD_HINT = { Calm: 'quiet parts', Groove: 'the steady beat', Peak: 'big moments', Drop: 'when the beat drops' };

// ---------- small helpers ----------
const h3 = (t, extra) => el('h3', null, t, extra || null);
const hint = t => el('div', { className: 'hint', textContent: t });
const btn = (text, onclick, cls = '', extra = {}) => el('button', { textContent: text, className: cls, onclick, ...extra });
const ibtn = (svg, label, onclick, cls = '') => { const b = el('button', { className: 'icon ' + cls, ariaLabel: label, title: label, onclick }); b.innerHTML = svg; return b; };
const clipAt = (li, ci) => comp.layers[li] && comp.layers[li].clips[ci];
const thumbCss = c => (c && c.thumb ? `url("${c.thumb}")` : '');
const pct = (i, v) => i.style.setProperty('--p', (100 * (v - i.min) / ((i.max - i.min) || 1)).toFixed(1) + '%');
function slider(min, max, step, get, set) {
  const i = el('input', { type: 'range', min, max, step, value: get() });
  pct(i, +i.value);
  i.addEventListener('input', () => { set(+i.value); pct(i, +i.value); });
  return i;
}
// every slider made elsewhere (fld() in core.js, clip settings) gets its track fill too
document.addEventListener('input', e => { const t = e.target; if (t && t.type === 'range') pct(t, +t.value); }, true);
const fillRanges = root => root.querySelectorAll('input[type=range]').forEach(i => pct(i, +i.value));
function choice(opts, cur, set) {   // a <select> from [[value, label]]
  const s = el('select', { onchange: e => set(e.target.value) });
  for (const [v, t] of opts) s.append(el('option', { value: v, textContent: t }));
  s.value = String(cur);
  return s;
}
function chips(opts, cur, pick) {   // a row of toggle buttons from [[value, label]]
  return el('div', { className: 'chips' }, ...opts.map(([v, t]) => btn(t, () => pick(v), String(v) === String(cur) ? 'on' : '')));
}
function segCtl(opts, cur, pick) {   // a segmented control (not 'seg': segments.js owns that name) from [[value, label]]
  return el('div', { className: 'seg' }, ...opts.map(([v, t]) => btn(t, () => pick(v), String(v) === String(cur) ? 'on' : '')));
}
const setting = (label, ctl) => el('label', { className: 'setting' }, el('span', { textContent: label }), ctl);
const toggle = (get, set) => el('input', { type: 'checkbox', className: 'sw', checked: !!get(), onchange: e => set(e.target.checked) });
function longPress(node, onShort, onLong, ms = 550) {
  let timer = 0, fired = false;
  node.addEventListener('pointerdown', () => { fired = false; timer = setTimeout(() => { fired = true; buzz(15); onLong(); }, ms); });
  const end = e => { clearTimeout(timer); if (e.type === 'pointerup' && !fired) onShort(); };
  node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end); node.addEventListener('pointerleave', () => clearTimeout(timer));
  node.addEventListener('contextmenu', e => e.preventDefault());
}
const clipNote = c => (!c ? '' : c.type === 'video' ? 'video' : c.type === 'image' ? 'photo' : c.type === 'gen' ? 'visual' : c.type === '3d' ? '3D' : c.type === 'cam' ? 'camera' : c.type);
function tileEl(c, li, ci, onclick) {
  const t = el('button', { className: 'tile' + (c.missing ? ' miss' : ''), style: { backgroundImage: thumbCss(c) }, onclick },
    el('i', { className: 'num', textContent: String(ci + 1) }), el('span', { textContent: c.name }));
  if (c.type === 'video') t.append(el('i', { className: 'bar' }));
  t.dataset.l = li; t.dataset.c = ci; t._thumb = c.thumb;
  M.tiles.push(t);
  return t;
}

// ---------- bottom sheet (swipe the header down, or tap outside, to close) ----------
function openSheet(title, build) {
  const s = $('sheet');
  s.textContent = '';
  const head = el('div', { className: 'sh' }, el('div', { className: 'grab' }), el('div', { className: 'row' }, el('h2', { textContent: title }), ibtn(I.x, 'Close', closeSheet, 'shrink ghost')));
  s.append(head);
  build(s);
  fillRanges(s);
  s.hidden = false; $('scrim').hidden = false; s.style.transform = '';
  M.sheet = { title, build };
  let y0 = null;
  head.addEventListener('pointerdown', e => { y0 = e.clientY; head.setPointerCapture(e.pointerId); s.style.transition = 'none'; });
  head.addEventListener('pointermove', e => { if (y0 !== null) s.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  const up = e => { if (y0 === null) return; const dy = e.clientY - y0; y0 = null; s.style.transition = 'transform .18s'; if (dy > 80) closeSheet(); else s.style.transform = ''; };
  head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
}
function closeSheet() { $('sheet').hidden = true; $('scrim').hidden = true; M.sheet = null; M.dirty = true; }
function refreshSheet() { if (M.sheet) { const { title, build } = M.sheet, top = $('sheet').scrollTop; openSheet(title, build); $('sheet').scrollTop = top; } }
$('scrim').addEventListener('click', closeSheet);

// ---------- Perform ----------
const PAD_FX = ['Strobe', 'Invert', 'RGB Shift', 'Kaleidoscope', 'Pixelate', 'Mirror', 'Wave Warp', 'Edge Detect'];
function padOn(name) {
  if (M.held.has(name)) return;
  const e = mkEffect(name);
  if (!e) return;
  e.padHeld = true;   // engine.js leaves it out of saves
  comp.fx.push(e); M.held.set(name, e);
}
function padOff(name) {
  const e = M.held.get(name);
  if (!e) return;
  const i = comp.fx.indexOf(e);
  if (i >= 0) comp.fx.splice(i, 1);
  M.held.delete(name);
}
// the column's picture: the top-most clip in it that has a thumbnail
const columnThumb = ci => { for (let li = comp.layers.length - 1; li >= 0; li--) { const c = comp.layers[li].clips[ci]; if (c && c.thumb) return c.thumb; } return ''; };
function welcomeCard(v) {
  if (M.prefs.welcomeDone) return;
  v.append(el('div', { className: 'card welcome' }, el('b', { textContent: 'Welcome to Strodano VJ' }),
    el('ol', null, ...[['Library', 'import your videos and photos'], ['Build', 'tap + to put them on layers'], ['Perform', 'tap clips and scenes, hold effects'], ['Auto', 'let it follow the music'], ['Live', 'share your show with a link or QR']]
      .map(([b, t]) => el('li', null, el('b', { textContent: b }), ' - ' + t))),
    btn('Got it', () => { M.prefs.welcomeDone = true; savePrefs(); M.dirty = true; }, 'big')));
}
function slowCard(v) {
  if (!M.slow || M.prefs.slowDismissed) return;
  const lower = comp.w > 960;
  v.append(el('div', { className: 'card slow' }, el('b', { textContent: `Running at ${M.slowFps} fps` }),
    hint(lower ? 'This phone is working hard. A smaller picture runs smoother and cooler; the web link and recording use it too.' : 'Try fewer layers or 3D visuals at once, or close other apps.'),
    el('div', { className: 'row' }, lower ? btn('Use 960 x 540', () => { resizeComp(960, 540); M.slow = 0; setStatus('Picture size 960 x 540'); M.dirty = true; }, 'pri') : null,
      btn('Dismiss', () => { M.prefs.slowDismissed = true; savePrefs(); M.slow = 0; M.dirty = true; }))));
}
function renderPerform(v) {
  welcomeCard(v); slowCard(v);
  const cols = Array.from({ length: comp.columns }, (_, ci) => ci).filter(ci => comp.layers.some(L => L.clips[ci]));
  v.append(h3('Scenes', el('span', { className: 'x hint', textContent: 'one tap changes every layer' })));
  const sc = el('div', { className: 'scenes' });
  for (const ci of cols) {
    const tag = comp.agentTags && comp.agentTags[ci];
    const b = el('button', { className: 'scene', style: { backgroundImage: columnThumb(ci) ? `url("${columnThumb(ci)}")` : '' }, onclick: () => { buzz(); triggerColumn(ci); } },
      el('b', { textContent: String(ci + 1) }), tag ? el('small', { className: 'mood-' + tag, textContent: tag }) : null);
    b.dataset.c = ci; M.scenes.push(b); sc.append(b);
  }
  if (!cols.length) sc.append(hint('No clips yet: add some in Build.'));
  v.append(sc);
  for (let li = comp.layers.length - 1; li >= 0; li--) {
    const L = comp.layers[li], filled = L.clips.map((c, ci) => [c, ci]).filter(([c]) => c);
    const now = el('small', { className: 'now' });
    const lvl = slider(0, 1, 0.001, () => L.opacity, x => { L.opacity = x; });
    const lvlOut = el('span', { textContent: Math.round(L.opacity * 100) + '%' });
    M.levels.push({ i: lvl, o: lvlOut, L });
    const card = el('div', { className: 'layer' + (L.bypass ? ' off' : '') },
      el('div', { className: 'lhead' }, el('div', { className: 'nm' }, el('b', { textContent: L.name + (L.locked ? '  🔒' : '') }), now),
        ...(L.clips.some(c => c && c.type === 'video') ? [   // nudge the playing video while held, to bring it back in time (clipopts.js)
          nudgeButton('«', li, -1, -1, { title: 'Hold: slow the playing clip down', ariaLabel: 'Nudge slower' }),
          nudgeButton('»', li, -1, 1, { title: 'Hold: speed the playing clip up', ariaLabel: 'Nudge faster' })] : []),
        ibtn(L.bypass ? I.eyeOff : I.eye, L.bypass ? 'Show this layer' : 'Hide this layer', () => { L.bypass = !L.bypass; M.dirty = true; }, L.bypass ? 'on' : ''),
        ibtn(I.stopSq, 'Stop this layer (clears what is playing)', () => { eject(li); buzz(); })),
      el('div', { className: 'lvl' }, lvl, lvlOut));
    card._now = now; card._L = L;
    const strip = el('div', { className: 'strip' });
    if (!filled.length) strip.append(hint('Empty: add clips in Build.'));
    for (const [c, ci] of filled) strip.append(tileEl(c, li, ci, () => { buzz(); trigger(li, ci); }));
    card.append(strip);
    M.layerCards.push(card);
    v.append(card);
  }
  const pads = el('div', { className: 'pads' });
  for (const name of PAD_FX.filter(n => DEFS.fx.has(n))) {
    const b = el('button', { textContent: name });
    b.addEventListener('pointerdown', e => {
      buzz(6);
      if (M.latch) { if (M.held.has(name)) padOff(name); else padOn(name); }
      else { padOn(name); b.setPointerCapture(e.pointerId); }
      b.classList.toggle('held', M.held.has(name));
    });
    const up = () => { if (!M.latch) { padOff(name); b.classList.remove('held'); } };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
    if (M.held.has(name)) b.classList.add('held');
    pads.append(b);
  }
  v.append(h3('Effects', el('label', { className: 'x', style: { display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--dim)' } }, 'Latch',
    toggle(() => M.latch, x => { M.latch = x; if (!x) [...M.held.keys()].forEach(padOff); M.dirty = true; }))),
  hint(M.latch ? 'Tap an effect to turn it on or off.' : 'Hold an effect: it is on while your finger is down.'), pads);
  const snapsRow = el('div', { className: 'snaps' });
  for (let i = 0; i < 8; i++) {
    const b = el('button', { textContent: String(i + 1) });
    longPress(b, () => (snaps.slots[i] ? snapRecall(i) : snapStore(i)), () => snapStore(i));
    M.snapBtns.push(b); snapsRow.append(b);
  }
  v.append(h3('Snapshots', el('span', { className: 'x hint', textContent: 'tap to save / recall, hold to save over' })), snapsRow,
    h3('Master'), el('div', { className: 'lvl' }, slider(0, 1, 0.001, () => comp.master, x => { comp.master = x; })));
}

// ---------- Build ----------
function placeAndClose(li, ci, c) { if (c) { setClip(li, ci, c); buzz(); setStatus(c.name + ' is in ' + comp.layers[li].name + ', slot ' + (ci + 1)); } closeSheet(); }
function addSheet(li, ci) {
  openSheet('Add to ' + comp.layers[li].name + ' · slot ' + (ci + 1), s => {
    s.append(btn('Import from this phone…', () => importInto(li, ci), 'big pri'));
    if (media.length) {
      const g = el('div', { className: 'lib' });
      for (const m of media) {
        const it = mlib.items.find(x => x.name === m.name);
        g.append(el('button', { className: 'tile', style: { backgroundImage: it && it.thumb ? `url("${it.thumb}")` : '' }, onclick: () => placeAndClose(li, ci, mediaClip(m)) },
          el('span', { textContent: m.name }), el('i', { className: 'k', textContent: m.kind === 'video' ? 'VIDEO' : 'PHOTO' })));
      }
      s.append(h3('Your photos and videos'), g);
    }
    s.append(h3('Visuals'), el('div', { className: 'chips' }, ...[...DEFS.gen.values()].map(d => btn(d.name, () => placeAndClose(li, ci, genClip(d.name))))));
    if (typeof SCENES3D !== 'undefined' && typeof THREE !== 'undefined')
      s.append(h3('3D', el('span', { className: 'x hint', textContent: 'heavier on older phones' })), el('div', { className: 'chips' }, ...Object.keys(SCENES3D).map(k => btn(SCENES3D[k].name || k, () => placeAndClose(li, ci, clip3d(k))))));
    const txt = el('input', { type: 'text', placeholder: 'Words, one line per cue', value: '' });
    s.append(h3('Text'), el('div', { className: 'row' }, txt, btn('Add', () => placeAndClose(li, ci, textClip({ text: txt.value || 'STRODANO VJ' })), 'shrink')));
    if (canCamera) s.append(h3('Camera'), btn('Live camera', () => placeAndClose(li, ci, camClip('')), 'big'));
  });
}
// Import, then put the first new file in the slot that asked for it (the rest wait in the Library)
function importInto(li, ci) { M.importTo = { li, ci }; $('importInput').click(); }
function clipSheet(li, ci) {
  const L = comp.layers[li], c = clipAt(li, ci);
  if (!c) return addSheet(li, ci);
  openSheet(c.name, s => {
    s.append(el('div', { className: 'row' }, btn('Play', () => { trigger(li, ci); buzz(); }, 'pri'), btn('Replace', () => addSheet(li, ci)),
      btn('Remove', e => armThen(e.currentTarget, 'remove ' + c.name, () => { setClip(li, ci, null); closeSheet(); }), 'danger')));
    s.append(el('div', { className: 'row', style: { marginTop: '8px' } },
      btn('◀  Move left', () => moveClip(li, ci, -1), '', { disabled: ci === 0 }), btn('Move right  ▶', () => moveClip(li, ci, 1), '', { disabled: ci >= comp.columns - 1 })));
    if (c.missing) s.append(hint(`"${c.fileName}" is not on this phone. Import it again in Library (same name) to bring it back.`));
    if (c.type === 'video' && !c.missing) {
      s.append(h3('When it ends'), segCtl([['loop', 'Loop'], ['hold', 'Hold last frame'], ['eject', 'Clear']], c.loopMode || 'loop', x => { c.loopMode = x; refreshSheet(); }),
        h3('Speed'), el('div', { className: 'lvl' }, slider(0.25, 2, 0.05, () => c.speed || 1, x => { c.speed = x; if (c.video) c.video.playbackRate = x; })),
        el('div', { className: 'row' }, btn('−0.01', () => { clipSpeedStep(c, -0.01); refreshSheet(); }), btn('1x', () => { clipSpeedReset(c); refreshSheet(); }), btn('+0.01', () => { clipSpeedStep(c, 0.01); refreshSheet(); })),
        h3('Nudge', el('span', { className: 'x hint', textContent: 'hold while it plays' })),
        el('div', { className: 'row' }, nudgeButton('« Slower', li, ci, -1), nudgeButton('Faster »', li, ci, 1)),
        h3('Follow the beat', el('span', { className: 'x hint', textContent: 'stretch it to' })), segCtl([[0, 'Off'], [4, '1 bar'], [8, '2'], [16, '4'], [32, '8 bars']], c.syncBeats || 0, x => { c.syncBeats = +x; c.sync0 = comp.beats; refreshSheet(); }));
    } else if (c.type === 'gen') {
      const d = DEFS.gen.get(c.gen);
      if (d && d.params.length) { s.append(h3('Settings')); d.params.forEach((pd, k) => s.append(fld(pd.name, 0, 1, 0.001, () => c.params[k] ?? pd.def, x => { c.params[k] = x; c.needThumb = true; }))); }
    } else if (CLIP_TYPES[c.type] && CLIP_TYPES[c.type].props) {
      s.append(h3('Settings'));
      const box = el('div', { className: 'props' });
      try { CLIP_TYPES[c.type].props(c, box, L); } catch (e) { box.append(hint('Settings for this clip are on the desktop app.')); }
      s.append(box);
    }
    if (!c.missing) {
      s.append(h3('Size, position and crop'));
      clipTrFields(c).forEach(r => s.append(fld(...r)));
      s.append(el('div', { className: 'row' }, btn('Reset', () => { delete c.tr; refreshSheet(); }), btn('Fit to crop', () => { clipFillCrop(c); refreshSheet(); })));
      s.append(h3('Effects on this clip'));
      fxCards(s, c.fx || (c.fx = []));
    }
  });
}
function moveClip(li, ci, d) {
  const L = comp.layers[li], cj = ci + d;
  if (cj < 0 || cj >= comp.columns) return;
  [ci, cj].forEach(k => { if (L.active === k || L.pendingCol === k) eject(li); });
  [L.clips[ci], L.clips[cj]] = [L.clips[cj], L.clips[ci]];
  ui.gridDirty = true; closeSheet(); clipSheet(li, cj);
}
// An effect list (a layer's or a clip's) inside a sheet: one card per effect, then the effects that can be added.
function fxCards(s, chain) {
  chain.forEach((e, i) => {
    const d = DEFS.fx.get(e.def), box = el('div', { className: 'card' }, el('div', { className: 'lhead' }, el('div', { className: 'nm' }, el('b', { textContent: e.def })),
      toggle(() => !e.bypass, x => { e.bypass = !x; }), ibtn(I.x, 'Remove ' + e.def, () => { chain.splice(i, 1); refreshSheet(); }, 'ghost')));
    if (d) { d.params.forEach((pd, k) => box.append(fld(pd.name, 0, 1, 0.001, () => e.params[k] ?? pd.def, x => { e.params[k] = x; }))); if (!d.isf) box.append(fld('Mix', 0, 1, 0.001, () => e.mix, x => { e.mix = x; })); }
    s.append(box);
  });
  if (!chain.length) s.append(hint('None yet. Add one:'));
  s.append(el('div', { className: 'chips' }, ...[...DEFS.fx.values()].filter(d => !/\(cam\)/.test(d.name)).map(d => btn('+ ' + d.name, () => { const e = mkEffect(d.name); if (e) { chain.push(e); refreshSheet(); } }))));
}
function layerSheet(li) {
  const L = comp.layers[li];
  openSheet(L.name, s => {
    s.append(h3('Name'), el('input', { type: 'text', value: L.name, onchange: e => { L.name = e.target.value.trim() || L.name; M.dirty = true; } }),
      el('div', { className: 'card' },
        setting('Blend', choice(BLENDS.map((b, i) => [i, b]), L.blend, x => { L.blend = +x; M.dirty = true; })),
        setting('Change between clips', choice(TRANSITION_TYPES.map((t, i) => [i, t]), L.transType || 0, x => { L.transType = +x; if (!L.trans) L.trans = 1; refreshSheet(); })),
        setting('Auto leaves it alone', toggle(() => L.locked, () => { toggleLayerLock(li); M.dirty = true; }))),
      h3('Change takes'), segCtl([[0, 'Cut'], [0.5, '½ beat'], [1, '1 beat'], [4, '1 bar'], [8, '2 bars']], L.trans || 0, x => { L.trans = +x; refreshSheet(); }),
      h3('Effects on this layer'));
    fxCards(s, L.fx);
    s.append(h3('Layer'), btn('Delete layer', e => armThen(e.currentTarget, 'delete ' + L.name, () => { if (comp.layers.length > 1) { removeLayer(li); closeSheet(); } else setStatus('A project needs at least one layer'); }), 'danger big'));
  });
}
function renderBuild(v) {
  v.append(el('div', { className: 'row', style: { marginTop: '4px' } },
    btn('+ Layer', () => { addLayer(); M.dirty = true; }), btn('+ Slot', () => setColumns(comp.columns + 1)), btn('− Slot', () => setColumns(comp.columns - 1), '', { disabled: comp.columns <= 1 })),
  hint('Tap + to fill a slot, tap a clip to change it. The button beside a layer\'s name opens its settings.'));
  for (let li = comp.layers.length - 1; li >= 0; li--) {
    const L = comp.layers[li], strip = el('div', { className: 'strip' });
    for (let ci = 0; ci < comp.columns; ci++) {
      const c = L.clips[ci];
      strip.append(c ? tileEl(c, li, ci, () => clipSheet(li, ci)) : el('button', { className: 'tile empty', textContent: '+', ariaLabel: 'Add to slot ' + (ci + 1), onclick: () => addSheet(li, ci) }));
    }
    const info = [L.blend ? 'blend ' + BLENDS[L.blend].toLowerCase() : '', L.fx.length ? L.fx.length + ' effect' + (L.fx.length > 1 ? 's' : '') : '', L.locked ? 'locked' : ''].filter(Boolean).join(' · ');
    v.append(el('div', { className: 'layer' }, el('div', { className: 'lhead' }, el('div', { className: 'nm' }, el('b', { textContent: L.name }), el('small', { textContent: info || L.clips.filter(Boolean).length + ' clips' })),
      ibtn(I.sliders, 'Layer settings', () => layerSheet(li))), strip));
  }
  v.append(hint('Picture size, saving, cloud projects and your account are in Settings (top of the screen).'));
}
// ---------- Settings (header button): everything that is about the app or the whole project, in one sheet ----------
function settingsSheet() {
  openSheet('Settings', s => {
    const sw = el('div', { className: 'swatches', role: 'radiogroup', ariaLabel: 'Colour theme' }, ...THEMES.map(t => {
      const b = el('button', { className: THEME.id === t.id ? 'on' : '', title: t.name, ariaLabel: t.name + ' theme', onclick: () => { applyTheme(t.id); refreshSheet(); } });
      b.style.setProperty('--sw', `rgb(${t.rgb.join(',')})`);
      return b;
    }));
    s.append(h3('Colour'), sw);
    settingsProject(s);
    s.append(h3('Account'), el('div', { className: 'card' }, el('div', { className: 'setting' }, el('span', { textContent: ent.token ? 'Signed in: ' + ENT_NAMES[entPlan()] : 'Free (not signed in)' }),
      btn(ent.token ? 'Account' : 'Sign in', () => { closeSheet(); entAccount(); }, ent.token ? '' : 'pri'))));
  });
}
function settingsProject(v) {
  const res = comp.w + 'x' + comp.h;
  v.append(h3('Picture'), el('div', { className: 'card' },
    setting('Picture size', choice([['960x540', '960 x 540 (smoothest)'], ['1280x720', '1280 x 720'], ['1920x1080', '1920 x 1080 (new phones)']].concat(['960x540', '1280x720', '1920x1080'].includes(res) ? [] : [[res, res.replace('x', ' x ')]]), res,
      x => { const [w, h] = x.split('x').map(Number); resizeComp(w, h); M.slow = 0; M.dirty = true; })),
    setting('Frame rate', choice([[60, '60 fps'], [30, '30 fps (saves battery)']], M.prefs.fpsCap, x => { M.prefs.fpsCap = +x; savePrefs(); })),
    setting('Small monitor (more room for controls)', toggle(() => M.prefs.monSmall, x => setMonSmall(x)))),
    h3('Project'),
    el('div', { className: 'row' }, btn('Save project', saveProject), btn('Open project', () => { closeSheet(); $('compInput').click(); })),
    el('div', { className: 'row', style: { marginTop: '8px' } }, btn('Cloud projects', () => { closeSheet(); wsCloud(); }),
      btn('Start over', e => armThen(e.currentTarget, 'start a new project (your library stays)', () => { mobileDemo(); closeSheet(); }), 'danger')),
    hint('Projects keep the layout; photos and videos stay in the Library and relink by name. Cloud projects open on any phone or computer you sign in on.'));
}
function saveProject() {
  const blob = new Blob([JSON.stringify(compToJSON(), null, 1)], { type: 'application/json' });
  const f = new File([blob], 'strodano-mobile.svj', { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: 'Strodano VJ project' }).catch(() => {}); return; }
  const a = el('a', { href: URL.createObjectURL(blob), download: 'strodano-mobile.svj' });
  document.body.append(a); a.click(); a.remove(); setStatus('Saved strodano-mobile.svj');
}

// ---------- Library ----------
function renderLibrary(v) {
  v.append(el('div', { style: { height: '4px' } }), btn('Import photos & videos', () => { M.importTo = null; $('importInput').click(); }, 'big pri'));
  if (mlib.busy) v.append(hint(`Copying into the app: ${Math.min(mlib.total, mlib.done + 1)} of ${mlib.total}…`));
  if (mlib.est && mlib.est.quota) v.append(hint(`Using ${mlibSize(mlib.est.usage || 0)} of ${mlibSize(mlib.est.quota)} available` + (mlib.persisted ? ' · kept by the browser' : '')));
  if (typeof premiumGet === 'function') v.append(premiumCard());
  if (isIOS && !standalone()) v.append(el('div', { className: 'card' }, hint('iPhone: tap Share, then "Add to Home Screen". The app then keeps your library and opens full screen.')));
  if (!mlib.items.length) {
    const e = el('div', { className: 'empty-state' });
    e.innerHTML = I.photo;
    e.append(el('b', { textContent: mlib.ready ? 'No clips yet' : 'Opening the library…' }), el('div', { textContent: 'Imported videos and photos are copied into the app, so they are here next time, offline too.' }));
    v.append(e);
    return;
  }
  const g = el('div', { className: 'lib' });
  for (const it of mlib.items) {
    const m = media.find(x => x.name === it.name), video = it.type.startsWith('video') || isVideoName(it.name);
    g.append(el('button', { className: 'tile', style: { backgroundImage: it.thumb ? `url("${it.thumb}")` : '' }, onclick: () => libSheet(it, m) },
      el('span', { textContent: it.name }), el('i', { className: 'k', textContent: video ? 'VIDEO' : 'PHOTO' })));
  }
  v.append(h3(mlib.items.length + ' in the library', el('span', { className: 'x hint', textContent: 'tap one to use it' })), g);
}
// The premium pack (starter.js): download for Pro / Festival, the upgrade prompt for Free
function premiumCard() {
  const have = premiumHave(), unlocked = entCan('pack'), p = premiumState;
  const go = have ? btn('Open the 3D show', e => armThen(e.currentTarget, 'replace your project with the STRODANO 3D show (your library stays)', () => { premiumOpenShow(); M.tab = 'perform'; renderTabs(); M.dirty = true; }), 'big pri', { style: { marginTop: '8px' } })
    : btn(p.busy ? (p.total ? `Downloading ${Math.min(p.total, p.done + 1)} of ${p.total}…` : 'Checking your plan…') : unlocked ? 'Download the pack' : 'Unlock with Pro', () => premiumGet(), 'big pri', { disabled: p.busy, style: { marginTop: '8px' } });
  return el('div', { className: 'card' },
    el('div', { className: 'lhead' }, el('div', { className: 'nm' }, el('b', { textContent: 'STRODANO 3D show' })), el('i', { className: 'k', textContent: 'PRO' })),
    hint('Six scenes built on the advanced 3D visualizers (particle pictures, terrain, harmonograph, crystals, supernova, text shatter) with STRODANO footage in full HD.'),
    p.note && !p.busy && !have ? hint(p.note) : null, go);
}
function libSheet(it, m) {
  openSheet(it.name, s => {
    s.append(hint(mlibSize(it.size) + ' · added ' + new Date(it.added).toLocaleDateString()));
    if (m) {
      s.append(h3('Put it on a layer', el('span', { className: 'x hint', textContent: 'next free slot' })));
      for (let li = comp.layers.length - 1; li >= 0; li--) {
        const L = comp.layers[li], free = L.clips.findIndex(c => !c);
        s.append(btn(L.name + (free < 0 ? '  (full)' : '  ·  slot ' + (free + 1)), () => { if (free < 0) { setStatus('No free slot on ' + L.name + ': add one in Build'); return; } setClip(li, free, mediaClip(m)); buzz(); setStatus(it.name + ' is on ' + L.name + ', slot ' + (free + 1)); closeSheet(); }, 'big', { disabled: free < 0, style: { marginBottom: '8px' } }));
      }
    }
    s.append(h3('Phone storage'), btn('Delete from this phone', e => armThen(e.currentTarget, 'delete ' + it.name, () => { mlibDelete(it.name); closeSheet(); }), 'danger big'));
  });
}
$('importInput').addEventListener('change', async e => {
  const files = [...e.target.files], to = M.importTo;
  e.target.value = '';
  if (!files.length) return;
  closeSheet(); if (!to) M.tab = 'library'; renderTabs(); M.dirty = true;
  const added = await mlibImport(files);
  if (to && added.length) { setClip(to.li, to.ci, mediaClip(added[0])); setStatus(added[0].name + ' is in ' + comp.layers[to.li].name + ', slot ' + (to.ci + 1)); }
  else if (added.length) setStatus(added.length + ' file' + (added.length > 1 ? 's' : '') + ' added to the library');
  M.dirty = true;
});
mlib.onChange = () => { if (M.tab === 'library') M.dirty = true; };

// ---------- Auto (the Agent, listening) ----------
async function startAuto() {
  if (!entGate('agent')) return;
  audioCtx();
  if (M.listen === 'mic' && live.src !== 'mic') { if (!(await useMic())) { M.dirty = true; return; } }
  if (M.listen === 'tap' && live.src !== 'dj') useDecks();
  if (M.listen === 'file') { if (!live.el) { $('songInput').click(); return; } live.el.play().catch(() => {}); }
  if (!agentLayers().length) agentStarter();
  setAgent(true); buzz(20); M.dirty = true;
}
function stopAuto() {
  setAgent(false);
  if (live.el && !live.el.paused) live.el.pause();
  if (live.src === 'mic') useDecks();   // the microphone is let go (the phone's mic indicator turns off)
  M.dirty = true;
}
$('songInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  audioCtx();
  if (await useFile(f)) { M.listen = 'file'; live.el.play().catch(() => {}); if (!agentLayers().length) agentStarter(); setAgent(true); }
  M.dirty = true;
});
onMusic((type, d) => {
  const names = { song: 'New song', drop: 'Drop!', breakdown: 'Breakdown', band: 'Energy ' + (d && d.band || ''), tempo: 'Tempo found' };
  if (names[type]) M.lastEvent = names[type];
});
function meter(get) { const i = el('i'); M.meters.push({ i, get }); return el('div', { className: 'meter' }, i); }
function renderAuto(v) {
  const on = agent.on;
  const go = el('button', { className: 'gobtn' + (on ? ' on' : ''), ariaLabel: on ? 'Stop auto' : 'Start auto', onclick: () => (on ? stopAuto() : startAuto()) });
  go.innerHTML = on ? ICONS_STOP : ICONS.auto;
  go.append(el('span', { textContent: on ? 'Stop' : 'Start' }), el('i', { className: 'ring' }));
  M.goBtn = go;
  v.append(el('div', { className: 'go' }, go, el('div', { className: 'sub', textContent: on ? 'Playing your clips with the music. Tap any clip in Perform to take over that layer for a while.' : 'Auto plays the clips you set up and changes them with the music it hears.' })));
  v.append(h3('Listen to'), segCtl([['mic', 'Microphone'], ['file', 'Music file'], ['tap', 'Tap tempo']], M.listen, x => {
    M.listen = x;
    if (x === 'file') $('songInput').click();
    else if (agent.on) startAuto();
    M.dirty = true;
  }));
  if (M.listen === 'file') v.append(el('div', { className: 'row', style: { marginTop: '8px' } }, el('span', { className: 'hint', textContent: live.fileName ? 'Playing: ' + live.fileName : 'No song picked yet' }), btn(live.fileName ? 'Change' : 'Pick a song', () => $('songInput').click(), 'shrink')));
  if (M.listen === 'mic') v.append(hint('Point the phone at the speakers, close to the music (not in a pocket).'));
  if (M.listen === 'tap') v.append(hint('Tap the BPM button at the top in time with the music.'));
  v.append(el('div', { className: 'card' }, meter(() => Math.min(1, audioFeat.level * 1.4)),
    el('div', { className: 'stat', style: { marginTop: '10px' } },
      el('div', null, el('b', { className: 'a-bpm' }), el('small', { textContent: 'BPM' })),
      el('div', null, el('b', { className: 'a-lock' }), el('small', { textContent: 'Beat' })),
      el('div', null, el('b', { className: 'a-band' }), el('small', { textContent: 'Energy' }))),
    el('div', { className: 'hint a-event', style: { textAlign: 'center', marginTop: '8px' } })));
  v.append(h3('Steer'), el('div', { className: 'row' }, btn('New scene', () => { agentNext(); buzz(); }), btn(agent.hold ? 'Holding' : 'Hold', () => { agentHold(); M.dirty = true; }, agent.hold ? 'on' : ''), btn('Drop!', () => { agentDrop(); buzz(25); }, 'pri')),
    el('div', { className: 'row', style: { marginTop: '8px' } }, btn('Resync to the bar', () => { comp.beats = Math.ceil(comp.beats / 4) * 4; if (live.src === 'mic' || live.src === 'file') resetTracker(); })));
  v.append(h3('Vibe'), segCtl(Object.entries(AGENT_VIBES).map(([k, x]) => [k, x.label]), agent.vibe, k => { setVibe(k); M.dirty = true; }),
    hint((AGENT_VIBES[agent.vibe] || {}).title || ''));
  v.append(h3('Rules'), el('div', { className: 'card' },
    setting('Change the scene every', choice([[4, '1 bar'], [8, '2 bars'], [16, '4 bars'], [32, '8 bars'], [64, '16 bars']], agent.vary, x => { agent.vary = +x; saveAgent(); })),
    setting('Strobe on drops', choice(STROBE_LENS, agent.strobe, x => { agent.strobe = +x; saveAgent(); })),
    setting('New scene when the song changes', toggle(() => agent.onSong, x => { agent.onSong = x; saveAgent(); }))));
  const used = Array.from({ length: comp.columns }, (_, ci) => ci).filter(ci => comp.layers.some(L => L.clips[ci]));
  v.append(h3('Scene moods'), hint('Tell Auto what each scene is for. Untagged clips are mixed by Auto itself.'));
  const card = el('div', { className: 'card' });
  for (const ci of used) {
    const t = columnThumb(ci), tag = colTag(ci);
    card.append(el('div', { className: 'setting' },
      el('div', { className: 'tile', style: { flex: '0 0 64px', height: '36px', backgroundImage: t ? `url("${t}")` : '' } }, el('i', { className: 'num', textContent: String(ci + 1) })),
      el('span', { className: tag ? 'mood-' + tag : '', textContent: tag ? tag + ' · ' + MOOD_HINT[tag] : 'Any' }),
      choice(COL_TAGS.map(x => [x, x || 'Any']), tag, x => { comp.agentTags = comp.agentTags || {}; if (x) comp.agentTags[ci] = x; else delete comp.agentTags[ci]; if (typeof plDirty === 'function') plDirty(); M.dirty = true; })));
  }
  if (used.length) v.append(card);
  if (!agentLayers().length) v.append(btn('Add starter clips', () => { agentStarter(); M.dirty = true; }, 'big'));
}
const ICONS_STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';

// ---------- Broadcast (web link) ----------
const VDO_PRESETS = [
  ['wifi', 'Wi-Fi', '1280 x 720, 30 fps, 2.5 Mbps', { vdoRes: '1280x720', vdoFps: 30, vdoKbps: 2500 }],
  ['cell', 'Mobile data', '960 x 540, 25 fps, 1.5 Mbps', { vdoRes: '960x540', vdoFps: 25, vdoKbps: 1500 }],
  ['high', 'High', '1920 x 1080, 30 fps, 4 Mbps', { vdoRes: '1920x1080', vdoFps: 30, vdoKbps: 4000 }],
];
const vdoScreen = () => { const s = screens[VDO_SCREEN]; if (s.device !== 'vdo') s.device = 'vdo'; vdoEnsureIds(s); return s; };
const presetOf = s => (VDO_PRESETS.find(p => p[3].vdoRes === (s.vdoRes || '1280x720') && p[3].vdoKbps === (s.vdoKbps || 2500)) || [''])[0];
const qrCache = { text: '', cv: null };
function qrCanvas(text) {
  if (qrCache.text === text) return qrCache.cv;
  const q = qrcode(0, 'M');
  q.addData(text); q.make();
  const n = q.getModuleCount(), cv = el('canvas', { width: n, height: n }), x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) x.fillRect(c, r, 1, 1);
  qrCache.text = text; qrCache.cv = cv;
  return cv;
}
function copyText(t) {
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => setStatus('Link copied: anyone with it can watch'), () => setStatus('Press and hold the link to copy it'));
}
function liveSummary(s) {
  const n = s.vdoSend;
  if (!n) return ['Not live', 'Go live to start sending your output'];
  if (n.error && n.state !== 'live') return ['Problem', n.error];
  if (n.state === 'connecting') return ['Connecting…', 'Reaching the server'];
  if (n.state === 'reconnecting') return ['Reconnecting…', 'The connection dropped'];
  return ['Live', `${n.w} x ${n.h} at ${n.fpsOut.toFixed(0)} fps` + (n.relayed ? ` · ${n.relayed} relayed` : '')];
}
function renderBroadcast(v) {
  const s = vdoScreen(), n = s.vdoSend, link = vdoLink(s), [t1, t2] = liveSummary(s);
  v.append(el('div', { className: 'card livecard' + (n && n.state === 'live' ? ' on' : '') }, el('i', { className: 'dot' }),
    el('div', { className: 't' }, el('b', { className: 'b-t1', textContent: t1 }), el('small', { className: 'b-t2', textContent: t2 })),
    el('div', { className: 'v' }, el('b', { className: 'b-v', textContent: n ? String(n.viewers.size) : '–' }), el('small', { textContent: 'watching' }))),
  btn(n ? 'Stop broadcast' : 'Go live', () => { if (n) closeOutput(VDO_SCREEN); else { vdoStart(VDO_SCREEN); buzz(20); } M.dirty = true; }, 'big ' + (n ? 'danger' : 'pri')));
  const share = ibtn(I.share, 'Share', () => { if (navigator.share) navigator.share({ title: 'Strodano VJ live', text: 'Watch my visuals live', url: link }).catch(() => {}); else copyText(link); }, 'pri');
  share.append(' Share');
  const copy = ibtn(I.copy, 'Copy', () => copyText(link)); copy.append(' Copy');
  const watch = ibtn(I.ext, 'Watch', () => window.open(link, '_blank', 'noopener')); watch.append(' Watch');
  [share, copy, watch].forEach(b => { b.style.gap = '6px'; });
  v.append(h3('Scan to watch'), el('div', { className: 'qr' }, qrCanvas(link)), el('div', { className: 'link', textContent: link }),
    el('div', { className: 'row', style: { marginTop: '8px' } }, share, copy, watch));
  v.append(h3('Quality'), segCtl(VDO_PRESETS.map(p => [p[0], p[1]]), presetOf(s), k => { const p = VDO_PRESETS.find(x => x[0] === k); Object.assign(s, p[3]); vdoRestart(VDO_SCREEN); M.dirty = true; }),
    hint((VDO_PRESETS.find(p => p[0] === presetOf(s)) || ['', '', 'Custom'])[2] + '. Every viewer uses that much of your upload: for more than 2 or 3, send it to a computer (below) and share from there.'),
    el('div', { className: 'card' }, setting('Send sound (music file or mic)', toggle(() => s.vdoAudio, x => { s.vdoAudio = x; vdoRestart(VDO_SCREEN); }))));
  v.append(h3('To a computer, OBS or NDI'), el('div', { className: 'card' }, el('ol', { className: 'steps' },
    el('li', null, el('b', { textContent: 'OBS: ' }), 'add a Browser Source with the link (or open it in any browser, full screen).'),
    el('li', null, el('b', { textContent: 'NDI: ' }), 'in Strodano VJ desktop, Sources > Web link input, paste the link, Show on a layer.'),
    el('li', null, 'Then in Advanced Output set a screen\'s display to NDI: every NDI app on that network sees your phone.'))));
  const name = el('input', { type: 'text', value: s.vdoId, spellcheck: false, autocapitalize: 'off', placeholder: 'e.g. strodano_ade' });
  const rename = () => { const err = vdoRename(VDO_SCREEN, name.value); setStatus(err || 'Your link is now ' + vdoLink(s)); M.dirty = true; };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
  name.addEventListener('change', rename);
  v.append(h3('Link name', el('span', { className: 'x hint', textContent: VDO_SITE.replace(/^https:\/\//, '') + '/live/…' })),
    el('div', { className: 'row' }, name, btn('Save', rename, 'shrink')),
    hint('Letters, digits and _ only. Pick something only you would use (your artist or event name). Renaming makes the old link stop working.'),
    h3('Link'), btn('Make a new private link', e => armThen(e.currentTarget, 'make a new link (the old one stops working)', () => { s.vdoId = ''; s.vdoPw = ''; vdoEnsureIds(s); vdoRestart(VDO_SCREEN); M.dirty = true; }), 'danger'),
    hint('The link includes its password (after the #): share it only with people who should watch. Keep this app open and the screen on while you are live.'));
}

// ---------- the view ----------
function renderTabs() {
  const t = $('tabs');
  t.textContent = '';
  if (M.tab === 'auto' && !proLoaded()) M.tab = 'perform';   // Agent Mode is Strodano VJ Pro
  for (const [id, label] of TABS.filter(([id]) => id !== 'auto' || proLoaded())) {
    const b = el('button', { className: (M.tab === id ? 'on' : '') + (id === 'broadcast' && M.onAir ? ' onair' : ''), ariaLabel: label, onclick: () => { if (M.tab === id) { $('view').scrollTo({ top: 0, behavior: 'smooth' }); return; } M.tab = id; M.dirty = true; $('view').scrollTop = 0; renderTabs(); } });
    const pill = el('span', { className: 'pill' });
    pill.innerHTML = ICONS[id];
    b.dataset.id = id;
    b.append(pill, el('span', { textContent: label }));
    t.append(b);
  }
}
// What the visible tab is built from. When only thumbnails / playing state / levels change, the view is patched in place.
const layerSig = () => [M.tab, comp.columns, comp.w, JSON.stringify(comp.agentTags || {}), M.slow, M.prefs.welcomeDone, M.latch, agentOn(), agentOn() && agent.hold, agentOn() && agent.vibe, live.src, M.listen, live.fileName,
  ...comp.layers.map(L => [L.name, L.locked, L.bypass, L.blend, L.fx.length, ...L.clips.map(c => (c ? (c.uid || c.fileName || c.name) + (c.missing ? '!' : '') : ''))].join('|'))].join('§');
function renderView() {
  const v = $('view'), top = v.scrollTop;
  v.textContent = '';
  M.tiles = []; M.meters = []; M.levels = []; M.scenes = []; M.snapBtns = []; M.layerCards = []; M.goBtn = null;
  if (M.tab === 'auto' && !proLoaded()) M.tab = 'perform';
  ({ perform: renderPerform, build: renderBuild, library: renderLibrary, auto: renderAuto, broadcast: renderBroadcast })[M.tab](v);
  fillRanges(v);
  v.scrollTop = top;
  M.sig = layerSig();
}
// A finger on a slider, or a scroll in progress: no rebuild now (it would pull the control out from under the finger).
// iOS never focuses a range input on touch, so the target of the pointer is tracked instead of document.activeElement.
let touchTarget = null;
window.addEventListener('pointerdown', e => { touchTarget = e.target; }, true);
['pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, () => { touchTarget = null; }, true));
const busyTouch = () => !!(touchTarget && touchTarget.closest && touchTarget.closest('#view'));

function patchView() {
  for (const t of M.tiles) {
    const L = comp.layers[+t.dataset.l], ci = +t.dataset.c, c = L && L.clips[ci];
    if (!c) continue;
    if (t._thumb !== c.thumb) { t._thumb = c.thumb; t.style.backgroundImage = thumbCss(c); }
    const a = L.active === ci, p = L.pendingCol === ci;
    if (t.classList.contains('active') !== a) t.classList.toggle('active', a);
    if (t.classList.contains('pending') !== p) t.classList.toggle('pending', p);
    const bar = c.video && t.lastChild && t.lastChild.className === 'bar' ? t.lastChild : null;
    if (bar) { const w = a && c.video.duration ? (100 * c.video.currentTime / c.video.duration).toFixed(1) + '%' : '0'; if (bar.style.width !== w) bar.style.width = w; }
  }
  for (const card of M.layerCards) {
    const L = card._L, c = L.clips[L.active], t = c ? '▶ ' + c.name : 'nothing playing';
    if (card._now.textContent !== t) card._now.textContent = t;
  }
  for (const b of M.scenes) {
    const ci = +b.dataset.c, on = comp.layers.some(L => L.clips[ci] && L.active === ci), th = columnThumb(ci);
    if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
    if (th && b._th !== th) { b._th = th; b.style.backgroundImage = `url("${th}")`; }
  }
  // level sliders follow the layer (the Agent fades them) unless that slider is under a finger
  for (const m of M.levels) {
    if (touchTarget === m.i) continue;
    const v = m.L.opacity;
    if (Math.abs(+m.i.value - v) > 0.004) { m.i.value = v; pct(m.i, v); }
    const t = Math.round(v * 100) + '%';
    if (m.o.textContent !== t) m.o.textContent = t;
  }
  M.snapBtns.forEach((b, i) => { const h = !!snaps.slots[i]; if (b.classList.contains('has') !== h) b.classList.toggle('has', h); });
  for (const m of M.meters) m.i.style.width = (m.get() * 100).toFixed(0) + '%';
  const set = (s, t) => { const e = document.querySelector(s); if (e && e.textContent !== t) e.textContent = t; };
  if (M.tab === 'auto') {
    set('.a-bpm', comp.bpm.toFixed(0));
    set('.a-lock', live.src === 'dj' ? 'tap' : live.locked ? 'locked' : 'finding');
    set('.a-band', live.src === 'dj' ? '–' : live.band || '–');
    set('.a-event', M.lastEvent ? 'Last heard: ' + M.lastEvent : '');
  }
  if (M.tab === 'broadcast') { const s = screens[VDO_SCREEN], [t1, t2] = liveSummary(s); set('.b-t1', t1); set('.b-t2', t2); set('.b-v', s.vdoSend ? String(s.vdoSend.viewers.size) : '–'); }
}
function tickUI() {
  outer: for (const L of comp.layers) for (const c of L.clips) if (c && c.needThumb) { genThumbFor(c); break outer; }
  ui.gridDirty = ui.propsDirty = ui.browserDirty = false;   // the signature below decides what needs rebuilding
  if (!M.sheet && !busyTouch() && (M.dirty || layerSig() !== M.sig)) { M.dirty = false; renderView(); }
  patchView();
  const beat = ((Math.floor(comp.beats) % 4) + 4) % 4;
  if (beat !== M.beatSeen) {
    M.beatSeen = beat;
    [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === beat));
    const r = M.goBtn && M.goBtn.querySelector('.ring');
    if (r && agentOn()) { r.classList.remove('beat'); void r.offsetWidth; r.classList.add('beat'); }
  }
  const bpm = comp.bpm.toFixed(0);
  if ($('bpmVal').textContent !== bpm) $('bpmVal').textContent = bpm;
  // badges over the monitor
  const isLive = vdoLive().length > 0;
  if (isLive !== M.onAir) {   // on air: red edge on the monitor, LIVE pill in the top bar, the Live tab tinted
    M.onAir = isLive;
    document.body.classList.toggle('on-air', isLive);
    $('livePill').hidden = !isLive;
    const lt = document.querySelector('#tabs button[data-id="broadcast"]');
    if (lt) lt.classList.toggle('onair', isLive);
  }
  const badge = (isLive ? 'L' : '') + (agentOn() ? 'A' : '') + (safety.black ? 'B' : '');
  if (badge !== M.badge) {
    M.badge = badge;
    const b = $('badge');
    b.textContent = '';
    if (isLive) b.append(el('span', { className: 'live', textContent: 'LIVE' }));
    if (agentOn()) b.append(el('span', { className: 'auto', textContent: 'AUTO' }));
    if (safety.black) b.append(el('span', { className: 'black', textContent: 'BLACKOUT' }));
  }
  // status messages as a toast
  if (ui.status && ui.status !== M.statusShown) { M.statusShown = ui.status; M.statusAt = performance.now(); $('status').textContent = ui.status; $('status').classList.add('show'); }
  if (M.statusAt && performance.now() - M.statusAt > 3800) { M.statusAt = 0; $('status').classList.remove('show'); }
}
// setStatus (engine.js) writes #status; a repeated message shows again
const _setStatus = setStatus;
setStatus = function (s) { _setStatus(s); M.statusShown = ''; };   // eslint-disable-line no-global-assign

// ---------- header ----------
function setMonSmall(on) { M.prefs.monSmall = !!on; savePrefs(); $('stage').classList.toggle('small', !!on); }
(function initHeader() {
  const taps = [];
  $('bpmBtn').addEventListener('click', () => {
    const now = performance.now() / 1000;
    if (taps.length && now - taps[taps.length - 1] > 2) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) { const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); if (avg > 0.15) comp.bpm = Math.min(300, Math.max(20, 60 / avg)); }
    comp.beats = Math.round(comp.beats);
    buzz(5);
  });
  $('livePill').addEventListener('click', () => { if (M.tab !== 'broadcast') { M.tab = 'broadcast'; M.dirty = true; $('view').scrollTop = 0; renderTabs(); } });
  $('blackBtn').addEventListener('click', () => { setBlackout(); buzz(20); });
  $('setBtn').innerHTML = I.sliders; $('setBtn').addEventListener('click', settingsSheet);
  $('monBtn').innerHTML = I.chevUp; $('monBtn').addEventListener('click', () => setMonSmall(!M.prefs.monSmall));
  setMonSmall(M.prefs.monSmall);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); M.install = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => { const e = M.install; if (!e) return; M.install = null; $('installBtn').hidden = true; e.prompt(); try { await e.userChoice; } catch (err) {} });
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; setStatus('Installed: open Strodano VJ from your home screen'); });
  $('compInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { setStatus(loadComp(JSON.parse(await f.text())) ? 'Opened ' + f.name : 'That file is not a Strodano VJ project'); } catch (err) { setStatus('Could not read that file'); }
    vdoScreen(); M.dirty = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { M.dirty = true; if (vdoLive().length && M.wasHiddenLive) setStatus('Back: the broadcast picks up again'); }
    M.wasHiddenLive = document.hidden && vdoLive().length > 0;
  });
})();

// ---------- main loop ----------
// Capped at 60 fps (90 / 120 Hz phones would otherwise render twice as often for nothing), or 30 to save battery.
// A frame is skipped only when it comes more than ~1/3 frame early, so a 60 Hz screen still runs every frame.
let lastT = performance.now(), fpsN = 0, fpsT = lastT, costSum = 0, lastFrameAt = 0, rafId = 0, slowSecs = 0;
function frame() {
  const now = performance.now(), cap = 1000 / (M.prefs.fpsCap || 60);
  if (now - lastFrameAt < cap * 0.75) { loop(); return; }
  const t0 = now, realDt = Math.max(0, (t0 - lastT) / 1000), dt = Math.min(realDt, 0.1);
  lastT = t0; lastFrameAt = t0;
  try {
    coreTick(t0, dt, realDt);
    if (!document.hidden) {
      const cv = M.mon.canvas, mw = 640, mh = Math.round(640 * comp.h / comp.w);
      if (cv.height !== mh) cv.height = mh;
      present(comp.outTex, mw, mh); grab(M.mon, mw, mh);
      tickUI();
    }
  } catch (e) { console.error(e); setStatus('Error: ' + (e.message || e)); }
  fpsN++; costSum += performance.now() - t0;
  if (t0 - fpsT >= 1000) {
    const fps = fpsN * 1000 / (t0 - fpsT), f = $('fps'), want = Math.min(M.prefs.fpsCap || 60, 60);
    f.textContent = `${fps.toFixed(0)} fps`; f.className = fps < want * 0.8 ? 'bad' : '';
    // slow-phone advisor: 6 s in a row well under 25 fps (while visible) offers a smaller picture on Perform
    slowSecs = !document.hidden && fps < 22 ? slowSecs + 1 : 0;
    if (slowSecs >= 6 && !M.slow && !M.prefs.slowDismissed) { M.slow = 1; M.slowFps = Math.round(fps); M.dirty = true; }
    window.__fps = fps; window.__frameMs = costSum / fpsN; fpsN = 0; costSum = 0; fpsT = t0;
  }
  loop();
}
// Exactly one frame request is ever outstanding (as in ui.js): the watchdog only re-requests when none is.
function loop() { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; frame(); }); }
setInterval(() => { if (performance.now() - lastFrameAt > 600) loop(); }, 300);

// A new phone project: the STRODANO starter pack (starter.js: STRODANO footage, photos and logos over Smart 3D, 720p,
// 6 scenes tagged for the Agent). Without starter.js: the generic demo, lighter than the desktop's.
function mobileDemo() {
  if (comp.w !== 1280 || comp.h !== 720) resizeComp(1280, 720);
  if (typeof loadStarter === 'function' && loadStarter()) { if (mlib.ready) starterFetch(); return; }
  demoComp();
  setColumns(Math.max(6, comp.layers.reduce((n, L) => Math.max(n, L.clips.reduce((m, c, i) => (c ? i + 1 : m), 0)), 0)));
}

// Opening the app again picks up where it was: the clips that were playing start again (not saved in the project file)
const PLAYING_KEY = 'strodano-vj-mobile-playing';
function savePlaying() { try { localStorage.setItem(PLAYING_KEY, JSON.stringify(comp.layers.map(L => (L.pendingCol >= 0 ? L.pendingCol : L.active)))); } catch (e) {} }
function resumePlaying() {
  let a = null;
  try { a = JSON.parse(localStorage.getItem(PLAYING_KEY) || 'null'); } catch (e) {}
  if (!Array.isArray(a)) return;
  a.forEach((ci, li) => { const L = comp.layers[li], c = L && L.clips[ci]; if (c && !c.missing && L.active !== ci && L.pendingCol !== ci) trigger(li, ci); });
}

// ---------- start ----------
(function start() {
  if (!gl) { document.body.innerHTML = '<p id="nogl">This browser does not support WebGL 2. Update the phone\'s browser (Safari 15+ or Chrome).</p>'; return; }
  initMidi();
  let restored = false;
  try { const s = localStorage.getItem(AUTOSAVE); if (s) restored = loadComp(JSON.parse(s)); } catch (e) {}
  if (!restored) mobileDemo();
  vdoScreen();
  renderTabs();
  mlibInit().then(() => { resumePlaying(); if (typeof starterFetch === 'function') starterFetch(); });   // after the library: clips are relinked by then; missing starter-pack files are downloaded once
  resumePlaying();
  setInterval(() => { autosave(); savePlaying(); }, 2000);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  loop();
})();
window.strodano = { comp, screens, DEFS, mlib, agent: typeof setAgent === 'function' ? agent : null, live, checkShaders: () => { const bad = []; for (const k of ['fx', 'gen']) for (const d of DEFS[k].values()) { d.tried = false; if (!defProg(d)) bad.push(d.name + ': ' + d.err); } return bad; } };
