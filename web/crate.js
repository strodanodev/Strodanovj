// Strodano VJ (web) - track list: analyse tracks once, remember the results, suggest what to play next. GPL-3.0.
// Analyses are kept in IndexedDB by file name, size and date, so a track added again (or found again in the media
// folder after a restart) is ready at once. The list itself lasts for the session; the media folder brings it back.
'use strict';
const crate = { tracks: [], busy: false, sel: null };   // track: { key, file, name, info, state: queued | analysing | ready | error, played, energy }
const fileKey = f => f.name + '|' + f.size + '|' + f.lastModified;

function trackDB(op, key, value) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('strodano-vj-tracks', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('analysis');
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result, tx = db.transaction('analysis', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('analysis');
      const r = op === 'get' ? st.get(key) : st.put(value, key);
      tx.oncomplete = () => { db.close(); resolve(r.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
const ANALYSIS_VERSION = 2;   // raise when analyseTrack changes what it returns, so old results are worked out again
async function cachedAnalysis(file) {
  try { const v = await trackDB('get', fileKey(file)); return v && v.v === ANALYSIS_VERSION ? v.info : null; } catch (e) { return null; }
}
function storeAnalysis(file, info) { trackDB('put', fileKey(file), { v: ANALYSIS_VERSION, info }).catch(() => {}); }

// Called by deckLoad (audio.js): the cached analysis, or a new one that is then cached and listed.
async function crateInfo(file, buf) {
  let t = crate.tracks.find(x => x.key === fileKey(file));
  if (t && t.info) return t.info;
  let info = await cachedAnalysis(file);
  if (!info) { info = await analyseAsync(monoOf(buf), buf.sampleRate); storeAnalysis(file, info); }
  if (!t) { t = newTrack(file); crate.tracks.push(t); }
  t.info = info; t.state = 'ready'; rankEnergy(); crateDirty();
  return info;
}
function newTrack(file) { return { key: fileKey(file), file, name: file.name.replace(/\.[^.]+$/, ''), info: null, state: 'queued', played: false, energy: 0 }; }

function crateAdd(files) {
  let n = 0;
  for (const f of files) {
    if (!isAudioFile(f) || crate.tracks.some(t => t.key === fileKey(f))) continue;
    crate.tracks.push(newTrack(f)); n++;
  }
  if (n) { crateDirty(); analyseQueue(); }
  return n;
}
// One track at a time: a decoded six-minute track is over 100 MB, so they are never all held at once.
async function analyseQueue() {
  if (crate.busy) return;
  crate.busy = true;
  try {
    for (let t; (t = crate.tracks.find(x => x.state === 'queued'));) {
      t.state = 'analysing'; crateDirty();
      try {
        let info = await cachedAnalysis(t.file);
        if (!info) {
          // an offline context decodes without starting audio, so tracks found in the media folder at start-up need no click
          const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await t.file.arrayBuffer());
          info = await analyseAsync(monoOf(buf), buf.sampleRate);
          storeAnalysis(t.file, info);
        }
        t.info = info; t.state = 'ready';
      } catch (e) { t.state = 'error'; }
      rankEnergy(); crateDirty();
    }
  } finally { crate.busy = false; }
}
// Energy 1..10, relative to the other tracks in the list (loudness and how busy the drums are). The list's range is
// stretched over 1..10 only when the tracks really differ: two near-identical tracks both land near the middle.
function rankEnergy() {
  const r = crate.tracks.filter(t => t.info);
  const raw = t => t.info.loudDb / 3 + Math.log2(1 + t.info.flux) * 2;   // 9 dB louder or drums twice as busy: about +3
  const vs = r.map(raw), lo = Math.min(...vs), hi = Math.max(...vs), mid = (lo + hi) / 2, span = Math.max(hi - lo, 3);
  for (const t of r) t.energy = Math.min(10, Math.max(1, Math.round(5.5 + 9 * (raw(t) - mid) / span)));
}

// ---------- what to play next ----------
// Camelot wheel: same key, one step round the wheel, or the relative major/minor mix cleanly.
function keyScore(a, b) {
  if (!a || !b) return 0.5;
  const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1), step = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  if (na === nb) return la === lb ? 1 : 0.85;
  if (la === lb && step === 1) return 0.9;
  if (la === lb && step === 2) return 0.5;
  return 0.1;
}
// Tempo change needed (as a fraction) for track info i to play at bpm, allowing for half and double time.
function tempoGap(i, bpm) {
  let r = bpm / i.bpm;
  while (r > 1.42) r /= 2;
  while (r < 0.71) r *= 2;
  return Math.abs(r - 1);
}
// 0..1, with the parts that made it, against the track playing on deck ref.
function suggestScore(t, ref) {
  const ri = ref.info, i = t.info;
  if (!i || !ri) return null;
  const g = i.ok && ri.ok ? tempoGap(i, ri.bpm * ref.rate) : 0.2;
  const ts = g <= 0.03 ? 1 : g <= 0.06 ? 0.65 : g <= 0.08 ? 0.35 : 0;
  const ks = keyScore(ri.camelot, i.camelot);
  const rt = crate.tracks.find(x => x.info === ri), de = t.energy - (rt ? rt.energy : t.energy);
  const es = de === 0 || de === 1 ? 1 : de === -1 || de === 2 ? 0.7 : 0.4;
  return { total: 0.45 * ts + 0.35 * ks + 0.2 * es, gap: g, ks, de };
}
// The deck the next track is chosen for: the one driving the visuals, else any playing deck.
const refDeck = () => audio.clockDeck || audio.decks.find(d => d.playing && d.info) || null;
function suggestions(ref = refDeck()) {
  if (!ref) return [];
  const loaded = new Set(audio.decks.map(d => d.file && fileKey(d.file)));
  return crate.tracks.filter(t => t.state === 'ready' && !t.played && !loaded.has(t.key))
    .map(t => ({ t, s: suggestScore(t, ref) })).filter(x => x.s).sort((a, b) => b.s.total - a.s.total);
}
function crateLoad(t, d) {
  if (!t || t.state === 'error' || d.playing) { if (d.playing) setStatus('Deck ' + d.id + ' is playing: pause it or load the other deck'); return; }
  deckLoad(d, t.file);
}
// Load the best next track into deck d (the MIDI "load" button, and autopilot).
function crateLoadNext(d) {
  const o = otherDeck(d), best = suggestions(o.playing ? o : refDeck())[0] || (!refDeck() && crate.tracks.find(t => t.state === 'ready' && !t.played));
  if (best) crateLoad(best.t || best, d); else setStatus('No more analysed tracks in the list to load');
}
// A track counts as played once it has been the deck driving the visuals for a while.
function crateMarkPlayed() {
  const d = audio.clockDeck;
  if (!d || !d.file || !d.playing || deckPos(d) < 30) return;
  const t = crate.tracks.find(x => x.key === fileKey(d.file));
  if (t && !t.played) { t.played = true; crateDirty(); }
}

// ---------- list UI ----------
let crateEl = null, crateRebuild = true;
function crateDirty() { crateRebuild = true; }
function buildCrate() {
  crateEl = el('div', { className: 'crate' });
  dropTarget(crateEl, hasFiles, e => { const n = crateAdd(e.dataTransfer.files); setStatus(n ? n + ' track(s) added to the list' : 'Drop audio files (MP3, WAV, FLAC, M4A...) here'); });
  return crateEl;
}
function renderCrate() {
  crateRebuild = false;
  if (!crateEl) return;
  const ref = refDeck(), sug = new Map(suggestions(ref).map((x, i) => [x.t, { ...x.s, rank: i }]));
  const head = el('div', { className: 'ch' },
    el('b', { textContent: 'Tracks' }),
    el('span', { className: 'hint', textContent: crate.tracks.length ? (ref ? 'Ranked as next track for deck ' + ref.id + ' by tempo, key and energy' : 'Play a track to get suggestions') : 'Drop audio files here or use Add tracks. The beat, key and energy are worked out once and remembered.' }),
    el('button', { textContent: 'Add tracks...', onclick: () => $('crateInput').click() }));
  const rows = crate.tracks.slice().sort((a, b) => {
    const sa = sug.get(a), sb = sug.get(b);
    if (sa && sb) return sa.rank - sb.rank;
    if (sa || sb) return sa ? -1 : 1;
    return a.played - b.played;
  }).map(t => {
    const i = t.info, s = sug.get(t);
    const fit = s ? (s.total >= 0.8 ? 'great' : s.total >= 0.6 ? 'good' : s.total >= 0.4 ? 'ok' : 'hard') : '';
    const why = s ? [s.gap <= 0.03 ? 'tempo matches' : s.gap <= 0.08 ? 'tempo ' + (s.gap * 100).toFixed(0) + '% off' : 'tempo too far: will cut',
      s.ks >= 0.85 ? 'key fits' : s.ks >= 0.5 ? 'key OK' : 'key clashes', s.de > 0 ? 'energy up' : s.de < 0 ? 'energy down' : 'same energy'].join(', ') : '';
    const r = el('div', { className: 'ct' + (t.played ? ' played' : '') + (crate.sel === t ? ' on' : ''), title: why || t.file.name, onclick: () => { crate.sel = t; crateDirty(); } },
      el('span', { className: 'fit ' + fit, textContent: fit ? { great: 'Great', good: 'Good', ok: 'OK', hard: 'Hard' }[fit] : '' }),
      el('span', { className: 'cn', textContent: t.name }),
      el('span', { className: 'cv', textContent: i ? (i.ok ? i.bpm.toFixed(1) : '-') : t.state === 'error' ? 'error' : t.state === 'analysing' ? '...' : '' }),
      el('span', { className: 'cv', textContent: i && i.camelot ? i.camelot : '' }),
      el('span', { className: 'cv', textContent: i ? 'E' + t.energy : '' }),
      el('span', { className: 'cv', textContent: i ? mmss(i.duration) : '' }),
      ...audio.decks.map(d => el('button', { textContent: d.id, title: 'Load into deck ' + d.id, disabled: t.state !== 'ready', onclick: ev => { ev.stopPropagation(); crateLoad(t, d); } })));
    r.addEventListener('dblclick', () => { const d = audio.decks.find(x => !x.playing); if (d) crateLoad(t, d); });
    return r;
  });
  crateEl.textContent = '';
  crateEl.append(head, el('div', { className: 'cl' }, ...rows));
}
let crateRefT = 0;
function tickCrate() {
  crateMarkPlayed();
  // suggestions follow the playing deck: re-rank when it changes, and now and then (energy, tempo changes)
  const now = performance.now(), ref = refDeck();
  if (ref !== tickCrate.ref || now - crateRefT > 3000) { tickCrate.ref = ref; crateRefT = now; crateRebuild = true; }
  if (crateRebuild && djUI.open) renderCrate();
}
function initCrate() {
  $('crateInput').addEventListener('change', e => { crateAdd(e.target.files); e.target.value = ''; });
}
