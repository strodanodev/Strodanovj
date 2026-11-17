// Strodano VJ (web) - Agent playlist: the songs in play order, each with its waveform, its transition points and the
// scenes the Agent has planned for each part of it, made from YOUR layers and clips. GPL-3.0.
// The playlist IS the DJ track list (crate.tracks) in order: dragging a song reorders the list, and the Agent's Start
// plays it in that order (mixer.order, mix.js). Per song: t.inAt / t.outAt move where it is mixed in and where the mix
// to the next song begins (seconds, snapped to bars; crate.js inPoint / outPoint), t.jStyle / t.jVis are the audio and
// visual transition into the next song, and t.plan holds one Agent scene per analysed section (agent.js makeScene; the
// Agent plays it through plannedScene). Plans are made again when your grid changes (compSig), and the shaders of the
// clips they use are compiled ahead of time (warmScene), so the first frame of a scene never waits for one.
// Shown in place of the clip grid while the Agent panel is open; a Layers tab brings the grid back.
'use strict';
const PL_KEY = 'strodano-vj-playlist';
const PL_STYLES = [['auto', 'Mix: auto'], ['blend', 'Smooth blend'], ['bass', 'Bass swap'], ['echo', 'Echo out'], ['cut', 'Cut']];
const PL_VIS = [['mix', 'Visuals: with the mix'], ['quick', 'Visuals: quick fade'], ['cut', 'Visuals: cut + flash']];
const SECTION_BAND = { intro: 'calm', outro: 'calm', breakdown: 'calm', build: 'groove', drop: 'peak' };
const pl = { view: 'playlist', order: [], saved: {}, root: null, list: null, rows: [], dirty: true, held: false, warmQ: [], lockKey: '', sig: '' };
try {
  const s = JSON.parse(localStorage.getItem(PL_KEY) || '{}');
  if (Array.isArray(s.order)) pl.order = s.order.filter(k => typeof k === 'string').slice(0, 5000);
  if (s.t && typeof s.t === 'object') pl.saved = s.t;
  if (s.view === 'layers') pl.view = 'layers';
} catch (e) {}

// ---------- remembering order and transition points ----------
function plSave() {
  const keys = crate.tracks.map(t => t.key);
  pl.order = keys.concat(pl.order.filter(k => !keys.includes(k)));   // songs not loaded this session keep their place after these
  for (const t of crate.tracks) {
    const o = {};
    if (typeof t.inAt === 'number') o.i = +t.inAt.toFixed(3);
    if (typeof t.outAt === 'number') o.o = +t.outAt.toFixed(3);
    if (t.jStyle && t.jStyle !== 'auto') o.s = t.jStyle;
    if (t.jVis && t.jVis !== 'mix') o.v = t.jVis;
    if (Object.keys(o).length) pl.saved[t.key] = o; else delete pl.saved[t.key];
  }
  try { localStorage.setItem(PL_KEY, JSON.stringify({ order: pl.order, t: pl.saved, view: pl.view })); } catch (e) {}
}
// Called for each new list entry (crate.js newTrack).
function plRestore(t) {
  const o = pl.saved[t.key];
  if (!o) return;
  if (typeof o.i === 'number') t.inAt = o.i;
  if (typeof o.o === 'number') t.outAt = o.o;
  if (PL_STYLES.some(([v]) => v === o.s)) t.jStyle = o.s;
  if (PL_VIS.some(([v]) => v === o.v)) t.jVis = o.v;
}
// Songs added again (media folder at start-up, a second drop) go back to their saved place; new ones go to the end.
function plSortSaved() {
  const at = new Map(pl.order.map((k, i) => [k, i])), was = new Map(crate.tracks.map((t, i) => [t, i]));
  crate.tracks.sort((a, b) => (at.has(a.key) ? at.get(a.key) : 1e9 + was.get(a)) - (at.has(b.key) ? at.get(b.key) : 1e9 + was.get(b)));
}
function plDirty() { pl.dirty = true; }
// The transition after the song on deck d (mix.js tickAuto, agent.js agentMixStart).
function plJunction(d) { const t = trackOf(d); return { style: (t && t.jStyle) || 'auto', vis: (t && t.jVis) || 'mix' }; }

// ---------- planned scenes ----------
// A song's sections as the artist has them: edited in the segment editor (segments.js sectionsFor), else analysed.
const partsOf = t => (typeof sectionsFor === 'function' ? sectionsFor(t.info, t.file) : t.info.sections);
// Changes when the sections are moved, resized, split, merged or re-labelled, so plans and waveforms follow the edit.
const secSig = t => (partsOf(t) || []).map(s => s.type + s.bar + ':' + s.bars).join(',');
// The parts of a song the plan follows: its sections, or the whole song as one part.
const planParts = t => { const s = partsOf(t); return t.info.ok && s && s.length ? s : [{ type: 'whole', t: 0, end: t.info.duration, bar: 0, bars: 1e9 }]; };
// Energy band for a part: from the section type, nudged by the song's energy in the list and by the vibe.
function partBand(t, type) {
  let b = SECTION_BAND[type] || (t.energy >= 7 ? 'peak' : t.energy <= 3 ? 'calm' : 'groove');
  if (type !== 'drop' && b !== 'calm' && t.energy >= 8) b = 'peak';
  if (type === 'drop' && t.energy <= 2) b = 'groove';
  return vibeBand(b);
}
// What the plans are made from: your layers, their clips, locks and bypass, and the column tags.
const compSig = () => comp.layers.map(L => (L.locked ? 'L' : '') + (L.bypass ? 'B' : '') + L.clips.map(c => (c ? c.name + (c.missing || c.error ? '!' : '') : '')).join(',')).join('|') + JSON.stringify(comp.agentTags || {});
// One scene per part. A part type that comes back (a second drop) gets a variation of the first one, so a song keeps a
// visual identity, and each scene is made to differ from the one before it.
function planTrack(t) {
  if (!t.info || typeof makeScene !== 'function') return;
  const byType = {};
  let prev = null;
  t.plan = planParts(t).map(s => {
    const band = partBand(t, s.type), drop = s.type === 'drop';
    let sc = byType[s.type] && byType[s.type].band === band ? varyScene(byType[s.type]) : makeScene(band, drop, prev);
    if (sc) { byType[s.type] = sc; prev = sc; if (typeof remember === 'function') remember(sc); }   // agent.js: later parts and songs use other clips
    return { s, sc };
  });
  t.planFor = t.info; t.planSig = pl.sig; t.planSecs = secSig(t);
  pl.warmQ.push(...t.plan.map(p => p.sc));
  pl.dirty = true;
}
function plReplanAll() { pl.sig = compSig(); for (const t of crate.tracks) if (t.info) planTrack(t); }
const ensurePlan = t => { if (t && t.info && (t.planFor !== t.info || t.planSig !== pl.sig || t.planSecs !== secSig(t))) planTrack(t); return t && t.plan; };
// The part of song t at position pos (seconds).
function partAt(t, pos) {
  const parts = ensurePlan(t);
  if (!parts) return -1;
  for (let k = parts.length - 1; k >= 0; k--) if (pos >= parts[k].s.t - 0.05) return k;
  return 0;
}
// The scene planned for the part of the playlist song playing now (null when no planned song is playing).
function plannedScene() {
  if (live.src !== 'dj') return null;
  const d = audio.clockDeck, t = trackOf(d);
  if (!t || !ensurePlan(t)) return null;
  return t.plan[Math.max(0, partAt(t, deckHeard(d)))].sc;
}
function plannedSceneAt(d, pos) {
  if (live.src !== 'dj') return null;
  const t = trackOf(d);
  if (!t || !ensurePlan(t)) return null;
  return t.plan[Math.max(0, partAt(t, pos))].sc;
}
function rerollPart(t, k) {
  const p = t.plan && t.plan[k];
  if (!p || !p.sc) return;
  p.sc = makeScene(p.sc.band, p.s.type === 'drop', p.sc) || p.sc;
  pl.warmQ.push(p.sc);
  // the Agent is showing the old one right now: swap it in on the next bar
  const d = audio.clockDeck;
  if (agent.on && trackOf(d) === t && partAt(t, deckHeard(d)) === k) agentSchedule('section');
  pl.dirty = true;
}
// Compile the shaders a scene's clips and layers use now, so showing it later does not stall a frame.
function warmScene(sc) {
  if (!sc || sc.warm) return;
  sc.warm = true;
  for (const li in sc.show) {
    const L = comp.layers[+li], c = L && L.clips[sc.show[li]];
    if (!L) continue;
    if (c && c.type === 'gen') { const g = DEFS.gen.get(c.gen); if (g) defProg(g); }
    for (const e of [...L.fx, ...((c && c.fx) || [])]) { const d = DEFS.fx.get(e.def); if (d) defProg(d); }
  }
}
// Short label for a planned scene: the clips that are up, bottom layer first.
const sceneShort = sc => (sc ? (sc.col >= 0 ? 'Col ' + (sc.col + 1) + ': ' : '') + Object.keys(sc.show).map(Number).sort((a, b) => a - b).map(li => clipName(li, sc.show[li])).join(' + ') : 'nothing to play');

// ---------- view ----------
const plShowing = () => agUI.open && pl.view === 'playlist';
function plSetView(v) { pl.view = v; plSave(); plApplyView(); }
// In Layers view the header (with the Playlist / Layers tabs and the layer locks) stays above the grid, so the way back
// to the playlist is always on screen; only the song list is hidden.
function plApplyView() {
  const on = plShowing();
  if (pl.root) {
    pl.root.hidden = !agUI.open;
    pl.list.hidden = !on;
    pl.root.classList.toggle('collapsed', agUI.open && !on);
    renderPlHead();   // tabs show the current view
  }
  const g = $('grid');
  if (g) g.style.display = on ? 'none' : '';
  if (on) pl.dirty = true;
  if (!on) ui.gridDirty = true;
}
function initPlaylist() {
  const root = pl.root = el('div', { id: 'playlist', hidden: true });
  pl.head = el('div', { className: 'plh' });
  pl.list = el('div', { className: 'pll' });
  root.append(pl.head, pl.list);
  $('grid').before(root);
  // songs dropped from Explorer join the playlist where they land; a dragged row moves there
  const over = e => {
    const files = hasFiles(e);
    if (!files && !pl.dragT) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = files ? 'copy' : 'move';
    plMarkDrop(plDropIndex(e.clientY));
  };
  root.addEventListener('dragover', over);
  root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) plMarkDrop(-1); });
  root.addEventListener('drop', e => {
    const idx = plDropIndex(e.clientY);
    plMarkDrop(-1);
    if (hasFiles(e)) {
      e.preventDefault(); e.stopPropagation(); rememberDropped(e.dataTransfer);
      const files = [...e.dataTransfer.files], audioF = files.filter(isAudioFile);
      if (!audioF.length) { setStatus('Drop songs here (MP3, WAV, FLAC, M4A...). Videos go to Files.'); return; }
      const before = new Set(crate.tracks);
      const n = crateAdd(audioF);
      const added = crate.tracks.filter(t => !before.has(t));
      plMove(added, idx);
      setStatus(n ? n + ' song(s) added to the playlist: the Agent is listening to them now' : 'Those songs are already in the playlist');
    } else if (pl.dragT) { e.preventDefault(); e.stopPropagation(); plMove([pl.dragT], idx); pl.dragT = null; }
  });
  plApplyView();
}
// Where in the list a drop at clientY lands (index of the song it goes before).
function plDropIndex(y) {
  const rows = pl.rows.filter(r => r.root.isConnected);
  for (let i = 0; i < rows.length; i++) { const r = rows[i].root.getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
  return rows.length;
}
function plMarkDrop(i) { pl.rows.forEach((r, k) => { r.root.classList.toggle('dropb', k === i); r.root.classList.toggle('dropa', i === pl.rows.length && k === pl.rows.length - 1); }); }
function plMove(ts, idx) {
  const anchor = crate.tracks[idx];
  const rest = crate.tracks.filter(t => !ts.includes(t));
  let at = anchor && !ts.includes(anchor) ? rest.indexOf(anchor) : rest.length;
  if (at < 0) at = rest.length;
  crate.tracks.length = 0;
  crate.tracks.push(...rest.slice(0, at), ...ts, ...rest.slice(at));
  plSave(); crateDirty(); pl.dirty = true;
}
function plRemove(t) {
  if (audio.decks.some(d => d.playing && trackOf(d) === t)) { setStatus('That song is playing: wait for the next one, then remove it'); return; }
  crate.tracks.splice(crate.tracks.indexOf(t), 1);
  delete pl.saved[t.key];
  plSave(); crateDirty(); pl.dirty = true;
}

// header: title, add, legend, layer locks, Playlist / Layers
function renderPlHead() {
  const h = pl.head;
  h.textContent = '';
  const tab = (v, label, title) => el('button', { textContent: label, title, className: pl.view === v ? 'on' : '', onclick: () => plSetView(v) });
  pl.locks = el('span', { className: 'pllocks' });
  // minimise (panels.js): only while the song list shows; the header keeps the tabs and locks on screen
  const mini = typeof setPanelMin === 'function' && pl.view === 'playlist'
    ? el('button', { id: 'plMinBtn', className: 'pchev' + (pnl.min.playlist ? ' on' : ''), innerHTML: CHEV, ariaLabel: 'Minimise the song list', title: pnl.min.playlist ? 'Show the song list' : 'Minimise the song list', onclick: () => setPanelMin('playlist', !pnl.min.playlist) })
    : null;
  if (mini) h.append(mini);
  h.append(el('b', { textContent: 'Playlist' }),
    el('button', { textContent: 'Add songs...', title: 'Add songs to the end of the playlist (or drop them anywhere on it)', onclick: addTracksPicker }),
    audiusMenu(),
    el('button', { textContent: 'STRODANO show', title: 'Replace the layers with the STRODANO stock show (videos, 3D, strobe, locked logo)', onclick: e => armThen(e.currentTarget, 'replace your layers with the STRODANO stock show', () => { stockComp(); setStatus('STRODANO stock show loaded: the logo layer is locked (unlock it to change it)'); }) }),
    el('span', { className: 'plleg' }, ...['intro', 'build', 'drop', 'breakdown'].map(s => el('i', { className: 'sec-' + s, textContent: SECTION_NAMES[s] }))),
    pl.locks,
    el('span', { className: 'seg' }, tab('playlist', 'Playlist', 'Songs in play order, with transitions and planned visuals'), tab('layers', 'Layers', 'The clip grid')));
  pl.lockKey = '';
}
// Lock chips: a locked layer is left alone by the Agent, section looks and track scores.
function renderLocks() {
  const key = comp.layers.map(L => L.name + (L.locked ? '1' : '0')).join('|');
  if (key === pl.lockKey || !pl.locks) return;
  pl.lockKey = key;
  pl.locks.textContent = '';
  pl.locks.append(el('span', { className: 'hint', textContent: 'Lock:' }));
  comp.layers.forEach((L, li) => {
    pl.locks.append(el('button', { className: 'lockchip' + (L.locked ? ' on' : ''), title: L.locked ? L.name + ' is locked: the Agent and auto-score leave it alone. Click to unlock.' : 'Lock ' + L.name + ' so the Agent and auto-score leave it alone',
      textContent: (L.locked ? '\u{1F512} ' : '') + L.name, onclick: () => toggleLayerLock(li) }));
  });
}
function toggleLayerLock(li) {
  const L = comp.layers[li];
  if (!L) return;
  L.locked = !L.locked;
  if (L.locked && typeof agentRelease === 'function') agentRelease(L);   // a layer locked mid-fade gets your level back
  if (L.locked && typeof quantQ !== 'undefined') quantQ.delete(li);
  setStatus(L.name + (L.locked ? ' locked: the Agent and auto-score will not touch it' : ' unlocked'));
  ui.gridDirty = true; pl.lockKey = '';
  if (typeof agentUIDirty === 'function') agentUIDirty();
  agent.snap = typeof userSnap === 'function' ? userSnap() : agent.snap;   // locking is not "you playing"
}

// one row per song, and a transition strip between rows
function renderPlaylist() {
  pl.dirty = false;
  if (!pl.head.childNodes.length) renderPlHead();
  pl.rows = [];
  const list = pl.list;
  list.textContent = '';
  if (live.src !== 'dj') {
    list.append(el('div', { className: 'plnote' }, 'The Agent is listening to ' + (live.src === 'mic' ? 'the microphone' : 'a music file') + ', so the playlist waits. ',
      el('button', { textContent: 'Play the playlist instead', onclick: () => { useDecks(); agentUIDirty(); pl.dirty = true; } })));
  }
  if (!crate.tracks.length) {
    list.append(el('div', { className: 'plempty' },
      el('b', { textContent: 'Drop songs here' }),
      el('span', { textContent: 'MP3, WAV, FLAC, M4A... The Agent finds the tempo, key, build-ups and drops of each song, plans visuals for every part, and mixes them in this order when you press Start.' }),
      el('button', { textContent: 'Add songs...', onclick: addTracksPicker })));
    return;
  }
  crate.tracks.forEach((t, i) => {
    const r = plRow(t, i);
    pl.rows.push(r);
    list.append(r.root);
    if (i < crate.tracks.length - 1) list.append(plJunctionRow(t));
  });
}
function plRow(t, i) {
  const r = { t, root: el('div', { className: 'plr' }) };
  const grip = el('span', { className: 'plgrip', textContent: '⠇', title: 'Drag to move this song', draggable: true });
  grip.addEventListener('dragstart', e => { pl.dragT = t; drag = null; e.dataTransfer.setData('text/plain', 'strodano-playlist'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setDragImage(r.root, 20, 20); } catch (err) {} });
  grip.addEventListener('dragend', () => { pl.dragT = null; plMarkDrop(-1); });
  const inf = t.info;
  r.num = el('span', { className: 'pln', textContent: String(i + 1) });
  r.state = el('span', { className: 'plst' });
  const meta = inf ? [inf.ok ? inf.bpm.toFixed(0) + ' BPM' : 'no beat', inf.camelot || '', 'E' + t.energy, mmss(inf.duration)].filter(Boolean).join(' · ') : t.state === 'error' ? 'cannot read this file' : 'listening...';
  const info = el('div', { className: 'pli' }, el('b', { textContent: t.name, title: t.file.name }), el('span', { className: 'dt', textContent: meta }), r.state);
  // waveform with transition markers, playhead and the planned scenes underneath
  r.cv = el('canvas');
  r.done = el('div', { className: 'pldone' });
  r.head = el('div', { className: 'plhead' });
  const wave = el('div', { className: 'plwave' }, r.cv, r.done, r.head);
  r.chips = el('div', { className: 'plchips' });
  const wv = el('div', { className: 'plw' }, wave, r.chips);
  if (inf && inf.ok) {
    r.mIn = plMarker(t, 'in', wave); r.mOut = plMarker(t, 'out', wave);
    wave.append(r.mIn, r.mOut);
    wave.addEventListener('pointerdown', e => {   // click the playing song's waveform to jump there
      if (e.target !== r.cv && e.target !== r.done) return;
      const d = audio.decks.find(x => trackOf(x) === t && x.buffer);
      if (!d) return;
      const b = wave.getBoundingClientRect();
      deckSeek(d, (e.clientX - b.left) / b.width * d.buffer.duration);
    });
  }
  if (inf && ensurePlan(t)) {
    t.plan.forEach((p, k) => {
      const a = p.s.t / inf.duration, w = (Math.min(inf.duration, p.s.end) - p.s.t) / inf.duration;
      const c = el('button', { className: 'plchip band-' + (p.sc ? p.sc.band : 'calm') + ' sec-' + p.s.type, style: { left: (a * 100).toFixed(3) + '%', width: 'calc(' + (w * 100).toFixed(3) + '% - 2px)' },
        textContent: sceneShort(p.sc), title: (SECTION_NAMES[p.s.type] || 'Whole song') + ': ' + (p.sc ? sceneLabel(p.sc) : 'no layer can play: add clips or unlock a layer') + '\nClick for a different combination of your clips', onclick: () => rerollPart(t, k) });
      c.sc = p.sc;
      r.chips.append(c);
    });
  }
  r.root.append(grip, r.num, info, wv, el('button', { className: 'del', title: 'Remove from the playlist', innerHTML: TRASH_SVG, onclick: () => plRemove(t) }));
  r.root.classList.toggle('err', t.state === 'error');
  return r;
}
// A transition marker: drag to move it (it snaps to bars), double-click to put it back where the analysis had it.
function plMarker(t, which, wave) {
  const m = el('div', { className: 'plm ' + which, title: which === 'in' ? 'MIX IN: where this song starts when it is mixed in. Drag to move, double-click to reset.' : 'MIX OUT: where the mix into the next song begins. Drag to move, double-click to reset.' },
    el('span', { textContent: which === 'in' ? 'IN' : 'OUT' }));
  const i = t.info, bar = i.barLen;
  const snap = s => i.grid0 + Math.round((s - i.grid0) / bar) * bar;
  m.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    m.setPointerCapture(e.pointerId); pl.held = true;
    const move = ev => {
      const b = wave.getBoundingClientRect(), s = snap(Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)) * i.duration);
      const tin = typeof t.inAt === 'number' ? t.inAt : i.mixIn, tout = typeof t.outAt === 'number' ? t.outAt : i.mixOut;
      if (which === 'in') t.inAt = Math.max(Math.max(0, i.grid0), Math.min(s, tout - 8 * bar));
      else t.outAt = Math.min(i.beatEnd - 2 * bar, Math.max(s, tin + 8 * bar));
      setStatus((which === 'in' ? 'Mix in at ' : 'Mix out from ') + mmss(which === 'in' ? t.inAt : t.outAt));
    };
    const up = () => { m.removeEventListener('pointermove', move); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', up); pl.held = false; plSave(); };
    m.addEventListener('pointermove', move); m.addEventListener('pointerup', up); m.addEventListener('pointercancel', up);
  });
  m.addEventListener('dblclick', () => { if (which === 'in') delete t.inAt; else delete t.outAt; plSave(); setStatus('Transition point back to the analysed one'); });
  return m;
}
function plJunctionRow(t) {
  const sel = (opts, get, set) => el('select', { onchange: e => { set(e.target.value); plSave(); } }, ...opts.map(([v, n]) => el('option', { value: v, textContent: n, selected: get() === v })));
  return el('div', { className: 'plj' }, el('span', { className: 'plarrow', textContent: '↓' }),
    sel(PL_STYLES, () => t.jStyle || 'auto', v => { t.jStyle = v; }),
    sel(PL_VIS, () => t.jVis || 'mix', v => { t.jVis = v; }),
    el('span', { className: 'hint', textContent: 'starts at the OUT marker' }));
}
// Whole-song waveform (bass in the theme colour), with the sections as a band along the bottom. Drawn once per width.
function drawPlWave(r) {
  const t = r.t, i = t.info, cv = r.cv, dpr = window.devicePixelRatio || 1;
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  const ss = i ? secSig(t) : '';
  if (!W || !H || (r.drawn === W && r.drawnFor === i && r.drawnSec === ss)) return;
  cv.width = W; cv.height = H; r.drawn = W; r.drawnFor = i; r.drawnSec = ss;
  const x = cv.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  if (!i) {
    x.fillStyle = '#777'; x.font = 11 * dpr + 'px Inter, system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText(t.state === 'error' ? 'Could not read this file' : t.state === 'analysing' ? 'Listening to the song...' : 'Waiting to be analysed', W / 2, H / 2 + 4 * dpr);
    r.drawn = 0;   // try again once it is analysed
    return;
  }
  const per = i.peaks.length / W, sh = Math.round(4 * dpr), wh = H - sh - dpr, mid = wh / 2;
  for (let px = 0; px < W; px++) {
    let pk = 0, lo = 0, n = 0;
    for (let k = Math.floor(px * per), e = Math.max(k + 1, Math.floor((px + 1) * per)); k < e && k < i.peaks.length; k++) { if (i.peaks[k] > pk) pk = i.peaks[k]; lo += i.lows[k]; n++; }
    const h = Math.max(1, pk * wh * 0.95);
    x.fillStyle = waveCol(n ? lo / n : 0);
    x.fillRect(px, mid - h / 2, 1, h);
  }
  for (const s of partsOf(t) || []) { x.fillStyle = sectionCol(s.type); x.fillRect(s.t / i.duration * W, H - sh, Math.max(1, s.bars * i.barLen / i.duration * W - dpr), sh); }
}

// ---------- per frame ----------
function tickPlaylist() {
  if (typeof tickAudius === 'function') tickAudius();
  // warm one planned scene per frame (playing and next songs first, then the rest)
  if (pl.warmQ.length) warmScene(pl.warmQ.shift());
  // you changed the grid (clips, locks, tags): plan the songs again from what is there now
  const sig = compSig();
  if (sig !== pl.sig) { pl.sig = sig; for (const t of crate.tracks) if (t.info) planTrack(t); }
  if (!agUI.open) return;
  renderLocks();   // the header shows in both views
  if (!plShowing()) return;
  if (pl.dirty && !pl.held && !pl.dragT) renderPlaylist();
  const clock = audio.clockDeck, next = clock ? crateNextTrack(clock) : mixer.order || agent.on ? crateNextTrack(null) : null;
  for (const r of pl.rows) {
    const t = r.t, i = t.info;
    drawPlWave(r);
    const d = audio.decks.find(x => trackOf(x) === t && x.buffer);
    const playing = !!(d && d.playing);
    const st = t.state === 'error' ? 'error' : !i ? 'listening...' : playing ? (d === clock ? 'NOW PLAYING' : 'mixing in') : t === next ? 'up next' : t.played ? 'played' : '';
    setText(r.state, st);
    r.root.classList.toggle('now', playing && d === clock);
    r.root.classList.toggle('next', !playing && t === next);
    r.root.classList.toggle('played', !playing && t.played);
    if (!i) continue;
    if (t.plan && t.planSecs !== secSig(t)) planTrack(t);   // sections edited in the segment editor: plan the new parts
    const pos = d ? deckHeard(d) : 0, f = d ? Math.min(1, Math.max(0, pos / i.duration)) : 0;
    r.head.hidden = !d; r.done.hidden = !d;
    if (d) { r.head.style.left = (f * 100).toFixed(2) + '%'; r.done.style.width = (f * 100).toFixed(2) + '%'; }
    if (r.mIn) {
      r.mIn.style.left = (100 * (typeof t.inAt === 'number' ? t.inAt : i.mixIn) / i.duration).toFixed(3) + '%';
      r.mOut.style.left = (100 * (typeof t.outAt === 'number' ? t.outAt : i.mixOut) / i.duration).toFixed(3) + '%';
      r.mIn.classList.toggle('moved', typeof t.inAt === 'number'); r.mOut.classList.toggle('moved', typeof t.outAt === 'number');
    }
    for (const c of r.chips.children) c.classList.toggle('on', agent.on && !!agent.scene && !!c.sc && (agent.scene === c.sc || agent.scene.src === c.sc));
    // the playing and next songs' scenes are compiled first
    if ((playing || t === next) && t.plan && t.warmed !== t.plan) { t.warmed = t.plan; pl.warmQ.unshift(...t.plan.map(p => p.sc)); }
  }
}
