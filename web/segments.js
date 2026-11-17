// Strodano VJ (web) - segment editor: fix a track's sections by hand and give each one its own visuals. GPL-3.0.
// The analysis (analysis.js) splits each track into intro / build / drop / breakdown / outro. Here the artist can move
// the boundaries, change a segment's length, split, merge or re-label segments, and choose per segment which look comes
// in when the music reaches it. Edits belong to the track (file name + length, like track scores in cues.js) and are
// saved with the composition. Everything that follows sections reads them through sectionsFor() / segmentsOf().
'use strict';
const seg = { edits: {}, ver: 0, ui: null, deck: null, sel: 0, drag: null };   // edits[key] = [{ type, bar, bars, lookMode, look }]
// lookMode: 'type' (default: the section look of its type), a section-look slot name (intro, build, drop, breakdown,
// outro, mix), 'own' (a look captured for this segment alone, in .look), or 'keep' (leave the visuals alone).
const segKey = (file, info) => (file && info ? file.name + '|' + Math.round(info.duration) : null);
const totalBars = i => Math.floor((i.duration - i.grid0) / i.barLen);

// The sections to follow for a track: the artist's edit if there is one, otherwise the analysis. t / end are worked out
// from the track's current grid each time, so they stay right after "Bar 1" moves the grid.
function sectionsFor(info, file) {
  if (!info || !info.sections) return info ? info.sections : null;
  const k = segKey(file, info), e = k && seg.edits[k], list = e || info.sections;
  if (e) for (const s of list) { s.t = info.grid0 + s.bar * info.barLen; s.end = s.t + s.bars * info.barLen; }
  return list;
}
const segmentsOf = d => (d && d.info ? sectionsFor(d.info, d.file) : null);
const isEdited = d => !!(d && d.info && seg.edits[segKey(d.file, d.info)]);
// Which look a segment brings (score.js asks this at each section change): null leaves the visuals alone.
function lookForSegment(s) {
  if (!s) return null;
  const m = s.lookMode || 'type';
  if (m === 'keep') return null;
  if (m === 'own') return s.look || null;
  return score.looks[m === 'type' ? s.type : m] || null;
}

// ---------- editing (on the deck's track) ----------
// The first change copies the analysed sections, so the analysis itself is never touched.
function editable(d) {
  const k = segKey(d.file, d.info);
  if (!seg.edits[k]) seg.edits[k] = d.info.sections.map(s => ({ type: s.type, bar: s.bar, bars: s.bars, lookMode: 'type' }));
  return seg.edits[k];
}
// Redraw the waveforms. A split, merge or a boundary crossing the playhead changes the segment index, and score.js then
// brings in that segment's look by itself; a new look or type for the segment playing now is applied with relook.
function changed() { seg.ver++; }
function relook() { changed(); score.idx = -1; }
// Move the boundary in front of segment k to bar b (whole bars; both neighbours keep at least one bar).
function moveBoundary(d, k, b) {
  const L = editable(d), a = L[k - 1], s = L[k];
  if (!a || !s) return;
  const end = s.bar + s.bars;
  b = Math.max(a.bar + 1, Math.min(end - 1, Math.round(b)));
  if (b === s.bar) return;
  a.bars = b - a.bar; s.bar = b; s.bars = end - b;
  changed();
}
// Make segment k n bars long by moving its end; the next segment gives or takes the bars. The last segment can only
// shrink back towards its start, or grow into the end of the track.
function setLength(d, k, n) {
  const L = editable(d), s = L[k], nx = L[k + 1];
  n = Math.max(1, Math.round(n));
  if (nx) moveBoundary(d, k + 1, s.bar + Math.min(n, s.bars + nx.bars - 1));
  else { s.bars = Math.min(n, totalBars(d.info) - s.bar); changed(); }
}
function splitAt(d, k, b) {
  const L = editable(d), s = L[k];
  b = Math.round(b);
  if (!s || b <= s.bar || b >= s.bar + s.bars) { setStatus('Pick a point inside the segment to split it (at least one bar from each end)'); return; }
  L.splice(k + 1, 0, { type: s.type, bar: b, bars: s.bar + s.bars - b, lookMode: 'type' });
  s.bars = b - s.bar;
  changed();
}
function mergeNext(d, k) {
  const L = editable(d), s = L[k], nx = L[k + 1];
  if (!nx) return;
  s.bars += nx.bars; L.splice(k + 1, 1);
  changed();
}
function setSegType(d, k, t) { editable(d)[k].type = t; relook(); }
function setSegLook(d, k, mode) { const s = editable(d)[k]; s.lookMode = mode; if (mode !== 'own') delete s.look; relook(); }
function captureSegLook(d, k) { const s = editable(d)[k]; s.lookMode = 'own'; s.look = captureLook(); changed(); }   // the visuals already show it
function resetSegments(d) { delete seg.edits[segKey(d.file, d.info)]; seg.sel = 0; changed(); }

// ---------- saved with the composition (inside the score block, score.js) ----------
function segmentsToJSON() { return seg.edits; }
function segmentsFromJSON(j) {
  seg.edits = {};
  if (!j || typeof j !== 'object') { changed(); return; }
  const num = (v, dflt) => (typeof v === 'number' && isFinite(v) ? v : dflt);
  for (const k in j) {
    if (!Array.isArray(j[k])) continue;
    const L = j[k].filter(s => s && SECTION_TYPES.includes(s.type)).map(s => {
      const o = { type: s.type, bar: Math.max(0, num(s.bar, 0) | 0), bars: Math.max(1, num(s.bars, 1) | 0), lookMode: LOOK_SLOTS.includes(s.lookMode) || ['type', 'own', 'keep'].includes(s.lookMode) ? s.lookMode : 'type' };
      if (o.lookMode === 'own') { const l = lookFromJSON(s.look); if (l) o.look = l; else o.lookMode = 'type'; }
      return o;
    }).sort((a, b) => a.bar - b.bar);
    for (let n = 1; n < L.length; n++) L[n].bar = L[n - 1].bar + L[n - 1].bars;   // back to back, no gaps or overlaps
    if (L.length) seg.edits[String(k)] = L;
  }
  changed();
}

// ---------- the editor window ----------
const segUI = {};
function openSegments(d) {
  d = d || audio.clockDeck || audio.decks.find(x => x.info && x.info.sections) || audio.decks[0];
  seg.deck = d; seg.sel = 0;
  if (!segUI.box) buildSegUI();
  segUI.box.hidden = false;
  renderSegPanel();
}
function closeSegments() { if (segUI.box) segUI.box.hidden = true; seg.drag = null; }
function buildSegUI() {
  segUI.title = el('b');
  segUI.tabs = el('span', { className: 'seg-tabs' });
  segUI.cv = el('canvas', { className: 'seg-wave' });
  segUI.list = el('div', { className: 'seg-list' });
  segUI.panel = el('div', { className: 'seg-panel' });
  segUI.box = el('div', { className: 'modal', hidden: true },
    el('div', { className: 'mh' }, segUI.title, segUI.tabs,
      el('button', { textContent: 'Back to analysed', title: 'Forget the changes to this track\'s segments', onclick: () => { if (seg.deck && seg.deck.info) { resetSegments(seg.deck); renderSegPanel(); } } }),
      el('button', { textContent: 'Close', onclick: closeSegments })),
    el('div', { className: 'seg-body' },
      el('div', { className: 'hint', textContent: 'Drag a boundary to move it (it snaps to bars). Click a segment to edit it; double-click to hear it from its start.' }),
      segUI.cv, segUI.list, segUI.panel));
  document.body.append(segUI.box);
  const cv = segUI.cv, at = e => { const r = cv.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
  // Boundaries are grabbed within 7 px; anywhere else selects the segment under the pointer.
  cv.addEventListener('pointerdown', e => {
    const d = seg.deck, L = segmentsOf(d);
    if (!L || !L.length) return;
    const i = d.info, r = cv.getBoundingClientRect(), fx = at(e), barAt = (fx * i.duration - i.grid0) / i.barLen;
    let best = -1, bd = 7 / r.width;
    for (let k = 1; k < L.length; k++) { const x = (i.grid0 + L[k].bar * i.barLen) / i.duration; if (Math.abs(x - fx) < bd) { bd = Math.abs(x - fx); best = k; } }
    if (best > 0) { seg.drag = best; cv.setPointerCapture(e.pointerId); seg.sel = best; return; }
    const k = L.findIndex(s => barAt >= s.bar && barAt < s.bar + s.bars);
    if (k >= 0) { seg.sel = k; renderSegPanel(); }
  });
  cv.addEventListener('pointermove', e => {
    const d = seg.deck;
    if (seg.drag === null || !d || !d.info) { cv.style.cursor = nearBoundary(e) ? 'ew-resize' : 'pointer'; return; }
    const i = d.info;
    moveBoundary(d, seg.drag, (at(e) * i.duration - i.grid0) / i.barLen);
    renderSegList();
  });
  const end = () => { if (seg.drag !== null) { seg.drag = null; renderSegPanel(); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', () => { const d = seg.deck, s = (segmentsOf(d) || [])[seg.sel]; if (s) playSegment(d, s); });
}
function nearBoundary(e) {
  const d = seg.deck, L = segmentsOf(d), cv = segUI.cv;
  if (!L) return false;
  const r = cv.getBoundingClientRect(), i = d.info, px = e.clientX - r.left;
  return L.slice(1).some(s => Math.abs((i.grid0 + s.bar * i.barLen) / i.duration * r.width - px) < 7);
}
function playSegment(d, s) {
  deckSeek(d, Math.max(0, s.t - 0.02));
  if (!d.playing) deckPlay(d);
}
function renderSegPanel() {
  const d = seg.deck;
  segUI.tabs.textContent = '';
  for (const x of audio.decks) segUI.tabs.append(el('button', { textContent: 'Deck ' + x.id, className: x === d ? 'on' : '', disabled: !x.info, onclick: () => { seg.deck = x; seg.sel = 0; renderSegPanel(); } }));
  segUI.title.textContent = d && d.info ? 'Segments: ' + (d.name || 'deck ' + d.id) + (isEdited(d) ? '  (edited)' : '') : 'Segments';
  renderSegList();
  const P = segUI.panel;
  P.textContent = '';
  const L = segmentsOf(d);
  if (!d || !d.info || !d.info.ok || !L || !L.length) { P.append(el('div', { className: 'hint', textContent: 'Load an analysed track into a deck to edit its segments.' })); return; }
  seg.sel = Math.min(seg.sel, L.length - 1);
  const k = seg.sel, s = L[k], i = d.info;
  const lenIn = el('input', { type: 'number', min: 1, max: 999, value: s.bars, style: { width: '64px' }, onchange: e => { setLength(d, k, +e.target.value || s.bars); renderSegPanel(); } });
  const step = n => el('button', { textContent: (n > 0 ? '+' : '') + n, title: (n > 0 ? 'Longer' : 'Shorter') + ' by ' + Math.abs(n) + (Math.abs(n) === 1 ? ' bar' : ' bars') + ' (the next segment gives or takes them)', onclick: () => { setLength(d, k, s.bars + n); renderSegPanel(); } });
  const lookSel = el('select', { onchange: e => { setSegLook(d, k, e.target.value); renderSegPanel(); } },
    el('option', { value: 'type', textContent: 'The ' + SECTION_NAMES[s.type] + ' look' + (score.looks[s.type] ? '' : ' (none saved yet)'), selected: (s.lookMode || 'type') === 'type' }),
    ...LOOK_SLOTS.filter(t => t !== s.type).map(t => el('option', { value: t, textContent: 'The ' + SECTION_NAMES[t] + ' look' + (score.looks[t] ? '' : ' (none saved yet)'), selected: s.lookMode === t })),
    el('option', { value: 'own', textContent: 'Its own look' + (s.look ? '' : ' (capture one)'), selected: s.lookMode === 'own' }),
    el('option', { value: 'keep', textContent: 'Leave the visuals as they are', selected: s.lookMode === 'keep' }));
  const nowBar = (deckHeard(d) - i.grid0) / i.barLen;
  P.append(
    el('div', { className: 'fld' }, el('label', { textContent: 'Segment ' + (k + 1) + ' of ' + L.length }),
      el('select', { title: 'What this part of the track is', onchange: e => { setSegType(d, k, e.target.value); renderSegPanel(); } }, ...SECTION_TYPES.map(t => el('option', { value: t, textContent: SECTION_NAMES[t], selected: t === s.type }))),
      el('span', { className: 'hint', textContent: 'bars ' + (s.bar + 1) + '-' + (s.bar + s.bars) + ', ' + mmss(s.t) + ' to ' + mmss(s.end) })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Length (bars)' }), step(-4), step(-1), lenIn, step(1), step(4)),
    el('div', { className: 'fld' }, el('label', { textContent: 'Cut' }),
      el('button', { textContent: 'Split in half', disabled: s.bars < 2, onclick: () => { splitAt(d, k, s.bar + Math.round(s.bars / 2)); renderSegPanel(); } }),
      el('button', { textContent: 'Split at playhead', disabled: !(nowBar > s.bar + 0.5 && nowBar < s.bar + s.bars - 0.5), title: 'Split on the bar nearest to where the deck is now', onclick: () => { splitAt(d, k, (deckHeard(d) - i.grid0) / i.barLen); renderSegPanel(); } }),
      el('button', { textContent: 'Merge with next', disabled: k + 1 >= L.length, onclick: () => { mergeNext(d, k); renderSegPanel(); } }),
      el('button', { textContent: 'Merge with previous', disabled: k === 0, onclick: () => { mergeNext(d, k - 1); seg.sel = k - 1; renderSegPanel(); } })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Visuals' }), lookSel,
      el('button', { textContent: 'Use current visuals', title: 'Capture the visuals as they are now as this segment\'s own look', onclick: () => { captureSegLook(d, k); renderSegPanel(); setStatus('Segment ' + (k + 1) + ' now has its own look'); } }),
      el('button', { textContent: 'Preview', title: 'Show this segment\'s look now', onclick: () => { const l = lookForSegment(s); if (l) recallLook(l); else setStatus('This segment has no look to show (none saved, or set to leave the visuals alone)'); } }),
      el('button', { textContent: 'Play from here', onclick: () => playSegment(d, s) })),
  );
  if (!score.on) P.append(el('div', { className: 'fld' }, el('span', { className: 'hint', textContent: 'Auto-score is off, so these looks will not come in by themselves.' }), el('button', { textContent: 'Turn on Auto-score', onclick: () => { setScore(true); renderSegPanel(); } })));
}
function renderSegList() {
  const d = seg.deck, L = segmentsOf(d) || [];
  segUI.list.textContent = '';
  L.forEach((s, k) => segUI.list.append(el('span', { className: 'seg-chip sec-' + s.type + (k === seg.sel ? ' on' : ''),
    textContent: (k + 1) + '. ' + SECTION_NAMES[s.type] + ' · ' + s.bars + (s.lookMode === 'own' ? ' · own look' : s.lookMode === 'keep' ? ' · no change' : s.lookMode && s.lookMode !== 'type' ? ' · ' + SECTION_NAMES[s.lookMode] + ' look' : ''),
    title: 'bars ' + (s.bar + 1) + '-' + (s.bar + s.bars), onclick: () => { seg.sel = k; renderSegPanel(); }, ondblclick: () => playSegment(d, s) })));
}
// Every frame while open (from tickDJ): waveform, segments, bar ruler and playhead.
function tickSegmentsUI() {
  if (!segUI.box || segUI.box.hidden) return;
  const d = seg.deck, cv = segUI.cv, dpr = window.devicePixelRatio || 1;
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const x = cv.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const i = d && d.info, L = segmentsOf(d);
  if (!i || !i.ok || !L) return;
  const band = 22 * dpr, ruler = 14 * dpr, wy = band, wh = H - band - ruler, per = i.peaks.length / W, X = t => t / i.duration * W;
  for (let px = 0; px < W; px++) {
    let pk = 0, lo = 0, n = 0;
    for (let k = Math.floor(px * per), e = Math.max(k + 1, Math.floor((px + 1) * per)); k < e && k < i.peaks.length; k++) { if (i.peaks[k] > pk) pk = i.peaks[k]; lo += i.lows[k]; n++; }
    const h = Math.max(1, pk * wh);
    x.fillStyle = waveCol(n ? lo / n : 0); x.fillRect(px, wy + (wh - h) / 2, 1, h);
  }
  // bar ruler: a tick every bar when there is room, numbered every 8 or 16
  const bars = totalBars(i), pxBar = W / (i.duration / i.barLen), every = pxBar * 8 > 40 * dpr ? 8 : 16;
  x.font = 10 * dpr + 'px Inter, system-ui, sans-serif'; x.textAlign = 'left';
  for (let b = 0; b <= bars; b++) {
    const px = Math.round(X(i.grid0 + b * i.barLen));
    if (pxBar > 3 * dpr || b % 4 === 0) { x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(px, H - ruler, 1, b % 4 ? 3 * dpr : 6 * dpr); }
    if (b % every === 0) { x.fillStyle = '#999'; x.fillText(String(b + 1), px + 2 * dpr, H - 2 * dpr); }
  }
  // segments: coloured blocks with their names, the selected one outlined, boundaries as handles
  L.forEach((s, k) => {
    const a = X(s.t), b = X(s.end);
    x.fillStyle = sectionCol(s.type); x.globalAlpha = k === seg.sel ? 1 : 0.7; x.fillRect(a, 0, b - a - dpr, band - 3 * dpr); x.globalAlpha = 1;
    if (k === seg.sel) { x.strokeStyle = '#fff'; x.lineWidth = 2 * dpr; x.strokeRect(a + dpr, dpr, b - a - 3 * dpr, H - 2 * dpr); }
    x.fillStyle = '#000'; x.font = '600 ' + 11 * dpr + 'px Inter, system-ui, sans-serif';
    const label = SECTION_NAMES[s.type] + (s.lookMode === 'own' ? ' ●' : '');
    if (x.measureText(label).width < b - a - 6 * dpr) x.fillText(label, a + 4 * dpr, band - 8 * dpr);
    if (k > 0) { x.fillStyle = seg.drag === k ? THEME.acc : '#fff'; x.fillRect(Math.round(a) - dpr, 0, 2 * dpr, H - ruler); }
  });
  // playhead
  const p = deckHeard(d);
  x.fillStyle = THEME.acc; x.fillRect(Math.round(X(p)) - dpr, 0, 2 * dpr, H);
}
