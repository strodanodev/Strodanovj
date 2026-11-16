// Strodano VJ (web) - audio engine: two decks, the music clock that drives the visuals, and live audio levels. GPL-3.0.
// Decks play decoded buffers, so two tracks stay locked sample for sample once their tempos match. Changing a deck's tempo
// changes its pitch too (like vinyl); there is no key lock yet.
'use strict';
const OFFSET_KEY = 'strodano-vj-av-offset';
const audio = { ctx: null, master: null, analyser: null, decks: [], clockDeck: null, offsetMs: 0, fbuf: null, tbuf: null, lastT: 0, bassAvg: 0, bassPrev: 0 };
try { audio.offsetMs = Math.min(500, Math.max(-500, +localStorage.getItem(OFFSET_KEY) || 0)); } catch (e) {}
// side: which half of the crossfader the deck sits on (1 = A, 2 = B), the same numbers layers use for their A/B buttons.
function newDeck(id, side) {
  return { id, side, name: '', buffer: null, info: null, state: 'empty', src: null, vol: null, xf: null, volume: 1, rate: 1, offset: 0, t0: 0,
    playing: false, sync: true, loadSeq: 0, gVol: -1, gXf: -1 };
}
audio.decks.push(newDeck('A', 1), newDeck('B', 2));
const otherDeck = d => audio.decks[d === audio.decks[0] ? 1 : 0];
const beatOK = d => !!(d.buffer && d.info && d.info.ok);
const isAudioFile = f => f.type.startsWith('audio') || /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|aiff?|weba)$/i.test(f.name);

// The context can only start from a click or key press, so it is made on first use (Load, Play), never at page load.
function audioCtx() {
  if (!audio.ctx) {
    const c = audio.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    audio.master = c.createGain();
    audio.master.gain.value = 0.8;
    const lim = c.createDynamicsCompressor();   // two full-level tracks overlap in the middle of the crossfader
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
    audio.master.connect(lim); lim.connect(c.destination);
    const an = audio.analyser = c.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0.4; an.minDecibels = -75; an.maxDecibels = -15;
    audio.master.connect(an);
    audio.fbuf = new Uint8Array(an.frequencyBinCount); audio.tbuf = new Float32Array(an.fftSize);
    for (const d of audio.decks) { d.vol = c.createGain(); d.xf = c.createGain(); d.vol.connect(d.xf); d.xf.connect(audio.master); }
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  return audio.ctx;
}
// Same curve as the layer crossfade in renderComp: both sides are full in the middle.
function xfGain(d) { const x = comp.crossfade; return Math.min(1, Math.max(0, (d.side === 1 ? 1 - x : x) * 2)); }

// ---------- decks ----------
// Position in the track (seconds) of the sample being handed to the sound card right now.
function deckPos(d) {
  if (!d.buffer) return 0;
  return d.playing ? Math.min(d.buffer.duration, d.offset + (audio.ctx.currentTime - d.t0) * d.rate) : d.offset;
}
// Position of what is coming out of the speakers, which is what the visuals and the waveform should show.
function deckHeard(d) {
  if (!d.playing) return d.offset;
  return deckPos(d) - ((audio.ctx.outputLatency || audio.ctx.baseLatency || 0) + audio.offsetMs / 1000) * d.rate;
}
const deckBeats = (d, pos) => (pos - d.info.grid0) / d.info.beatLen;   // beat 0, 4, 8... are first beats of a bar
function startSrc(d) {
  const c = audio.ctx, s = c.createBufferSource();
  s.buffer = d.buffer; s.playbackRate.value = d.rate; s.connect(d.vol);
  s.onended = () => { if (d.src === s) { d.offset = deckPos(d); d.src = null; d.playing = false; } };   // ran off the end
  d.t0 = c.currentTime; s.start(0, d.offset);
  d.src = s; d.playing = true;
}
function stopSrc(d) {
  const s = d.src;
  d.src = null;
  if (s) { s.onended = null; try { s.stop(); } catch (e) {} s.disconnect(); }
}
function deckSetRate(d, r) {
  if (Math.abs(r - d.rate) < 1e-9) return;
  if (d.playing) { d.offset = deckPos(d); d.t0 = audio.ctx.currentTime; d.src.playbackRate.value = r; }
  d.rate = r;
}
// A synced deck takes the other deck's tempo (halved or doubled when that is the nearer match).
function applySyncRate(d) {
  const o = otherDeck(d);
  if (!d.sync || !beatOK(d) || !beatOK(o)) return;
  if (o.sync && audio.clockDeck === d) return;   // both synced: the deck the visuals follow leads
  let r = o.info.bpm * o.rate / d.info.bpm;
  while (r > 1.42) r /= 2;
  while (r < 0.71) r *= 2;
  deckSetRate(d, r);
}
// The position nearest to pos at which this deck's beats fall on the other deck's (every beat for m = 1, bar on bar for m = 4).
function alignedPos(d, pos, m) {
  const o = otherDeck(d), bl = d.info.beatLen;
  let diff = (((deckBeats(o, deckPos(o)) - deckBeats(d, pos)) % m) + m) % m;
  if (diff > m / 2) diff -= m;
  let p = pos + diff * bl;
  while (p < 0) p += m * bl;
  return Math.min(p, d.buffer.duration - 0.01);
}
const canAlign = d => d.sync && beatOK(d) && beatOK(otherDeck(d)) && otherDeck(d).playing;
function deckPlay(d) {
  if (!d.buffer || d.playing) return;
  audioCtx();
  if (d.offset >= d.buffer.duration - 0.05) d.offset = 0;
  applySyncRate(d);
  if (canAlign(d)) d.offset = alignedPos(d, d.offset, 4);
  startSrc(d);
}
function deckPause(d) { if (!d.playing) return; d.offset = deckPos(d); stopSrc(d); d.playing = false; }
function deckToggle(d) { if (d.playing) deckPause(d); else deckPlay(d); }
function deckSeek(d, t) {
  if (!d.buffer) return;
  t = Math.min(d.buffer.duration - 0.01, Math.max(0, t));
  const was = d.playing;
  if (was && canAlign(d)) t = alignedPos(d, t, 1);   // a jump on a synced deck lands on the beat
  if (was) stopSrc(d);
  d.offset = t;
  if (was) startSrc(d);
}
function deckCue(d) { if (!d.buffer) return; deckPause(d); d.offset = beatOK(d) ? Math.max(0, d.info.grid0) : 0; }
function deckSyncToggle(d) {
  d.sync = !d.sync;
  if (!d.sync) return;
  applySyncRate(d);
  if (d.playing && canAlign(d)) { const p = alignedPos(d, deckPos(d), 1); stopSrc(d); d.offset = p; startSrc(d); }
}
// Tempo fader, v 0..1 = -8 %..+8 %. Moving it by hand takes the deck out of sync.
function deckTempo(d, v) { d.sync = false; deckSetRate(d, 1 + (Math.min(1, Math.max(0, v)) - 0.5) * 0.16); }
// "Bar 1": the beat being heard right now becomes the first beat of the bar.
function deckSetDownbeat(d) {
  if (!beatOK(d)) return;
  const i = d.info, bar = 4 * i.beatLen;
  i.grid0 += Math.round((deckHeard(d) - i.grid0) / i.beatLen) * i.beatLen;
  i.grid0 -= Math.floor((i.grid0 + 0.05) / bar) * bar;
}
async function deckLoad(d, file) {
  const c = audioCtx(), seq = ++d.loadSeq;
  deckPause(d);
  d.buffer = null; d.info = null; d.offset = 0; d.rate = 1; d.name = file.name.replace(/\.[^.]+$/, ''); d.state = 'loading';
  setStatus('Deck ' + d.id + ': reading ' + file.name + '...');
  try {
    const buf = await c.decodeAudioData(await file.arrayBuffer());
    if (seq !== d.loadSeq) return;
    d.buffer = buf; d.state = 'analysing';   // playable from here on; the beat grid follows
    const n = buf.length, mono = new Float32Array(n), g = 1 / buf.numberOfChannels;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const x = buf.getChannelData(ch); for (let i = 0; i < n; i++) mono[i] += x[i] * g; }
    const info = await analyseAsync(mono, buf.sampleRate);
    if (seq !== d.loadSeq) return;
    d.info = info; d.state = 'ready';
    applySyncRate(d);
    setStatus('Deck ' + d.id + ': ' + d.name + (info.ok ? ' - ' + info.bpm.toFixed(1) + ' BPM' : ' - no steady beat found, so it will not drive the visuals or sync'));
  } catch (e) {
    if (seq !== d.loadSeq) return;
    d.buffer = null; d.state = 'error';
    setStatus('Deck ' + d.id + ': this browser cannot play ' + file.name);
  }
}

// ---------- music clock ----------
// The deck the visuals follow: the louder playing deck, with a margin so it does not flip back and forth mid-fade.
function pickClockDeck() {
  const pl = audio.decks.filter(d => d.playing && beatOK(d));
  if (!pl.length) return (audio.clockDeck = null);
  const g = d => d.volume * xfGain(d);
  let m = pl.includes(audio.clockDeck) ? audio.clockDeck : pl[0];
  for (const d of pl) if (g(d) > g(m) + 0.15) m = d;
  return (audio.clockDeck = m);
}
// engine.js asks this every frame; null means no music is playing and the tapped tempo runs free.
musicClock = function () {
  if (!audio.ctx) return null;
  const d = pickClockDeck();
  return d ? { beats: deckBeats(d, deckHeard(d)), bpm: d.info.bpm * d.rate } : null;
};

// ---------- per-frame: gains, sync, levels ----------
function audioTick() {
  const c = audio.ctx;
  if (!c) return;
  const now = performance.now(), dt = Math.min(0.1, (now - audio.lastT) / 1000);
  audio.lastT = now;
  for (const d of audio.decks) {
    applySyncRate(d);
    const x = xfGain(d);
    if (x !== d.gXf) { d.gXf = x; d.xf.gain.setTargetAtTime(x, c.currentTime, 0.008); }
    if (d.volume !== d.gVol) { d.gVol = d.volume; d.vol.gain.setTargetAtTime(d.volume, c.currentTime, 0.008); }
  }
  const an = audio.analyser, f = audio.fbuf, t = audio.tbuf, hz = c.sampleRate / an.fftSize;
  an.getByteFrequencyData(f); an.getFloatTimeDomainData(t);
  const band = (lo, hi) => { let s = 0, a = Math.max(1, Math.round(lo / hz)), b = Math.max(a + 1, Math.round(hi / hz)); for (let i = a; i < b; i++) s += f[i]; const v = s / ((b - a) * 255); return v * v; };
  let sq = 0;
  for (let i = 0; i < t.length; i++) sq += t[i] * t[i];
  const raw = { bass: band(30, 150), mid: band(150, 2000), high: band(2000, 12000), level: Math.min(1, Math.sqrt(sq / t.length) * 2.5) };
  for (const k in raw) audioFeat[k] = Math.max(raw[k], audioFeat[k] - dt * 2.5);   // jump up at once, fall back over ~0.4 s
  // Kick: the bass jumping well above its recent average.
  audio.bassAvg += (raw.bass - audio.bassAvg) * Math.min(1, dt * 4);
  if (raw.bass > audio.bassAvg + 0.08 && raw.bass > audio.bassPrev + 0.02) audioFeat.kick = 1;
  else audioFeat.kick *= Math.exp(-dt * 9);
  audio.bassPrev = raw.bass;
}
// MIDI targets "deck:<A|B>:play | cue | sync | volume | tempo" (see midi.js).
function djMidiTarget(id, what) {
  const d = audio.decks.find(x => x.id === id);
  if (!d) return null;
  if (what === 'play') return { fire: () => deckToggle(d) };
  if (what === 'cue') return { fire: () => deckCue(d) };
  if (what === 'sync') return { fire: () => deckSyncToggle(d) };
  if (what === 'volume') return { set: v => { d.volume = v; } };
  if (what === 'tempo') return { set: v => deckTempo(d, v) };
  return null;
}
