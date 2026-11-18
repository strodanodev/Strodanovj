// Strodano VJ (web) - rekordbox USB import: playlists, beat grids and cue points from a stick exported by rekordbox. GPL-3.0.
// Reads the two things rekordbox writes for CDJs: PIONEER/rekordbox/export.pdb (tracks and playlists, "DeviceSQL",
// little-endian pages) and the per-track analysis files under PIONEER/USBANLZ (ANLZ0000.DAT / .EXT, big-endian tagged
// sections). Both formats were worked out by the Deep Symmetry project (crate-digger); nothing here comes from Pioneer /
// AlphaTheta. The encrypted exportLibrary.db (Device Library Plus) is not read: rekordbox still writes export.pdb beside it.
// The parsers at the top touch no DOM, so they can be run on their own (tools/test-rekordbox.mjs).
'use strict';

// ---------- export.pdb ----------
function rbStr(dv, at) {   // DeviceSQL string: short ASCII, long ASCII or long UTF-16LE
  if (!(at >= 0) || at + 4 > dv.byteLength) return '';
  const k = dv.getUint8(at);
  let a, n, enc = 'latin1';
  if (k & 1) { n = (k >> 1) - 1; a = at + 1; }
  else if (k === 0x40 || k === 0x90) { n = dv.getUint16(at + 1, true) - 4; a = at + 4; if (k === 0x90) enc = 'utf-16le'; }
  else return '';
  if (n <= 0 || a + n > dv.byteLength) return '';
  return new TextDecoder(enc).decode(new Uint8Array(dv.buffer, dv.byteOffset + a, n)).replace(/\0+$/, '');
}
const RB_ROWS = {
  0: (dv, r, db) => {   // track
    const s = i => rbStr(dv, r + dv.getUint16(r + 0x5e + 2 * i, true));
    const t = { id: dv.getUint32(r + 0x48, true), artist: dv.getUint32(r + 0x44, true), key: dv.getUint32(r + 0x20, true), genre: dv.getUint32(r + 0x3c, true),
      bpm: dv.getUint32(r + 0x38, true) / 100, size: dv.getUint32(r + 0x10, true), secs: dv.getUint16(r + 0x54, true), rating: dv.getUint8(r + 0x59),
      title: s(17), path: s(20), anlz: s(14), comment: s(16) };
    if (t.path) db.tracks.set(t.id, t);
  },
  1: (dv, r, db) => db.genres.set(dv.getUint32(r, true), rbStr(dv, r + 4)),
  2: (dv, r, db) => {   // artist: the name is near (one byte offset) or far (two bytes) depending on the row subtype
    const far = dv.getUint16(r, true) === 0x64;
    db.artists.set(dv.getUint32(r + 4, true), rbStr(dv, r + (far ? dv.getUint16(r + 0x0a, true) : dv.getUint8(r + 9))));
  },
  5: (dv, r, db) => db.keys.set(dv.getUint32(r, true), rbStr(dv, r + 8)),
  7: (dv, r, db) => db.lists.push({ parent: dv.getUint32(r, true), order: dv.getUint32(r + 8, true), id: dv.getUint32(r + 12, true), folder: dv.getUint32(r + 16, true) !== 0, name: rbStr(dv, r + 20) }),
  8: (dv, r, db) => db.entries.push({ idx: dv.getUint32(r, true), track: dv.getUint32(r + 4, true), list: dv.getUint32(r + 8, true) }),
  11: (dv, r, db) => db.lists.push({ parent: -1, order: dv.getUint32(r, true), id: 'h' + dv.getUint32(r, true), folder: false, hist: true, name: rbStr(dv, r + 4) }),
  12: (dv, r, db) => db.entries.push({ track: dv.getUint32(r, true), list: 'h' + dv.getUint32(r + 4, true), idx: dv.getUint32(r + 8, true) }),
};
function rbParsePdb(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 0x1c || dv.getUint32(0, true) !== 0) throw new Error('This is not a rekordbox database');
  const pageLen = dv.getUint32(4, true), nT = dv.getUint32(8, true);
  if (pageLen < 512 || pageLen > 65536 || nT < 1 || nT > 64) throw new Error('This is not a rekordbox database');
  const db = { tracks: new Map(), artists: new Map(), keys: new Map(), genres: new Map(), lists: [], entries: [] };
  for (let i = 0; i < nT; i++) {
    const o = 0x1c + i * 16, type = dv.getUint32(o, true), last = dv.getUint32(o + 12, true), row = RB_ROWS[type];
    if (!row) continue;
    for (let p = dv.getUint32(o + 8, true), guard = 0; guard < 200000; guard++) {
      const base = p * pageLen;
      if (!p || base + pageLen > buf.byteLength) break;
      // a data page of this table (0x40 in the flags marks an index page)
      if (dv.getUint32(base + 8, true) === type && !(dv.getUint8(base + 0x1b) & 0x40)) {
        const nOfs = (dv.getUint8(base + 0x18) | dv.getUint8(base + 0x19) << 8 | dv.getUint8(base + 0x1a) << 16) & 0x1fff;
        // row offsets sit at the end of the page in groups of 16, each with a bit mask of the rows still present
        for (let g = 0; g * 16 < nOfs; g++) {
          const gb = base + pageLen - g * 0x24, present = dv.getUint16(gb - 4, true);
          for (let k = 0; k < 16 && g * 16 + k < nOfs; k++) {
            if (!(present >> k & 1)) continue;
            const r = base + 0x28 + dv.getUint16(gb - 6 - 2 * k, true);
            if (r + 0x20 > base + pageLen) continue;
            try { row(dv, r, db); } catch (e) {}   // a damaged row is skipped, the rest still loads
          }
        }
      }
      if (p === last) break;
      p = dv.getUint32(base + 0x0c, true);
    }
  }
  for (const t of db.tracks.values()) { t.artistName = db.artists.get(t.artist) || ''; t.keyName = db.keys.get(t.key) || ''; t.genreName = db.genres.get(t.genre) || ''; }
  db.entries.sort((a, b) => a.idx - b.idx);
  db.lists.sort((a, b) => a.order - b.order);
  return db;
}
// The tracks of a playlist, in its order.
const rbListTracks = (db, id) => db.entries.filter(e => e.list === id).map(e => db.tracks.get(e.track)).filter(Boolean);

// ---------- ANLZ analysis files ----------
const RB_MEMORY_COLS = [null, '#ff4fa0', '#ff3030', '#ff9020', '#f0d020', '#30d040', '#20c8d8', '#3070ff', '#a050ff'];
// Adds what the file holds to out = { beats: [{n, bpm, t}], cues: [{t, end, hot, name, color}] }. Times in seconds; hot 0 = memory cue, 1.. = A..
function rbParseAnlz(buf, out = {}) {
  const dv = new DataView(buf), tag = at => String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
  if (buf.byteLength < 12 || tag(0) !== 'PMAI') return out;
  const basic = [], ext = [];
  for (let at = dv.getUint32(4); at + 12 <= buf.byteLength;) {
    const id = tag(at), head = dv.getUint32(at + 4), len = dv.getUint32(at + 8), end = Math.min(buf.byteLength, at + len);
    if (len < 12) break;
    if (id === 'PQTZ') {
      const n = dv.getUint32(at + 20), beats = [];
      for (let i = 0, p = at + head; i < n && p + 8 <= end; i++, p += 8) beats.push({ n: dv.getUint16(p), bpm: dv.getUint16(p + 2) / 100, t: dv.getUint32(p + 4) / 1000 });
      if (beats.length) out.beats = beats;
    } else if (id === 'PCOB') {
      for (let p = at + head; p + 40 <= end && tag(p) === 'PCPT';) {
        const el = dv.getUint32(p + 8);
        const type = dv.getUint8(p + 28);
        if (type === 1 || type === 2) {   // 1 = cue, 2 = loop (the status word before it is 0 on most real cues)
          const loop = type === 2, t = dv.getUint32(p + 32) / 1000;
          basic.push({ t, end: loop ? dv.getUint32(p + 36) / 1000 : undefined, hot: dv.getUint32(p + 12), name: '', color: null });
        }
        if (el < 16) break;
        p += el;
      }
    } else if (id === 'PCO2') {
      for (let p = at + head; p + 28 <= end && tag(p) === 'PCP2';) {
        const el = dv.getUint32(p + 8), type = dv.getUint8(p + 16);
        if (type === 1 || type === 2) {
          const c = { t: dv.getUint32(p + 20) / 1000, end: type === 2 ? dv.getUint32(p + 24) / 1000 : undefined, hot: dv.getUint32(p + 12), name: '', color: null };
          if (!c.hot && p + 29 <= end) c.color = RB_MEMORY_COLS[dv.getUint8(p + 28)] || null;
          if (el > 44 && p + 44 <= end) {
            const nc = dv.getUint32(p + 40);
            if (nc >= 0 && p + 44 + nc <= Math.min(end, p + el)) {
              if (nc >= 2) c.name = new TextDecoder('utf-16be').decode(new Uint8Array(buf, p + 44, nc)).replace(/\0+$/, '');
              const q = p + 44 + nc;   // colour code, then red, green, blue (hot cues); present with or without a name
              if (c.hot && q + 4 <= Math.min(end, p + el) && (dv.getUint8(q + 1) || dv.getUint8(q + 2) || dv.getUint8(q + 3))) c.color = '#' + [1, 2, 3].map(k => dv.getUint8(q + k).toString(16).padStart(2, '0')).join('');
            }
          }
          ext.push(c);
        }
        if (el < 16) break;
        p += el;
      }
    }
    at += len;
  }
  // the extended list (.EXT) has every hot cue, names and colours; the basic one is the fallback
  const cues = ext.length ? ext : basic;
  if (cues.length && (ext.length || !(out.cues && out.cues.length))) out.cues = cues.sort((a, b) => a.t - b.t);
  return out;
}
// One steady grid from rekordbox's beat list: { bpm, grid0 } with grid0 on a first beat of the bar, or null when the
// tempo changes along the track (this app's grid is one tempo, so its own analysis is used instead).
function rbGrid(beats) {
  if (!beats || beats.length < 16) return null;
  let lo = Infinity, hi = 0;
  for (const b of beats) { if (b.bpm < lo) lo = b.bpm; if (b.bpm > hi) hi = b.bpm; }
  if (!(lo > 20) || hi - lo > 0.02) return null;
  const bl = 60 / lo, n = beats.length;
  let off = 0;
  for (let i = 0; i < n; i++) off += beats[i].t - i * bl;
  off /= n;
  for (let i = 0; i < n; i++) if (Math.abs(beats[i].t - (off + i * bl)) > 0.03) return null;
  let k = beats.findIndex(b => b.n === 1);
  if (k < 0) k = 0;
  return { bpm: lo, grid0: off + k * bl };
}
// rekordbox shows keys as "Am" / "F#" or as "8A" / "4B" (the user's choice): both to { key, camelot }.
function rbKey(name) {
  const s = (name || '').trim();
  let m = /^(\d{1,2})\s*([ABabMmDd])$/.exec(s);   // Camelot "8A" / "4B", or Open Key "1m" / "6d"
  const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const L = m[2].toUpperCase(), minor = L === 'A' || L === 'M', num = L === 'M' || L === 'D' ? (+m[1] + 6) % 12 + 1 : +m[1];   // Open Key 1d = C = 8B
    const pc = ((num - 1 - (minor ? 4 : 7) + 12) * 7) % 12;
    return { key: NAMES[pc] + (minor ? 'm' : ''), camelot: num + (minor ? 'A' : 'B') };
  }
  m = /^([A-Ga-g])([#b♯♭]?)\s*(m|min|minor|maj|major)?$/.exec(s);   // "Am", "F#", "Emin", "Fmaj"
  if (!m) return null;
  const pc = ([9, 11, 0, 2, 4, 5, 7]['ABCDEFG'.indexOf(m[1].toUpperCase())] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? 11 : 0)) % 12, minor = !!m[3] && !m[3].startsWith('ma');
  return { key: NAMES[pc] + (minor ? 'm' : ''), camelot: ((pc * 7) % 12 + (minor ? 4 : 7)) % 12 + 1 + (minor ? 'A' : 'B') };
}

// ---------- the stick ----------
// root: the folder that holds PIONEER (the stick itself). When the browser will not hand out a whole drive, the user
// picks the PIONEER folder (pio) and then the folder the music is in (music) instead.
// files: the other way in, for browsers and shells whose folder picker hands nothing back: a plain folder upload input,
// every file of the picked folder keyed by its lower-case path on the stick (nothing can be remembered for the next start).
const rb = { root: null, pio: null, music: null, files: null, db: null, lists: [], pending: false, busy: false, meta: new Map() };
const canRekordbox = typeof window !== 'undefined';
const canRbHandles = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
const rbKeyOf = path => '/' + rbParts(path).join('/').toLowerCase();
const rbParts = p => p.split(/[\\/]+/).filter(Boolean);
async function rbWalk(dir, parts) {
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}
// A file by its path on the stick ("/Contents/Artist/Album/song.mp3", "/PIONEER/USBANLZ/.../ANLZ0000.DAT").
async function rbFile(path) {
  const ps = rbParts(path);
  if (rb.files) { const f = rb.files.get(rbKeyOf(path)); if (!f) throw new Error('not in the picked folder'); return f; }
  if (rb.root) return rbWalk(rb.root, ps);
  if (ps[0] && ps[0].toUpperCase() === 'PIONEER' && rb.pio) return rbWalk(rb.pio, ps.slice(1));
  if (rb.music) {
    const at = ps.findIndex(x => x.toLowerCase() === rb.music.name.toLowerCase());
    return rbWalk(rb.music, at >= 0 ? ps.slice(at + 1) : ps);
  }
  throw new Error('no folder');
}
async function rbHas(dir, parts) { try { await rbWalk(dir, parts); return true; } catch (e) { return false; } }
// Works out what the picked folder is and reads the database. Returns false (with a status line) when it is not a rekordbox stick.
async function rbUse(dir) {
  rb.root = rb.pio = rb.files = null;
  if (await rbHas(dir, ['PIONEER', 'rekordbox', 'export.pdb'])) rb.root = dir;
  else if (await rbHas(dir, ['rekordbox', 'export.pdb'])) rb.pio = dir;
  else {
    const plus = await rbHas(dir, ['PIONEER', 'rekordbox', 'exportLibrary.db']);
    setStatus(plus ? 'This stick only has the newer Device Library Plus database, which cannot be read. In rekordbox, export it again with the standard Device Library on.'
      : 'No rekordbox export in "' + dir.name + '": pick the USB stick itself (the folder that holds PIONEER)');
    return false;
  }
  rb.db = rbParsePdb(await (await rbFile('/PIONEER/rekordbox/export.pdb')).arrayBuffer());
  return true;
}
async function rbPick() {
  if (!entGate('rekordbox')) return;
  if (!canRbHandles) { rbPickPlain(false); return; }
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'strodano-rekordbox', mode: 'read' }); }
  catch (e) { rbNoFolder(e); return; }
  try { if (!await rbUse(dir)) return; } catch (e) { setStatus('Could not read the rekordbox database: ' + (e.message || e)); return; }
  rb.music = null; rb.lists = [];
  rbDialog();
}
// The picker closed without a folder: cancelled, or refused (a whole drive, or a shell that does not allow it). A
// cancel and a refusal look the same from here, so say so and offer the plain folder input, which every browser has.
function rbNoFolder(e) {
  const why = e && e.name && e.name !== 'AbortError' ? ' (' + e.name + ')' : '';
  setStatus('No folder was opened' + why);
  entDialog('REKORDBOX', 'No folder was opened', 'The folder picker closed without handing over a folder' + why + '. If you did not cancel it, this browser refused that folder: use the other way, which reads the stick as a one-off (it asks again on the next start).',
    [entBtn('Cancel', entClose), entBtn('Try again', () => { entClose(); rbPick(); }), entBtn('Open the stick another way', () => { entClose(); rbPickPlain(false); }, true)]);
}
// The plain folder input. add = the second pick (the songs folder) on top of a PIONEER folder picked first.
function rbPickPlain(add) {
  const inp = el('input', { type: 'file', multiple: true, style: { display: 'none' } });
  inp.webkitdirectory = true;
  inp.addEventListener('change', () => { const fs = [...inp.files]; inp.remove(); rbUseFiles(fs, add); });
  document.body.append(inp);
  inp.click();
}
async function rbUseFiles(fs, add) {
  {
    if (!fs.length) { setStatus('That folder is empty, or the browser did not hand over its files'); return; }
    setStatus('Reading ' + fs.length + ' file names from the stick...');
    const keys = fs.map(f => '/' + (f.webkitRelativePath || f.name).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase());
    if (!add) {
      // where the stick starts inside the picked folder: whatever comes before /pioneer/rekordbox/export.pdb
      const tail = '/pioneer/rekordbox/export.pdb', at = keys.findIndex(k => k.endsWith(tail));
      if (at < 0) { setStatus(keys.some(k => k.endsWith('/pioneer/rekordbox/exportlibrary.db')) ? 'This stick only has the newer Device Library Plus database, which cannot be read. In rekordbox, export it again with the standard Device Library on.' : 'No rekordbox export in that folder: pick the USB stick itself, or its PIONEER folder'); return; }
      const pre = keys[at].slice(0, -tail.length);
      rb.root = rb.pio = rb.music = null; rb.lists = [];
      rb.files = new Map();
      keys.forEach((k, i) => { if (k.startsWith(pre + '/')) rb.files.set(k.slice(pre.length), fs[i]); });
      try { rb.db = rbParsePdb(await fs[at].arrayBuffer()); } catch (e) { rb.files = null; setStatus('Could not read the rekordbox database: ' + (e.message || e)); return; }
    } else if (rb.files) keys.forEach((k, i) => rb.files.set(k, fs[i]));   // "Contents/..." as picked
    setStatus('rekordbox stick opened: ' + rb.db.tracks.size + ' songs');
    rbDialog();
  }
}
// Second pick, only when the PIONEER folder was chosen instead of the stick: where the songs are.
async function rbPickMusic() {
  if (rb.files) { rbPickPlain(true); return; }
  try { rb.music = await window.showDirectoryPicker({ id: 'strodano-rekordbox-music', mode: 'read' }); } catch (e) { return; }
  rbDialog();
}
function rbTree(parent, depth, out) {
  for (const l of rb.db.lists.filter(x => x.parent === parent && !x.hist)) {
    out.push({ l, depth });
    if (l.folder) rbTree(l.id, depth + 1, out);
  }
  return out;
}
function rbDialog() {
  const db = rb.db, rows = rbTree(0, 0, []), hist = db.lists.filter(l => l.hist);
  const count = id => db.entries.reduce((n, e) => n + (e.list === id), 0);
  const line = (l, depth) => {
    const n = l.folder ? 0 : count(l.id);
    return el(l.folder ? 'div' : 'button', { textContent: (l.folder ? '▾ ' : '') + (l.name || 'Untitled') + (l.folder ? '' : '   ' + n + ' song' + (n === 1 ? '' : 's')), disabled: !l.folder && !n,
      onclick: l.folder ? null : () => { entClose(); rbImport([l.id]); },
      style: { display: 'block', width: '100%', textAlign: 'left', font: 'inherit', padding: '8px 10px 8px ' + (10 + depth * 18) + 'px', margin: '0', border: '0', borderBottom: '1px solid var(--line)', background: 'none',
        color: l.folder ? 'var(--dim)' : 'var(--txt)', cursor: l.folder ? 'default' : 'pointer', fontWeight: l.folder ? '600' : '400', opacity: !l.folder && !n ? '.45' : '1' } });
  };
  const list = el('div', { style: { maxHeight: '46vh', overflowY: 'auto', margin: '14px 0 0', border: '1px solid var(--line)', borderRadius: '8px' } },
    ...rows.map(x => line(x.l, x.depth)),
    hist.length ? el('div', { textContent: 'Played sets (history)', style: { padding: '8px 10px', color: 'var(--dim)', fontWeight: '600', borderBottom: '1px solid var(--line)' } }) : null,
    ...hist.map(l => line(l, 1)));
  // files mode: the songs are missing when not one of the first tracks is among the picked files
  const needMusic = rb.files ? ![...db.tracks.values()].slice(0, 200).some(t => rb.files.has(rbKeyOf(t.path))) : !rb.root && !rb.music;
  entDialog('REKORDBOX', needMusic ? 'One more folder' : 'Choose a playlist',
    needMusic ? 'You picked the PIONEER folder. Now pick the folder on the stick that holds the songs (usually "Contents").'
      : db.tracks.size + ' songs on this stick. A playlist is added to the end of the track list with its beat grids, keys and cue points.',
    needMusic ? [entBtn('Cancel', entClose), entBtn('Pick the songs folder', rbPickMusic, true)]
      : [entBtn('Cancel', entClose), entBtn('All ' + db.tracks.size + ' songs', () => { entClose(); rbImport(null); })],
    needMusic ? null : rows.length || hist.length ? list : el('div', { textContent: 'This stick has no playlists: use "All songs".', style: { marginTop: '14px', color: 'var(--dim)' } }));
}
// What rekordbox knows about one song, in this app's terms.
async function rbMeta(tr) {
  const m = { title: tr.title, artist: tr.artistName, bpm: tr.bpm, keyName: tr.keyName, cues: [], grid: null, dynamic: false };
  if (tr.anlz) {
    const a = {};
    for (const p of [tr.anlz, tr.anlz.replace(/\.DAT$/i, '.EXT')]) { try { rbParseAnlz(await (await rbFile(p)).arrayBuffer(), a); } catch (e) {} }
    m.cues = a.cues || [];
    m.grid = rbGrid(a.beats);
    m.dynamic = !!a.beats && !m.grid;
  }
  return m;
}
// ids: playlist ids, or null for every song on the stick. Songs go to the track list in playlist order.
async function rbImport(ids, quiet) {
  if (rb.busy || !rb.db) return;
  rb.busy = true;
  try {
    const seen = new Set(), want = [];
    for (const tr of ids ? ids.flatMap(id => rbListTracks(rb.db, id)) : [...rb.db.tracks.values()]) if (!seen.has(tr.id)) { seen.add(tr.id); want.push(tr); }
    const files = [];
    let lost = 0, cued = 0, grids = 0, dyn = 0;
    for (let i = 0; i < want.length; i++) {
      if (!quiet && i % 10 === 0) setStatus('Reading the rekordbox stick: ' + i + ' of ' + want.length + ' songs...');
      let f;
      try { f = await rbFile(want[i].path); } catch (e) { lost++; continue; }
      const m = await rbMeta(want[i]);
      rb.meta.set(fileKey(f), m);
      cued += m.cues.length > 0; grids += !!m.grid; dyn += m.dynamic;
      files.push(f);
    }
    for (const t of crate.tracks) rbAttach(t);   // songs that were already in the list get their cues too
    const n = crateAdd(files);
    crateDirty();
    if (ids) rb.lists = [...new Set(rb.lists.concat(ids))]; else rb.lists = [null];
    if (!rb.files) {   // only folder handles can be kept for the next start (initRekordbox)
      rb.saved = { root: rb.root, pio: rb.pio, music: rb.music, lists: rb.lists };
      folderStore('put', rb.saved, 'rekordbox').catch(() => {});
      ui.browserDirty = true;
    }
    if (!quiet || lost) setStatus(files.length ? `rekordbox: ${n} song(s) added` + (files.length - n ? `, ${files.length - n} already in the list` : '') + `, ${cued} with cue points, ${grids} with rekordbox's beat grid` +
      (dyn ? `, ${dyn} with a changing tempo (own analysis used)` : '') + (lost ? `, ${lost} file(s) not found on the stick` : '')
      : lost ? `rekordbox: none of the ${lost} song file(s) were found. Pick the stick itself, not a folder inside it.` : 'That playlist is empty');
  } catch (e) { setStatus('rekordbox import stopped: ' + (e.message || e)); }
  rb.busy = false;
}
// Called for every new track list entry (crate.js newTrack): rekordbox's title, cues and beat grid, when it came from a stick.
function rbAttach(t) {
  const m = rb.meta.get(t.key);
  if (!m || t.rb === m) return;
  t.rb = m;
  if (m.title) t.name = (m.artist ? m.artist + ' - ' : '') + m.title;
  // analysed before with another grid: once more with rekordbox's, unless it is on a deck right now
  if (m.grid && t.info && t.info.rb !== hintSig(m.grid) && !audio.decks.some(d => d.file && fileKey(d.file) === t.key)) { t.info = null; t.state = 'queued'; analyseQueue(); }
  else rbApply(t);
}
// After an analysis: rekordbox's key wins over the one worked out here (the DJ may have corrected it).
function rbApply(t) {
  const k = t.rb && t.info && rbKey(t.rb.keyName);
  if (k) { t.info.key = k.key; t.info.camelot = k.camelot; }
}

// ---------- the next start ----------
async function initRekordbox() {
  if (!canRbHandles) return;
  let s = null;
  try { s = await folderStore('get', null, 'rekordbox'); } catch (e) {}
  if (!s || !(s.root || s.pio)) return;
  rb.saved = s;
  let ok = true;
  for (const h of [s.root, s.pio, s.music]) { if (!h) continue; try { if (await h.queryPermission({ mode: 'read' }) !== 'granted') ok = false; } catch (e) { ok = false; } }
  if (ok) await rbReload(); else { rb.pending = true; ui.browserDirty = true; }
}
async function rbReload() {
  const s = rb.saved;
  rb.pending = false;
  try {
    rb.root = s.root || null; rb.pio = s.pio || null; rb.music = s.music || null; rb.files = null;
    rb.db = rbParsePdb(await (await rbFile('/PIONEER/rekordbox/export.pdb')).arrayBuffer());
    rb.lists = [];
    const ids = (s.lists || []).filter(id => id === null || rb.db.lists.some(l => l.id === id));
    if (ids.length) await rbImport(ids.includes(null) ? null : ids, true);
  } catch (e) { rb.db = null; }   // the stick is not plugged in: nothing to bring back
}
// From the Reconnect button (mediafolder.js), so inside a click.
async function rbReconnect() {
  if (!rb.pending || !rb.saved) return;
  try {
    for (const h of [rb.saved.root, rb.saved.pio, rb.saved.music]) if (h && await h.requestPermission({ mode: 'read' }) !== 'granted') return;
    await rbReload();
  } catch (e) { rb.pending = false; }
}

function rbForget() {
  folderStore('delete', null, 'rekordbox').catch(() => {});
  rb.saved = null; rb.pending = false; rb.lists = []; ui.browserDirty = true;
  setStatus('rekordbox stick forgotten: its songs stay in the list until the next start');
}

// ---------- on screen ----------
// Files tab (ui.js): the remembered stick, with Reconnect when the browser wants a click again.
function rbRow() {
  const s = rb.saved;
  if (!s) return null;
  const nm = (s.root || s.pio).name || 'USB stick';
  return el('div', { className: 'fld' }, el('span', { className: 'hint', style: { flex: '1' }, textContent: rb.pending ? `rekordbox stick "${nm}" needs permission again` : `rekordbox stick "${nm}": its playlists reload on every start` }),
    rb.pending ? el('button', { className: 'on', textContent: 'Reconnect', onclick: reconnectMediaFolder }) : null,
    el('button', { textContent: 'Forget', title: 'Stop reloading playlists from this stick', onclick: rbForget }));
}
const rbButton = () => (canRekordbox ? el('button', { textContent: 'rekordbox USB...', title: 'Bring in a playlist from a USB stick exported by rekordbox, with its beat grids and cue points' + (entCan('rekordbox') ? '' : ' (Pro)'), onclick: rbPick }) : null);
const rbCueCol = c => c.color || (c.hot ? '#30d040' : '#ff3030');
const rbCueTag = c => (c.hot ? String.fromCharCode(64 + Math.min(c.hot, 26)) : '');
const rbCueTitle = c => (c.hot ? 'Hot cue ' + rbCueTag(c) : c.end !== undefined ? 'Loop' : 'Memory cue') + (c.name ? ': ' + c.name : '') + ' at ' + mmss(c.t);
// A cue's place in the song as the browser decodes it: rekordbox's time plus the song's beat correction (analysis.js gridShift).
const rbT = (t, info) => t + ((info && info.gridShift) || 0);
const rbCuesOf = d => { const t = trackOf(d); return t && t.rb && t.rb.cues.length ? t.rb.cues : null; };
// Deck waveform (dj.js drawDeck): a coloured line with its letter on the scrolling part, a tick on the overview strip.
function rbDrawDeck(x, d, t0, span, W, zh, oy, oh, dpr) {
  const cues = rbCuesOf(d);
  if (!cues) return;
  const dur = d.info.duration, at = c => rbT(c.t, d.info);
  x.font = '700 ' + 10 * dpr + 'px Inter, system-ui, sans-serif'; x.textAlign = 'left';
  for (const c of cues) {
    const col = rbCueCol(c);
    x.fillStyle = col; x.fillRect(Math.round(at(c) / dur * W), oy, Math.max(2, Math.round(2 * dpr)), Math.round(oh * 0.45));
    if (at(c) < t0 || at(c) > t0 + span) continue;
    const px = Math.round((at(c) - t0) / span * W), lab = rbCueTag(c) || (c.end !== undefined ? 'LOOP' : 'CUE'), text = c.name ? lab + ' ' + c.name.slice(0, 18) : lab, y = 16 * dpr;
    if (c.end !== undefined) { x.globalAlpha = 0.18; x.fillRect(px, y, Math.max(1, (c.end - c.t) / span * W), zh - y); x.globalAlpha = 1; }
    x.fillRect(px, y, Math.max(1, Math.round(2 * dpr)), zh - y);
    x.fillRect(px, y, x.measureText(text).width + 8 * dpr, 13 * dpr);
    x.fillStyle = '#000'; x.fillText(text, px + 4 * dpr, y + 10 * dpr);
  }
}
// Deck cue buttons (dj.js tickDJ): one per cue of the loaded song, rebuilt only when the song changes.
function rbDeckCues(u) {
  const t = trackOf(u.d), cues = rbCuesOf(u.d);
  if (t && t.rb && t.rb.title && u.d.name !== t.name) u.d.name = t.name;   // rekordbox's artist and title instead of the file name
  if (u.hotFor === cues) return;
  u.hotFor = cues;
  u.hot.textContent = '';
  u.hot.hidden = !cues;
  if (!cues) return;
  u.hot.append(el('span', { className: 'hint', textContent: 'Cues' }), ...cues.slice(0, 24).map(c => el('button', {
    textContent: (rbCueTag(c) || mmss(c.t)) + (c.name ? ' ' + c.name.slice(0, 14) : ''), title: rbCueTitle(c) + ': jump there',
    style: { borderColor: rbCueCol(c), boxShadow: 'inset 3px 0 0 ' + rbCueCol(c) }, onclick: () => deckSeek(u.d, rbT(c.t, u.d.info)) })));
}
// Playlist row (playlist.js plRow): cue marks along the top of the song's waveform; a click jumps the show there.
function rbPlCues(t, wave) {
  const dur = t.info && t.info.duration;
  if (!dur || !t.rb) return;
  for (const c of t.rb.cues) {
    const m = el('i', { className: 'rbcue', title: rbCueTitle(c) + ' (click to jump here)', textContent: rbCueTag(c), style: { left: (100 * rbT(c.t, t.info) / dur).toFixed(3) + '%', background: rbCueCol(c) } });
    m.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.button === 0) plJump(t, rbT(c.t, t.info) / dur); });
    wave.append(m);
  }
}
if (typeof document !== 'undefined') document.head.append(Object.assign(document.createElement('style'), { textContent:
  '.rbcue{position:absolute;top:0;width:11px;height:11px;margin-left:-1px;font:700 8px/11px Inter,system-ui,sans-serif;font-style:normal;text-align:center;color:#000;cursor:pointer;z-index:2;border-radius:0 0 3px 0}' +
  '.rbcue:hover{transform:scale(1.4);transform-origin:0 0}' +
  '.deck .dhot{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:6px}.deck .dhot button{padding:2px 8px;font-size:11px}' }));
