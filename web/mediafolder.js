// Strodano VJ (web) - remembered media folder: pick it once, and every start relinks clips by file name. GPL-3.0.
// Uses the File System Access API (Chrome / Edge). The folder handle is kept in IndexedDB; the browser may ask
// again for read permission after a restart, which needs a click (the Reconnect button).
'use strict';
const mediaFolder = { handle: null, state: 'none', count: 0 };   // state: none | needs-permission | scanning | ready | error
const canPickFolder = typeof window.showDirectoryPicker === 'function';

function folderStore(op, value, key = 'mediaFolder') {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('strodano-vj', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result, tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
      const r = op === 'get' ? st.get(key) : op === 'put' ? st.put(value, key) : st.delete(key);
      tx.oncomplete = () => { db.close(); resolve(r.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
// Media files (video, images, audio tracks) in the folder and its subfolders (4 levels, hidden folders skipped), sorted by name.
async function scanFolder(dir, depth = 0, out = []) {
  for await (const h of dir.values()) {
    if (out.length >= 5000) break;
    if (h.kind === 'directory') { if (depth < 4 && !h.name.startsWith('.')) await scanFolder(h, depth + 1, out); }
    else if (isVideoName(h.name) || isImageName(h.name) || isAudioFile({ name: h.name, type: '' })) out.push(await h.getFile());
  }
  return depth ? out : out.sort((a, b) => a.name.localeCompare(b.name));
}
const missingClips = () => comp.layers.reduce((n, L) => n + L.clips.filter(c => c && c.missing).length, 0);
async function loadMediaFolder() {
  mediaFolder.state = 'scanning'; ui.browserDirty = true;
  try {
    const before = missingClips(), files = await scanFolder(mediaFolder.handle);
    addMediaFiles(files);
    crateAdd(files);   // audio files go to the DJ track list
    mediaFolder.count = files.length; mediaFolder.state = 'ready';
    const relinked = before - missingClips();
    setStatus(`Media folder "${mediaFolder.handle.name}": ${files.length} file(s)` + (relinked ? `, ${relinked} clip(s) relinked` : '') + (missingClips() ? `, ${missingClips()} still missing` : ''));
  } catch (e) {
    mediaFolder.state = 'error';
    setStatus('Could not read the media folder: ' + (e.message || e));
  }
  ui.browserDirty = true;
}
async function pickMediaFolder() {
  try { mediaFolder.handle = await window.showDirectoryPicker({ id: 'strodano-media', mode: 'read' }); } catch (e) { return; }   // cancelled
  try { await folderStore('put', mediaFolder.handle); } catch (e) {}
  await loadMediaFolder();
}
// Must run from a click: the browser only shows the permission prompt for a user gesture.
async function reconnectMediaFolder() {
  if (mediaFolder.handle && mediaFolder.state === 'needs-permission') {
    try { if (await mediaFolder.handle.requestPermission({ mode: 'read' }) === 'granted') await loadMediaFolder(); } catch (e) { setStatus('Could not reconnect the media folder'); }
  }
  await reconnectLooseFiles();
  if (typeof rbReconnect === 'function') await rbReconnect();   // a remembered rekordbox stick
}
function forgetMediaFolder() {
  folderStore('delete').catch(() => {});
  mediaFolder.handle = null; mediaFolder.state = 'none'; mediaFolder.count = 0; ui.browserDirty = true;
}

// ---------- files added one by one (drag and drop, Add media, Add tracks) ----------
// A dropped or picked File only lives as long as the page, so its FileSystemFileHandle is kept in IndexedDB as well and
// the file is read again on the next start. Files inside the media folder are not stored twice (the folder covers them).
const looseFiles = { handles: [], pending: [] };   // pending: handles whose read permission lapsed (Reconnect asks again)
const canKeepFiles = typeof window.showOpenFilePicker === 'function' && typeof DataTransferItem !== 'undefined' && 'getAsFileSystemHandle' in DataTransferItem.prototype;
async function rememberHandles(hs) {
  hs = hs.filter(h => h && h.kind === 'file');
  if (!hs.length) return;
  for (const h of hs) {
    if (mediaFolder.handle && mediaFolder.state === 'ready') { try { if (await mediaFolder.handle.resolve(h)) continue; } catch (e) {} }
    let dup = false;
    for (const o of looseFiles.handles) { try { if (o.name === h.name && await o.isSameEntry(h)) { dup = true; break; } } catch (e) {} }
    if (!dup) looseFiles.handles = looseFiles.handles.filter(o => o.name !== h.name).concat(h);   // same name = same clip (relink is by name)
  }
  try { await folderStore('put', looseFiles.handles.slice(-2000), 'looseFiles'); } catch (e) {}
  ui.browserDirty = true;
}
// Call synchronously inside a drop handler: the handles can only be asked for while the event is being dispatched.
function rememberDropped(dt) {
  if (!canKeepFiles || !dt || !dt.items) return;
  const ps = [...dt.items].filter(it => it.kind === 'file').map(it => it.getAsFileSystemHandle().catch(() => null));
  Promise.all(ps).then(rememberHandles);
}
// Opens the system file picker (so the handles can be kept); falls back to the plain <input type=file>.
const PICK_TYPES = {
  media: [{ description: 'Video and images', accept: { 'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ogv'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif'] } }],
  audio: [{ description: 'Audio tracks', accept: { 'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aif', '.aiff'] } }],
};
async function pickFiles(kind, fallbackInput, onFiles) {
  if (!canKeepFiles) { $(fallbackInput).click(); return; }
  let hs;
  try { hs = await window.showOpenFilePicker({ id: 'strodano-' + kind, multiple: true, types: PICK_TYPES[kind] }); } catch (e) { return; }   // cancelled
  const files = await Promise.all(hs.map(h => h.getFile()));
  rememberHandles(hs);
  onFiles(files);
}
// The file names saved clips are waiting for (a composition only keeps names, never the files).
const missingNames = () => { const s = new Set(); comp.layers.forEach(L => L.clips.forEach(c => { if (c && c.missing && c.fileName) s.add(c.fileName); })); return [...s]; };
// Find missing files: one picker for all of them. Picked files relink by name and are remembered from now on.
function findMissingFiles() {
  const want = missingNames();
  if (!want.length) { setStatus('No clips are missing their file'); return; }
  pickFiles('media', 'mediaInput', files => {
    addMediaFiles(files);
    const left = missingNames(), found = want.length - left.length;
    setStatus((found ? found + ' missing file(s) found and relinked' : 'None of those files are the missing ones') +
      (left.length ? '. Still missing: ' + left.slice(0, 3).join(', ') + (left.length > 3 ? ' and ' + (left.length - 3) + ' more' : '') + ' (Search a folder looks through subfolders too)' : ''));
  });
}
async function readLoose(hs) {
  const files = [];
  for (const h of hs) { try { files.push(await h.getFile()); } catch (e) {} }   // moved or deleted since: skipped
  if (files.length) { addMediaFiles(files); crateAdd(files); }
  return files.length;
}
async function reconnectLooseFiles() {
  if (!looseFiles.pending.length) return;
  const ok = [];
  for (const h of looseFiles.pending) {
    try { if (await h.requestPermission({ mode: 'read' }) === 'granted') ok.push(h); else break; } catch (e) { break; }   // a refused prompt ends the round
  }
  looseFiles.pending = looseFiles.pending.filter(h => !ok.includes(h));
  const n = await readLoose(ok);
  setStatus(n + ' remembered file(s) reloaded' + (looseFiles.pending.length ? `, ${looseFiles.pending.length} still need Reconnect` : '') + (missingClips() ? `, ${missingClips()} clip(s) still missing` : ''));
  ui.browserDirty = true;
}
function forgetLooseFiles() {
  folderStore('delete', null, 'looseFiles').catch(() => {});
  looseFiles.handles = []; looseFiles.pending = []; ui.browserDirty = true;
}
async function initLooseFiles() {
  if (!canKeepFiles) return;
  let hs = null;
  try { hs = await folderStore('get', null, 'looseFiles'); } catch (e) {}
  if (!Array.isArray(hs) || !hs.length) return;
  looseFiles.handles = hs;
  const ready = [];
  for (const h of hs) {
    let p = 'prompt';
    try { p = await h.queryPermission({ mode: 'read' }); } catch (e) {}
    (p === 'granted' ? ready : looseFiles.pending).push(h);
  }
  await readLoose(ready);
  ui.browserDirty = true;
}

// On start: reopen the remembered folder and files if the browser still allows it, otherwise offer Reconnect.
async function initMediaFolder() {
  if (canPickFolder) {
    let h = null;
    try { h = await folderStore('get'); } catch (e) {}
    if (h) {
      mediaFolder.handle = h;
      let p = 'granted';
      try { if (h.queryPermission) p = await h.queryPermission({ mode: 'read' }); } catch (e) { p = 'prompt'; }
      if (p === 'granted') await loadMediaFolder();
      else { mediaFolder.state = 'needs-permission'; ui.browserDirty = true; }
    }
  }
  await initLooseFiles();
  if (typeof initRekordbox === 'function') await initRekordbox();
  if (needsReconnect()) {
    if (typeof browserTab !== 'undefined') browserTab = 'files';   // the Reconnect button lives on the Files tab
    setStatus('The browser needs your OK to read your media again after a restart: click Reconnect in Files (choose "Allow on every visit" if offered).');
  } else if (missingClips()) setStatus(`${missingClips()} clip(s) are missing their file: add those files again, or pick a Media folder that holds them.`);
  ui.browserDirty = true;
}
const needsReconnect = () => mediaFolder.state === 'needs-permission' || looseFiles.pending.length > 0 || (typeof rb !== 'undefined' && rb.pending);
