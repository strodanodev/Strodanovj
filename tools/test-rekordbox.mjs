// Runs the rekordbox parsers (web/rekordbox.js) on real files, outside the browser.
//   node tools/test-rekordbox.mjs <export.pdb> [folder with ANLZ*.DAT / .EXT files, searched 3 levels deep]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../web/rekordbox.js'), 'utf8');
const rbx = new Function(src + '\nreturn { rbParsePdb, rbListTracks, rbParseAnlz, rbGrid, rbKey };')();
const ab = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const [pdb, anlz] = process.argv.slice(2);
if (pdb) {
  const db = rbx.rbParsePdb(ab(pdb));
  console.log(`tracks ${db.tracks.size}, artists ${db.artists.size}, keys ${db.keys.size}, genres ${db.genres.size}, playlists ${db.lists.length}, entries ${db.entries.length}`);
  for (const l of db.lists.slice(0, 12)) console.log(`  ${l.folder ? 'folder' : l.hist ? 'history' : 'list  '} ${String(l.id).padStart(4)} parent ${l.parent}  "${l.name}"  ${rbx.rbListTracks(db, l.id).length} songs`);
  const ts = [...db.tracks.values()];
  for (const t of ts.slice(0, 5)) console.log('  track', JSON.stringify({ id: t.id, title: t.title, artist: t.artistName, bpm: t.bpm, key: t.keyName, secs: t.secs, path: t.path, anlz: t.anlz }));
  const bad = ts.filter(t => !t.title || !/^[\\/]/.test(t.path) || !(t.bpm >= 0 && t.bpm < 400)).length, orphans = db.entries.filter(e => !db.tracks.has(e.track)).length;
  { const ks = [...new Set(ts.map(x => x.keyName).filter(Boolean))], no = ks.filter(k => !rbx.rbKey(k)); console.log(`  key names ${ks.length}, not understood: ${no.join(' ') || 'none'}`); }
  console.log(`  suspicious tracks: ${bad}, playlist entries pointing at no track: ${orphans}, keys: ${[...new Set(ts.map(t => t.keyName))].slice(0, 30).join(' ')}`);
}
if (anlz) {
  const dats = [];
  const walk = (d, depth) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (depth < 3) walk(p, depth + 1); } else if (/\.DAT$/i.test(n)) dats.push(p); } };
  walk(anlz, 0);
  let grids = 0, dyn = 0, noBeats = 0, cued = 0, cues = 0, hot = 0, named = 0, coloured = 0, loops = 0, badT = 0, shown = 0;
  for (const p of dats) {
    const a = {};
    for (const f of [p, p.replace(/\.DAT$/i, '.EXT')]) { try { rbx.rbParseAnlz(ab(f), a); } catch (e) { if (e.code !== 'ENOENT') console.log('  failed', f, e.message); } }
    const g = rbx.rbGrid(a.beats);
    if (g) grids++; else if (a.beats) dyn++; else noBeats++;
    const cs = a.cues || [];
    if (cs.length) cued++;
    cues += cs.length;
    for (const c of cs) { hot += c.hot > 0; named += !!c.name; coloured += !!c.color; loops += c.end !== undefined; badT += !(c.t >= 0 && c.t < 7200) || c.hot > 16; }
    if (cs.length > 2 && g && shown < 4) { shown++; console.log('  sample', JSON.stringify({ grid: { bpm: g.bpm, grid0: +g.grid0.toFixed(3) }, beats: a.beats.length, cues: cs })); }
  }
  console.log(`analysis files ${dats.length}: steady grid ${grids}, changing tempo ${dyn}, no beat list ${noBeats}; songs with cues ${cued}, cues ${cues} (hot ${hot}, named ${named}, coloured ${coloured}, loops ${loops}), implausible ${badT}`);
}
for (const k of ['8A', '11B', 'Am', 'F#m', 'Db', 'Bbm', 'C', 'Emin', 'Fmaj', 'A#maj', '1d', '1m', '7m']) console.log('  key', k, JSON.stringify(rbx.rbKey(k)));
