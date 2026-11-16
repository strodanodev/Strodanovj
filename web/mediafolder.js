// Strodano VJ (web) - remembered media folder: pick it once, and every start relinks clips by file name. GPL-3.0.
// Uses the File System Access API (Chrome / Edge). The folder handle is kept in IndexedDB; the browser may ask
// again for read permission after a restart, which needs a click (the Reconnect button).
'use strict';
const mediaFolder = { handle: null, state: 'none', count: 0 };   // state: none | needs-permission | scanning | ready | error
const canPickFolder = typeof window.showDirectoryPicker === 'function';

function folderStore(op, value) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('strodano-vj', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result, tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
      const r = op === 'get' ? st.get('mediaFolder') : op === 'put' ? st.put(value, 'mediaFolder') : st.delete('mediaFolder');
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
  if (!mediaFolder.handle) return;
  try { if (await mediaFolder.handle.requestPermission({ mode: 'read' }) === 'granted') await loadMediaFolder(); } catch (e) { setStatus('Could not reconnect the media folder'); }
}
function forgetMediaFolder() {
  folderStore('delete').catch(() => {});
  mediaFolder.handle = null; mediaFolder.state = 'none'; mediaFolder.count = 0; ui.browserDirty = true;
}
// On start: reopen the remembered folder if the browser still allows it, otherwise offer Reconnect.
async function initMediaFolder() {
  if (!canPickFolder) return;
  let h = null;
  try { h = await folderStore('get'); } catch (e) {}
  if (!h) return;
  mediaFolder.handle = h;
  let p = 'granted';
  try { if (h.queryPermission) p = await h.queryPermission({ mode: 'read' }); } catch (e) { p = 'prompt'; }
  if (p === 'granted') await loadMediaFolder();
  else { mediaFolder.state = 'needs-permission'; ui.browserDirty = true; if (missingClips()) setStatus(`Click Reconnect in Files to relink clips from "${h.name}"`); }
}
