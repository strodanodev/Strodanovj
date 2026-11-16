// Strodano VJ (web) - auto-mix, autopilot and beat-quantised clip launches. GPL-3.0.
// A mix is timed in the outgoing deck's beats, read from the sound card's clock (deckPos), so it starts on a phrase and
// moves in step with the music even when frames are dropped. It drives comp.crossfade, so the A/B layers mix with it.
'use strict';
const MIXER_KEY = 'strodano-vj-mixer';
const MIX_STYLES = { blend: 'Smooth blend', bass: 'Bass swap', echo: 'Echo out', cut: 'Cut' };
const mixer = { style: 'bass', bars: 8, start: 'phrase', quant: 4, auto: false, ownTempo: true, m: null, glide: null, lastXf: null, autoWait: 0 };
try { Object.assign(mixer, JSON.parse(localStorage.getItem(MIXER_KEY) || '{}'), { auto: false, m: null, glide: null }); } catch (e) {}
function saveMixer() {
  try { localStorage.setItem(MIXER_KEY, JSON.stringify({ style: mixer.style, bars: mixer.bars, start: mixer.start, quant: mixer.quant, ownTempo: mixer.ownTempo, autoGain: audio.autoGain })); } catch (e) {}
}
try { const s = JSON.parse(localStorage.getItem(MIXER_KEY) || '{}'); if (typeof s.autoGain === 'boolean') audio.autoGain = s.autoGain; } catch (e) {}

const sideXf = d => (d.side === 1 ? 0 : 1);   // crossfader position where only this deck (and its layers) is heard
const posAtBeat = (d, b) => d.info.grid0 + b * d.info.beatLen;
const beatNow = d => deckBeats(d, deckPos(d));   // sound-card time: what the audio graph is doing right now
function setXf(v) {
  comp.crossfade = v; mixer.lastXf = v;
  if (typeof reflectMidi === 'function') reflectMidi('crossfade', v);
}

// Start (or cancel, or finish) a mix from the deck that is playing into the other one.
//   opts.atBeat: outgoing-deck beat to start on (autopilot); opts.style / opts.bars override the settings
function startMix(opts = {}) {
  if (mixer.m) { if (mixer.m.started) finishMix(); else cancelMix(); return; }
  const out = refDeck(), inn = out && otherDeck(out);
  if (!out) { setStatus('Play a track first, then press Mix to bring in the other deck'); return; }
  if (!inn.buffer) { setStatus('Load a track into deck ' + inn.id + ' first'); return; }
  if (inn.state === 'analysing' || inn.state === 'loading') { setStatus('Deck ' + inn.id + ' is still being analysed'); return; }
  let style = opts.style || mixer.style, note = '';
  const both = beatOK(out) && beatOK(inn), gap = both ? tempoGap(inn.info, out.info.bpm * out.rate) : 1;
  if (!both) { style = 'fade'; note = ' (no steady beat, so a timed fade)'; }
  else if ((style === 'blend' || style === 'bass') && gap > 0.08) { style = 'echo'; note = ' (tempos are ' + (gap * 100).toFixed(0) + '% apart, so echo out instead of a blend)'; }
  const m = { out, inn, style, started: false, scheduled: inn.playing, xfTo: sideXf(inn), lenBeats: 0, startBeat: 0, inBeat: 0 };
  if (style === 'fade') { m.t0 = audio.ctx.currentTime + 0.05; m.len = 8; }
  else {
    m.lenBeats = style === 'echo' ? 8 : style === 'cut' ? 0 : 4 * (opts.bars || mixer.bars);
    const b = beatNow(out), lead = 2.2 * out.info.bpm * out.rate / 60;   // time to get the incoming deck ready
    const grid = mixer.start === 'bar' && opts.atBeat === undefined ? 4 : 32, base = deckBeats(out, out.info.mixIn);
    m.startBeat = opts.atBeat !== undefined && opts.atBeat >= b + lead ? opts.atBeat : base + grid * Math.ceil((b + lead - base) / grid);
    m.inBeat = style === 'echo' ? m.startBeat + 4 : m.startBeat;
    if (!inn.playing) {
      inn.sync = gap <= 0.08;
      if (!inn.sync) deckSetRate(inn, 1);
      if (style === 'bass') inn.bass = 0;   // the incoming bass stays out until the swap
    }
  }
  mixer.m = m; mixer.glide = null;
  setStatus('Mix ' + out.id + ' -> ' + inn.id + ': ' + (MIX_STYLES[style] || 'Fade') + note);
}
function cancelMix() {
  const m = mixer.m;
  if (!m) return;
  if (m.scheduled && !m.started && m.inn.playing && m.inn.t0 > audio.ctx.currentTime - 0.01) { stopSrc(m.inn); m.inn.playing = false; }
  m.inn.bass = 0.5; m.out.echo = 0;
  mixer.m = null;
  setStatus('Mix cancelled');
}
function finishMix() {
  const m = mixer.m;
  if (!m) return;
  mixer.m = null;
  if (!m.inn.playing) deckPlay(m.inn);
  setXf(m.xfTo);
  deckPause(m.out);
  m.out.bass = 0.5; m.out.echo = 0; m.inn.bass = 0.5;
  // Matching the outgoing tempo bends the new track's pitch: drift back to its own tempo over 16 bars.
  if (mixer.ownTempo && m.inn.sync && Math.abs(m.inn.rate - 1) > 0.002 && beatOK(m.inn)) mixer.glide = { d: m.inn, from: m.inn.rate, b0: beatNow(m.inn) };
  setStatus('Now playing deck ' + m.inn.id + (m.inn.name ? ': ' + m.inn.name : ''));
}
function tickMix() {
  const m = mixer.m, c = audio.ctx;
  // the user grabbed the crossfader: the mix is theirs from here
  if (m && m.started && mixer.lastXf !== null && Math.abs(comp.crossfade - mixer.lastXf) > 0.003) {
    m.out.echo = 0; m.inn.bass = 0.5; m.out.bass = 0.5; mixer.m = null; mixer.lastXf = null;
    if (!m.inn.playing) { m.inn.offset = m.inn.info && m.inn.info.ok ? m.inn.info.mixIn : 0; deckPlay(m.inn); }   // an echo out hands over before its new deck has started
    setStatus('Crossfader moved by hand: the mix is yours');
  } else if (m) {
    if (!m.out.playing && !m.started) { cancelMix(); return; }
    if (m.style === 'fade') {
      if (!m.started) { m.started = true; m.xfFrom = mixer.lastXf = comp.crossfade; if (!m.inn.playing) deckPlay(m.inn); }
      const p = Math.min(1, (c.currentTime - m.t0) / m.len);
      setXf(m.xfFrom + (m.xfTo - m.xfFrom) * p);
      if (p >= 1) finishMix();
    } else {
      const b = beatNow(m.out), bps = m.out.info.bpm * m.out.rate / 60;
      // Schedule the incoming deck two seconds ahead, sample-exact, so its bar lands on the outgoing deck's bar even if
      // ticks only come once a second (hidden window, see audio.js).
      if (!m.scheduled && b >= m.inBeat - 2 * bps) {
        applySyncRate(m.inn);
        const when = c.currentTime + (posAtBeat(m.out, m.inBeat) - deckPos(m.out)) / m.out.rate;
        deckStartAt(m.inn, when, m.inn.info.ok ? m.inn.info.mixIn : 0);
        m.scheduled = true;
      }
      if (m.style === 'echo' && b >= m.startBeat) m.out.echo = b < m.inBeat ? 0.6 : 0;
      if (b >= m.startBeat) {
        if (!m.started) { m.started = true; m.xfFrom = mixer.lastXf = comp.crossfade; }
        const p = m.lenBeats ? Math.min(1, (b - m.startBeat) / m.lenBeats) : 1;
        if (m.style === 'blend' || m.style === 'bass') setXf(m.xfFrom + (m.xfTo - m.xfFrom) * p);
        if (m.style === 'bass' && p >= 0.5) { m.inn.bass = 0.5; m.out.bass = 0; }
        if (m.style === 'echo' && b >= m.inBeat) setXf(m.xfTo);
        if (m.style === 'cut') setXf(m.xfTo);
        if (p >= 1) finishMix();
      }
    }
  }
  const g = mixer.glide;
  if (g) {
    if (!g.d.playing || mixer.m) mixer.glide = null;
    else {
      const p = Math.min(1, (beatNow(g.d) - g.b0) / 64);
      deckSetRate(g.d, g.from + (1 - g.from) * p);
      if (p >= 1) mixer.glide = null;
    }
  }
  tickAuto();
  quantTick();
}
// Text for the mixer row: what the mix is doing, or what it would do.
function mixStatus() {
  const m = mixer.m;
  if (m) {
    if (m.style === 'fade') return 'Fading ' + m.out.id + ' -> ' + m.inn.id;
    const b = beatNow(m.out), bars = Math.ceil((m.startBeat - b) / 4);
    if (!m.started) return 'Mix ' + m.out.id + ' -> ' + m.inn.id + ' starts in ' + bars + (bars === 1 ? ' bar' : ' bars');
    return MIX_STYLES[m.style] + ' ' + m.out.id + ' -> ' + m.inn.id + (m.lenBeats ? ': bar ' + Math.min(m.lenBeats / 4, 1 + Math.floor((b - m.startBeat) / 4)) + ' of ' + m.lenBeats / 4 : '');
  }
  const out = refDeck(), inn = out && otherDeck(out);
  if (!out) return 'Play a track on a deck';
  if (!inn.buffer) return 'Load the next track into deck ' + inn.id;
  if (beatOK(out) && out.info.mixOut) {
    const bars = Math.floor((deckBeats(out, out.info.mixOut) - deckBeats(out, deckHeard(out))) / 4);
    if (bars > 0) return 'Deck ' + out.id + ' outro in ' + bars + (bars === 1 ? ' bar' : ' bars') + ': a good time to mix';
    return 'Deck ' + out.id + ' is in its outro: mix now';
  }
  return 'Press Mix to bring in deck ' + inn.id;
}

// ---------- autopilot ----------
function setAuto(on) {
  mixer.auto = on;
  if (on && !crate.tracks.some(t => t.state === 'ready') && !audio.decks.some(d => d.buffer)) setStatus('Autopilot: add tracks to the list first');
  else if (on) setStatus('Autopilot on: it picks the next track and mixes it in at the outro');
}
function tickAuto() {
  if (!mixer.auto || mixer.m) return;
  const now = performance.now();
  if (now < mixer.autoWait) return;
  mixer.autoWait = now + 250;
  const busy = d => d.state === 'loading' || d.state === 'analysing';
  const playing = audio.decks.filter(d => d.playing);
  if (!playing.length) {
    const d = audio.decks.find(x => x.state === 'ready' && x.buffer) || null;
    if (d) { deckCue(d); deckPlay(d); setXf(sideXf(d)); }
    else if (!audio.decks.some(busy)) crateLoadNext(audio.decks[0]);
    return;
  }
  const out = refDeck() || playing[0], inn = otherDeck(out);
  if (playing.length > 1 || busy(inn)) return;
  const t = inn.file && crate.tracks.find(x => x.key === fileKey(inn.file));
  if (!inn.buffer || !t || t.played || inn.state === 'error') {
    if (suggestions(out).length) crateLoadNext(inn);
    return;
  }
  if (!beatOK(out) || !beatOK(inn)) {   // no grid: fade 10 s before the end
    if (out.buffer.duration - deckPos(out) < 10) startMix({ style: 'fade' });
    return;
  }
  const i = out.info, at = deckBeats(out, i.mixOut), b = beatNow(out);
  if (b < at - 64) return;   // wait until 16 bars before the outro
  const gap = tempoGap(inn.info, i.bpm * out.rate), room = Math.floor((deckBeats(out, i.beatEnd) - Math.max(at, b)) / 4);
  const bars = Math.max(2, Math.min(mixer.bars, room >= 8 ? 8 : room >= 4 ? 4 : 2));
  startMix({ atBeat: at > b + 2 ? at : undefined, style: gap > 0.08 ? 'echo' : mixer.style === 'cut' ? 'cut' : mixer.style, bars });
}

// ---------- quantised clip launches ----------
// While music drives the clock, a clip trigger waits for the next beat or bar (engine.js trigger() asks quantHold first).
const quantQ = new Map();   // layer index -> { ci, at }
let quantFiring = false;
function quantHold(li, ci) {
  if (quantFiring || !mixer.quant || !audio.clockDeck) return false;
  const q = mixer.quant, b = comp.beats, frac = b / q - Math.floor(b / q);
  if (frac * q < 0.12) return false;   // pressed just after the beat: play now
  quantQ.set(li, { ci, at: q * Math.ceil(b / q) });
  return true;
}
function quantTick() {
  if (!quantQ.size) return;
  const mc = audio.clockDeck ? musicClock() : null;
  for (const [li, e] of [...quantQ]) {
    if (mc && mc.beats < e.at) continue;
    quantQ.delete(li);
    quantFiring = true;
    try { trigger(li, e.ci); } finally { quantFiring = false; }
  }
}
function markQueued() {
  if (typeof cellEls === 'undefined') return;
  cellEls.forEach((row, li) => (row || []).forEach((cell, ci) => {
    const q = quantQ.get(li), on = !!q && q.ci === ci;
    if (cell.classList.contains('queued') !== on) cell.classList.toggle('queued', on);
  }));
}

// ---------- mixer row ----------
const mixUI = {};
function buildMixer() {
  const sel = (title, opts, get, set) => el('select', { title, onchange: e => { set(e.target.value); saveMixer(); } },
    ...opts.map(([v, t]) => el('option', { value: v, textContent: t, selected: String(get()) === String(v) })));
  const chk = (label, title, get, set) => el('label', { title }, el('input', { type: 'checkbox', checked: get(), onchange: e => { set(e.target.checked); saveMixer(); } }), ' ' + label);
  mixUI.go = el('button', { className: 'mixgo', textContent: 'Mix', title: 'Bring in the other deck on the next phrase. Press again to cancel, or during the mix to finish it now.', dataset: { midi: 'deck:mix:go' }, onclick: () => startMix() });
  mixUI.auto = el('button', { textContent: 'Autopilot', title: 'Play the track list by itself: picks the best next track and mixes it in at each outro', dataset: { midi: 'deck:mix:auto' }, onclick: () => setAuto(!mixer.auto) });
  mixUI.txt = el('span', { className: 'mixtxt' });
  mixUI.bar = el('i');
  return el('div', { className: 'dmix' },
    mixUI.go, el('span', { className: 'mixprog' }, mixUI.bar), mixUI.txt,
    sel('How the mix sounds', Object.entries(MIX_STYLES), () => mixer.style, v => { mixer.style = v; }),
    sel('How long a blend or bass swap takes', [[4, '4 bars'], [8, '8 bars'], [16, '16 bars']], () => mixer.bars, v => { mixer.bars = +v; }),
    sel('When a mix starts after pressing Mix', [['phrase', 'On next phrase'], ['bar', 'On next bar']], () => mixer.start, v => { mixer.start = v; }),
    sel('Clip launches wait for the beat while music is playing', [[0, 'Clips: instant'], [1, 'Clips on beat'], [4, 'Clips on bar']], () => mixer.quant, v => { mixer.quant = +v; }),
    chk('Auto-gain', 'Play every track at the same loudness', () => audio.autoGain, v => { audio.autoGain = v; }),
    chk('Own tempo after mix', 'After a mix, let the new track drift back to its own tempo (and pitch) over 16 bars', () => mixer.ownTempo, v => { mixer.ownTempo = v; }),
    mixUI.auto);
}
function tickMixUI() {
  const m = mixer.m;
  setText(mixUI.txt, mixStatus());
  setText(mixUI.go, !m ? 'Mix' : m.started ? 'Finish' : 'Cancel');
  mixUI.go.classList.toggle('on', !!m);
  mixUI.auto.classList.toggle('on', mixer.auto);
  let p = 0;
  if (m && m.started) p = m.style === 'fade' ? (audio.ctx.currentTime - m.t0) / m.len : m.lenBeats ? (beatNow(m.out) - m.startBeat) / m.lenBeats : 1;
  mixUI.bar.style.width = (Math.min(1, Math.max(0, p)) * 100).toFixed(1) + '%';
  markQueued();
}
// MIDI: "deck:mix:go" and "deck:mix:auto" (routed here from djMidiTarget).
function mixMidiTarget(what) {
  if (what === 'go') return { fire: () => startMix() };
  if (what === 'auto') return { fire: () => setAuto(!mixer.auto) };
  return null;
}
