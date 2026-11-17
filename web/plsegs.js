// Strodano VJ (web) - editing a song's visual segments right on the Agent playlist. GPL-3.0.
// Each playlist song shows its parts (intro / build / drop / breakdown / outro) as blocks under the waveform. Here they
// can be edited without the DJ panel:
//   click            select a part (toolbar: visuals, reroll, type, split, merge, delete, undo)
//   double-click     choose the part's visuals: Auto (the Agent picks), Pick clips (one clip per layer, mixed and
//                    matched), Snapshot (the clips of a stored snapshot), or Keep (leave whatever is up)
//   drag an edge     move the boundary between two parts (snaps to bars)
//   keys             Delete removes the selected part (its bars go to the one before), C cuts it at the pointer, Ctrl+Z
//                    undoes, Escape closes
// Parts and their timing are the segment edits of segments.js (the same ones the DJ panel's segment editor makes; its
// functions take any {file, info}, so a playlist song works as is). The visuals choice is the part's .vis, saved with
// those edits; a part without one is planned by the Agent as before (playlist.js planTrack uses sceneFromVis).
'use strict';
const VIS_MODES = [['', 'Auto'], ['pick', 'Pick clips'], ['snap', 'Snapshot'], ['keep', 'Keep']];
pl.sel = null;    // { key, k } the selected part
pl.pick = null;   // { key, k } the part whose visuals picker is open
pl.undo = [];     // [{ key, list }] segment lists before each edit (null: the song had no edits)
pl.hover = null;  // { key, bar } where the pointer is over a song's parts (C cuts there)

// ---------- what a part's visuals mean ----------
const clipRef = c => (c ? c.uid || (c.fileName ? 'f:' + c.fileName : 'n:' + c.name) : '');
// The column of a saved clip on layer li: where it was if it is still there, else wherever that clip is now.
function findClip(li, v) {
  const L = comp.layers[li];
  if (!L || !v) return -1;
  if (clipRef(L.clips[v.ci]) === v.ref) return v.ci;
  return L.clips.findIndex(c => c && clipRef(c) === v.ref);
}
// The scene a part's .vis asks for, or null to let the Agent plan it (a pinned scene whose clips are all gone too).
function sceneFromVis(s, band, drop) {
  const v = s && s.vis;
  if (!v) return null;
  if (v.mode === 'keep') return { band, drop, col: -1, show: {}, keep: true, pinned: true };
  const show = {};
  if (v.mode === 'pick') for (const li in v.show) { const ci = findClip(+li, v.show[li]); if (ci >= 0) show[li] = ci; }
  if (v.mode === 'snap') {
    const look = typeof snaps !== 'undefined' && snaps.slots[v.slot];
    if (look) look.layers.forEach((sl, li) => { if (sl.active >= 0 && comp.layers[li] && comp.layers[li].clips[sl.active]) show[li] = sl.active; });
  }
  return Object.keys(show).length ? { band, drop, col: -1, show, pinned: true } : null;
}
function visLabel(s) {
  const v = s && s.vis;
  if (!v) return '';
  return v.mode === 'keep' ? 'Keep' : v.mode === 'snap' ? 'Snapshot ' + (v.slot + 1) : '';
}
function visFromJSON(v) {
  if (!v || typeof v !== 'object') return undefined;
  if (v.mode === 'keep') return { mode: 'keep' };
  if (v.mode === 'snap' && Number.isInteger(v.slot) && v.slot >= 0 && v.slot < 64) return { mode: 'snap', slot: v.slot };
  if (v.mode === 'pick' && v.show && typeof v.show === 'object') {
    const show = {};
    for (const li in v.show) { const o = v.show[li]; if (o && Number.isInteger(o.ci) && typeof o.ref === 'string' && +li >= 0) show[+li] = { ci: o.ci, ref: o.ref }; }
    return Object.keys(show).length ? { mode: 'pick', show } : undefined;
  }
  return undefined;
}

// ---------- edits, with undo ----------
const canEditParts = t => !!(t && t.info && t.info.ok && t.info.sections && t.info.sections.length);
const partsList = t => (canEditParts(t) ? sectionsFor(t.info, t.file) : null);
function segEdit(t, fn) {
  if (!canEditParts(t)) { setStatus('This song has no beat grid, so its parts cannot be edited'); return; }
  const key = segKey(t.file, t.info), was = seg.edits[key];
  pl.undo.push({ key, list: was ? JSON.parse(JSON.stringify(was)) : null });
  if (pl.undo.length > 60) pl.undo.shift();
  fn(editable(t));
  changed(); plDirty();
}
function segUndo() {
  const u = pl.undo.pop();
  if (!u) { setStatus('Nothing to undo'); return; }
  if (u.list) seg.edits[u.key] = u.list; else delete seg.edits[u.key];
  if (pl.sel && pl.sel.key === u.key) { const t = crate.tracks.find(x => x.key === pl.sel.key); const n = t && partsList(t); if (n && pl.sel.k >= n.length) pl.sel.k = n.length - 1; }
  pl.pick = null;
  changed(); plDirty(); setStatus('Undone');
}
const selTrack = () => (pl.sel ? crate.tracks.find(t => t.key === pl.sel.key) || null : null);
function setVis(t, k, vis, all) {
  segEdit(t, L => {
    const ty = L[k].type;
    L.forEach((s, j) => { if (j === k || (all && s.type === ty)) { if (vis) s.vis = JSON.parse(JSON.stringify(vis)); else delete s.vis; } });
  });
}
function splitPart(t, k) {
  const L = partsList(t), s = L && L[k];
  if (!s) return;
  if (s.bars < 2) { setStatus('This part is one bar long: it cannot be split'); return; }
  const h = pl.hover && pl.hover.key === t.key ? pl.hover.bar : -1;
  const b = h > s.bar && h < s.bar + s.bars ? h : s.bar + Math.floor(s.bars / 2);
  segEdit(t, () => splitAt(t, k, b));
  setStatus('Split at bar ' + (b + 1));
}
function deletePart(t, k) {
  const L = partsList(t);
  if (!L || L.length < 2) { setStatus('A song needs at least one part'); return; }
  segEdit(t, E => {
    if (k > 0) { E[k - 1].bars += E[k].bars; E.splice(k, 1); }
    else { E[1].bars += E[1].bar - E[0].bar; E[1].bar = E[0].bar; E.splice(0, 1); }
  });
  pl.sel.k = Math.max(0, k - 1); pl.pick = null;
}
function mergePart(t, k) {
  const L = partsList(t);
  if (!L || k >= L.length - 1) { setStatus('This is the last part: nothing after it to merge with'); return; }
  segEdit(t, () => mergeNext(t, k));
}
function rerollPinned(t, k) {
  const L = partsList(t);
  if (L && L[k] && L[k].vis) setVis(t, k, null);   // back to Auto, then a new combination
  rerollPart(t, k);
}

// ---------- the parts strip ----------
// Fills r.chips with one block per part and adds r.tools / r.pick under the row (playlist.js plRow calls it).
function plSegStrip(t, r, wv) {
  const inf = t.info;
  r.tools = el('div', { className: 'pltools' });
  r.pick = el('div', { className: 'plpick' });
  wv.append(r.tools, r.pick);
  if (!inf || !ensurePlan(t)) return;
  const edit = canEditParts(t), parts = partsList(t);
  r.cut = el('div', { className: 'plcut' }); r.cut.hidden = true;
  r.chips.append(r.cut);
  t.plan.forEach((p, k) => {
    const s = parts ? parts[k] : null, pinned = !!(s && s.vis);
    const c = el('div', { className: 'plchip band-' + (p.sc ? p.sc.band : 'calm') + ' sec-' + p.s.type + (pinned ? ' pinned' : ''), tabIndex: 0,
      textContent: (visLabel(s) || sceneShort(p.sc)),
      title: (SECTION_NAMES[p.s.type] || 'Whole song') + (s ? ' · bars ' + (s.bar + 1) + '-' + (s.bar + s.bars) : '') + ': ' + (p.sc ? (p.sc.keep ? 'keeps what is up' : sceneLabel(p.sc)) : 'nothing to play: add clips or unlock a layer') +
        (pinned ? '\nYour choice (pinned)' : '\nChosen by the Agent') + '\nClick to select · double-click to choose its visuals' + (edit ? ' · drag an edge to resize' : '') });
    c.sc = p.sc; c.k = k;
    c.addEventListener('pointerdown', e => partPointer(e, t, r, k, c));
    c.addEventListener('dblclick', e => { e.preventDefault(); pl.sel = { key: t.key, k }; pl.pick = { key: t.key, k }; plDirty(); });
    r.chips.append(c);
  });
  layoutChips(r, t);
  r.chips.addEventListener('pointermove', e => partHover(e, t, r));
  r.chips.addEventListener('pointerleave', () => { if (r.cut) r.cut.hidden = true; });
  const selK = pl.sel && pl.sel.key === t.key ? pl.sel.k : -1;
  if (selK >= 0 && t.plan[selK]) { r.chips.children[selK + 1].classList.add('sel'); renderTools(t, r, selK); }
  if (pl.pick && pl.pick.key === t.key && t.plan[pl.pick.k]) renderPicker(t, r, pl.pick.k);
}
function layoutChips(r, t) {
  const inf = t.info, parts = partsList(t);
  [...r.chips.querySelectorAll('.plchip')].forEach(c => {
    const s = parts ? parts[c.k] : t.plan[c.k].s, a = Math.max(0, s.t) / inf.duration, w = (Math.min(inf.duration, s.end) - Math.max(0, s.t)) / inf.duration;
    c.style.left = (a * 100).toFixed(3) + '%'; c.style.width = 'calc(' + (w * 100).toFixed(3) + '% - 2px)';
  });
}
const barAtX = (t, x, w) => Math.round((x / w * t.info.duration - t.info.grid0) / t.info.barLen);
function partHover(e, t, r) {
  if (!canEditParts(t)) return;
  const b = r.chips.getBoundingClientRect(), bar = barAtX(t, e.clientX - b.left, b.width);
  pl.hover = { key: t.key, bar };
  const L = partsList(t), k = pl.sel && pl.sel.key === t.key ? pl.sel.k : -1, s = L[k];
  const show = !!s && bar > s.bar && bar < s.bar + s.bars;
  r.cut.hidden = !show;
  if (show) r.cut.style.left = (100 * (t.info.grid0 + bar * t.info.barLen) / t.info.duration).toFixed(3) + '%';
  // edges show a resize cursor
  const edge = edgeAt(e, t, r);
  r.chips.style.cursor = edge > 0 ? 'col-resize' : '';
}
// The boundary under the pointer (the index of the part after it), or -1.
function edgeAt(e, t, r) {
  if (!canEditParts(t)) return -1;
  const b = r.chips.getBoundingClientRect(), L = partsList(t);
  for (let k = 1; k < L.length; k++) { const x = b.left + b.width * L[k].t / t.info.duration; if (Math.abs(e.clientX - x) <= 5) return k; }
  return -1;
}
function partPointer(e, t, r, k, c) {
  if (e.button !== 0) return;
  const edge = edgeAt(e, t, r);
  if (edge > 0) {   // drag the boundary in front of part `edge`
    e.preventDefault(); e.stopPropagation();
    try { c.setPointerCapture(e.pointerId); } catch (err) {}
    const key = segKey(t.file, t.info), was = seg.edits[key];
    const undo = { key, list: was ? JSON.parse(JSON.stringify(was)) : null };
    let moved = false;
    pl.held = true;
    const move = ev => {
      const b = r.chips.getBoundingClientRect(), bar = barAtX(t, ev.clientX - b.left, b.width), L = editable(t);
      if (L[edge] && bar !== L[edge].bar) { if (!moved) { pl.undo.push(undo); moved = true; } moveBoundary(t, edge, bar); layoutChips(r, t); setStatus('Part starts at bar ' + (L[edge].bar + 1)); }
    };
    const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); pl.held = false; if (moved) { changed(); plDirty(); } };
    c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    return;
  }
  if (!pl.sel || pl.sel.key !== t.key || pl.sel.k !== k) { pl.sel = { key: t.key, k }; if (pl.pick && (pl.pick.key !== t.key || pl.pick.k !== k)) pl.pick = null; plDirty(); }
}

// ---------- toolbar ----------
function renderTools(t, r, k) {
  const L = partsList(t), s = L ? L[k] : null, edit = !!L;
  const typeSel = el('select', { title: 'What this part of the song is', disabled: !edit, onchange: e => segEdit(t, () => setSegType(t, k, e.target.value)) },
    ...SECTION_TYPES.map(ty => el('option', { value: ty, textContent: SECTION_NAMES[ty], selected: (s ? s.type : t.plan[k].s.type) === ty })));
  r.tools.append(
    el('span', { className: 'pltlabel', textContent: (SECTION_NAMES[t.plan[k].s.type] || 'Whole song') + (s ? ' · bars ' + (s.bar + 1) + '-' + (s.bar + s.bars) : '') }),
    el('button', { textContent: 'Visuals...', title: 'Choose this part’s visuals (or double-click the part)', onclick: () => { pl.pick = pl.pick && pl.pick.key === t.key && pl.pick.k === k ? null : { key: t.key, k }; plDirty(); } }),
    el('button', { textContent: 'Reroll', title: 'Let the Agent pick a different combination for this part', onclick: () => rerollPinned(t, k) }),
    typeSel,
    el('button', { textContent: 'Split', title: 'Cut this part in two at the pointer (C), or in the middle', disabled: !edit, onclick: () => splitPart(t, k) }),
    el('button', { textContent: 'Merge →', title: 'Join this part with the next one', disabled: !edit, onclick: () => mergePart(t, k) }),
    el('button', { textContent: 'Delete', title: 'Remove this part: its bars go to the part before it (Delete key)', disabled: !edit, onclick: () => deletePart(t, k) }),
    el('button', { textContent: 'Undo', title: 'Undo the last part edit (Ctrl+Z)', disabled: !pl.undo.length, onclick: segUndo }),
    el('span', { className: 'hint', textContent: edit ? 'Drag an edge to resize' : 'No beat grid: only the visuals can be rerolled' }));
}

// ---------- visuals picker ----------
function renderPicker(t, r, k) {
  const L = partsList(t), s = L ? L[k] : null, p = t.plan[k], v = (s && s.vis) || null, mode = v ? v.mode : '';
  if (!L) { r.pick.append(el('span', { className: 'hint', textContent: 'This song has no beat grid, so its parts cannot be given their own visuals.' })); return; }
  const head = el('div', { className: 'plpk-h' }, el('b', { textContent: 'Visuals for ' + SECTION_NAMES[s.type] + ' · bars ' + (s.bar + 1) + '-' + (s.bar + s.bars) }),
    el('span', { className: 'seg' }, ...VIS_MODES.map(([m, label]) => el('button', { textContent: label, className: m === mode ? 'on' : '',
      title: m === '' ? 'The Agent picks, guided by your column tags' : m === 'pick' ? 'One clip per layer, as you choose' : m === 'snap' ? 'The clips of a stored snapshot' : 'Leave whatever is up when this part starts',
      onclick: () => { if (m === mode) return; if (m === '') setVis(t, k, null); else if (m === 'keep') setVis(t, k, { mode: 'keep' }); else if (m === 'snap') { const i = snaps.slots.findIndex(Boolean); if (i < 0) { setStatus('No snapshots stored yet: Shift+F1..F8 stores the show as it is now'); return; } setVis(t, k, { mode: 'snap', slot: i }); } else setVis(t, k, { mode: 'pick', show: pickFrom(p.sc) }); } }))));
  r.pick.append(head);
  if (mode === 'pick' || mode === '') {
    // Auto shows what the Agent planned; clicking a clip turns it into your choice, starting from that plan.
    const cur = mode === 'pick' ? sceneFromVis(s, p.sc ? p.sc.band : 'groove', s.type === 'drop') : p.sc;
    const grid = el('div', { className: 'plpk-g' });
    comp.layers.map((Ly, li) => li).reverse().forEach(li => {
      const Ly = comp.layers[li], on = cur && cur.show[li] !== undefined ? cur.show[li] : -1;
      grid.append(el('span', { className: 'plpk-l', textContent: Ly.name + (Ly.locked ? ' (locked)' : '') }));
      const row = el('div', { className: 'plpk-r' });
      if (Ly.locked) { row.append(el('span', { className: 'hint', textContent: 'Locked: it keeps what you set. Unlock the layer to choose here.' })); grid.append(row); return; }
      const choose = ci => { const show = pickFrom(cur); if (ci < 0) delete show[li]; else show[li] = { ci, ref: clipRef(Ly.clips[ci]) }; setVis(t, k, Object.keys(show).length ? { mode: 'pick', show } : null); };
      row.append(el('button', { className: 'plpk-c' + (on < 0 ? ' on' : ''), textContent: 'None', onclick: () => choose(-1) }));
      Ly.clips.forEach((c, ci) => {
        if (!c) return;
        const b = el('button', { className: 'plpk-c' + (on === ci ? ' on' : '') + (c.missing || c.error ? ' bad' : ''), title: c.name + (c.missing ? ' (file missing)' : ''), onclick: () => choose(ci) });
        if (c.thumb) b.append(el('img', { src: c.thumb, alt: '' }));
        b.append(el('span', { textContent: c.name }));
        row.append(b);
      });
      grid.append(row);
    });
    r.pick.append(grid);
    if (mode === '') r.pick.append(el('span', { className: 'hint', textContent: 'Auto: the Agent’s current pick is highlighted. Click a clip to make this part your own choice.' }));
  } else if (mode === 'snap') {
    r.pick.append(el('div', { className: 'plpk-r' }, ...snaps.slots.map((sl, i) => el('button', { className: 'plpk-c' + (v.slot === i ? ' on' : ''), textContent: 'Snapshot ' + (i + 1) + (sl ? '' : ' (empty)'), disabled: !sl, onclick: () => setVis(t, k, { mode: 'snap', slot: i }) }))),
      el('span', { className: 'hint', textContent: 'Plays the clips stored in the snapshot (Shift+F1..F8 stores one).' }));
  } else r.pick.append(el('span', { className: 'hint', textContent: 'Keep: when this part starts, the Agent leaves the visuals as they are.' }));
  r.pick.append(el('div', { className: 'plpk-f' },
    el('button', { textContent: 'Preview', title: 'Show this part’s visuals on the output now', onclick: () => previewPart(t, k) }),
    el('button', { textContent: 'Use for every ' + SECTION_NAMES[s.type] + ' in this song', disabled: !v, onclick: () => setVis(t, k, v, true) }),
    el('button', { textContent: 'Done', onclick: () => { pl.pick = null; plDirty(); } })));
}
// A pick's show map ({li: {ci, ref}}) from a scene ({li: ci}).
function pickFrom(sc) {
  const show = {};
  if (sc) for (const li in sc.show) { const c = comp.layers[+li] && comp.layers[+li].clips[sc.show[li]]; if (c && !comp.layers[+li].locked) show[li] = { ci: sc.show[li], ref: clipRef(c) }; }
  return show;
}
function previewPart(t, k) {
  const sc = t.plan && t.plan[k] && t.plan[k].sc;
  if (!sc || sc.keep) { setStatus('Nothing to preview: this part keeps what is up'); return; }
  if (agent.on) { const v = validScene(sc); if (v) applyScene(v, 0); }
  else for (const li of agentLayers()) { if (sc.show[li] !== undefined) trigger(li, sc.show[li]); else eject(li); }
  setStatus('Previewing ' + SECTION_NAMES[t.plan[k].s.type] + ' of ' + t.name);
}

// ---------- keys (before the app's shortcuts, only while a part is selected) ----------
window.addEventListener('keydown', e => {
  if (!pl.sel || typeof agUI === 'undefined' || !agUI.open || !plShowing() || typingIn(e.target)) return;
  const t = selTrack();
  if (!t) return;
  let done = true;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') segUndo();
  else if (e.ctrlKey || e.metaKey || e.altKey) done = false;
  else if (e.key === 'Delete' || e.key === 'Backspace') deletePart(t, pl.sel.k);
  else if (e.code === 'KeyC') splitPart(t, pl.sel.k);
  else if (e.key === 'Escape') { if (pl.pick) pl.pick = null; else pl.sel = null; plDirty(); }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
}, true);
// A click anywhere outside the playlist's parts clears the selection.
document.addEventListener('pointerdown', e => { if (pl.sel && !e.target.closest('.plchips, .pltools, .plpick')) { pl.sel = null; pl.pick = null; plDirty(); } });

(function css() {
  const s = document.createElement('style');
  s.textContent = `
.plchip{cursor:pointer;user-select:none}
.plchip.sel{outline:2px solid var(--acc);outline-offset:0;z-index:1}
.plchip.pinned{font-weight:600;color:var(--txt)} .plchip.pinned::before{content:'\\25C6  ';color:var(--acc)}
.plcut{position:absolute;top:-2px;bottom:-2px;width:0;border-left:2px dashed var(--acc);z-index:2;pointer-events:none}
.pltools{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px} .pltools:empty,.plpick:empty{display:none}
.pltools button,.pltools select,.plpick button{font-size:11px;padding:2px 8px}
.pltlabel{font-size:11px;font-weight:600;margin-right:4px}
.plpick{margin-top:6px;padding:8px;border:1px solid var(--card-line);border-radius:var(--r-card);background:var(--bg);display:grid;gap:8px}
.plpk-h{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;font-size:12px}
.plpk-h .seg{display:flex;gap:2px} .plpk-h .seg button.on,.plpk-c.on{background:var(--acc-soft);color:var(--acc);border-color:var(--acc)}
.plpk-g{display:grid;grid-template-columns:minmax(80px,140px) minmax(0,1fr);gap:6px 10px;align-items:center}
.plpk-l{font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plpk-r{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
.plpk-c{display:flex;align-items:center;gap:5px;max-width:170px} .plpk-c img{width:36px;height:20px;object-fit:cover;border-radius:2px}
.plpk-c span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .plpk-c.bad{opacity:.5}
.plpk-f{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}`;
  document.head.append(s);
})();
