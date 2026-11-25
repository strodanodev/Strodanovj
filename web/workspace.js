// Strodano VJ (web) - the workspace: taking a project to another computer. GPL-3.0.
// Loaded by both pages. The desktop page has the whole Workspace menu; the phone page uses the cloud projects
// (wsCloud, on its Build tab) and the smart relink.
// A project (.svj) only names its media files, so three things live here:
//  1. Cloud projects: the project file kept on the website for the signed-in account (GET /api/app/projects and
//     POST /api/app/projects/save | load | delete, device token from plan.js). The website enforces how many an account
//     keeps (Free 1, Pro 3, Festival 30); media is never uploaded.
//  2. Smart relink: clips whose file is missing are matched to added files even when the name is not exactly the same
//     (wsMatch: other upper / lower case, another extension, a "copy" or "(2)" suffix, or a renamed file of exactly the
//     same size). engine.js addMediaFiles calls smartRelink for every file that comes in, whatever way it comes in.
//     "Search a folder" (wsFindInFolder) looks through a folder and its subfolders for the missing files only.
//  3. Collect: wsCollect copies every file the project uses into one folder (media/ and tracks/ beside workspace.svj),
//     for a USB stick. wsOpenFolder on another computer loads workspace.svj and makes that folder the Media folder,
//     which relinks everything and is remembered for the next start.
'use strict';
const ws = { menu: null, busy: false, cloud: { id: '', name: '' } };

// ---------- smart relink ----------
const wsBase = n => n.toLowerCase().replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').replace(/[\s_-]*copy(\s*\d+)?$/, '').replace(/[^a-z0-9]+/g, '');
// The clips still waiting for a file: [{ fileName, kind, size }] (size 0 = not known: projects saved before sizes were kept).
function wsWanted() {
  const m = new Map();
  comp.layers.forEach(L => L.clips.forEach(c => { if (c && c.missing && c.fileName && !m.has(c.fileName)) m.set(c.fileName, { fileName: c.fileName, kind: c.type === 'image' ? 'image' : 'video', size: c.fileSize || 0 }); }));
  return [...m.values()];
}
// Pairs wanted files with candidates ({ name, size, kind }), each candidate used once. A pair is made only when it is
// the one clear answer, in this order: same name, same name in another case, same name apart from the extension or a
// copy suffix (told apart by size when several fit), then exactly the same size (a renamed file). Returns
// [{ want, file, how }] with how = 'name' | 'case' | 'similar' | 'size'.
function wsMatch(wanted, cands) {
  const out = [], free = new Set(cands), take = (w, f, how) => { out.push({ want: w, file: f, how }); free.delete(f); };
  const left = () => wanted.filter(w => !out.some(o => o.want === w));
  const pass = (how, fits) => {
    for (const w of left()) {
      let c = [...free].filter(f => f.kind === w.kind && fits(w, f));
      if (c.length > 1 && w.size) { const same = c.filter(f => f.size === w.size); if (same.length === 1) c = same; }
      if (c.length === 1) take(w, c[0], how);
    }
  };
  pass('name', (w, f) => f.name === w.fileName);
  pass('case', (w, f) => f.name.toLowerCase() === w.fileName.toLowerCase());
  pass('similar', (w, f) => wsBase(f.name) === wsBase(w.fileName) && wsBase(f.name).length > 0);
  pass('size', (w, f) => w.size > 0 && f.size === w.size);
  return out;
}
// Puts a media pool entry on every clip that is missing `fileName` (what engine.js does for an exact name).
function wsRelink(fileName, m) {
  let n = 0;
  comp.layers.forEach(L => L.clips.forEach((c, ci) => {
    if (c && c.missing && c.fileName === fileName) { const x = mediaClip(m); x.speed = c.speed; x.name = c.name; if (typeof clipOptsCopy === 'function') clipOptsCopy(c, x); L.clips[ci] = x; n++; }
  }));
  ui.gridDirty = ui.browserDirty = true;
  return n;
}
// Called by engine.js addMediaFiles with the pool entries just added: the ones no clip uses yet are tried against the
// clips still missing a file.
function smartRelink(added) {
  const wanted = wsWanted();
  if (!wanted.length || !added.length) return;
  const used = new Set();
  comp.layers.forEach(L => L.clips.forEach(c => { if (c && !c.missing && c.fileName) used.add(c.fileName); }));
  const pairs = wsMatch(wanted, added.filter(m => !used.has(m.name) && !m.stock)).filter(p => p.how !== 'name');
  if (!pairs.length) return;
  pairs.forEach(p => wsRelink(p.want.fileName, p.file));
  const left = wsWanted().length, text = pairs.slice(0, 3).map(p => p.want.fileName + ' = ' + p.file.name).join(', ') + (pairs.length > 3 ? ' and ' + (pairs.length - 3) + ' more' : '');
  setTimeout(() => setStatus(pairs.length + ' renamed file(s) matched: ' + text + (left ? '. ' + left + ' still missing.' : '. Nothing is missing now.')), 0);   // after the caller's own message
}
// Every media file in a folder and its subfolders, with its handle (so a match can be remembered for the next start).
async function wsScan(dir, depth = 0, out = []) {
  for await (const h of dir.values()) {
    if (out.length >= 20000) break;
    if (h.kind === 'directory') { if (depth < 6 && !h.name.startsWith('.') && h.name !== 'node_modules') await wsScan(h, depth + 1, out); }
    else if (isVideoName(h.name) || isImageName(h.name)) { try { out.push({ handle: h, file: await h.getFile() }); } catch (e) {} }
  }
  return out;
}
// Search a folder: only the files that answer a missing clip are added (and remembered), not the whole folder.
async function wsFindInFolder() {
  const wanted = wsWanted();
  if (!wanted.length) { setStatus('No clips are missing their file'); return; }
  if (!canPickFolder) { setStatus('This browser cannot open folders: use Find missing files, or Chrome / Edge / the desktop app'); return; }
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'strodano-find', mode: 'read' }); } catch (e) { return; }   // cancelled
  setStatus('Searching "' + dir.name + '" for ' + wanted.length + ' missing file(s)...');
  let found;
  try { found = await wsScan(dir); } catch (e) { setStatus('Could not read that folder'); return; }
  const cands = found.map(x => ({ name: x.file.name, size: x.file.size, kind: isVideoName(x.file.name) ? 'video' : 'image', x }));
  const pairs = wsMatch(wanted, cands);
  if (!pairs.length) { setStatus('None of the ' + found.length + ' media file(s) in "' + dir.name + '" match the missing clips'); return; }
  const added = addMediaFiles(pairs.map(p => p.file.x.file));   // exact names relink here, the rest in smartRelink
  rememberHandles(pairs.map(p => p.file.x.handle));
  const left = wsWanted(), guessed = pairs.filter(p => p.how !== 'name').length;
  setTimeout(() => setStatus(added.length + ' of ' + wanted.length + ' missing file(s) found in "' + dir.name + '"' + (guessed ? ' (' + guessed + ' under another name)' : '') +
    (left.length ? '. Still missing: ' + left.slice(0, 3).map(w => w.fileName).join(', ') + (left.length > 3 ? ' and ' + (left.length - 3) + ' more' : '') : '. Nothing is missing now.')), 10);
}

// ---------- the playlist: song order, transition points and mix styles ----------
// The playlist is remembered per computer by file name + size + date (playlist.js), and a copied file has a new date,
// so a workspace and a cloud project carry it by file name instead: [{ name, i, o, s, v }] in playing order.
let wsKeptPlaylist;   // a loaded playlist, kept as it was by a build without Pro (no track list) and saved back unchanged
function wsPlaylist() {
  if (typeof crate === 'undefined') return wsKeptPlaylist;
  const list = crate.tracks.filter(t => t.file).map(t => ({ name: t.file.name, i: typeof t.inAt === 'number' ? +t.inAt.toFixed(3) : undefined, o: typeof t.outAt === 'number' ? +t.outAt.toFixed(3) : undefined,
    s: t.jStyle && t.jStyle !== 'auto' ? t.jStyle : undefined, v: t.jVis && t.jVis !== 'mix' ? t.jVis : undefined }));
  return list.length ? list : undefined;
}
// Puts the songs that are in the track list now into the saved order with their saved settings. Returns how many.
function wsApplyPlaylist(list) {
  if (typeof crate === 'undefined') { wsKeptPlaylist = Array.isArray(list) ? list : undefined; return 0; }
  if (!Array.isArray(list) || !crate.tracks.length) return 0;
  const at = new Map();
  list.slice(0, 5000).forEach((x, i) => { if (x && typeof x.name === 'string' && !at.has(x.name)) at.set(x.name, { i, x }); });
  let n = 0;
  for (const t of crate.tracks) {
    const e = t.file && at.get(t.file.name);
    if (!e) continue;
    n++;
    if (typeof e.x.i === 'number') t.inAt = e.x.i;
    if (typeof e.x.o === 'number') t.outAt = e.x.o;
    if (typeof PL_STYLES !== 'undefined' && PL_STYLES.some(([v]) => v === e.x.s)) t.jStyle = e.x.s;
    if (typeof PL_VIS !== 'undefined' && PL_VIS.some(([v]) => v === e.x.v)) t.jVis = e.x.v;
  }
  if (!n) return 0;
  const was = new Map(crate.tracks.map((t, i) => [t, i])), rank = t => (t.file && at.has(t.file.name) ? at.get(t.file.name).i : 1e9 + was.get(t));
  crate.tracks.sort((a, b) => rank(a) - rank(b));
  if (typeof plSave === 'function') plSave();
  if (typeof plDirty === 'function') plDirty();
  return n;
}

// ---------- collect into a folder / open a workspace folder ----------
const WS_FILE = 'workspace.svj';
async function wsWrite(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  try { const old = await fh.getFile(); if (old.size === blob.size && blob.size > 0) return false; } catch (e) {}   // already there
  const w = await fh.createWritable();
  await blob.stream().pipeTo(w);
  return true;
}
async function wsCollect() {
  if (ws.busy) return;
  if (!canPickFolder) { setStatus('This browser cannot write folders: use Chrome, Edge or the desktop app'); return; }
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'strodano-workspace', mode: 'readwrite' }); } catch (e) { return; }   // cancelled
  ws.busy = true;
  try {
    const clips = new Map(), skipped = new Set(), missing = wsWanted().map(w => w.fileName);
    comp.layers.forEach(L => L.clips.forEach(c => {
      if (!c || c.missing || !c.fileName) return;
      const m = media.find(x => x.name === c.fileName);
      if (!m || m.stock) return;                                              // built-in stock: every copy of the app has it
      if (typeof premium !== 'undefined' && premium.have.has(m.name)) { skipped.add(m.name); return; }   // premium pack: downloaded again with the account
      clips.set(m.name, m);
    }));
    const tracks = (typeof crate !== 'undefined' ? crate.tracks : []).filter(t => t.file && !t.audius);   // Audius songs reload from Audius
    const total = clips.size + tracks.length;
    let done = 0, copied = 0, failed = [];
    const step = async (sub, name, getBlob) => {
      setStatus('Collecting ' + (++done) + ' of ' + total + ': ' + name);
      try { if (await wsWrite(sub, name, await getBlob())) copied++; } catch (e) { failed.push(name); }
    };
    if (clips.size) { const sub = await dir.getDirectoryHandle('media', { create: true }); for (const [name, m] of clips) await step(sub, name, async () => (await fetch(m.url)).blob()); }
    if (tracks.length) { const sub = await dir.getDirectoryHandle('tracks', { create: true }); for (const t of tracks) await step(sub, t.file.name, async () => t.file); }
    const j = compToJSON();
    j.workspace = { made: new Date().toISOString(), media: [...clips.keys()], tracks: tracks.map(t => t.file.name), playlist: wsPlaylist() };
    await wsWrite(dir, WS_FILE, new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' }));
    setStatus('Workspace saved in "' + dir.name + '": ' + clips.size + ' clip file(s)' + (tracks.length ? ' and ' + tracks.length + ' track(s)' : '') + (copied === total ? '' : ' (' + copied + ' copied, the rest were already there)') +
      (failed.length ? '. Could not copy: ' + failed.slice(0, 3).join(', ') : '') + (missing.length ? '. ' + missing.length + ' clip(s) had no file to copy' : '') +
      (skipped.size ? '. Premium pack clips are not copied: download them on the other computer' : '') + '. On another computer: Workspace > Open a workspace folder.');
  } catch (e) { setStatus('Could not write the workspace: ' + (e && e.message || e)); }
  finally { ws.busy = false; }
}
function wsAfterLoad() {
  if (typeof syncTransport === 'function') syncTransport();
  if (typeof display !== 'undefined' && display.autoOut) syncDisplays(display.list.map(d => d.key));   // the new project's screens go to their displays
  sel.l = 0; sel.c = -1; ui.gridDirty = ui.propsDirty = ui.browserDirty = true;
  if (typeof M !== 'undefined') {   // the phone page: its own view, its broadcast screen, and the starter pack files the project may want
    if (typeof vdoScreen === 'function') vdoScreen();
    M.dirty = true;
    if (typeof starterFetch === 'function') starterFetch();
  }
}
async function wsOpenFolder() {
  if (ws.busy) return;
  if (!canPickFolder) { setStatus('This browser cannot open folders: use Chrome, Edge or the desktop app'); return; }
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'strodano-workspace', mode: 'read' }); } catch (e) { return; }   // cancelled
  ws.busy = true;
  try {
    let fh = null;
    try { fh = await dir.getFileHandle(WS_FILE); } catch (e) { for await (const h of dir.values()) if (h.kind === 'file' && /\.svj$/i.test(h.name)) { fh = h; break; } }
    if (!fh) { setStatus('"' + dir.name + '" has no ' + WS_FILE + ': pick the folder made with Collect files'); return; }
    let j;
    try { j = JSON.parse(await (await fh.getFile()).text()); } catch (e) { setStatus('Could not read ' + fh.name); return; }
    if (!loadComp(j)) { setStatus(fh.name + ' is not a Strodano VJ project'); return; }
    mediaFolder.handle = dir;                       // the workspace is the Media folder from now on: remembered for the next start
    try { await folderStore('put', dir); } catch (e) {}
    await loadMediaFolder();
    wsApplyPlaylist(j.workspace && j.workspace.playlist);
    wsAfterLoad();
    ws.cloud = { id: '', name: '' };
    if (typeof pjDetach === 'function') pjDetach(dir.name);
    const left = wsWanted().length;
    setStatus('Opened the workspace "' + dir.name + '"' + (left ? ': ' + left + ' clip file(s) are not in it (Project > Find missing files)' : ': every clip found its file') + '. It is now your Media folder.');
  } finally { ws.busy = false; }
}

// ---------- cloud projects ----------
const wsDate = d => { try { return new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; } };
async function wsCloud(note) {
  if (!ent.token) { setStatus('Sign in to your Strodano account to save projects to the cloud'); entDialog('CLOUD', 'Sign in to use cloud projects', 'Your saved projects belong to your Strodano account, so they open on any computer you sign in on. Free keeps 1 project, Pro 3, Festival 30.', [entBtn('Close', entClose), entBtn('Sign in', entSignIn, true)]); return; }
  entDialog('CLOUD', 'Cloud projects', 'Loading your saved projects...', [entBtn('Close', entClose)]);
  let r = null;
  try { r = await entFetch('/api/app/projects', null, ent.token); } catch (e) {}
  if (!r) return entDialog('CLOUD', 'No connection to strodano.live', 'Cloud projects need the internet. Check the connection and try again.', [entBtn('Close', entClose), entBtn('Try again', () => wsCloud(), true)]);
  if (r.status === 401) { entRefresh(); return entDialog('CLOUD', 'This app was signed out', 'Sign in again to reach your saved projects.', [entBtn('Close', entClose), entBtn('Sign in', entSignIn, true)]); }
  if (!r.ok) return entDialog('CLOUD', 'Cloud projects are not available right now', r.json.error || 'Try again in a few minutes.', [entBtn('Close', entClose)]);
  const { projects, limit, plan } = r.json, full = projects.length >= limit, over = projects.length > limit, pname = ENT_NAMES[plan] || 'Free';
  const small = { font: 'inherit', fontSize: '13px', padding: '4px 10px', minHeight: '30px', borderRadius: '6px', cursor: 'pointer', background: 'var(--ctl)', color: 'var(--txt)', border: '1px solid var(--ctl-line)' };
  const act = async (path, body, okText) => {
    let a = null;
    try { a = await entFetch(path, body, ent.token); } catch (e) {}
    if (a && a.ok) { if (okText) setStatus(okText); return a.json; }
    wsCloud(a ? (a.json.error || 'That did not work. Try again.') : 'No connection to strodano.live');
    return null;
  };
  const save = async (name, id) => {
    const j = await act('/api/app/projects/save', { name, data: Object.assign(compToJSON(), { workspace: { playlist: wsPlaylist() } }), ...(id && { id }) }, 'Saved "' + name + '" to the cloud (the project only: its media files stay on this device)');
    if (j) { ws.cloud = { id: j.id, name: j.name }; if (typeof pjPersist === 'function') { pjTab().cloud = { ...ws.cloud }; pjPersist(); } wsCloud('Saved "' + j.name + '".'); }
  };
  const open = async p => {
    const j = await act('/api/app/projects/load', { id: p.id });
    if (!j) return;
    if (!loadComp(j.data)) return wsCloud('That saved project could not be opened.');
    ws.cloud = { id: p.id, name: p.name };
    wsApplyPlaylist(j.data.workspace && j.data.workspace.playlist);
    wsAfterLoad(); entClose();
    if (typeof pjDetach === 'function') pjDetach(p.name);   // this tab is the cloud project now, not the file it was saved to
    if (typeof stockRelink === 'function') stockRelink();
    const left = wsWanted().length;
    setStatus('Opened "' + p.name + '" from the cloud' + (left ? ': ' + left + (typeof M !== 'undefined' ? ' clip file(s) are not on this phone yet: import them in Library.' : ' clip file(s) are not on this computer yet. Use Project > Open a workspace folder, or Find missing files.') : ''));
  };
  const rows = projects.map(p => el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' } },
    el('div', { style: { flex: '1 1 120px', minWidth: '0' } },
      el('div', { textContent: p.name + (p.id === ws.cloud.id ? '  (open now)' : ''), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
      el('div', { textContent: wsDate(p.updatedAt) + ' · ' + Math.max(1, Math.round(p.bytes / 1024)) + ' KB', style: { color: 'var(--dim)', fontSize: '12px' } })),
    el('button', { textContent: 'Open', title: 'Load this project (replaces what is open now)', style: small, onclick: () => open(p) }),
    el('button', { textContent: 'Replace', title: 'Save the project that is open now over this one', disabled: over, style: { ...small, opacity: over ? '.5' : '1' }, onclick: e => armThen(e.currentTarget, 'replace "' + p.name + '" with the open project', () => save(p.name, p.id)) }),
    el('button', { textContent: 'Delete', title: 'Remove this saved project from the cloud', style: small, onclick: e => armThen(e.currentTarget, 'delete "' + p.name + '" from the cloud', async () => { if (await act('/api/app/projects/delete', { id: p.id })) { if (ws.cloud.id === p.id) ws.cloud = { id: '', name: '' }; wsCloud('Deleted "' + p.name + '".'); } }) })));
  const nameIn = el('input', { type: 'text', maxLength: 80, placeholder: 'Name for this project', value: projects.some(p => p.id === ws.cloud.id) ? '' : ws.cloud.name || '', disabled: full,
    style: { flex: '1', minWidth: '0', font: 'inherit', padding: '6px 10px', borderRadius: '6px', background: 'var(--field, #000)', color: 'var(--txt)', border: '1px solid var(--line)' } });
  const saveNew = () => { const n = nameIn.value.replace(/\s+/g, ' ').trim(); if (!n) { nameIn.focus(); setStatus('Give the project a name first'); return; } save(n); };
  nameIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') saveNew(); });
  const used = projects.length + ' of ' + limit + ' used on ' + pname + '.';
  entDialog('CLOUD', 'Cloud projects', (note ? note + ' ' : '') + used + ' Only the project is saved (layers, clips, settings); the media files stay on this device.',
    [full && plan !== 'festival' ? el('a', { textContent: 'See plans', href: ENT_SITE + '/#pricing', target: '_blank', rel: 'noopener', style: entBtnStyle(false) }) : null, entBtn('Close', entClose, true)],
    el('div', { style: { margin: '14px 0 0', maxHeight: '40vh', overflowY: 'auto' } }, ...(rows.length ? rows : [el('div', { textContent: 'Nothing saved yet.', style: { color: 'var(--dim)', padding: '8px 0', borderTop: '1px solid var(--line)' } })])),
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--line)' } }, nameIn,
      el('button', { textContent: 'Save as new', disabled: full, style: { ...small, opacity: full ? '.5' : '1' }, onclick: saveNew })),
    full ? el('div', { textContent: over ? 'You have more saved projects than ' + pname + ' keeps: delete some to save again.' : pname + ' keeps ' + limit + ' saved project' + (limit === 1 ? '' : 's') + ': replace one, delete one' + (plan === 'festival' ? '.' : ', or upgrade.'), style: { color: 'var(--dim)', fontSize: '12px', marginTop: '8px' } }) : null);
  if (!full) nameIn.focus();
}

// Save over the cloud project this tab was opened from or last saved to (Project menu), without the list.
async function wsCloudOverwrite() {
  const c = ws.cloud;
  if (!ent.token || !c.id) return wsCloud();
  setStatus('Saving "' + c.name + '" to the cloud...');
  let a = null;
  try { a = await entFetch('/api/app/projects/save', { name: c.name, id: c.id, data: Object.assign(compToJSON(), { workspace: { playlist: wsPlaylist() } }) }, ent.token); } catch (e) {}
  if (a && a.ok) setStatus('Saved "' + c.name + '" to the cloud, over the earlier copy (the project only: its media files stay on this device)');
  else wsCloud(a ? (a.json.error || 'That did not work. Try again.') : 'No connection to strodano.live');
}

// ---------- the Workspace menu (header) ----------
function wsCloseMenu() { if (ws.menu) { ws.menu.remove(); ws.menu = null; const b = document.getElementById('wsBtn'); if (b) b.setAttribute('aria-expanded', 'false'); } }
function wsToggleMenu() {
  if (ws.menu) return wsCloseMenu();
  const b = document.getElementById('wsBtn'), r = b.getBoundingClientRect(), miss = wsWanted().length;
  const item = (title, hint, fn, off) => el('button', { role: 'menuitem', disabled: !!off, onclick: () => { wsCloseMenu(); fn(); },
    style: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: '0', background: 'none', height: 'auto', opacity: off ? '.5' : '1' } },
    el('div', { textContent: title }), el('div', { textContent: hint, style: { color: 'var(--dim)', fontSize: '12px', whiteSpace: 'normal' } }));
  ws.menu = el('div', { role: 'menu', style: { position: 'fixed', left: Math.max(8, Math.min(r.left, innerWidth - 328)) + 'px', top: r.bottom + 4 + 'px', zIndex: '20', width: '320px', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '4px', boxShadow: '0 12px 40px rgba(0,0,0,.7)' } },
    item('New project', 'Start again from the starter show', () => entDialog('PROJECT', 'Start a new project?', 'It replaces the project on screen. Save it first if you want to keep it.',
      [entBtn('Cancel', entClose), entBtn('New project', () => { entClose(); menuAct('new'); }, true)])),
    item('Open a project file...', 'Load a .svj file from this computer in a new tab', () => menuAct('open')),
    ...(typeof pjSave === 'function' ? [
      item('Save', pjTab().file ? 'Write over ' + pjTab().file.name + ' (Ctrl / Cmd + S)' : canSaveFile ? 'Choose where to keep this project; Save then writes over that file (Ctrl / Cmd + S)' : 'Download ' + pjTab().name + '.svj', () => menuAct('save')),
      canSaveFile ? item('Save as...', 'Save this tab to another file and keep working in that one (Ctrl / Cmd + Shift + S)', () => menuAct('saveAs')) : null,
      canSaveFile ? item('Autosave to the file: ' + (pj.auto ? 'On' : 'Off'), pj.auto ? 'Changes are written to the project file as you work. Click to turn off.' : 'Only Save writes the project file. Click to turn on.', () => pjSetAuto(!pj.auto)) : null,
    ] : [item('Save as a file', 'Download composition.svj', () => menuAct('save'))]).filter(Boolean),
    el('div', { style: { height: '1px', background: 'var(--line)', margin: '4px 8px' } }),
    item('Cloud projects...', 'Save this project to your account, or open one you saved', () => wsCloud()),
    ws.cloud.id ? item('Save to the cloud: ' + ws.cloud.name, 'Write this tab over its copy in your account', wsCloudOverwrite) : null,
    item('Collect files into a folder...', 'Copy the project and every file it uses into one folder, for a USB stick', wsCollect, !canPickFolder),
    item('Open a workspace folder...', 'Load a collected folder: the project and all its files', wsOpenFolder, !canPickFolder),
    item('Find missing files in a folder...', miss ? miss + ' clip file(s) missing: search a folder and its subfolders, renamed files too' : 'No clip is missing its file', wsFindInFolder, !miss || !canPickFolder));
  document.body.append(ws.menu);
  b.setAttribute('aria-expanded', 'true');
}
document.addEventListener('pointerdown', e => { if (ws.menu && !ws.menu.contains(e.target) && !e.target.closest('#wsBtn')) wsCloseMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ws.menu) wsCloseMenu(); });
window.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('wsBtn'); if (b) b.addEventListener('click', wsToggleMenu); });
