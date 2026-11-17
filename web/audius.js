// Strodano VJ (web) - STRODANO's music from Audius (https://audius.co/strodano) as the default playlist. GPL-3.0.
// Uses Audius' public API (api.audius.co, CORS open, no key). Each track is downloaded once and kept in IndexedDB
// ('strodano-vj-audius'), so later starts load it from disk; it then goes into the track list as an ordinary File, so
// the analysis (tempo, key, sections, energy), the DJ decks, the playlist plans and the Agent all work on it unchanged.
// The analysis is cached by name + size + date (crate.js fileKey), so every file gets the same fixed date.
// When the downloaded songs are analysed, they are put in a set order (audiusOrder): an energy arc that rises to a peak
// about three quarters through and eases off at the end, each step chosen for a close tempo and a compatible key.
// On a start with an empty track list the STRODANO set loads by itself; the playlist head has a menu to load it again,
// or one of the profile's playlists.
'use strict';
const AUDIUS_API = 'https://api.audius.co/v1', AUDIUS_APP = 'StrodanoVJ', AUDIUS_HANDLE = 'strodano';
const AUDIUS_KEY = 'strodano-vj-audius';
const audius = { busy: false, done: 0, total: 0, user: null, playlists: [], src: 'all', ordered: false, pending: new Set() };
try { const s = JSON.parse(localStorage.getItem(AUDIUS_KEY) || '{}'); if (typeof s.src === 'string') audius.src = s.src; audius.ordered = !!s.ordered; } catch (e) {}
const audiusSave = () => { try { localStorage.setItem(AUDIUS_KEY, JSON.stringify({ src: audius.src, ordered: audius.ordered })); } catch (e) {} };

async function audiusGet(path) {
  const r = await fetch(AUDIUS_API + path + (path.includes('?') ? '&' : '?') + 'app_name=' + AUDIUS_APP);
  if (!r.ok) throw new Error('Audius answered ' + r.status);
  return (await r.json()).data;
}
function audiusDB(op, key, value) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('strodano-vj-audius', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('tracks');
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result, tx = db.transaction('tracks', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('tracks');
      const r = op === 'get' ? st.get(key) : st.put(value, key);
      tx.oncomplete = () => { db.close(); resolve(r.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
// A file name the rest of the app can show and match: the Audius title, without characters file systems refuse.
const audiusFileName = t => (t.title || 'Track ' + t.id).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.mp3';

async function audiusUser() {
  if (!audius.user) audius.user = await audiusGet('/users/handle/' + AUDIUS_HANDLE);
  return audius.user;
}
async function audiusPlaylists() {
  if (!audius.playlists.length) { const u = await audiusUser(); audius.playlists = (await audiusGet('/users/' + u.id + '/playlists')) || []; }
  return audius.playlists;
}
// The tracks of a source: 'all' = every track on the profile, else a playlist id.
async function audiusTracks(src) {
  const u = await audiusUser();
  const ts = src === 'all' ? await audiusGet('/users/' + u.id + '/tracks?limit=100') : await audiusGet('/playlists/' + encodeURIComponent(src) + '/tracks');
  return (ts || []).filter(t => t && t.id && t.is_streamable !== false && !t.is_delete);
}
async function audiusFile(t) {
  const name = audiusFileName(t);
  let rec = null;
  try { rec = await audiusDB('get', t.id); } catch (e) {}
  if (!rec || !rec.blob) {
    const r = await fetch(AUDIUS_API + '/tracks/' + t.id + '/stream?app_name=' + AUDIUS_APP);
    if (!r.ok) throw new Error('stream ' + r.status);
    rec = { blob: await r.blob(), title: t.title, genre: t.genre, mood: t.mood, bpm: t.bpm, key: t.musical_key };
    try { await audiusDB('put', t.id, rec); } catch (e) {}
  }
  return new File([rec.blob], name, { type: 'audio/mpeg', lastModified: 1 });
}

// Load a source into the track list / playlist. reorder: put the set in order once its songs are analysed.
async function audiusLoad(src = audius.src, reorder = true) {
  if (audius.busy) { setStatus('Audius: still loading the last set'); return; }
  audius.busy = true; audius.done = 0; audius.total = 0; audius.pending = new Set();   // only this load's songs are put in order
  if (src !== audius.src) { audius.src = src; audius.ordered = false; audiusSave(); }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  try {
    setStatus('Audius: finding STRODANO’s tracks…');
    const ts = await audiusTracks(src);
    audius.total = ts.length;
    for (const t of ts) {
      try {
        const f = await audiusFile(t);
        audius.pending.add(fileKey(f));
        crateAdd([f]);
        const ct = crate.tracks.find(x => x.key === fileKey(f));
        if (ct) ct.audius = { id: t.id, genre: t.genre, mood: t.mood, artist: t.user && t.user.name };
      } catch (e) {}
      audius.done++;
      setStatus(`Audius: ${audius.done} / ${audius.total} STRODANO tracks loaded (each is downloaded once, then kept)`);
    }
    if (reorder && !audius.ordered) audius.wantOrder = true;
    setStatus(`Audius: ${audius.total} STRODANO tracks in the playlist. The Agent is analysing them${audius.wantOrder ? ' and will put them in set order' : ''}.`);
  } catch (e) {
    setStatus('Audius: could not load the tracks (' + (e && e.message || 'offline?') + ')');
  } finally { audius.busy = false; }
}

// ---------- set order ----------
// Target energy (1..10) at place i of n: a warm-up rising to the peak about three quarters through, then easing off.
const arcEnergy = (i, n) => { const x = n > 1 ? i / (n - 1) : 0; return x < 0.75 ? 3 + 6.5 * Math.sin((x / 0.75) * Math.PI / 2) : 9.5 - 10 * (x - 0.75); };
function audiusOrder() {
  const set = crate.tracks.filter(t => audius.pending.has(t.key) && t.info);
  if (set.length < 3) return false;
  const left = set.slice(), out = [];
  // open with the calmest song near the set's usual tempo
  const bpms = set.filter(t => t.info.ok).map(t => t.info.bpm).sort((a, b) => a - b), mid = bpms[bpms.length >> 1] || 126;
  const gap = t => (t.info.ok ? tempoGap(t.info, mid) : 0.1);
  left.sort((a, b) => (a.energy + gap(a) * 40) - (b.energy + gap(b) * 40));
  out.push(left.shift());
  while (left.length) {
    const p = out[out.length - 1], want = arcEnergy(out.length, set.length);
    let best = 0, bs = -1;
    left.forEach((t, k) => {
      const g = p.info.ok && t.info.ok ? tempoGap(t.info, p.info.bpm) : 0.1;
      const ts = Math.max(0, 1 - g / 0.08), ks = keyScore(p.info.camelot, t.info.camelot), es = 1 - Math.min(1, Math.abs(t.energy - want) / 5);
      const s = 0.35 * ts + 0.25 * ks + 0.4 * es;
      if (s > bs) { bs = s; best = k; }
    });
    out.push(left.splice(best, 1)[0]);
  }
  // the set takes the places the songs had in the list, in the new order
  const slots = crate.tracks.map((t, i) => (set.includes(t) ? i : -1)).filter(i => i >= 0);
  slots.forEach((i, k) => { crate.tracks[i] = out[k]; });
  if (typeof plSave === 'function') plSave();
  crateDirty();
  return true;
}
// Called every frame from the playlist tick: orders the set once every downloaded song is analysed (and no deck plays).
function tickAudius() {
  if (!audius.wantOrder || audius.busy) return;
  const set = crate.tracks.filter(t => audius.pending.has(t.key));
  if (set.some(t => t.state === 'queued' || t.state === 'analysing')) return;
  if (audio.decks.some(d => d.playing)) return;
  audius.wantOrder = false;
  if (audiusOrder()) { audius.ordered = true; audiusSave(); setStatus('Audius: the STRODANO set is analysed and in set order: warm-up, peak, then easing off. Press Start.'); }
}

// ---------- UI (playlist head) ----------
function audiusMenu() {
  const sel = el('select', { title: 'Load STRODANO’s music from Audius into the playlist' },
    el('option', { value: '', textContent: 'Audius…' }),
    el('option', { value: 'all', textContent: 'STRODANO: all tracks' }));
  const fill = () => audiusPlaylists().then(ps => { for (const p of ps) sel.append(el('option', { value: p.id, textContent: 'STRODANO: ' + p.playlist_name + ' (' + (p.track_count || '?') + ')' })); }).catch(() => {});
  sel.addEventListener('focus', function once() { sel.removeEventListener('focus', once); fill(); });
  sel.addEventListener('change', () => { const v = sel.value; sel.value = ''; if (v) audiusLoad(v, true); });
  return sel;
}
// On start: the STRODANO set when the track list is still empty once the remembered files are back.
function initAudius() {
  if (crate.tracks.length || (audio.decks && audio.decks.some(d => d.file))) return;
  audiusLoad(audius.src, true);   // a set already put in order comes back in that order (playlist.js plSortSaved)
}
