// Strodano VJ (web) - user interface and main loop. GPL-3.0.
'use strict';
// $, el, sel, drag, propTab, browserTab, fld, tabs, dropTarget, draggable, hasFiles, armThen, TRASH_SVG / LOCK_SVG, autosave
// and coreTick (the shared show pipeline) are in core.js, loaded first.
let cellEls = [], posSlider = null;
// ---------- clip grid ----------
function putMedia(list, li, ci, onlyFree) {
  for (const m of list) {
    if (onlyFree) while (ci < comp.columns && comp.layers[li].clips[ci]) ci++;
    if (ci >= comp.columns) { setStatus('No free clip slot left on that layer'); break; }
    setClip(li, ci++, mediaClip(m));
  }
}
function dropOnCell(li, ci, e) {
  if (hasFiles(e)) { rememberDropped(e.dataTransfer); putMedia(addMediaFiles(e.dataTransfer.files), li, ci, false); return; }
  if (!drag) return;
  if (drag.kind === 'media') setClip(li, ci, mediaClip(drag.m));
  else if (drag.kind === 'gen') setClip(li, ci, genClip(drag.name));
  else if (drag.kind === 'make') { const c = drag.make(); if (c) setClip(li, ci, c); }   // camera / text / 3D / web link sources (null = nothing to place)
  else if (drag.kind === 'fx') {   // an effect dropped on a clip goes on that clip only
    const c = comp.layers[li].clips[ci], e = c && mkEffect(drag.name);
    if (e) { (c.fx || (c.fx = [])).push(e); sel.l = li; sel.c = ci; propTab = 'clip'; ui.gridDirty = ui.propsDirty = true; }
  }
  else if (drag.kind === 'clip' && (drag.l !== li || drag.c !== ci)) {
    const A = comp.layers[drag.l], B = comp.layers[li];
    if (A.active === drag.c || A.pendingCol === drag.c) eject(drag.l);
    if (B.active === ci || B.pendingCol === ci) eject(li);
    [A.clips[drag.c], B.clips[ci]] = [B.clips[ci], A.clips[drag.c]];
    ui.gridDirty = true;
  }
}
// Delete a layer (its clips and effects go with it). The selection follows the layer it was on.
function deleteLayer(li) {
  if (comp.layers.length <= 1) { setStatus('A composition needs at least one layer'); return; }
  const name = comp.layers[li].name;
  removeLayer(li);
  if (sel.l > li || sel.l >= comp.layers.length) sel.l = Math.max(0, sel.l - 1);
  sel.c = -1; ui.gridDirty = ui.propsDirty = true;
  setStatus('Deleted ' + name);
}
function renderGrid() {
  const g = $('grid');
  g.textContent = '';
  g.style.setProperty('--cols', comp.columns);   // every row shares one column template (index.html .row)
  cellEls = [];
  const head = el('div', { className: 'row' },
    el('div', { className: 'lctl' }, el('div', { className: 'r' }, el('b', { textContent: 'COMPOSITION', style: { color: 'var(--acc)' } }),
      el('button', { textContent: 'X', title: 'Eject all layers', onclick: () => comp.layers.forEach((_, i) => eject(i)) }),
      el('input', { type: 'range', min: 0, max: 1, step: 0.001, value: comp.master, title: 'Master', dataset: { midi: 'master' }, oninput: e => { comp.master = +e.target.value; reflectMidi('master', comp.master); } }))));
  head.append(el('div', { className: 'lmon sp' }));   // keeps the column buttons over their cells
  for (let c = 0; c < comp.columns; c++) head.append(el('button', { className: 'colbtn', textContent: 'Column ' + (c + 1), dataset: { midi: 'column:' + c }, onclick: () => triggerColumn(c) }));
  g.append(head);
  for (let li = comp.layers.length - 1; li >= 0; li--) {
    const L = comp.layers[li];
    const tog = (label, title, on, cls, fn, mid) => el('button', { textContent: label, title, className: (on ? 'on ' : '') + cls, dataset: mid ? { midi: mid } : {}, onclick: () => { fn(); ui.gridDirty = true; } });
    // three lines: the name on its own (readable at full width), the switches and blend mode, then opacity
    const ctl = el('div', { className: 'lctl' },
      el('div', { className: 'r nmrow' },
        el('span', { className: 'lno', textContent: String(li + 1), title: 'Layer ' + (li + 1) }),
        el('span', { className: 'nm', textContent: L.name, title: L.name + ' (click for the Layer tab)', onclick: () => { sel.l = li; sel.c = -1; propTab = 'layer'; ui.gridDirty = ui.propsDirty = true; } }),
        el('button', { className: 'lockbtn' + (L.locked ? ' on' : ''), innerHTML: LOCK_SVG, ariaLabel: 'Lock ' + L.name,
          title: L.locked ? 'Locked: the Agent, auto-score and track scores leave this layer alone. Click to unlock.' : 'Lock this layer: the Agent, auto-score and track scores leave it alone',
          onclick: () => toggleLayerLock(li) }),
        el('button', { className: 'del', title: 'Delete layer (click twice)', ariaLabel: 'Delete ' + L.name, innerHTML: TRASH_SVG, onclick: e => armThen(e.currentTarget, 'delete ' + L.name, () => deleteLayer(li)) })),
      el('div', { className: 'r' },
        el('button', { textContent: 'X', title: 'Eject clip', dataset: { midi: 'layer:' + li + ':eject' }, onclick: () => eject(li) }),
        tog('B', 'Bypass layer', L.bypass, 'red', () => { L.bypass = !L.bypass; }, 'layer:' + li + ':bypass'),
        tog('S', 'Solo layer', L.solo, 'yel', () => { L.solo = !L.solo; }, 'layer:' + li + ':solo'),
        tog('A', 'Crossfader side A', L.xfade === 1, '', () => { L.xfade = L.xfade === 1 ? 0 : 1; }),
        tog('B', 'Crossfader side B', L.xfade === 2, '', () => { L.xfade = L.xfade === 2 ? 0 : 2; }),
        el('select', { className: 'blend', title: 'Blend mode', onchange: e => { L.blend = +e.target.value; } }, ...BLENDS.map((b, i) => el('option', { value: i, textContent: b, selected: i === L.blend })))),
      el('div', { className: 'r' },
        el('input', { type: 'range', min: 0, max: 1, step: 0.001, value: L.opacity, title: 'Opacity', dataset: { midi: 'layer:' + li + ':opacity' }, oninput: e => { L.opacity = +e.target.value; reflectMidi('layer:' + li + ':opacity', L.opacity); } })));
    dropTarget(ctl, () => drag && drag.kind === 'fx', () => { const e = mkEffect(drag.name); if (e) { L.fx.push(e); sel.l = li; ui.propsDirty = true; } });
    const row = el('div', { className: 'row' + (sel.l === li ? ' sel' : '') + (L.locked ? ' locked' : '') }, ctl, layerMon(li));
    cellEls[li] = [];
    for (let ci = 0; ci < comp.columns; ci++) {
      const c = L.clips[ci];
      const cell = el('div', { className: 'cell' + (c ? ' has' : '') + (sel.l === li && sel.c === ci ? ' selc' : ''), dataset: { midi: 'clip:' + li + ':' + ci } });
      if (c) {
        cell.append(c.thumb ? el('img', { src: c.thumb, draggable: false }) : el('div', { className: 'ph' }), el('div', { className: 'prog' }, el('i')), el('span', { textContent: c.name, title: c.fileName || c.name }));
        if (c.missing) cell.append(el('div', { className: 'miss', textContent: 'missing file' }));
        if (c.error) cell.append(el('div', { className: 'miss', textContent: 'cannot play' }));
        if (viz3dLocked(c)) { cell.classList.add('prolocked'); cell.append(el('div', { className: 'prolock', textContent: 'PRO', title: c.name + ' is a Pro visualizer: click to see Pro' })); }
        draggable(cell, { kind: 'clip', l: li, c: ci });
      }
      cell.addEventListener('click', () => { sel.l = li; sel.c = ci; if (c) { if (viz3dLocked(c)) proGate('viz3d'); else trigger(li, ci); propTab = 'clip'; } ui.gridDirty = ui.propsDirty = true; });
      cell.addEventListener('contextmenu', e => { e.preventDefault(); if (c) setClip(li, ci, null); });
      dropTarget(cell, e => hasFiles(e) || (drag && (drag.kind !== 'fx' || c)), e => dropOnCell(li, ci, e));
      cellEls[li][ci] = cell;
      row.append(cell);
    }
    g.append(row);
  }
}

// ---------- properties ----------
// Reset: back to the shader's defaults. A slider that follows the beat or an input (owner.mod) and a snapshot glide still
// running on it (looks.js lookGlide.tweens) are dropped as well, or the value would move straight away again and the
// reset would look as if it did nothing.
function paramReset(owner, k, def) {
  if (k === 'mix') owner.mix = def; else owner.params[k] = def;
  if (k !== 'mix' && owner.mod && owner.mod[k]) { delete owner.mod[k]; if (!Object.keys(owner.mod).length) owner.mod = undefined; }
  if (typeof lookGlide !== 'undefined' && lookGlide.tweens) lookGlide.tweens = lookGlide.tweens.filter(t => !(k === 'mix' ? t.obj === owner && t.key === 'mix' : t.obj === owner.params && +t.key === +k));
  ui.propsDirty = true;
}
function fxReset(e) {
  const d = DEFS.fx.get(e.def);
  if (!d) return;
  d.params.forEach((pd, k) => paramReset(e, k, pd.def));
  paramReset(e, 'mix', 1);
}
function chainUI(chain, title = 'Effects') {
  const box = el('div', null, el('h4', { textContent: title }));
  chain.forEach((e, i) => {
    const d = DEFS.fx.get(e.def);
    const move = dir => { const j = i + dir; if (j >= 0 && j < chain.length) { [chain[i], chain[j]] = [chain[j], chain[i]]; ui.propsDirty = true; } };
    const fx = el('div', { className: 'fx' }, el('div', { className: 'hd' },
      el('input', { type: 'checkbox', checked: !e.bypass, title: 'Enabled', dataset: { midi: 'fx:' + e.uid + ':bypass' }, onchange: ev => { e.bypass = !ev.target.checked; } }),
      el('b', { textContent: e.def + (d ? (d.custom ? '  (custom)' : '') : '  (missing)') }),
      d ? el('button', { textContent: '↺', title: 'Reset this effect: every slider back to its default, Mix to full, nothing following the beat or an input (double-click one slider to reset just that one)', ariaLabel: 'Reset ' + e.def, onclick: () => { fxReset(e); setStatus(e.def + ' reset to its defaults'); } }) : null,
      el('button', { textContent: '↑', title: 'Move up', onclick: () => move(-1) }), el('button', { textContent: '↓', title: 'Move down', onclick: () => move(1) }),
      el('button', { textContent: '×', title: 'Remove', onclick: () => { chain.splice(i, 1); ui.propsDirty = true; } })));
    if (d) {
      if (d.err) fx.append(el('div', { className: 'hint', style: { color: 'var(--bad)' }, textContent: 'Shader error - open the Shader Editor' }));
      const tagged = (f, id) => { f.slider.dataset.midi = 'fx:' + e.uid + ':' + id; f.slider.title = 'Double-click to reset'; f.slider.addEventListener('dblclick', () => paramReset(e, id, id === 'mix' ? 1 : d.params[id].def)); return f; };
      d.params.forEach((pd, k) => fx.append(...lfoControls(e, k, tagged(fld(pd.name, 0, 1, 0.001, () => e.params[k] ?? pd.def, v => { e.params[k] = v; }), k))));
      if (!d.isf) fx.append(tagged(fld('Mix', 0, 1, 0.001, () => e.mix, v => { e.mix = v; }), 'mix'));
    }
    box.append(fx);
  });
  const dz = el('div', { className: 'dropz', textContent: 'Drop effects here' });
  dropTarget(dz, () => drag && drag.kind === 'fx', () => { const e = mkEffect(drag.name); if (e) { chain.push(e); ui.propsDirty = true; } });
  box.append(dz);
  return box;
}
function renderProps() {
  const p = $('props');
  p.textContent = '';
  posSlider = null; lfoMeters.length = 0;
  sel.l = Math.min(comp.layers.length - 1, Math.max(0, sel.l));
  const L = comp.layers[sel.l];
  p.append(tabs([['comp', 'Composition'], ['layer', 'Layer'], ['clip', 'Clip']], propTab, t => { propTab = t; ui.propsDirty = true; }));
  if (propTab === 'comp') {
    const fm = fld('Master', 0, 1, 0.001, () => comp.master, v => { comp.master = v; reflectMidi('master', v); });
    const fx = fld('Crossfader', 0, 1, 0.001, () => comp.crossfade, v => { comp.crossfade = v; $('xf').value = v; });
    fm.slider.dataset.midi = 'master'; fx.slider.dataset.midi = 'crossfade';
    p.append(fm, fx, el('div', { className: 'fld' }, el('span', { className: 'hint', style: { flex: '1' }, textContent: `${comp.w} x ${comp.h}, ${comp.layers.length} layers, ${comp.columns} columns` }),
      el('button', { textContent: 'Resolution...', title: 'Change the composition resolution (Settings)', onclick: () => toggleKeysHelp(true, 'prefs') })), chainUI(comp.fx), snapPanel());
  } else if (propTab === 'layer') {
    const fo = fld('Opacity', 0, 1, 0.001, () => L.opacity, v => { L.opacity = v; reflectMidi('layer:' + sel.l + ':opacity', v); });
    fo.slider.dataset.midi = 'layer:' + sel.l + ':opacity';
    p.append(el('div', { className: 'fld' }, el('label', { textContent: 'Name' }), el('input', { type: 'text', value: L.name, onchange: e => { L.name = e.target.value || L.name; ui.gridDirty = true; } })),
      fo,
      transitionField(L),
      el('div', { className: 'fld' }, el('label', { textContent: 'Scaling' }), el('select', { onchange: e => { L.fit = +e.target.value; } }, ...['Fill', 'Fit', 'Stretch'].map((n, i) => el('option', { value: i, textContent: n, selected: i === L.fit })))),
      fld('Scale', 0.05, 4, 0.01, () => L.scale, v => { L.scale = v; }), fld('Position X', -1, 1, 0.001, () => L.x, v => { L.x = v; }), fld('Position Y', -1, 1, 0.001, () => L.y, v => { L.y = v; }),
      el('div', { className: 'fld' }, el('button', { textContent: 'Reset transform', onclick: () => { L.scale = 1; L.x = L.y = 0; ui.propsDirty = true; } }),
        el('button', { textContent: 'Delete layer', title: 'Click twice', onclick: e => armThen(e.currentTarget, 'delete ' + L.name, () => deleteLayer(sel.l)) })),
      chainUI(L.fx));
  } else {
    const c = L.clips[sel.c];
    if (!c) { p.append(el('div', { className: 'hint', textContent: 'Select a clip in the grid.' })); return; }
    p.append(el('div', { className: 'fld' }, el('label', { textContent: 'Name' }), el('input', { type: 'text', value: c.name, onchange: e => { c.name = e.target.value || c.name; ui.gridDirty = true; } })));
    if (c.missing) p.append(el('div', { className: 'hint', style: { color: 'var(--bad)' }, textContent: `"${c.fileName}" is not loaded. Find it to relink it (or drop it anywhere).` }),
      el('button', { className: 'on', textContent: 'Find missing files...', title: 'Pick this file (and any other missing ones): they relink by name and are remembered for next start', onclick: findMissingFiles }));
    else if (CLIP_TYPES[c.type] && CLIP_TYPES[c.type].props) CLIP_TYPES[c.type].props(c, p, L);
    else if (c.type === 'video') {
      p.append(el('div', { className: 'hint', textContent: `${c.fileName}  -  ${c.w} x ${c.h}, ${(c.video.duration || 0).toFixed(2)} s` }),
        fld('Speed', 0, 4, 0.01, () => c.speed, s => { c.speed = s; if (s <= 0) c.video.pause(); else { c.video.playbackRate = Math.max(0.0625, s); if (L.active === sel.c && c.video.paused) c.video.play().catch(() => {}); } }, s => s.toFixed(2) + 'x'));
      const pos = fld('Position', 0, 1, 0.0005, () => (c.video.duration ? c.video.currentTime / c.video.duration : 0), f => { if (c.video.duration) c.video.currentTime = f * c.video.duration; }, f => (f * (c.video.duration || 0)).toFixed(1) + 's');
      posSlider = { input: pos.slider, clip: c };
      p.append(pos, el('div', { className: 'fld' },
        el('button', { textContent: 'Play / Pause', onclick: () => { if (c.video.paused) c.video.play().catch(() => {}); else c.video.pause(); } }),
        el('button', { textContent: 'Restart', onclick: () => { c.video.currentTime = clipStart(c); c.sync0 = comp.beats; c.done = false; } }),
        el('button', { textContent: '1x', title: 'Speed back to 1x', dataset: { midi: 'clip:' + sel.l + ':' + sel.c + ':speed1' }, onclick: () => clipSpeedReset(c) })),
      // nudge (held, while this clip plays) and a fine speed trim: clipopts.js. Map mode maps each button to a pad.
      el('div', { className: 'fld', title: 'Hold to push the playing clip ahead or hold it back (like a DJ nudge), to bring it back in time. Keys: , and . (Shift: harder); [ and ] trim the speed.' },
        el('label', { textContent: 'Nudge' }),
        nudgeButton('◀ Slower', sel.l, sel.c, -1, { dataset: { midi: 'clip:' + sel.l + ':' + sel.c + ':nudge-' } }),
        nudgeButton('Faster ▶', sel.l, sel.c, 1, { dataset: { midi: 'clip:' + sel.l + ':' + sel.c + ':nudge+' } }),
        el('button', { textContent: '−', title: 'Speed -0.01x (kept)', dataset: { midi: 'clip:' + sel.l + ':' + sel.c + ':speed-' }, onclick: () => clipSpeedStep(c, -0.01) }),
        el('button', { textContent: '+', title: 'Speed +0.01x (kept)', dataset: { midi: 'clip:' + sel.l + ':' + sel.c + ':speed+' }, onclick: () => clipSpeedStep(c, 0.01) })),
        ...videoClipOpts(c, L));
    } else if (c.type === 'image') p.append(el('div', { className: 'hint', textContent: `${c.fileName}  -  ${c.w} x ${c.h}` }));
    else if (c.type === 'gen') {
      const d = DEFS.gen.get(c.gen);
      if (!d) p.append(el('div', { className: 'hint', textContent: 'Generator "' + c.gen + '" is not available.' }));
      else d.params.forEach((pd, k) => { const f = fld(pd.name, 0, 1, 0.001, () => c.params[k] ?? pd.def, v => { c.params[k] = v; }); f.slider.dataset.midi = 'gen:' + c.uid + ':' + k; f.slider.title = 'Double-click to reset'; f.slider.addEventListener('dblclick', () => paramReset(c, k, pd.def)); p.append(...lfoControls(c, k, f)); });
    }
    if (!c.missing) p.append(clipLookUI(c), chainUI(c.fx || (c.fx = []), 'Effects on this clip'));   // clipopts.js
  }
}

// ---------- browser ----------
function firstFree(li) { const i = comp.layers[li].clips.findIndex(c => !c); return i; }
function renderBrowser() {
  const b = $('browser'), fa = document.activeElement;
  const caret = fa && fa.classList.contains('src-filter') && b.contains(fa) ? fa.selectionStart : -1;   // the Sources filter keeps focus through a rebuild
  b.textContent = '';
  b.append(tabs([['files', 'Files'], ['fx', 'Effects'], ['src', 'Sources'], ['cam', 'Camera']], browserTab, t => { browserTab = t; ui.browserDirty = true; }));
  const list = el('div', { className: 'list' });
  if (browserTab === 'files') {
    b.append(el('div', { className: 'fld' }, el('button', { textContent: 'Add media...', onclick: addMediaPicker }),
      canPickFolder ? el('button', { textContent: mediaFolder.handle ? 'Change folder...' : 'Media folder...', title: 'Pick a folder once; clips relink from it on every start', onclick: pickMediaFolder }) : null));
    if (mediaFolder.handle) {
      const st = mediaFolder.state, nm = mediaFolder.handle.name;
      b.append(el('div', { className: 'fld' }, el('span', { className: 'hint', style: { flex: '1' }, textContent: st === 'scanning' ? `Reading "${nm}"...` : st === 'needs-permission' ? `"${nm}" needs permission again` : st === 'error' ? `"${nm}" could not be read` : `Folder "${nm}": ${mediaFolder.count} file(s)` }),
        st === 'needs-permission' ? el('button', { className: 'on', textContent: 'Reconnect', onclick: reconnectMediaFolder }) : el('button', { textContent: 'Rescan', onclick: loadMediaFolder }),
        el('button', { textContent: 'Forget', title: 'Stop remembering this folder', onclick: forgetMediaFolder })));
    }
    if (looseFiles.handles.length) {
      const pend = looseFiles.pending.length;
      b.append(el('div', { className: 'fld' }, el('span', { className: 'hint', style: { flex: '1' }, textContent: pend ? `${pend} remembered file(s) need permission again` : `${looseFiles.handles.length} added file(s) remembered for next start` }),
        pend ? el('button', { className: 'on', textContent: 'Reconnect', onclick: reconnectMediaFolder }) : null,
        el('button', { textContent: 'Forget', title: 'Stop reloading the files you added one by one', onclick: forgetLooseFiles })));
    } else if (media.length && !mediaFolder.handle && !canKeepFiles) b.append(el('div', { className: 'hint', textContent: 'This browser cannot remember added files: they are gone after a refresh. Use Chrome or Edge, or pick a Media folder.' }));
    { const row = typeof rbRow === 'function' && rbRow(); if (row) b.append(row); }   // a remembered rekordbox stick
    { const row = premiumRow(); if (row) b.append(row); }
    b.append(el('div', { className: 'hint', textContent: 'Or drag video files from your file manager onto a clip slot. Drag a file below onto a slot, or double-click it.' }));
    const missing = new Set(missingNames());
    if (missing.size) b.append(el('div', { className: 'fld' }, el('span', { className: 'hint', style: { flex: '1', color: 'var(--bad)' }, textContent: missing.size + ' clip file(s) missing' }),
      el('button', { className: 'on', textContent: 'Find missing files...', title: 'Pick the missing files (several at once): they relink by name and are remembered for next start', onclick: findMissingFiles }),
      canPickFolder ? el('button', { textContent: 'Search a folder...', title: 'Look through a folder and its subfolders for the missing files. Renamed files are recognised too.', onclick: wsFindInFolder }) : null));
    missing.forEach(n => list.append(el('div', { className: 'miss', textContent: 'Missing: ' + n, title: 'Add this file again to relink it' })));
    media.forEach(m => {
      const d = el('div', { textContent: m.name, title: m.name, ondblclick: () => { const ci = sel.c >= 0 && !comp.layers[sel.l].clips[sel.c] ? sel.c : firstFree(sel.l); if (ci >= 0) setClip(sel.l, ci, mediaClip(m)); else setStatus('No free clip slot on the selected layer'); } });
      draggable(d, { kind: 'media', m });
      list.append(d);
    });
    if (!media.length && !missing.size) list.append(el('div', { className: 'hint', textContent: 'No media loaded yet.' }));
  } else if (browserTab === 'fx') {
    b.append(el('div', { className: 'hint', textContent: 'Drag onto a layer, a clip or an effects list. Double-click adds to the selected layer, or to the selected clip while the Clip tab is open.' }));
    for (const d of DEFS.fx.values()) {
      const n = el('div', { textContent: d.name + (d.custom ? (d.isf ? '  (ISF)' : '  (custom)') : ''), ondblclick: () => { const e = mkEffect(d.name), c = propTab === 'clip' && comp.layers[sel.l].clips[sel.c]; if (!e) return; if (c && !c.missing) (c.fx || (c.fx = [])).push(e); else { comp.layers[sel.l].fx.push(e); propTab = 'layer'; } ui.propsDirty = true; } });
      draggable(n, { kind: 'fx', name: d.name });
      list.append(n);
    }
  } else if (browserTab === 'cam') {
    b.append(el('div', { className: 'hint', textContent: 'Live pictures from a webcam or a phone, and the camera and hands as inputs that sliders and effects can follow.' }));
    for (const panel of CAMERA_PANELS) b.append(...panel());
    return;
  } else return renderSources(b, caret);
  b.append(list);
}

// The Sources tab: generated content (generators, text, lower thirds, 3D). Every h4 starts a section that folds;
// the filter box hides rows in place, so typing never rebuilds the tab.
let srcFilter = '';
const srcFold = new Set(JSON.parse(localStorage.getItem('svj-src-fold') || '[]'));
function renderSources(b, caret = -1) {
  const gens = el('div', { className: 'list' });
  for (const d of DEFS.gen.values()) {
    const n = el('div', { textContent: d.name + (d.custom ? (d.isf ? '  (ISF)' : '  (custom)') : ''), title: 'Drag onto a clip slot, or double-click to fill the selected slot', ondblclick: () => { const ci = sel.c >= 0 ? sel.c : firstFree(sel.l); if (ci >= 0) setClip(sel.l, ci, genClip(d.name)); } });
    draggable(n, { kind: 'gen', name: d.name });
    gens.append(n);
  }
  const parts = [el('h4', { textContent: 'Generators' }), gens];
  for (const panel of SOURCE_PANELS) parts.push(...panel());
  // group into sections: an h4 and everything up to the next one
  const secs = [];
  for (const p of parts) {
    if (p.tagName === 'H4' || !secs.length) secs.push({ name: p.tagName === 'H4' ? p.textContent : '', head: p.tagName === 'H4' ? p : null, body: [] });
    if (p.tagName !== 'H4') secs[secs.length - 1].body.push(p);
  }
  const rows = sec => sec.body.flatMap(n => n.classList.contains('list') ? [...n.children] : []).filter(r => !r.classList.contains('hint'));
  const boxes = secs.map(sec => {
    const n = rows(sec).length, folded = () => srcFold.has(sec.name);
    const count = el('span', { className: 'src-count', textContent: n ? String(n) : '' });
    const head = el('h4', { className: 'src-head', tabIndex: 0, role: 'button', title: 'Show or hide this section' },
      el('span', { className: 'src-caret' }), el('span', { style: { flex: '1' }, textContent: sec.name }), count);
    const body = el('div', { className: 'src-body' }, ...sec.body);
    const box = el('section', { className: 'src-sec' + (folded() ? ' folded' : '') }, head, body);
    const toggle = () => {
      if (srcFilter) return;   // everything that matches is shown while filtering
      if (folded()) srcFold.delete(sec.name); else srcFold.add(sec.name);
      localStorage.setItem('svj-src-fold', JSON.stringify([...srcFold]));
      box.classList.toggle('folded', folded());
    };
    head.onclick = toggle;
    head.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    return { box, rows: rows(sec), count, n };
  });
  const none = el('div', { className: 'hint', textContent: 'Nothing matches.', style: { display: 'none' } });
  const apply = () => {
    const q = srcFilter.trim().toLowerCase();
    let any = false;
    for (const s of boxes) {
      let shown = 0;
      for (const r of s.rows) { const hit = !q || r.textContent.toLowerCase().includes(q); r.style.display = hit ? '' : 'none'; if (hit) shown++; }
      s.box.style.display = q && !shown ? 'none' : '';
      s.box.classList.toggle('filtering', !!q);
      s.count.textContent = !s.n ? '' : q ? shown + ' / ' + s.n : String(s.n);
      if (!q || shown) any = true;
    }
    none.style.display = any ? 'none' : '';
  };
  const filter = el('input', { type: 'search', className: 'src-filter', placeholder: 'Filter sources', value: srcFilter, spellcheck: false,
    oninput: e => { srcFilter = e.target.value; apply(); }, onkeydown: e => { if (e.key === 'Escape' && srcFilter) { e.stopPropagation(); srcFilter = e.target.value = ''; apply(); } } });
  b.append(el('div', { className: 'fld' }, filter),
    el('div', { className: 'hint', textContent: 'Drag onto a clip slot, or double-click to fill the selected slot. Click a heading to fold it.' }),
    ...boxes.map(s => s.box), none);
  apply();
  if (caret >= 0) { filter.focus(); filter.setSelectionRange(caret, caret); }
}

// ---------- advanced output ----------
const outUI = { screen: 0, slice: 0, tab: 'out', drag: null, rect: null, prev: document.createElement('canvas') };
outUI.prev.width = 640; outUI.prev.height = 360;
function renderOutPanels() {
  outUI.screen = Math.min(screens.length - 1, Math.max(0, outUI.screen));
  const scr = screens[outUI.screen];
  outUI.slice = Math.min(scr.slices.length - 1, Math.max(0, outUI.slice));
  const redo = () => renderOutPanels();
  const L = $('outLists');
  L.textContent = '';
  L.append(el('h4', { textContent: 'Screens' }));
  screens.forEach((s, i) => L.append(el('div', { className: 'sel-item' + (i === outUI.screen ? ' on' : ''), textContent: s.name + (s.win && !s.win.closed ? '  [live]' : ''), onclick: () => { outUI.screen = i; outUI.slice = 0; redo(); } })));
  L.append(el('div', { className: 'fld' }, el('button', { textContent: '+ Screen', onclick: () => { if (!entGate('mapping')) return; screens.push({ name: 'Screen ' + (screens.length + 1), win: null, ctx: null, slices: [newSlice('Slice 1')] }); outUI.screen = screens.length - 1; redo(); } }),
    el('button', { textContent: '- Screen', onclick: () => { if (screens.length > 1) { closeOutput(outUI.screen); screens.splice(outUI.screen, 1); redo(); } } })));
  L.append(el('h4', { textContent: 'Slices and masks' }));
  scr.slices.forEach((sl, i) => L.append(el('div', { className: 'sel-item' + (i === outUI.slice ? ' on' : ''), onclick: () => { outUI.slice = i; redo(); } },
    el('input', { type: 'checkbox', checked: sl.enabled, onclick: e => e.stopPropagation(), onchange: e => { sl.enabled = e.target.checked; } }), sl.name + (sl.mask ? '  (mask)' : ''))));
  const swap = d => { const i = outUI.slice, j = i + d; if (j >= 0 && j < scr.slices.length) { [scr.slices[i], scr.slices[j]] = [scr.slices[j], scr.slices[i]]; outUI.slice = j; redo(); } };
  L.append(el('div', { className: 'fld' }, el('button', { textContent: '+ Slice', onclick: () => { if (!entGate('mapping')) return; scr.slices.push(newSlice('Slice ' + (scr.slices.length + 1))); outUI.slice = scr.slices.length - 1; redo(); } }),
    el('button', { textContent: '+ Mask', onclick: () => { if (!entGate('mapping')) return; scr.slices.push(newSlice('Mask ' + (scr.slices.length + 1), true)); outUI.slice = scr.slices.length - 1; redo(); } })),
    el('div', { className: 'fld' }, el('button', { textContent: 'Remove', onclick: () => { scr.slices.splice(outUI.slice, 1); redo(); } }),
      el('button', { textContent: 'To front', onclick: () => swap(1) }), el('button', { textContent: 'To back', onclick: () => swap(-1) })),
    el('div', { className: 'hint', textContent: 'Later items draw on top.' }));
  L.append(...displaysList());

  const P = $('outProps');
  P.textContent = '';
  const live = !!((scr.win && !scr.win.closed) || scr.ndiSend || scr.vdoSend), isNdi = scr.device === 'ndi', isVdo = scr.device === 'vdo';
  P.append(el('h4', { textContent: 'Screen' }),
    el('div', { className: 'fld' }, el('label', { textContent: 'Name' }), el('input', { type: 'text', value: scr.name, onchange: e => { scr.name = e.target.value || scr.name; redo(); } })),
    ...displayPanel(scr, outUI.screen),
    el('button', { textContent: isNdi ? (live ? 'Stop NDI' : 'Start NDI') : isVdo ? (live ? 'Stop web link' : 'Start web link') : live ? 'Close output' : 'Open output', className: live ? 'on' : '', style: { width: '100%' }, onclick: () => { if (live) closeOutput(outUI.screen); else openOnDisplay(outUI.screen, displayFor(outUI.screen)); syncOutBtn(); redo(); } }));
  if (isNdi && typeof ndiNetSection === 'function') P.append(...ndiNetSection());   // ndi.js: firewall, addresses, adapter / Discovery Server
  const sl = scr.slices[outUI.slice];
  if (!sl) return;
  P.append(el('h4', { textContent: sl.mask ? 'Mask' : 'Slice' }),
    el('div', { className: 'fld' }, el('label', { textContent: 'Name' }), el('input', { type: 'text', value: sl.name, onchange: e => { sl.name = e.target.value || sl.name; redo(); } })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Mask (black)' }), el('input', { type: 'checkbox', checked: sl.mask, onchange: e => { if (e.target.checked && !entGate('mapping')) { e.target.checked = false; return; } sl.mask = e.target.checked; redo(); } })));
  if (!sl.mask) P.append(
    el('div', { className: 'fld' }, el('label', { textContent: 'Flip' }), el('label', null, el('input', { type: 'checkbox', checked: sl.flipH, onchange: e => { sl.flipH = e.target.checked; } }), ' H'),
      el('label', null, el('input', { type: 'checkbox', checked: sl.flipV, onchange: e => { sl.flipV = e.target.checked; } }), ' V')),
    fld('Brightness', 0, 1, 0.001, () => sl.bright, v => { sl.bright = v; }));
  P.append(fld('Warp grid', 0, 6, 1, () => sl.grid, v => { if (v > sl.grid && !entGate('mapping')) { redo(); return; } setGrid(sl, v); }, v => (v ? v + ' x ' + v : 'Off')),
    fld('Soft edge', 0, 0.5, 0.001, () => sl.feather, v => { if (v > sl.feather && !entGate('mapping')) { redo(); return; } sl.feather = v; }, v => v.toFixed(3)),
    el('div', { className: 'fld' }, el('button', { textContent: 'Reset warp', onclick: () => { sl.c = sl.mask ? [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]] : [[0, 0], [1, 0], [1, 1], [0, 1]]; setGrid(sl, sl.grid); } }),
      el('button', { textContent: 'Reset input', onclick: () => { sl.in = [0, 0, 1, 1]; } })),
    el('div', { className: 'hint', textContent: 'Orange handles: corners. Blue: move. Green: warp points.' }));
}
function outHandles() {
  const scr = screens[outUI.screen], sl = scr && scr.slices[outUI.slice], hs = [];
  if (!sl) return hs;
  if (outUI.tab === 'in') {
    if (sl.mask) return hs;
    const [x, y, w, h] = sl.in;
    hs.push({ x: x + w / 2, y: y + h / 2, col: '#ffffff', move: (dx, dy) => { sl.in[0] += dx; sl.in[1] += dy; } },
      { x, y, col: THEME.acc, move: (dx, dy) => { sl.in[0] += dx; sl.in[1] += dy; sl.in[2] = Math.max(0.01, sl.in[2] - dx); sl.in[3] = Math.max(0.01, sl.in[3] - dy); } },
      { x: x + w, y: y + h, col: THEME.acc, move: (dx, dy) => { sl.in[2] = Math.max(0.01, sl.in[2] + dx); sl.in[3] = Math.max(0.01, sl.in[3] + dy); } });
    return hs;
  }
  hs.push({ x: (sl.c[0][0] + sl.c[1][0] + sl.c[2][0] + sl.c[3][0]) / 4, y: (sl.c[0][1] + sl.c[1][1] + sl.c[2][1] + sl.c[3][1]) / 4, col: '#ffffff', move: (dx, dy) => sl.c.forEach(q => { q[0] += dx; q[1] += dy; }) });
  const n = sl.grid;
  for (let j = 0; j <= n && n > 0; j++) for (let i = 0; i <= n; i++) {
    if ((i === 0 || i === n) && (j === 0 || j === n)) continue;
    const [x, y] = slicePoint(sl, i / n, j / n), idx = (j * (n + 1) + i) * 2;
    hs.push({ x, y, col: '#2ea44f', small: true, move: (dx, dy) => { sl.warp[idx] += dx; sl.warp[idx + 1] += dy; } });
  }
  sl.c.forEach(q => hs.push({ x: q[0], y: q[1], col: THEME.acc, move: (dx, dy) => { q[0] += dx; q[1] += dy; } }));
  return hs;
}
function drawOutCanvas() {
  const cv = $('outCanvas'), dpr = window.devicePixelRatio || 1;
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const scr = screens[outUI.screen], x = cv.getContext('2d');
  const live = scr.win && !scr.win.closed && scr.ctx;
  const aspect = outUI.tab === 'in' ? comp.w / comp.h : live ? scr.ctx.canvas.width / scr.ctx.canvas.height : 16 / 9;
  const pw = 640, ph = Math.max(16, Math.round(640 / aspect));
  if (outUI.prev.width !== pw || outUI.prev.height !== ph) { outUI.prev.width = pw; outUI.prev.height = ph; }
  if (outUI.tab === 'in') present(comp.outTex, pw, ph); else renderScreen(scr, pw, ph);
  grab(outUI.prev.getContext('2d'), pw, ph);
  const m = 26 * dpr;
  let w = W - m * 2, h = w / aspect;
  if (h > H - m * 2) { h = H - m * 2; w = h * aspect; }
  const ox = (W - w) / 2, oy = (H - h) / 2;
  outUI.rect = { ox: ox / dpr, oy: oy / dpr, w: w / dpr, h: h / dpr };
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  x.drawImage(outUI.prev, ox, oy, w, h);
  x.strokeStyle = '#333'; x.lineWidth = 1; x.strokeRect(ox + 0.5, oy + 0.5, w, h);
  const px = (u, v) => [ox + u * w, oy + v * h];
  scr.slices.forEach((sl, i) => {
    const on = i === outUI.slice;
    x.strokeStyle = on ? THEME.acc : 'rgba(136,136,136,.7)'; x.lineWidth = (on ? 2 : 1) * dpr; x.fillStyle = x.strokeStyle;
    x.beginPath();
    let lab;
    if (outUI.tab === 'in') { if (sl.mask) return; const [a, b] = px(sl.in[0], sl.in[1]); x.rect(a, b, sl.in[2] * w, sl.in[3] * h); lab = [a, b]; }
    else { sl.c.forEach((q, k) => { const [a, b] = px(q[0], q[1]); if (k) x.lineTo(a, b); else { x.moveTo(a, b); lab = [a, b]; } }); x.closePath(); }
    x.stroke();
    x.font = 11 * dpr + 'px Inter, system-ui, sans-serif'; x.fillText(sl.name, lab[0] + 5 * dpr, lab[1] + 13 * dpr);
  });
  for (const hd of outHandles()) {
    const [a, b] = px(hd.x, hd.y);
    x.beginPath(); x.arc(a, b, (hd.small ? 4.5 : 6) * dpr, 0, 6.2832); x.fillStyle = hd.col; x.fill(); x.strokeStyle = '#000'; x.lineWidth = dpr; x.stroke();
  }
}
function initOutput() {
  const cv = $('outCanvas');
  const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    const R = outUI.rect;
    if (!R) return;
    const [mx, my] = at(e);
    let best = -1, bd = 14;
    outHandles().forEach((hd, i) => { const d = Math.hypot(R.ox + hd.x * R.w - mx, R.oy + hd.y * R.h - my); if (d <= bd) { bd = d; best = i; } });
    if (best >= 0) { outUI.drag = { i: best, x: mx, y: my }; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', e => {
    const d = outUI.drag, R = outUI.rect;
    if (!d || !R) return;
    const [mx, my] = at(e), hd = outHandles()[d.i];
    if (hd) hd.move((mx - d.x) / R.w, (my - d.y) / R.h);
    d.x = mx; d.y = my;
  });
  const end = () => { outUI.drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const setTab = t => { outUI.tab = t; $('outTabIn').classList.toggle('on', t === 'in'); $('outTabOut').classList.toggle('on', t === 'out'); renderOutPanels(); };
  $('outTabIn').onclick = () => setTab('in'); $('outTabOut').onclick = () => setTab('out');
  $('testPat').onchange = e => { out.testPattern = e.target.checked; };
}

// ---------- shader editor ----------
const shUI = { cur: -1, timer: 0 };
function refsTo(name, fn) {
  comp.fx.forEach(e => { if (e.def === name) fn(e, 'fx'); });
  comp.layers.forEach(L => { L.fx.forEach(e => { if (e.def === name) fn(e, 'fx'); }); L.clips.forEach(c => { if (c && c.type === 'gen' && c.gen === name) fn(c, 'gen'); if (c && c.fx) c.fx.forEach(e => { if (e.def === name) fn(e, 'fx'); }); }); });
}
function compileCustom(s) {
  let d, err = '';
  try { d = applyCustom(s); err = d.err || ''; } catch (e) { err = String(e.message || e); }
  if (d) refsTo(s.name, r => { while (r.params.length < d.params.length) r.params.push(d.params[r.params.length].def); if (r.type === 'gen') r.needThumb = true; });
  const box = $('shErr');
  box.textContent = err ? err : 'Compiled OK' + (s.isf ? ' (ISF ' + (s.kind === 'fx' ? 'effect' : 'generator') + ')' : '');
  box.className = err ? '' : 'ok';
  ui.propsDirty = ui.browserDirty = true;
  return !err;
}
function uniqueName(base) { let n = base, i = 2; while (DEFS.fx.has(n) || DEFS.gen.has(n)) n = base + ' ' + i++; return n; }
function addCustom(kind, name, code) {
  const s = { name: uniqueName(name), kind, code };
  customShaders.push(s);
  shUI.cur = customShaders.length - 1;
  renderShaderEditor();
  compileCustom(s);
  renderShaderEditor();
  return s;
}
function renderShaderEditor() {
  const L = $('shList');
  L.textContent = '';
  L.append(el('div', { className: 'fld' }, el('button', { textContent: '+ Effect', onclick: () => addCustom('fx', 'My Effect', TEMPLATE_FX) }), el('button', { textContent: '+ Generator', onclick: () => addCustom('gen', 'My Generator', TEMPLATE_GEN) })),
    el('div', { className: 'fld' }, el('button', { textContent: 'Load shader file...', title: 'ISF (.fs) or GLSL snippet', onclick: () => $('shaderInput').click() })),
    el('h4', { textContent: 'Custom shaders' }));
  customShaders.forEach((s, i) => L.append(el('div', { className: 'sel-item' + (i === shUI.cur ? ' on' : ''), textContent: s.name + (s.kind === 'fx' ? '  - effect' : '  - generator'), onclick: () => { shUI.cur = i; renderShaderEditor(); compileCustom(customShaders[i]); } })));
  if (!customShaders.length) L.append(el('div', { className: 'hint', textContent: 'None yet. Create one, or load an ISF file.' }));
  const s = customShaders[shUI.cur];
  $('shName').value = s ? s.name : ''; $('shName').disabled = !s;
  $('shCode').value = s ? s.code : ''; $('shCode').disabled = !s;
  if (!s) { $('shErr').textContent = ''; return; }
  L.append(el('div', { className: 'fld' }, el('button', { textContent: 'Delete selected', onclick: () => {
    DEFS[s.kind].delete(s.name); customShaders.splice(shUI.cur, 1); shUI.cur = Math.min(shUI.cur, customShaders.length - 1);
    ui.propsDirty = ui.browserDirty = true; renderShaderEditor();
  } })));
}
function initShaderEditor() {
  $('shCode').addEventListener('input', () => {
    const s = customShaders[shUI.cur];
    if (!s) return;
    s.code = $('shCode').value;
    clearTimeout(shUI.timer);
    shUI.timer = setTimeout(() => compileCustom(s), 200);
  });
  $('shCode').addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); } });
  $('shName').addEventListener('change', () => {
    const s = customShaders[shUI.cur], n = $('shName').value.trim();
    if (!s || !n || n === s.name) return;
    const nn = uniqueName(n), old = s.name;
    DEFS[s.kind].delete(old);
    refsTo(old, (r, t) => { if (t === 'fx') r.def = nn; else { r.gen = nn; if (r.name === old) r.name = nn; } });
    s.name = nn;
    compileCustom(s); renderShaderEditor(); ui.gridDirty = true;
  });
  $('shaderInput').addEventListener('change', async e => {
    for (const f of e.target.files) {
      const code = await f.text(), base = f.name.replace(/\.[^.]+$/, '');
      addCustom(/\bvec4\s+gen\s*\(/.test(code) ? 'gen' : 'fx', base, code);
    }
    e.target.value = '';
  });
}

// ---------- menu, transport, persistence ----------
// keeps the header Output button in step with the output windows (they can be closed from outside the app)
// ---------- Broadcast (header button) ----------
// The web link and NDI are screen devices, which hid them inside Advanced Output > Display. The Broadcast button
// gives each its own screen (made on first use, so the display output is left alone) and opens Advanced Output on
// it, where the link, the settings and Start are. A broadcast screen is not "advanced mapping": making one is free.
const BC_KINDS = { vdo: { name: 'Web link', menu: 'Web link (internet)', hint: 'Anyone with the link can watch in a browser' },
  ndi: { name: 'NDI', menu: 'NDI (network)', hint: 'For OBS, vMix and other NDI receivers on this network' } };
let bcMenuEl = null;
function closeBroadcastMenu() { if (bcMenuEl) { bcMenuEl.remove(); bcMenuEl = null; $('bcBtn').setAttribute('aria-expanded', 'false'); } }
function openBroadcast(kind) {
  closeBroadcastMenu();
  if (kind === 'ndi' && !ndi.api) { setStatus('NDI output needs the desktop app (and the NDI Runtime installed)'); return; }
  let i = screens.findIndex(s => screenDevice(s) === kind);
  if (i < 0) { screens.push({ name: BC_KINDS[kind].name, device: kind, win: null, ctx: null, slices: [newSlice('Slice 1')] }); i = screens.length - 1; }
  outUI.screen = i; outUI.slice = 0;
  $('outModal').hidden = false;
  renderOutPanels();
  const s = screens[i], live = kind === 'vdo' ? s.vdoSend : s.ndiSend;
  setStatus(live ? BC_KINDS[kind].name + ' is live' : 'Press Start ' + (kind === 'vdo' ? 'web link' : 'NDI') + ' to go live. ' + BC_KINDS[kind].hint + '.');
}
function toggleBroadcastMenu() {
  if (bcMenuEl) return closeBroadcastMenu();
  const b = $('bcBtn'), r = b.getBoundingClientRect();
  const item = kind => {
    const s = screens.find(x => screenDevice(x) === kind), live = s && (kind === 'vdo' ? s.vdoSend : s.ndiSend), off = kind === 'ndi' && !ndi.api;
    return el('button', { role: 'menuitem', disabled: off, onclick: () => openBroadcast(kind),
      style: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: '0', background: 'none', height: 'auto', opacity: off ? '.5' : '1' } },
      el('div', { textContent: BC_KINDS[kind].menu + (live ? '  [live]' : '') }),
      el('div', { textContent: off ? 'Desktop app only' : BC_KINDS[kind].hint, style: { color: 'var(--dim)', fontSize: '12px' } }));
  };
  bcMenuEl = el('div', { role: 'menu', style: { position: 'fixed', left: Math.max(8, Math.min(r.left, innerWidth - 276)) + 'px', top: r.bottom + 4 + 'px', zIndex: '20', width: '268px', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '4px', boxShadow: '0 12px 40px rgba(0,0,0,.7)' } },
    item('vdo'), item('ndi'),
    // remote control (Festival): the host's side is in Strodano VJ Pro; without it this opens the upgrade prompt
    el('button', { role: 'menuitem', onclick: () => { closeBroadcastMenu(); if (typeof remoteHostUI === 'function') remoteHostUI(); else proGate('remote'); },
      style: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: '0', background: 'none', height: 'auto' } },
      el('div', { textContent: 'Remote control (phone)' }),
      el('div', { textContent: 'Play this show from your phone. Festival', style: { color: 'var(--dim)', fontSize: '12px' } })));
  document.body.append(bcMenuEl);
  b.setAttribute('aria-expanded', 'true');
}
document.addEventListener('pointerdown', e => { if (bcMenuEl && !bcMenuEl.contains(e.target) && !e.target.closest('#bcBtn')) closeBroadcastMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && bcMenuEl) closeBroadcastMenu(); });

function syncOutBtn() {
  const bc = $('bcBtn'), bcOn = ndiLive().length + vdoLive().length > 0;
  if (bc && bc.classList.contains('on') !== bcOn) bc.classList.toggle('on', bcOn);
  const b = $('outBtn'), on = liveScreens().length + ndiLive().length + vdoLive().length > 0;
  if (!b) return;
  if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  const where = on ? outputWhere() : '', t = 'Output' + (where ? ' > ' + where : '');
  if (b.lastChild.textContent !== t) b.lastChild.textContent = t;
}
let menuAct = () => {};   // run a menu action by name from another module (the Project menu, workspace.js)
function initMenu() {
  const acts = {
    new: () => { stockComp(); sel.l = 0; sel.c = -1; ws.cloud = { id: '', name: '' }; pjDetach(); },   // the starter show in this tab, no longer its old file
    open: () => pjOpen(),          // projects.js: a project file, in a new tab
    save: () => pjSave(false),     // over the tab's own file (asks where the first time)
    saveAs: () => pjSave(true),
    media: addMediaPicker,
    addLayer: () => { addLayer(); sel.l = comp.layers.length - 1; sel.c = -1; ui.propsDirty = true; },
    addCol: () => setColumns(comp.columns + 1), delCol: () => setColumns(comp.columns - 1),
    output: () => { $('outModal').hidden = false; renderOutPanels(); },
    shaders: () => { $('shModal').hidden = false; renderShaderEditor(); },
    midi: () => setMidiLearn(!midi.learn),
    dj: () => { if (typeof toggleDJ === 'function') toggleDJ(!djUI.open); else proGate('dj'); },
    agent: () => { if (typeof toggleDJ === 'function') toggleDJ(!djUI.open); else proGate('agent'); },   // one DJ panel since 2026-11-25
    settings: () => toggleKeysHelp(undefined, 'prefs'),
    fullscreen: () => appFullscreen(),
    // header Output button: open every screen's output (not the web link: only its own Start puts it on the internet), or close them all when any is live
    outWin: () => { if (liveScreens().length || ndiLive().length || vdoLive().length) screens.forEach((s, i) => closeOutput(i)); else { const t = displayTargets(); screens.forEach((s, i) => { if (screenDevice(s) !== 'vdo') openOnDisplay(i, t[i]); }); } syncOutBtn(); ui.propsDirty = true; },
  };
  menuAct = a => { if (acts[a]) acts[a](); };
  const onAct = e => { const b = e.target.closest && e.target.closest('[data-act]'), a = b && b.dataset.act; if (a && acts[a]) acts[a](); };
  $('menubar').addEventListener('click', onAct); $('sidebar').addEventListener('click', onAct);
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { $(b.dataset.close).hidden = true; }));
  $('resSel').addEventListener('change', e => { const [w, h] = e.target.value.split('x').map(Number); resizeComp(w, h); ui.propsDirty = true; });
  $('mediaInput').addEventListener('change', e => { onMediaFiles(e.target.files); e.target.value = ''; });
  $('compInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';
    pjOpenFile(f, null);   // projects.js: in a new tab (this input is the fallback for browsers without the file picker API)
  });
  // Files dropped anywhere outside a clip slot go to the media pool (and relink missing clips).
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => { if (hasFiles(e)) { e.preventDefault(); rememberDropped(e.dataTransfer); const a = addMediaFiles(e.dataTransfer.files); if (a.length) { browserTab = 'files'; setStatus(a.length + ' file(s) added to Files'); } } });
}
// Add media: new files fill free slots on the selected layer; files that match saved clips just relink them.
function onMediaFiles(files) {
  const added = addMediaFiles(files);
  const fresh = added.filter(m => !comp.layers.some(L => L.clips.some(c => c && c.fileName === m.name)));
  if (fresh.length) putMedia(fresh, sel.l, 0, true);
  browserTab = 'files'; ui.browserDirty = true;
}
const addMediaPicker = () => pickFiles('media', 'mediaInput', onMediaFiles);
function syncTransport() {
  $('bpm').value = comp.bpm.toFixed(1); $('xf').value = comp.crossfade;
  const r = comp.w + 'x' + comp.h, s = $('resSel');
  if (![...s.options].some(o => o.value === r)) s.append(el('option', { textContent: r }));
  s.value = r;
}
function initTransport() {
  const taps = [];
  $('bpm').addEventListener('change', e => { comp.bpm = Math.min(300, Math.max(20, +e.target.value || 120)); syncTransport(); });
  $('tap').addEventListener('click', () => {
    const now = performance.now() / 1000;
    if (taps.length && now - taps[taps.length - 1] > 2) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) { const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); if (avg > 0.15) comp.bpm = Math.min(300, Math.max(20, 60 / avg)); }
    comp.beats = Math.round(comp.beats); syncTransport();
  });
  $('resync').addEventListener('click', () => { comp.beats = 0; });
  $('xf').addEventListener('input', e => { comp.crossfade = +e.target.value; });
}

// ---------- main loop ----------
let lastT = performance.now(), lastFrameAt = 0, fpsN = 0, fpsT = lastT, costSum = 0, loopWin = null;
const monOut = $('monOut').getContext('2d'), monPrev = $('monPrev').getContext('2d');
// Frames come from requestAnimationFrame, but Chromium gives a window that Windows sees as covered (OBS or anything else
// in front of it) about one animation frame per second, background throttling off or not (measured 2026-11-20: page
// visible, timers at full rate, rAF 1.3/s). With the control window behind OBS that dropped NDI to 1-3 fps, a picture up to
// a second old. So while something is live (output window, NDI, web link) and animation frames stop coming, a timer runs
// the frames (below schedule()), without the control-window monitors (nobody sees them then). Rendering is capped at RENDER_FPS:
// a 144 / 165 Hz control display would otherwise render the show 2-3 times as often as any output needs, heating a laptop
// GPU into thermal throttling. A frame is due at the display frame NEAREST its time (half a display frame of slack).
const RENDER_FPS = 60;
let rafLast = 0, rafDt = 0, renderDue = 0;
function frame(fromTimer) {
  const t0 = performance.now(), per = 1000 / RENDER_FPS;
  if (t0 < renderDue - Math.min(per, rafDt || per) / 2) { schedule(); return; }
  renderDue = t0 - renderDue > per * 3 ? t0 + per : renderDue + per;
  const realDt = Math.max(0, (t0 - lastT) / 1000), dt = Math.min(realDt, 0.1);
  lastT = t0; lastFrameAt = t0;
  try {
    coreTick(t0, dt, realDt);   // core.js: music, inputs, clock, composition, output windows, NDI, web link
    if (!document.hidden && fromTimer !== true) {
      if (!$('bottom').classList.contains('pmin')) {   // the monitors are not drawn while the bottom row is minimised
        const mw = 480, mh = Math.round(480 * comp.h / comp.w);
        for (const cv of [monOut.canvas, monPrev.canvas]) if (cv.height !== mh) cv.height = mh;
        present(comp.outTex, mw, mh); grab(monOut, mw, mh);
        const L = comp.layers[Math.min(sel.l, comp.layers.length - 1)];
        present(L.outTex, mw, mh); grab(monPrev, mw, mh);
      }
      drawLayerMons();
      if (!$('outModal').hidden) drawOutCanvas();
      tickUI();
    }
  } catch (e) { console.error(e); setStatus('Error: ' + (e.message || e)); }
  fpsN++; costSum += performance.now() - t0;
  if (t0 - fpsT >= 500) {
    const fps = fpsN * 1000 / (t0 - fpsT), el2 = $('fps');
    syncOutBtn();
    el2.textContent = `${liveScreens().length || ndiLive().length || vdoLive().length ? 'OUTPUT LIVE' : 'output closed'}   ${fps.toFixed(0)} fps   ${(costSum / fpsN).toFixed(1)} ms`;
    el2.className = fps < 29 ? 'bad' : '';
    window.__fps = fps; fpsN = 0; costSum = 0; fpsT = t0;
  }
  schedule();
}
// Run the loop from an output window when one is open, so the show keeps its frame rate even if the control window is covered.
// At most one frame request is ever outstanding, so the watchdog below can never start a second loop. It only re-requests when
// the loop has to move to another window (an output window was closed); a request still waiting in the right window is left alone,
// because cancelling it would starve a throttled window that only delivers a frame every second or so.
let rafId = 0;
function schedule() {
  const live = liveScreens()[0], w = live ? live.win : window;
  if (rafId && loopWin === w) return;
  if (rafId && loopWin && !loopWin.closed) { try { loopWin.cancelAnimationFrame(rafId); } catch (e) {} }
  loopWin = w;
  rafId = w.requestAnimationFrame(() => {
    rafId = 0;
    const now = performance.now();
    if (rafLast) { const d = now - rafLast; if (d > 0 && d < 100) rafDt = rafDt ? rafDt * 0.9 + d * 0.1 : d; }
    rafLast = now;
    frame(false);
  });
}
// the timer side of the loop (see above frame()): runs a due frame only while animation frames have stopped coming
setInterval(() => {
  const now = performance.now(), per = 1000 / RENDER_FPS;
  if (now - rafLast < per * 2 || now < renderDue - 1) return;
  if (liveScreens().length || ndiLive().length || vdoLive().length) frame(true);
}, 4);
setInterval(() => { if (performance.now() - lastFrameAt > 600) schedule(); }, 300);

// genThumbFor (generator thumbnails) is in core.js
// A panel is not rebuilt while one of its sliders is held: rebuilding would drop the slider out from under the pointer mid-drag.
let pointerHeld = false;
['pointerdown', 'pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, () => { pointerHeld = t === 'pointerdown'; }, true));
const holding = id => { const a = document.activeElement; return pointerHeld && a && a.type === 'range' && $(id).contains(a); };
function tickUI() {
  outer: for (const L of comp.layers) for (const c of L.clips) {
    if (c && c.needThumb) { genThumbFor(c); break outer; }
    if (c && c.type === '3d' && c.wantThumb && !c.thumb && typeof thumb3d === 'function') { thumb3d(c); break outer; }
  }
  if (ui.gridDirty && !holding('grid')) { ui.gridDirty = false; renderGrid(); }
  if (ui.propsDirty && !holding('props')) { ui.propsDirty = false; renderProps(); }
  tickLfoMeters(); tickCamMeters(); tickHandMeters();
  if (ui.browserDirty) { ui.browserDirty = false; renderBrowser(); }
  if (midi.learn) markMidi();
  comp.layers.forEach((L, li) => (cellEls[li] || []).forEach((cell, ci) => {
    const a = L.active === ci, p = L.pendingCol === ci;
    if (cell.classList.contains('active') !== a) cell.classList.toggle('active', a);
    if (cell.classList.contains('pending') !== p) cell.classList.toggle('pending', p);
    const c = L.clips[ci], bar = cell.querySelector('.prog i');
    if (bar) bar.style.width = a && c && c.video && c.video.duration ? (100 * c.video.currentTime / c.video.duration).toFixed(1) + '%' : '0';
  }));
  const beat = ((Math.floor(comp.beats) % 4) + 4) % 4;
  if (typeof tickDJ === 'function') tickDJ();
  if (typeof tickAgentUI === 'function') tickAgentUI();
  [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === beat));
  if (posSlider && document.activeElement !== posSlider.input && posSlider.clip.video.duration) posSlider.input.value = posSlider.clip.video.currentTime / posSlider.clip.video.duration;   // the clip's player changes at every loop (clipopts.js twinStep)
  $('monPrevT').textContent = 'PREVIEW: ' + comp.layers[Math.min(sel.l, comp.layers.length - 1)].name;
}

// ---------- start ----------
(function start() {
  if (!gl) { document.body.innerHTML = '<p style="padding:30px;font-size:15px">This browser does not support WebGL 2. Use a current version of Chrome or Edge.</p>'; return; }
  initMenu(); initTransport(); initOutput(); initDisplays(); initShaderEditor(); initMidi(); if (typeof initDJ === 'function') initDJ(); if (typeof buildAgentPanel === 'function') buildAgentPanel(); initKeys();
  let restored = false;
  try { const s = localStorage.getItem(AUTOSAVE); if (s) restored = loadComp(JSON.parse(s)); } catch (e) {}
  if (!restored) stockComp(); else stockRelink();   // the STRODANO stock show (stock.js) is the default
  pjInit();   // composition tabs (projects.js): the one restored above is the current tab
  initNdi();
  $('bcBtn').addEventListener('click', toggleBroadcastMenu);
  syncTransport();
  initPremium();   // the premium pack files already on this computer (premium.js)
  initMediaFolder().then(initAudius, initAudius);   // then STRODANO's set from Audius when the track list is empty
  setInterval(autosave, 2000);
  schedule();
})();
// Small hook for automated checks: compile every shader and report failures.
window.strodano = { comp, screens, DEFS, midi, audio, audioFeat, midiIn: onMidiMessage, mediaFolder, checkShaders: () => { const bad = []; for (const k of ['fx', 'gen']) for (const d of DEFS[k].values()) { d.tried = false; if (!defProg(d)) bad.push(d.name + ': ' + d.err); } return bad; } };
