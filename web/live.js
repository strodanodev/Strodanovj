// Strodano VJ (web) - listening: microphone / line-in and long music files, a live beat tracker, and the musical events the
// Agent reacts to (song change, drop, breakdown, energy band, key). GPL-3.0.
// DJ decks keep their own pre-analysed clock (audio.js); the live tracker drives the visuals only when no deck is playing.
// Long files (an hour-long mix, an MP4) are played from a media element, never decoded into memory, so they are tracked
// live exactly like the microphone.
'use strict';
const live = {
  src: 'dj',            // dj | mic | file
  stream: null, micNode: null, el: null, elNode: null, fileName: '', fileUrl: '',
  tap: null, tapReady: null, sink: null,
  // onset history (ring buffers, one entry per ~5 ms hop)
  fps: 200, N: 0, eF: null, eL: null, on: null, onL: null, count: 0, tLast: 0,
  // beat clock: beat(t) = b0 + (t - t0) / beatLen, plus a short slew for phase corrections
  locked: false, beatLen: 0.5, t0: 0, b0: 0, slew: null, conf: 0, lastEst: 0, offCount: 0, lowConfSince: 0, dbGroup: -1, dbVotes: 0,
  // features for the Agent
  chromaAn: null, chromaBuf: null, chS: new Float64Array(12), chL: new Float64Array(12), cenS: 0, cenL: 0, featT: 0,
  key: '', camelot: '', energy: 0, eMean: 0, eVar: 0.01, band: 'groove', section: 'groove', barE: 0, barN: 0, barIdx: null,
  bassMean: 0, barBass: 0, t: 0, secT: -99, quietBars: 0, novelty: 0, novSince: 0, lastSong: 0, silentSince: 0, wasSilent: false,
  deckKey: null, listeners: [],
};
const onMusic = fn => live.listeners.push(fn);   // fn(type, data): song | drop | breakdown | band | phrase
function emitMusic(type, data) { for (const fn of live.listeners) { try { fn(type, data || {}); } catch (e) { console.error(e); } } }

// ---------- inputs ----------
const TAP_SRC = `class OnsetTap extends AudioWorkletProcessor {
  constructor() { super(); this.hop = Math.round(sampleRate / 200); this.a = 1 - Math.exp(-2 * Math.PI * 150 / sampleRate);
    this.l1 = 0; this.l2 = 0; this.ef = 0; this.el = 0; this.n = 0; this.buf = new Float32Array(64); this.k = 0; }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const ch = inp.length, n = inp[0].length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < ch; c++) s += inp[c][i];
      s /= ch;
      this.l1 += this.a * (s - this.l1); this.l2 += this.a * (this.l1 - this.l2);
      this.ef += s * s; this.el += this.l2 * this.l2;
      if (++this.n >= this.hop) {
        this.buf[this.k++] = Math.sqrt(this.ef / this.n); this.buf[this.k++] = Math.sqrt(this.el / this.n);
        this.ef = this.el = 0; this.n = 0;
        if (this.k >= this.buf.length) { this.port.postMessage({ t: (currentFrame + i + 1) / sampleRate, v: this.buf.slice(0) }); this.k = 0; }
      }
    }
    return true;
  }
}
registerProcessor('onset-tap', OnsetTap);`;

// The onset tap listens to the whole mix bus plus the microphone, so the tracker hears whatever the visuals should follow.
async function ensureTap() {
  const c = audioCtx();
  if (live.tapReady) return live.tapReady;
  live.tapReady = (async () => {
    const url = URL.createObjectURL(new Blob([TAP_SRC], { type: 'text/javascript' }));
    try { await c.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const tap = live.tap = new AudioWorkletNode(c, 'onset-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    live.sink = c.createGain(); live.sink.gain.value = 0;   // the tap must reach the destination to be run, silently
    tap.connect(live.sink); live.sink.connect(c.destination);
    tap.port.onmessage = e => pushHops(e.data.t, e.data.v);
    audio.master.connect(tap);
    const an = live.chromaAn = c.createAnalyser();
    an.fftSize = 16384; an.smoothingTimeConstant = 0;   // ~3 Hz bins: enough to tell semitones apart down to ~130 Hz
    live.chromaBuf = new Float32Array(an.frequencyBinCount);
    audio.master.connect(an);
    live.fps = c.sampleRate / Math.round(c.sampleRate / 200);
    live.N = Math.round(live.fps * 12);
    for (const k of ['eF', 'eL', 'on', 'onL']) live[k] = new Float32Array(live.N);
  })();
  return live.tapReady;
}
async function useMic() {
  await ensureTap();
  stopInputs();
  try {
    live.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) { setStatus('Microphone access was refused or no input was found'); live.src = 'dj'; return false; }
  const n = live.micNode = audio.ctx.createMediaStreamSource(live.stream);
  n.connect(live.tap); n.connect(audio.analyser); n.connect(live.chromaAn);   // heard by the visuals, not sent to the speakers
  if (typeof recAddInput === 'function') recAddInput(n);
  live.src = 'mic'; resetTracker();
  setStatus('Listening to ' + (live.stream.getAudioTracks()[0].label || 'the microphone'));
  return true;
}
// A local music file or a recorded mix (MP3, WAV, M4A, MP4, WebM...). Played and heard through the mix bus.
async function useFile(file) {
  await ensureTap();
  stopInputs();
  const v = live.el = document.createElement('video');
  Object.assign(v, { preload: 'auto', playsInline: true });
  live.fileUrl = v.src = URL.createObjectURL(file);
  live.fileName = file.name.replace(/\.[^.]+$/, '');
  live.elNode = audio.ctx.createMediaElementSource(v);
  live.elNode.connect(audio.master);
  v.addEventListener('ended', () => emitMusic('ended', {}));
  v.addEventListener('error', () => setStatus('This browser cannot play ' + file.name));
  live.src = 'file'; resetTracker();
  setStatus('Loaded ' + file.name + ' - press Play');
  return true;
}
function stopInputs() {
  if (live.stream) { live.stream.getTracks().forEach(t => t.stop()); live.stream = null; }
  if (live.micNode) { live.micNode.disconnect(); live.micNode = null; }
  if (live.el) { live.el.pause(); live.el.removeAttribute('src'); live.el.load(); live.el = null; }
  if (live.elNode) { live.elNode.disconnect(); live.elNode = null; }
  if (live.fileUrl) { URL.revokeObjectURL(live.fileUrl); live.fileUrl = ''; }
  live.src = 'dj';
}
function useDecks() { stopInputs(); resetTracker(); }
const fileTime = () => (live.el ? live.el.currentTime : 0);
const fileDur = () => (live.el && isFinite(live.el.duration) ? live.el.duration : 0);

// ---------- live beat tracker ----------
function resetTracker() {
  live.count = 0; live.locked = false; live.conf = 0; live.slew = null; live.offCount = 0; live.dbVotes = 0; live.dbGroup = -1;
  if (live.on) { live.eF.fill(0); live.eL.fill(0); live.on.fill(0); live.onL.fill(0); }
}
const ri = j => ((j % live.N) + live.N) % live.N;
function pushHops(t, v) {
  const n = v.length / 2;
  for (let h = 0; h < n; h++) {
    const j = live.count, k = ri(j);
    live.eF[k] = v[h * 2]; live.eL[k] = v[h * 2 + 1];
    // onset: rise of the log energy, smoothed over 4 hops, bass counted double (as in analysis.js)
    if (j >= 6) {
      const sm = (a, i) => (a[ri(i)] + a[ri(i - 1)] + a[ri(i - 2)] + a[ri(i - 3)]) * 0.25;
      const dl = Math.log(1 + 80 * sm(live.eL, j)) - Math.log(1 + 80 * sm(live.eL, j - 2));
      const df = Math.log(1 + 80 * sm(live.eF, j)) - Math.log(1 + 80 * sm(live.eF, j - 2));
      live.onL[k] = dl > 0 ? dl : 0;
      live.on[k] = live.onL[k] + 0.5 * (df > 0 ? df : 0);
    } else live.on[k] = live.onL[k] = 0;
    live.count++;
  }
  live.tLast = t;
}
const hopTime = j => live.tLast - (live.count - 1 - j) / live.fps;
function rawBeatAt(t) {
  let b = live.b0 + (t - live.t0) / live.beatLen;
  const s = live.slew;
  if (s) b += s.amt * Math.min(1, Math.max(0, (t - s.t) / s.dur));
  return b;
}
// Re-anchor the clock at time t, carrying any unfinished phase correction over, so tempo can change without a jump.
function anchor(t) {
  const sl = live.slew;
  let rest = null;
  if (sl) { const f = Math.min(1, Math.max(0, (t - sl.t) / sl.dur)); if (f < 1) rest = { amt: sl.amt * (1 - f), t, dur: sl.dur * (1 - f) }; }
  live.b0 = rawBeatAt(t); live.t0 = t; live.slew = rest;
}
function estimateTempo() {
  const fps = live.fps, W = Math.min(live.count, Math.round(fps * 8));
  if (W < fps * 4) return;
  const a = live.count - W, on = live.on;
  let mean = 0;
  for (let j = a; j < live.count; j++) mean += on[ri(j)];
  mean /= W;
  const minLag = Math.round(fps * 60 / 200), maxLag = Math.round(fps * 60 / 60);
  const ac = new Float32Array(2 * maxLag + 2);
  for (let lag = minLag; lag <= 2 * maxLag && lag < W - fps; lag++) {
    let s = 0;
    for (let j = a, e = live.count - lag; j < e; j++) s += (on[ri(j)] - mean) * (on[ri(j + lag)] - mean);
    ac[lag] = s / (W - lag);
  }
  let T = 0, best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const o = Math.log2(60 * fps / lag / 125) / 0.6, sc = (ac[lag] + 0.5 * ac[2 * lag]) * Math.exp(-0.5 * o * o);
    if (sc > best) { best = sc; T = lag; }
  }
  if (!(best > 0)) return;
  // fold the onsets onto one beat: a sharp peak means the period is right, and its position is the beat phase
  const fold = (T, B) => {
    const acc = new Float64Array(B);
    for (let j = a; j < live.count; j++) { const ph = j / T; acc[((ph - Math.floor(ph)) * B) | 0] += on[ri(j)]; }
    let sum = 0, bv = -1, bi = 0;
    const sv = b => acc[b] + 0.5 * (acc[(b + 1) % B] + acc[(b + B - 1) % B]);
    for (let b = 0; b < B; b++) { sum += acc[b]; const v = sv(b); if (v > bv) { bv = v; bi = b; } }
    return { score: bv / (2 * sum / B + 1e-12), phase: (bi + 0.5) / B };
  };
  let bT = T, bs = -1;
  for (let i = -12; i <= 12; i++) { const t = T * (1 + 0.025 * i / 12), s = fold(t, 24).score; if (s > bs) { bs = s; bT = t; } }
  const f = fold(bT, 48), beatLen = bT / fps;
  live.conf = f.score;
  const now = live.tLast;
  if (f.score < 1.5) {
    if (!live.lowConfSince) live.lowConfSince = now;
    if (live.locked && now - live.lowConfSince > 6) live.locked = false;   // no steady beat for a while: let the tapped tempo take over
    return;
  }
  live.lowConfSince = 0;
  // time of a measured beat near the end of the window
  const jb = Math.floor((live.count - 1) / bT) * bT + f.phase * bT;
  const tb = hopTime(jb - (jb > live.count - 1 ? bT : 0)) - 0.7 / fps;
  const off = Math.abs(beatLen / live.beatLen - 1);
  if (!live.locked || off > 0.04) {
    if (live.locked && ++live.offCount < 3) return;   // a new tempo has to be heard three times in a row
    const relock = live.locked;
    const count = relock ? Math.round(rawBeatAt(tb)) : 0;   // keep counting beats (and bars) through a tempo change
    live.b0 = count; live.t0 = tb; live.beatLen = beatLen; live.slew = null; live.locked = true; live.offCount = 0;
    if (relock) { emitMusic('tempo', { bpm: 60 / beatLen }); if (now - live.lastSong > 30) songChange('tempo', now); }
  } else {
    live.offCount = 0;
    anchor(now);
    live.beatLen += (beatLen - live.beatLen) * 0.2;
    let e = rawBeatAt(tb) - Math.round(rawBeatAt(tb));   // phase error, in beats
    if (Math.abs(e) > 0.02) live.slew = { amt: -e * 0.5, t: now, dur: 0.4 };
  }
  // first beat of the bar: of the four beats, the one with the most bass onsets, voted over several estimates
  const grp = [0, 0, 0, 0], bFirst = Math.ceil(rawBeatAt(hopTime(a))), bLast = Math.floor(rawBeatAt(hopTime(live.count - 1)));
  for (let b = bFirst; b <= bLast; b++) {
    const t = live.t0 + (b - live.b0) * live.beatLen, j = Math.round(live.count - 1 - (live.tLast - t) * fps);
    let v = 0;
    for (let i = j - 2; i <= j + 2; i++) if (i > a && i < live.count) v = Math.max(v, live.onL[ri(i)]);
    grp[((b % 4) + 4) % 4] += v;
  }
  let g = 0;
  for (let i = 1; i < 4; i++) if (grp[i] > grp[g]) g = i;
  if (grp[g] > 1.15 * (grp[0] + grp[1] + grp[2] + grp[3]) / 4) {
    live.dbVotes = g === live.dbGroup ? live.dbVotes + 1 : 1; live.dbGroup = g;
    if (g !== 0 && live.dbVotes >= 3) { live.b0 -= g; live.dbVotes = 0; }   // shift the count so that beat becomes "1"
  }
}
const liveLag = () => (live.src === 'file' && !audio.recording ? (audio.ctx.outputLatency || audio.ctx.baseLatency || 0) : 0) + audio.offsetMs / 1000;
function liveClock() {
  if (!live.locked || live.src === 'dj' || (live.src === 'file' && (!live.el || live.el.paused))) return null;
  return { beats: rawBeatAt(audio.ctx.currentTime - liveLag()), bpm: 60 / live.beatLen };
}

// ---------- what the music is doing: key, energy band, sections, song changes ----------
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function keyOfChroma(ch) {
  let best = -2, bk = 0, bm = false;
  const m = ch.reduce((s, v) => s + v, 0) / 12;
  for (let r = 0; r < 12; r++) for (const minor of [false, true]) {
    const P = minor ? KS_MIN : KS_MAJ, pm = P.reduce((s, v) => s + v, 0) / 12;
    let sab = 0, saa = 0, sbb = 0;
    for (let p = 0; p < 12; p++) { const x = ch[(p + r) % 12] - m, y = P[p] - pm; sab += x * y; saa += x * x; sbb += y * y; }
    const c = sab / Math.sqrt(saa * sbb + 1e-12);
    if (c > best) { best = c; bk = r; bm = minor; }
  }
  return best > 0.4 ? ((bk * 7) % 12 + (bm ? 4 : 7)) % 12 + 1 + (bm ? 'A' : 'B') : '';
}
// Every 250 ms: chroma and brightness, short (~6 s) and long (~40 s) averages; a lasting gap between them is a new song.
function tickFeatures(now) {
  const an = live.chromaAn, c = audio.ctx;
  if (!an || now - live.featT < 0.25) return;
  const dt = live.featT ? now - live.featT : 0.25;
  live.featT = now;
  an.getFloatFrequencyData(live.chromaBuf);
  const hz = c.sampleRate / an.fftSize, ch = new Float64Array(12), lo = Math.ceil(110 / hz), hi = Math.floor(3500 / hz);
  let num = 0, den = 0, tot = 0;
  for (let k = lo; k <= hi; k++) {
    const db = live.chromaBuf[k];
    if (!(db > -100)) continue;
    const a = Math.pow(10, db / 20), f = k * hz;
    ch[((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12] += a;
    num += f * a; den += a; tot += a;
  }
  const level = audioFeat.level, silent = level < 0.02;
  // a gap of silence followed by music is the plainest sign of a new song
  if (silent) { if (!live.silentSince) live.silentSince = now; }
  else {
    if (live.silentSince && now - live.silentSince > 1.2 && now - live.lastSong > 20) songChange('gap', now);
    live.silentSince = 0;
  }
  if (silent || tot < 1e-4) return;
  const mx = Math.max(...ch);
  for (let p = 0; p < 12; p++) ch[p] /= mx;
  const cen = Math.log2(num / den), aS = 1 - Math.exp(-dt / 6), aL = 1 - Math.exp(-dt / 40);
  for (let p = 0; p < 12; p++) { live.chS[p] += (ch[p] - live.chS[p]) * aS; live.chL[p] += (ch[p] - live.chL[p]) * aL; }
  live.cenS += (cen - live.cenS) * aS; live.cenL += (cen - live.cenL) * aL;
  if (!live.camelot || ((now * 4) | 0) % 8 === 0) live.camelot = keyOfChroma(live.chL);
  // novelty: how far the last few seconds have moved from the last forty, in harmony and brightness
  let dot = 0, na = 0, nb = 0;
  for (let p = 0; p < 12; p++) { dot += live.chS[p] * live.chL[p]; na += live.chS[p] ** 2; nb += live.chL[p] ** 2; }
  const harm = 1 - dot / Math.sqrt(na * nb + 1e-12);
  // harmony only: brightness jumps whenever the drums drop out, which is a breakdown, not a new song
  live.novelty = harm * 6;
  const nearSection = live.section === 'breakdown' || live.t - live.secT < 16;
  if (live.src !== 'dj' && !nearSection && live.novelty > 0.8 && now - live.lastSong > 40) {
    if (!live.novSince) live.novSince = now;
    if (now - live.novSince > 4) songChange('novelty', now);
  } else live.novSince = 0;
}
function songChange(why, now) {
  live.lastSong = now; live.novSince = 0;
  live.chL.set(live.chS); live.cenL = live.cenS;   // the new song's sound becomes the reference
  emitMusic('song', { why });
}
// A deck track with analysed sections (DJ phase 3) announces its own drops and breakdowns.
// The same goes for a track recognised on external gear (follow.js: extDeck()), whose sections score.js emits as deck 'EXT'.
const deckSections = () => {
  if (live.src === 'dj' && audio.clockDeck && audio.clockDeck.info && audio.clockDeck.info.sections) return true;
  const x = typeof extDeck === 'function' ? extDeck() : null;
  return !!(x && x.info && x.info.sections);
};
// Energy per bar against a slow running average: calm / groove / peak, and breakdowns and drops.
function tickSections(dt) {
  live.t += dt;
  const e = 0.6 * audioFeat.bass + 0.4 * audioFeat.level;
  // running averages: quick to settle at the start, then about a minute and a half of memory
  const a = 1 - Math.exp(-dt / Math.min(90, 4 + live.t));
  if (!live.eMean) { live.eMean = e; live.eVar = (e * 0.5) ** 2 + 1e-4; }
  live.eMean += (e - live.eMean) * a; live.eVar += ((e - live.eMean) ** 2 - live.eVar) * a;
  live.bassMean += (audioFeat.bass - live.bassMean) * a;
  live.energy = e;
  const mc = musicClock && musicClock(), b = mc ? mc.beats : null;
  // per bar (or per 2 s without a beat)
  const idx = b !== null ? Math.floor(b / 4) : Math.floor(performance.now() / 2000);
  live.barE += e; live.barBass += audioFeat.bass; live.barN++;
  if (live.barIdx === null) live.barIdx = idx;
  if (idx === live.barIdx) return;
  const n = Math.max(1, live.barN), be = live.barE / n, bb = live.barBass / n, sd = Math.sqrt(live.eVar) + 1e-3, z = (be - live.eMean) / sd;
  live.barE = 0; live.barBass = 0; live.barN = 0; live.barIdx = idx;
  if (b !== null && idx % 8 === 0) emitMusic('phrase', { bar: idx });
  if (live.t < 8) return;   // let the averages settle before calling anything
  const band = live.section === 'breakdown' ? 'calm' : z < -0.8 ? 'calm' : z > 0.7 ? 'peak' : 'groove';
  if (band !== live.band) { live.band = band; emitMusic('band', { band }); }
  if (deckSections()) return;   // the deck's analysed sections drive drops and breakdowns instead
  // a breakdown is the bass dropping out for two bars (pads and vocals may carry on at full level)
  if (live.section !== 'breakdown' && bb < 0.35 * live.bassMean) {
    if (++live.quietBars >= 2) { live.section = 'breakdown'; live.secT = live.t; emitMusic('breakdown', {}); }
  } else if (live.section !== 'breakdown') live.quietBars = 0;
}
// Called on each kick: in a breakdown, the bass coming back at full strength is the drop.
function checkDrop() {
  if (deckSections()) return;
  if (live.section !== 'breakdown' || audioFeat.bass < 0.7 * live.bassMean) return;
  live.section = 'groove'; live.quietBars = 0; live.secT = live.t;
  emitMusic('drop', {});
}
// DJ decks: a song change is the deck driving the visuals now playing a different track.
function tickDeckSong(now) {
  const d = audio.clockDeck, k = d && d.file ? d.file.name + '|' + d.file.size : null;
  if (k && k !== live.deckKey) { live.deckKey = k; songChange('deck', now); }
  if (!k) live.deckKey = null;
}
let liveKickPrev = 0;
function liveTick(dt) {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  if (live.tap && live.src !== 'dj' && now - live.lastEst > 0.5) { live.lastEst = now; estimateTempo(); }
  tickFeatures(now);
  tickSections(dt);
  if (live.src === 'dj') tickDeckSong(now);
  if (audioFeat.kick === 1 && liveKickPrev < 1) checkDrop();
  liveKickPrev = audioFeat.kick;
}
// The key to colour the visuals by: the analysed key of the deck that drives the visuals, else the live estimate.
const musicKey = () => (live.src === 'dj' && audio.clockDeck && audio.clockDeck.info && audio.clockDeck.info.camelot) || live.camelot || '';
