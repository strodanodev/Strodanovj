// Strodano VJ (web) - track scores: record a visual performance over a track once, and it plays back every time that
// track plays. GPL-3.0.
// A cue is { b, id, v }: b is the beat in the TRACK's own grid (deckBeats), so a score stays right at any tempo, after a
// jump or loop, and in any mix order. id is a control id from midi.js (clip:L:C, layer:L:opacity, fx:<uid>:<k>, master,
// column:C...), so anything that can be MIDI-mapped can be recorded, and playback goes through midiTarget() exactly
// like a controller would. v is the value for faders, absent for buttons. Scores are saved with the composition.
'use strict';
const cues = { scores: {}, play: true, rec: false, recTrack: null, undo: null, lane: new Map(), prev: null, prevTrack: null, held: new Map() };
// DJ-side controls are the mix itself, not the visuals, so they are never recorded.
const cueSkip = id => /^(deck|agent):/.test(id) || id === 'crossfade' || id === 'tap' || id === 'resync';
// A track is known by file name and length, so a score still finds its track on another computer.
const trackId = d => (d && d.file && d.buffer ? d.file.name + '|' + Math.round(d.buffer.duration) : d && d.ext ? d.ext.id : null);

// The track the visuals follow right now: the deck driving the clock, or a track recognised on external gear (follow.js).
function cueDeck() {
  const d = audio.clockDeck;
  if (d && d.playing && beatOK(d)) return d;
  const x = typeof extDeck === 'function' ? extDeck() : null;
  return x && x.info ? x : null;
}
const cueBeat = d => deckBeats(d, deckHeard(d));

// ---------- recording ----------
function setCueRec(on) {
  const d = cueDeck();
  if (on && !d) { setStatus('Play an analysed track first: a score is recorded against its beats'); return; }
  cues.rec = on;
  if (on) {
    cues.recTrack = trackId(d);
    cues.undo = { track: cues.recTrack, list: (cues.scores[cues.recTrack] || []).slice() };
    cues.lane.clear();
    setStatus('Recording the visuals over ' + (d.name || 'this track') + ': clips, faders and effect sliders you touch are kept. Press Rec again to stop.');
  } else setStatus('Score recording stopped: ' + (cues.scores[cues.recTrack] || []).length + ' cues on this track');
}
// Called for every control the user moves or presses (DOM listeners below, and midi.js for controllers).
function cueRecord(id, v) {
  if (!cues.rec || !id || cueSkip(id) || (typeof midi !== 'undefined' && midi.learn)) return;
  const d = cueDeck();
  if (!d || trackId(d) !== cues.recTrack) return;
  const b = cueBeat(d), list = cues.scores[cues.recTrack] || (cues.scores[cues.recTrack] = []);
  if (v === null || v === undefined) {
    // a press: snapped to the nearest 1/4 beat when it is close, so cues sit on the grid
    const q = Math.round(b * 4) / 4, bb = Math.abs(q - b) < 0.08 ? q : b;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id && list[i].v === undefined && Math.abs(list[i].b - bb) < 0.1) list.splice(i, 1);
    list.push({ b: +bb.toFixed(4), id });
  } else {
    // a fader: overdub replaces what was recorded for it since the last value written in this pass
    const last = cues.lane.get(id);
    const from = last !== undefined && b - last < 2 ? last : b - 0.01;
    // (beats are stored rounded, so the value written last in this pass sits within 0.001 of `from`: keep it)
    for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; if (e.id === id && e.v !== undefined && e.b > from + 0.001 && e.b <= b + 0.01) list.splice(i, 1); }
    // keep at most 8 values a beat
    const prevV = list.filter(e => e.id === id && e.v !== undefined && e.b <= b).pop();
    if (!prevV || b - prevV.b >= 0.125 || Math.abs(prevV.v - v) > 0.05) list.push({ b: +b.toFixed(4), id, v: +(+v).toFixed(4) });
    cues.lane.set(id, b);
    cues.held.set(id, performance.now());
  }
  list.sort((a, c) => a.b - c.b);
}
function initCueCapture() {
  // a fader moved with the mouse
  document.addEventListener('input', e => { const t = e.target; if (t && t.dataset && t.dataset.midi && t.type === 'range') cueRecord(t.dataset.midi, +t.value); }, true);
  // a clip, column or button pressed with the mouse (capture phase, before the grid rebuilds)
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest && e.target.closest('[data-midi]');
    if (t && t.type !== 'range' && !(t.tagName === 'INPUT' && t.type === 'checkbox' && !t.dataset.midi.endsWith(':bypass'))) cueRecord(t.dataset.midi, null);
  }, true);
}
function undoCuePass() {
  if (!cues.undo) return;
  cues.scores[cues.undo.track] = cues.undo.list; cues.undo = null; cues.rec = false;
  setStatus('Last recording pass undone');
}
function clearCues() {
  const d = cueDeck(), id = trackId(d) || cues.prevTrack;
  if (!id || !cues.scores[id]) return;
  cues.undo = { track: id, list: cues.scores[id] };
  delete cues.scores[id];
  setStatus('Score cleared for this track (Undo brings it back)');
}

// ---------- playback ----------
// A cue aimed at a locked layer (its clips, faders or effects) is skipped: locked layers keep what you set.
function cueLocked(id) {
  const [a, b] = id.split(':');
  if (a === 'clip' || a === 'layer') return !!(comp.layers[+b] && comp.layers[+b].locked);
  if (a === 'fx') return comp.layers.some(L => L.locked && L.fx.some(e => e.uid === b));
  if (a === 'gen') return comp.layers.some(L => L.locked && L.clips.some(c => c && c.uid === b));
  return false;
}
function applyCue(e) {
  if (cueLocked(e.id)) return;
  if (e.id.startsWith('column:') && e.v === undefined) {   // column launch: only on unlocked layers
    const ci = +e.id.split(':')[1];
    comp.layers.forEach((L, li) => { if (!L.locked && !L.agent && L.clips[ci]) trigger(li, ci); });
    return;
  }
  const t = midiTarget(e.id);
  if (!t) return;
  if (e.v !== undefined && t.set) { t.set(e.v); if (typeof reflectMidi === 'function') reflectMidi(e.id, e.v); }
  else if (e.v === undefined && t.fire) t.fire();
}
function tickCues() {
  const d = cueDeck(), id = trackId(d), list = id && cues.scores[id];
  if (!d) { cues.prev = null; cues.prevTrack = null; return; }
  const b = cueBeat(d);
  if (id !== cues.prevTrack) { cues.prevTrack = id; cues.prev = null; }
  if (!list || !list.length || !cues.play) { cues.prev = b; return; }
  const now = performance.now(), heldNow = k => now - (cues.held.get(k) || 0) < 600;   // the user is moving it: hands off
  if (cues.prev !== null && b > cues.prev && b - cues.prev < 4) {
    for (const e of list) if (e.b > cues.prev && e.b <= b && !(e.v !== undefined && heldNow(e.id))) applyCue(e);
  } else if (cues.prev === null || Math.abs(b - cues.prev) >= 4 || b < cues.prev) {
    // started, jumped or looped back: put every fader where the score has it at this point (buttons are not replayed)
    const at = new Map();
    for (const e of list) { if (e.b > b) break; if (e.v !== undefined) at.set(e.id, e); }
    for (const e of at.values()) if (!heldNow(e.id)) applyCue(e);
  }
  cues.prev = b;
}

// ---------- UI: the track score row in the DJ panel ----------
const cueUI = {};
function buildCues() {
  cueUI.rec = el('button', { className: 'cue-rec', textContent: 'Rec', title: 'Record the visuals over the playing track: every clip, fader and effect slider you touch (mouse or MIDI) is kept against its beats', onclick: () => setCueRec(!cues.rec) });
  cueUI.play = el('button', { textContent: 'Play score', title: 'Play back the score of each track when it plays', onclick: () => { cues.play = !cues.play; } });
  cueUI.txt = el('span', { className: 'mixtxt' });
  return el('div', { className: 'dmix dcues' }, el('b', { textContent: 'Track score' }), cueUI.rec, cueUI.play,
    el('button', { textContent: 'Undo pass', title: 'Take back the last recording pass (or Clear)', onclick: undoCuePass }),
    el('button', { textContent: 'Clear', title: 'Delete the score of the playing track', onclick: clearCues }), cueUI.txt);
}
function tickCuesUI() {
  if (!cueUI.rec) return;
  cueUI.rec.classList.toggle('on', cues.rec);
  cueUI.play.classList.toggle('on', cues.play);
  const d = cueDeck(), id = trackId(d), n = id && cues.scores[id] ? cues.scores[id].length : 0;
  const total = Object.values(cues.scores).reduce((s, l) => s + l.length, 0);
  setText(cueUI.txt, !d ? (total ? Object.keys(cues.scores).length + ' track(s) have a score' : 'Play a track, press Rec, and perform: it plays back every time this track plays')
    : (cues.rec ? 'Recording over ' : '') + (d.ext ? 'external: ' : 'deck ' + d.id + ': ') + (d.name || '') + ' - ' + n + ' cue' + (n === 1 ? '' : 's'));
}
// Saved with the composition, inside the section-looks block (score.js).
function cuesToJSON() { return cues.scores; }
function cuesFromJSON(j) {
  cues.scores = {}; cues.rec = false; cues.undo = null;
  if (!j || typeof j !== 'object') return;
  for (const k in j) {
    if (!Array.isArray(j[k])) continue;
    const l = j[k].filter(e => e && typeof e.id === 'string' && typeof e.b === 'number' && isFinite(e.b) && !cueSkip(e.id))
      .map(e => (typeof e.v === 'number' && isFinite(e.v) ? { b: e.b, id: e.id, v: Math.min(1, Math.max(0, e.v)) } : { b: e.b, id: e.id }));
    if (l.length) cues.scores[String(k)] = l.sort((a, c) => a.b - c.b);
  }
}
// Cue beats of a deck's track, for the waveform ticks (dj.js).
const cuesFor = d => cues.scores[trackId(d)] || null;
