// Strodano VJ mobile - the on-phone media library. GPL-3.0.
// Phones have no folder or file pickers that can be remembered (mediafolder.js needs the desktop File System Access
// API), so imported photos and videos are COPIED into this site's own storage (IndexedDB, Blob values) and loaded back
// on every start. Clips keep referring to them by file name, as everywhere else, so addMediaFiles relinks them.
// Each record: {name, type, size, added, thumb (160x90 JPEG data URL), blob}. Database 'strodano-vj-media', store 'files'.
// navigator.storage.persist() is asked on the first import so the browser does not clear the library to save space
// (an installed home-screen app is the most reliable way to keep it on iPhone).
'use strict';
const mlib = { db: null, items: [], busy: 0, done: 0, total: 0, est: null, persisted: false, ready: false, onChange: null };
const MLIB_DB = 'strodano-vj-media', MLIB_STORE = 'files';

function mlibOpen() {
  if (mlib.db) return Promise.resolve(mlib.db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(MLIB_DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(MLIB_STORE, { keyPath: 'name' }); };
    r.onsuccess = () => { mlib.db = r.result; res(mlib.db); };
    r.onerror = () => rej(r.error);
  });
}
function mlibTx(mode, fn) {
  return mlibOpen().then(db => new Promise((res, rej) => {
    const t = db.transaction(MLIB_STORE, mode), st = t.objectStore(MLIB_STORE);
    let out;
    Promise.resolve(fn(st, v => { out = v; })).catch(rej);
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  }));
}
const mlibChanged = () => { if (mlib.onChange) mlib.onChange(); };
async function mlibEstimate() {
  try { mlib.est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { mlib.est = null; }
  try { mlib.persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) {}
  mlibChanged();
}
const mlibFile = r => new File([r.blob], r.name, { type: r.type || '' });

// Start: load every stored file into the media pool (relinks clips saved with these names)
async function mlibInit() {
  try {
    const all = await mlibTx('readonly', (st, done) => { const q = st.getAll(); q.onsuccess = () => done(q.result || []); });
    mlib.items = all.map(r => ({ name: r.name, type: r.type, size: r.size, added: r.added, thumb: r.thumb })).sort((a, b) => a.added - b.added);
    if (all.length) addMediaFiles(all.map(mlibFile));
  } catch (e) { setStatus('Could not open the media library on this phone: ' + (e.message || e)); }
  mlib.ready = true;
  mlibEstimate();
}

// A small picture of a photo or of a video's first second, made once at import
function mlibThumb(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file), done = t => { URL.revokeObjectURL(url); res(t); };
    const kind = file.type.startsWith('video') || isVideoName(file.name) ? 'video' : 'image';
    const timer = setTimeout(() => done(null), 8000);
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => { clearTimeout(timer); done(thumbOf(img, img.naturalWidth, img.naturalHeight)); };
      img.onerror = () => { clearTimeout(timer); done(null); };
      img.src = url;
    } else {
      const v = document.createElement('video');
      Object.assign(v, { muted: true, playsInline: true, preload: 'auto' });
      v.onloadeddata = () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) {} };
      v.onseeked = () => { clearTimeout(timer); const t = thumbOf(v, v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load(); done(t); };
      v.onerror = () => { clearTimeout(timer); done(null); };
      v.src = url;
    }
  });
}
// a name nothing else in the library or the media pool uses yet ("clip.mp4" -> "clip (2).mp4")
function mlibFreeName(name) {
  const taken = n => mlib.items.some(x => x.name === n) || media.some(m => m.name === n);
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) { const n = `${base} (${i})${ext}`; if (!taken(n)) return n; }
}
const mlibKind = f => (f.type.startsWith('video') || isVideoName(f.name) ? 'video' : f.type.startsWith('image') || isImageName(f.name) ? 'image' : '');

// Import picked files: copy each into the library, then into the media pool. Returns the media entries added.
async function mlibImport(files) {
  const list = [...files].filter(mlibKind);
  if (!list.length) { setStatus('Pick photos or videos (MP4 / MOV / WebM, JPG / PNG / GIF)'); return []; }
  if (navigator.storage && navigator.storage.persist && !mlib.persisted) { try { mlib.persisted = await navigator.storage.persist(); } catch (e) {} }
  mlib.busy += list.length; mlib.total += list.length; mlibChanged();
  const added = [];
  for (const f of list) {
    try {
      const name = mlibFreeName(f.name || ('media-' + Date.now() + (mlibKind(f) === 'video' ? '.mp4' : '.jpg')));
      const thumb = await mlibThumb(f);
      const rec = { name, type: f.type || '', size: f.size, added: Date.now(), thumb, blob: f };
      await mlibTx('readwrite', st => { st.put(rec); });
      mlib.items.push({ name, type: rec.type, size: rec.size, added: rec.added, thumb });
      added.push(...addMediaFiles([name === f.name ? f : new File([f], name, { type: f.type })]));
    } catch (e) {
      setStatus((e && e.name === 'QuotaExceededError' ? 'This phone has no room left for ' : 'Could not import ') + f.name);
    }
    mlib.busy--; mlib.done++; mlibChanged();
  }
  if (!mlib.busy) { mlib.done = mlib.total = 0; }
  mlibEstimate();
  return added;
}
// Delete from the phone (clips using it show "missing file", as on the desktop)
async function mlibDelete(name) {
  try { await mlibTx('readwrite', st => { st.delete(name); }); } catch (e) {}
  mlib.items = mlib.items.filter(x => x.name !== name);
  const i = media.findIndex(m => m.name === name);
  if (i >= 0) {
    const m = media[i];
    comp.layers.forEach((L, li) => L.clips.forEach((c, ci) => { if (c && c.fileName === name && !c.missing) setClip(li, ci, { type: c.type, missing: true, fileName: name, name: c.name, thumb: null }); }));
    media.splice(i, 1);
    URL.revokeObjectURL(m.url);
  }
  ui.gridDirty = ui.browserDirty = true;
  mlibEstimate();
}
const mlibSize = b => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
