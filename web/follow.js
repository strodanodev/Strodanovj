// Strodano VJ (web) - following a DJ on external gear (CDJs, Traktor, a mixer): MIDI clock in, and recognising which
// analysed track is playing from the line-in, so its sections, section looks and track score still run. GPL-3.0.
// Recognition compares the loudness and bass share of each beat over the last 32-64 beats with every analysed track.
// Counted per beat, that pattern does not change with tempo, pitch or key lock, which is what external gear changes.
// It needs the live listener (live.js) locked on the beat, and the track in the track list. It is a best guess: it is
// shown with its confidence and can be dropped.
'use strict';

// ---------- MIDI clock (24 ticks a beat; start, continue, stop, song position) ----------
const mclk = { ticks: [], count: 0, running: true, lastT: 0, fit: null };
// Returns true when the message was MIDI clock (midi.js then ignores it).
function midiClockMsg(data, ts) {
  const s = data[0], t = (ts || performance.now()) / 1000;
  if (s === 0xf8) {
    mclk.count++; mclk.lastT = t;
    mclk.ticks.push([t, mclk.count / 24]);
    if (mclk.ticks.length > 97) mclk.ticks.shift();
    // least-squares line through the last four beats of ticks: steady through USB timing jitter
    const n = mclk.ticks.length;
    if (n >= 25) {
      let tm = 0, bm = 0;
      for (const [x, y] of mclk.ticks) { tm += x; bm += y; }
      tm /= n; bm /= n;
      let sxy = 0, sxx = 0;
      for (const [x, y] of mclk.ticks) { sxy += (x - tm) * (y - bm); sxx += (x - tm) ** 2; }
      if (sxx > 0) mclk.fit = { tm, bm, slope: sxy / sxx };
    }
    return true;
  }
  // start: the first tick after it is beat 0 (a bar start), so count from -1
  if (s === 0xfa) { mclk.count = -1; mclk.ticks = []; mclk.fit = null; mclk.running = true; return true; }
  if (s === 0xfb) { mclk.running = true; return true; }
  if (s === 0xfc) { mclk.running = false; return true; }
  if (s === 0xf2) { mclk.count = ((data[1] | (data[2] << 7)) * 6) - 1; mclk.ticks = []; mclk.fit = null; return true; }   // song position, in 16ths: the next tick is there
  return false;
}
// { beats, bpm } while clock is arriving (audio.js musicClock asks this after the decks, before the live listener).
function midiClock() {
  const now = performance.now() / 1000, f = mclk.fit;
  if (!f || !mclk.running || now - mclk.lastT > 0.5 || !(f.slope > 0.3 && f.slope < 5)) return null;
  const t = now - audio.offsetMs / 1000;
  return { beats: f.bm + (t - f.tm) * f.slope, bpm: f.slope * 60 };
}

// ---------- track recognition from the line-in ----------
const follow = { on: false, hist: [], lastBeat: null, match: null, cand: null, checkT: 0, best: null, seq: new WeakMap(), lost: 0, ref: null };
// Every beat the live listener completes: its level (log) and bass share, from the listener's 12 s ring buffer.
function collectBeats() {
  if (typeof live === 'undefined' || !live.locked || live.src === 'dj' || !live.count) return;   // keep the history: a short loss of lock is bridged above
  // The listener re-counts its beats when it re-locks or moves the first beat of the bar. Measure that jump at one
  // moment against the clock it had before, and shift the history and the match by it, so nothing is lost.
  const ref = follow.ref, t = live.tLast;
  if (ref && follow.lastBeat !== null) {
    const J = Math.round(rawBeatAt(t) - (ref.b0 + (t - ref.t0) / ref.beatLen));
    if (J !== 0 && Math.abs(ref.beatLen / live.beatLen - 1) < 0.08) {
      for (const x of follow.hist) x.B += J;
      follow.lastBeat += J;
      if (follow.match) follow.match.delta -= J;
      if (follow.cand) follow.cand.delta -= J;
    } else if (J !== 0) { follow.hist = []; follow.lastBeat = null; follow.cand = null; }   // a different tempo: start the window again
  }
  follow.ref = { t0: live.t0, b0: live.b0, beatLen: live.beatLen };
  const bNow = Math.floor(rawBeatAt(t));
  if (follow.lastBeat === null || bNow <= follow.lastBeat || bNow - follow.lastBeat > 16) {   // first beat, or a gap
    if (follow.lastBeat !== null) follow.hist = [];
    follow.lastBeat = bNow - 1; return;
  }
  for (let B = follow.lastBeat + 1; B < bNow; B++) {
    const ta = live.t0 + (B - live.b0) * live.beatLen;
    const ja = live.count - 1 - Math.round((live.tLast - ta) * live.fps), je = ja + Math.round(live.beatLen * live.fps);
    if (ja <= live.count - live.N || je > live.count) continue;
    let f = 0, low = 0, n = 0;
    for (let j = ja; j < je; j++) { const k = ri(j); f += live.eF[k]; low += Math.min(1, live.eL[k] / (live.eF[k] + 1e-6)); n++; }
    follow.hist.push({ B, lvl: Math.log(1e-4 + f / n), low: low / n });
  }
  follow.lastBeat = bNow - 1;
  if (follow.hist.length > 128) follow.hist.splice(0, follow.hist.length - 128);
}
// The same per-beat pattern for an analysed track, worked out once.
function beatSeq(info) {
  let s = follow.seq.get(info);
  if (s) return s;
  const nB = Math.floor((info.duration - info.grid0) / info.beatLen), lvl = new Float32Array(Math.max(0, nB)), low = new Float32Array(Math.max(0, nB));
  for (let k = 0; k < nB; k++) {
    const a = Math.max(0, Math.round((info.grid0 + k * info.beatLen) * info.fps)), e = Math.min(info.peaks.length, Math.round((info.grid0 + (k + 1) * info.beatLen) * info.fps));
    let p = 0, l = 0;
    const lv = info.rms || info.peaks;   // rms matches the listener; peaks only for analyses made before it was stored
    for (let i = a; i < e; i++) { p += lv[i]; l += info.lows[i]; }
    const n = Math.max(1, e - a);
    lvl[k] = Math.log(1e-4 + p / n); low[k] = l / n;
  }
  s = { lvl, low };
  follow.seq.set(info, s);
  return s;
}
// Prefix sums of a sequence and of its squares, for the sliding correlation.
function prefix(a) { const p = new Float64Array(a.length + 1), q = new Float64Array(a.length + 1); for (let i = 0; i < a.length; i++) { p[i + 1] = p[i] + a[i]; q[i + 1] = q[i] + a[i] * a[i]; } return [p, q]; }
function corrAt(w, a, o, p, q) {
  const W = w.length, m = (p[o + W] - p[o]) / W, v = (q[o + W] - q[o]) / W - m * m;
  if (v < 1e-6) return 0;
  let s = 0;
  for (let i = 0; i < W; i++) s += w[i] * a[o + i];
  return s / (W * Math.sqrt(v));   // w has mean 0 and sd 1, so the mean of a drops out
}
// Pattern correlation of the window (standardised level and bass share) with an analysed track at every offset.
// best: the top offset; unique: false when another offset more than 2 beats away matches nearly as well (inside a
// repeating loop the position cannot be told yet).
function bestOffset(wl, wb, seq) {
  const W = wl.length, n = seq.lvl.length - W;
  if (n < 0) return null;
  if (!seq.pre) seq.pre = [prefix(seq.lvl), prefix(seq.low)];
  const [[pl, ql], [pb, qb]] = seq.pre, rs = new Float32Array(n + 1);
  let o = 0, r = -2;
  for (let k = 0; k <= n; k++) { rs[k] = 0.6 * corrAt(wl, seq.lvl, k, pl, ql) + 0.4 * corrAt(wb, seq.low, k, pb, qb); if (rs[k] > r) { r = rs[k]; o = k; } }
  let unique = true;
  for (let k = 0; k <= n; k++) if (Math.abs(k - o) > 2 && rs[k] >= r - 0.03) { unique = false; break; }
  return { o, r, unique, at: k => (k >= 0 && k <= n ? rs[k] : -1) };
}
// Harmony: the track's average chroma against what the listener has heard for the last ~40 s, allowing up to a semitone
// of shift (CDJs without key lock change pitch with tempo). -1..1, or null when either side has none.
function chromaMatch(a) {
  if (!a || typeof live === 'undefined' || !live.chL) return null;
  const b = live.chL, mb = b.reduce((s, v) => s + v, 0) / 12;
  if (!(mb > 0)) return null;
  const ma = a.reduce((s, v) => s + v, 0) / 12;
  let best = -1;
  for (const sh of [-1, 0, 1]) {
    let sab = 0, saa = 0, sbb = 0;
    for (let p = 0; p < 12; p++) { const x = a[p] - ma, y = b[(p + sh + 12) % 12] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    best = Math.max(best, sab / Math.sqrt(saa * sbb + 1e-12));
  }
  return best;
}
const zs = a => { const n = a.length, m = a.reduce((s, v) => s + v, 0) / n, sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / n) || 1; return a.map(v => (v - m) / sd); };
// Rank every analysed track against the last 32-128 beats: pattern, plus harmony when both have it.
function rankTracks(win, chromaOf) {
  const wl = zs(win.map(x => x.lvl)), wb = zs(win.map(x => x.low)), res = [];
  for (const t of crate.tracks) {
    if (!t.info || !t.info.ok) continue;
    const b = bestOffset(wl, wb, beatSeq(t.info));
    if (!b) continue;
    const h = (chromaOf || chromaMatch)(t.info.chroma);
    res.push({ t, o: b.o, r: b.r, unique: b.unique, at: b.at, harm: h, score: h === null ? b.r : 0.6 * b.r + 0.4 * h, delta: b.o - win[0].B });
  }
  return res.sort((a, b) => b.score - a.score);
}
// Every 2 s: which track, and where in it. A match must beat the next track clearly, have one clear position, and be
// found again at the same position on the next check before it is used. Once locked it is followed by counting beats,
// so long repeating stretches do not lose it.
function checkMatch() {
  const h = follow.hist, W = Math.min(128, h.length);
  if (W < 32) return;
  const win = h.slice(-W), res = rankTracks(win), top = res[0], next = res[1];
  follow.best = top || null;
  const clear = top && top.r >= 0.6 && (!next || top.score - next.score >= 0.08);
  const m = follow.match;
  if (m) {
    const cur = res.find(x => x.t === m.t);
    m.r = cur ? cur.at(win[0].B + m.delta) : -1;   // still where we expect it in the same track?
    if (m.r >= 0.35) { follow.lost = 0; return; }
    if (++follow.lost < 3 && !(clear && top.unique && top.t !== m.t)) return;
    follow.match = null; follow.lost = 0;
    setStatus('External track lost: listening for the next one');
  }
  if (!clear || !top.unique) { follow.cand = null; return; }
  const c = follow.cand;
  if (c && c.t === top.t && Math.abs(c.delta - top.delta) <= 1) {
    follow.match = { t: top.t, delta: top.delta, r: top.r };
    follow.cand = null;
    setStatus('Recognised on external gear: ' + top.t.name + ' (' + Math.round(top.r * 100) + '%)');
  } else follow.cand = top;
}
// The recognised track as a stand-in deck, so sections (score.js) and track scores (cues.js) follow it like a deck.
const extStub = { id: 'EXT', ext: true, playing: false, rate: 1, offset: 0, name: '', file: null, buffer: null, info: null };
function extDeck() {
  const m = follow.match, lc = m && typeof liveClock === 'function' ? liveClock() : null;
  if (!m || !lc || audio.decks.some(d => d.playing)) return null;
  const i = m.t.info;
  extStub.info = i; extStub.file = m.t.file; extStub.name = m.t.name; extStub.buffer = { duration: i.duration };
  extStub.offset = i.grid0 + (lc.beats + m.delta) * i.beatLen;
  return extStub;
}
function tickFollow() {
  if (!follow.on) return;
  collectBeats();
  const now = performance.now();
  if (now - follow.checkT > 2000) { follow.checkT = now; checkMatch(); }
}

// ---------- UI: the external gear row in the DJ panel ----------
const followUI = {};
function buildFollow() {
  followUI.on = el('button', { textContent: 'Recognise tracks', title: 'Listen to the line-in and work out which track from the list is playing on external gear, and where in it', onclick: () => setFollow(!follow.on) });
  followUI.listen = el('button', { textContent: 'Line-in', title: 'Listen to the microphone / line-in (the DJ mixer\'s record or booth output)', onclick: () => { if (live.src === 'mic') useDecks(); else useMic(); } });
  followUI.txt = el('span', { className: 'mixtxt' });
  return el('div', { className: 'dmix dfollow' }, el('b', { textContent: 'External gear' }), followUI.listen, followUI.on,
    el('button', { textContent: 'Forget', title: 'Drop the recognised track', onclick: () => { follow.match = null; follow.cand = null; } }), followUI.txt);
}
function setFollow(on) {
  follow.on = on; follow.hist = []; follow.lastBeat = null; follow.match = null; follow.cand = null; follow.ref = null;
  if (on && !crate.tracks.some(t => t.info && t.info.ok)) setStatus('Add the tracks the DJ will play to the track list first: recognition compares against them');
  else if (on && live.src === 'dj') setStatus('Recognition is on: turn on Line-in so it can hear the external mixer');
}
function tickFollowUI() {
  if (!followUI.on) return;
  followUI.on.classList.toggle('on', follow.on);
  followUI.listen.classList.toggle('on', typeof live !== 'undefined' && live.src === 'mic');
  const mc = midiClock(), m = follow.match, x = m && extDeck();
  const parts = [];
  if (mc) parts.push('MIDI clock ' + mc.bpm.toFixed(1) + ' BPM');
  if (follow.on) {
    if (live.src === 'dj') parts.push('turn on Line-in');
    else if (!live.locked) parts.push('waiting for a steady beat');
    else if (x) { const s = sectionNow(x); parts.push('playing ' + m.t.name + ', bar ' + Math.floor((x.offset - m.t.info.grid0) / m.t.info.barLen + 1) + (s ? ' (' + SECTION_NAMES[s.type].toLowerCase() + ')' : '') + ', ' + Math.round(Math.max(0, m.r) * 100) + '% sure'); }
    else if (follow.hist.length < 32) parts.push('listening (' + follow.hist.length + ' of 32 beats)');
    else if (follow.best && !follow.best.unique && follow.best.r >= 0.6) parts.push('probably ' + follow.best.t.name + ': waiting for a section change to find the position');
    else parts.push('not recognised yet' + (follow.best ? ' (closest: ' + follow.best.t.name + ' ' + Math.round(follow.best.score * 100) + '%)' : ''));
  }
  setText(followUI.txt, parts.join('  ·  ') || 'Send MIDI clock from your gear, or turn on Line-in and Recognise tracks');
}
