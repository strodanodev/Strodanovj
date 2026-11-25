// Strodano VJ (web) - composition tabs, and saving a project to its own file. GPL-3.0.
// Desktop page only (index.html, before ui.js). Two things live here:
//  1. Tabs (#pjTabs, under the header): several compositions open at once. Only one is in the engine; the others are
//     kept as project JSON (pj.tabs[i].data) and loaded with loadComp when their tab is clicked. What was playing in a
//     tab plays again when you come back to it. The outputs and their mapping (screens) belong to the app, not to a tab:
//     a switch leaves them open. The tab on screen is the usual autosave (core.js, every 2 s); the others are in
//     localStorage PJ_KEY, written when the tabs change. The media pool is shared, so clips relink by file name.
//  2. Files: Save writes over the tab's own .svj (File System Access API: the handle from Open or Save as is kept on
//     the tab, and in IndexedDB 'tabFiles' for the next start, where the browser asks once more before writing).
//     With autosave on (Project menu, on by default) a changed project is written to that file while you work, at most
//     every PJ_EVERY ms. A browser without the API (Safari, Firefox) downloads <tab name>.svj as before.
'use strict';
const PJ_KEY = 'strodano-vj-tabs', PJ_AUTO_KEY = 'strodano-vj-fileauto', PJ_MAX = 12, PJ_EVERY = 10000;
const PJ_TYPES = [{ description: 'Strodano VJ project', accept: { 'application/json': ['.svj'] } }];
const canSaveFile = typeof window.showSaveFilePicker === 'function';
const pj = { tabs: [], cur: 0, auto: localStorage.getItem(PJ_AUTO_KEY) !== '0', busy: false, editing: false, warned: false };
const pjTab = () => pj.tabs[pj.cur];
const pjMk = (name, data = null) => ({ id: Math.random().toString(36).slice(2, 10), name, data, file: null, fileStr: null, fileAt: 0, dirty: false, cloud: { id: '', name: '' }, active: [] });
function pjFreeName() { let n = pj.tabs.length + 1; while (pj.tabs.some(t => t.name === 'Composition ' + n)) n++; return 'Composition ' + n; }

// ---------- remembering the tabs ----------
function pjPersist() {
  try {
    localStorage.setItem(PJ_KEY, JSON.stringify({ cur: pj.cur, tabs: pj.tabs.map((t, i) => ({ id: t.id, name: t.name, cloud: t.cloud, active: t.active, data: i === pj.cur ? null : t.data })) }));
    pj.warned = false;
  } catch (e) {
    if (!pj.warned) { pj.warned = true; setStatus('Could not keep the other composition tabs for the next start (the browser storage is full): save them as files'); }
  }
}
function pjKeepFiles() {
  const m = {};
  for (const t of pj.tabs) if (t.file) m[t.id] = t.file;
  folderStore('put', m, 'tabFiles').catch(() => {});
}
// Called once by ui.js start(), after the autosaved composition is on screen: that one is the current tab.
function pjInit() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(PJ_KEY) || 'null'); } catch (e) {}
  if (s && Array.isArray(s.tabs)) {
    const cur = s.cur | 0;
    s.tabs.slice(0, PJ_MAX).forEach((t, i) => {
      if (!t || typeof t.name !== 'string' || (i !== cur && !(t.data && Array.isArray(t.data.layers)))) return;
      const n = pjMk(t.name.slice(0, 60) || 'Composition', i === cur ? null : t.data);
      if (typeof t.id === 'string' && t.id) n.id = t.id;
      if (t.cloud && typeof t.cloud.id === 'string') n.cloud = { id: t.cloud.id, name: String(t.cloud.name || '') };
      if (Array.isArray(t.active)) n.active = t.active.map(v => v | 0);
      if (i === cur) pj.cur = pj.tabs.length;
      pj.tabs.push(n);
    });
  }
  if (!pj.tabs.length) pj.tabs.push(pjMk('Composition 1'));
  pj.cur = Math.min(pj.cur, pj.tabs.length - 1);
  pjTab().data = null;
  if (typeof ws !== 'undefined') ws.cloud = { ...pjTab().cloud };
  pjDraw();
  folderStore('get', null, 'tabFiles').then(m => { if (m && typeof m === 'object') { for (const t of pj.tabs) if (m[t.id] && !t.file) t.file = m[t.id]; pjDraw(); } }).catch(() => {});
}

// ---------- the tab bar ----------
function pjDraw() {
  const bar = $('pjTabs');
  if (!bar || pj.editing) return;
  bar.textContent = '';
  pj.tabs.forEach((t, i) => {
    const on = i === pj.cur;
    const tab = el('div', { className: 'pjtab' + (on ? ' on' : ''), role: 'tab', tabIndex: 0, ariaSelected: String(on),
      title: t.name + (t.file ? '  -  ' + t.file.name + (t.dirty ? ' (changes not in the file yet)' : '') : '  -  not saved as a file yet') + '. Double-click to rename.',
      onclick: () => pjSwitch(i), ondblclick: e => pjRename(i, e.currentTarget),
      onkeydown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pjSwitch(i); } } },
      el('span', { className: 'pjname', textContent: t.name }),
      t.file ? el('i', { className: 'pjdot' + (t.dirty ? ' dirty' : '') }) : null,
      pj.tabs.length > 1 ? el('button', { className: 'pjx', textContent: '×', title: 'Close this tab (click twice). A tab that is not saved as a file is gone for good.', ariaLabel: 'Close ' + t.name,
        onclick: e => { e.stopPropagation(); armThen(e.currentTarget, 'close "' + t.name + '"', () => pjClose(pj.tabs.indexOf(t))); } }) : null);
    bar.append(tab);
  });
  bar.append(el('button', { className: 'pjadd', textContent: '+', title: 'New composition tab (empty: 3 layers). Project > Open opens a file in a new tab.', ariaLabel: 'New composition tab', onclick: () => pjNew() }));
}
function pjRename(i, tabEl) {
  const t = pj.tabs[i], span = tabEl.querySelector('.pjname');
  if (!t || !span || pj.editing) return;
  pj.editing = true;
  const inp = el('input', { type: 'text', value: t.name, maxLength: 60, className: 'pjedit' });
  const done = keep => {
    if (!pj.editing) return;
    pj.editing = false;
    const n = inp.value.replace(/\s+/g, ' ').trim();
    if (keep && n) t.name = n;
    pjPersist(); pjDraw();
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
  inp.addEventListener('click', e => e.stopPropagation()); inp.addEventListener('dblclick', e => e.stopPropagation());
  span.replaceWith(inp);
  inp.focus(); inp.select();
}

// ---------- switching ----------
// The composition on screen goes into its tab as JSON, with what is playing on each layer.
function pjStash() {
  const t = pjTab();
  t.data = compToJSON();
  t.active = comp.layers.map(L => (L.pendingCol >= 0 ? L.pendingCol : L.active));
  if (typeof ws !== 'undefined') t.cloud = { ...ws.cloud };
}
const pjBlank = () => ({ w: comp.w, h: comp.h, columns: 8, bpm: comp.bpm, layers: [{ name: 'Layer 1' }, { name: 'Layer 2' }, { name: 'Layer 3' }] });
// Put the current tab's stored composition on screen.
function pjShow() {
  const t = pjTab(), j = Object.assign({}, t.data || pjBlank());
  delete j.screens;   // the outputs stay as they are (see the top of this file)
  if (!loadComp(j)) loadComp(pjBlank());
  t.data = null;
  if (typeof ws !== 'undefined') ws.cloud = { ...t.cloud };
  if (typeof stockRelink === 'function') stockRelink();
  if (typeof syncTransport === 'function') syncTransport();
  sel.l = 0; sel.c = -1; ui.gridDirty = ui.propsDirty = ui.browserDirty = true;
  (t.active || []).forEach((ci, li) => { if (ci >= 0 && comp.layers[li]) trigger(li, ci); });   // what was playing plays again
  autosave(); pjPersist(); pjDraw();
}
// Leaving a tab: with autosave on, its last changes go into its file first (pjWrite takes the composition before anything else loads).
function pjFlush() { const t = pjTab(); if (pj.auto && t && t.file && t.dirty) pjWrite(t, false).catch(() => {}); }
function pjSwitch(i) {
  if (i === pj.cur || !pj.tabs[i] || pj.editing) return;
  pjFlush(); pjStash();
  pj.cur = i;
  pjShow();
  setStatus('Composition: ' + pjTab().name);
}
function pjNew(name, data) {
  if (pj.tabs.length >= PJ_MAX) { setStatus('That is the most composition tabs (' + PJ_MAX + '): close one first'); return false; }
  pjFlush(); pjStash();
  pj.tabs.push(pjMk(name || pjFreeName(), data || null));
  pj.cur = pj.tabs.length - 1;
  pjShow();
  if (!data) setStatus('New composition tab: ' + pjTab().name);
  return true;
}
function pjClose(i) {
  if (pj.tabs.length <= 1 || !pj.tabs[i]) return;
  const name = pj.tabs[i].name;
  pj.tabs.splice(i, 1);
  if (i === pj.cur) { pj.cur = Math.min(i, pj.tabs.length - 1); pjShow(); }
  else { if (i < pj.cur) pj.cur--; pjPersist(); pjDraw(); }
  pjKeepFiles();
  setStatus('Closed ' + name);
}
// The current tab now holds another project (New project, a cloud project, a workspace folder): it is no longer the
// file it was saved to, or autosave would write the new project over that file.
function pjDetach(name) {
  const t = pjTab();
  if (!t) return;
  t.file = null; t.fileStr = null; t.dirty = false; t.active = [];
  if (name) t.name = String(name).slice(0, 60);
  if (typeof ws !== 'undefined') t.cloud = { ...ws.cloud };
  pjKeepFiles(); pjPersist(); pjDraw();
}

// ---------- files ----------
// Write the composition on screen to tab t's file. ask = from a click, so the browser may show its permission prompt.
async function pjWrite(t, ask) {
  const j = compToJSON(), h = t.file;   // taken now: the tab can change while the browser is asked
  let p = 'granted';
  try { if (h.queryPermission) p = await h.queryPermission({ mode: 'readwrite' }); } catch (e) { p = 'prompt'; }
  if (p !== 'granted' && ask) { try { p = await h.requestPermission({ mode: 'readwrite' }); } catch (e) { p = 'denied'; } }
  if (p !== 'granted') return false;
  const w = await h.createWritable();
  await w.write(JSON.stringify(j, null, 1));
  await w.close();
  t.fileStr = JSON.stringify(j); t.fileAt = Date.now(); t.dirty = false;
  return true;
}
function pjDownload(t) {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(compToJSON(), null, 1)], { type: 'application/json' })), download: (t.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'composition') + '.svj' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  setStatus('Saved ' + a.download + ' to your downloads (this browser cannot write over a file: Chrome, Edge and the desktop app can)');
}
// Save: over the tab's own file. The first time, or with as = true (Save as), the system dialog asks where.
async function pjSave(as) {
  const t = pjTab();
  if (!canSaveFile) return pjDownload(t);
  if (as || !t.file) {
    let h;
    try { h = await window.showSaveFilePicker({ id: 'strodano-project', suggestedName: (t.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'composition') + '.svj', types: PJ_TYPES }); } catch (e) { return; }   // cancelled
    if (t !== pjTab()) { setStatus('Not saved: the tab changed while the dialog was open'); return; }
    t.file = h; t.name = h.name.replace(/\.svj$/i, '') || t.name;
    pjKeepFiles();
  }
  try {
    const ok = await pjWrite(t, true);
    setStatus(ok ? 'Saved ' + t.file.name + (pj.auto ? '. Autosave is on: your changes are written to this file as you work.' : '') : 'Not saved: the browser was not allowed to write ' + t.file.name);
  } catch (e) { setStatus('Could not save ' + t.file.name + ': ' + (e && e.message || e)); }
  pjPersist(); pjDraw();
}
// Called by core.js autosave() every 2 s with the project as JSON text.
function pjAutosave(s) {
  const t = pjTab();
  if (!t || !t.file) return;
  const dirty = s !== t.fileStr;
  if (dirty !== t.dirty) { t.dirty = dirty; pjDraw(); }
  if (!dirty || !pj.auto || pj.busy || Date.now() - t.fileAt < PJ_EVERY) return;
  pj.busy = true;
  t.fileAt = Date.now();   // also spaces out the tries when the browser wants to be asked again (after a restart: press Save once)
  pjWrite(t, false).then(ok => { if (ok) pjDraw(); }, () => {}).then(() => { pj.busy = false; });
}
function pjSetAuto(on) {
  pj.auto = !!on;
  try { localStorage.setItem(PJ_AUTO_KEY, pj.auto ? '1' : '0'); } catch (e) {}
  const t = pjTab();
  setStatus(pj.auto ? 'Autosave is on' + (t && t.file ? ': changes are written to ' + t.file.name : ': it starts once this tab is saved as a file (Save)') : 'Autosave to the project file is off: Save writes it');
}
// Open a project file in a new tab (in this one when the tab limit is reached). h = its handle, when the browser gave one.
async function pjOpenFile(f, h) {
  let j = null;
  try { j = JSON.parse(await f.text()); } catch (e) {}
  if (!j) { setStatus('Could not read that file'); return; }
  if (!Array.isArray(j.layers)) { setStatus('That file is not a Strodano VJ composition'); return; }
  const name = f.name.replace(/\.svj$/i, '') || 'Composition';
  const same = h ? await pjFindFile(h) : -1;
  if (same >= 0 && same !== pj.cur) { pjSwitch(same); setStatus(f.name + ' is already open in this tab'); return; }
  if (same < 0 && pj.tabs.length < PJ_MAX) { pjFlush(); pjStash(); pj.tabs.push(pjMk(name)); pj.cur = pj.tabs.length - 1; }
  const t = pjTab();
  if (!loadComp(j)) { setStatus('That file is not a Strodano VJ composition'); return; }   // with its screens: a project file carries its output mapping
  Object.assign(t, { name, data: null, file: h || null, fileStr: h ? JSON.stringify(compToJSON()) : null, fileAt: Date.now(), dirty: false, cloud: { id: '', name: '' }, active: [] });
  if (typeof ws !== 'undefined') ws.cloud = { id: '', name: '' };
  if (typeof stockRelink === 'function') stockRelink();
  syncTransport();
  if (display.autoOut) syncDisplays(display.list.map(d => d.key));   // the new composition's screens go to their displays
  sel.l = 0; sel.c = -1; ui.gridDirty = ui.propsDirty = ui.browserDirty = true;
  autosave(); pjKeepFiles(); pjPersist(); pjDraw();
  setStatus('Opened ' + f.name + (h ? '. Save writes over this file.' : ''));
}
async function pjFindFile(h) {
  for (let i = 0; i < pj.tabs.length; i++) { const o = pj.tabs[i].file; try { if (o && await o.isSameEntry(h)) return i; } catch (e) {} }
  return -1;
}
async function pjOpen() {
  if (typeof window.showOpenFilePicker !== 'function') { $('compInput').click(); return; }
  let h;
  try { [h] = await window.showOpenFilePicker({ id: 'strodano-project', types: PJ_TYPES }); } catch (e) { return; }   // cancelled
  let f;
  try { f = await h.getFile(); } catch (e) { setStatus('Could not read that file'); return; }
  pjOpenFile(f, h);
}
// Ctrl / Cmd + S: Save. With Shift: Save as.
window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.code !== 'KeyS') return;
  e.preventDefault(); e.stopPropagation();
  if (!e.repeat) pjSave(e.shiftKey);
}, true);
