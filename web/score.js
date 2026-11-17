// Strodano VJ (web) - song sections in time with the music, and section looks (auto-score). GPL-3.0.
// Every analysed deck track carries info.sections (intro / build / drop / breakdown / outro, in bars from grid0).
// This file follows them at the HEARD position of the deck driving the visuals: it reports section changes on the shared
// music event bus (emitMusic, live.js), feeds the build-up and in-drop modulation sources (musicFeat, motion.js), answers
// "what comes next, and when" (sectionAhead), and, when the artist turns it on, recalls the look saved for each section.
'use strict';
const SECTION_TYPES = ['intro', 'build', 'drop', 'breakdown', 'outro'];
const SECTION_NAMES = { intro: 'Intro', build: 'Build', drop: 'Drop', breakdown: 'Breakdown', outro: 'Outro', mix: 'Mix' };
const LOOK_SLOTS = [...SECTION_TYPES, 'mix'];   // 'mix' is recalled while an auto-mix runs (mix.js), then the new track's section look
// Modulation sources that come from song structure and mixing (motion.js reads these). 0..1.
// mix: progress of an auto-mix, 0 -> 1; midmix: 0 -> 1 -> 0, highest half-way through it (mix.js writes both).
const musicFeat = { build: 0, drop: 0, mix: 0, midmix: 0 };
const score = { on: false, morph: 4, looks: {}, deck: null, idx: -1, tweens: [], liveDrop: false };

// ---------- where are we in the song ----------
// A deck's sections: the artist's edit (segments.js) if there is one, otherwise the analysis.
const secList = d => (typeof segmentsOf === 'function' ? segmentsOf(d) : d && d.info && d.info.sections);
function sectionNow(d) {
  const i = d && d.info, L = secList(d);
  if (!i || !L || !L.length || !i.ok || !d.buffer) return null;
  const bar = (deckHeard(d) - i.grid0) / i.barLen;
  for (let k = 0; k < L.length; k++) {
    const s = L[k];
    if (bar < s.bar + s.bars || k === L.length - 1) {
      if (bar < s.bar) return null;   // before the first bar
      return { type: s.type, index: k, bars: s.bars, progress: Math.min(1, (bar - s.bar) / s.bars), barsLeft: s.bar + s.bars - bar, seg: s };
    }
  }
  return null;
}
// The next section and how many bars until it starts (fractional), or null at the last one.
function sectionAhead(d) {
  const now = sectionNow(d), L = secList(d);
  if (!now || now.index + 1 >= L.length) return null;
  return { type: L[now.index + 1].type, bars: now.barsLeft };
}
// Bars until the next drop starts (0 while in one), or null when no drop is left.
function dropAhead(d) {
  const now = sectionNow(d), i = d && d.info, L = secList(d);
  if (!now) return null;
  if (now.type === 'drop') return 0;
  const bar = (deckHeard(d) - i.grid0) / i.barLen;
  for (let k = now.index + 1; k < L.length; k++) if (L[k].type === 'drop') return L[k].bar - bar;
  return null;
}
// Auto-score takes the clips from the Agent only when it has a look to recall (on with nothing saved, the Agent used to
// let go of every layer while nothing replaced it).
const scoreActive = () => score.on && (Object.keys(score.looks).length > 0 || (typeof seg !== 'undefined' && Object.values(seg.edits).some(es => es.some(s => s.lookMode && s.lookMode !== 'type'))));
// An auto-mix brings its own look (if one is saved); when it ends, the new track's current section look comes back.
function scoreMixStart() { score.mixing = true; if (score.on && score.looks.mix) recallLook(score.looks.mix); }
function scoreMixEnd() { score.mixing = false; score.idx = -1; }

// ---------- per frame (from audioTick) ----------
let scoreLastT = 0;
function tickScore() {
  const now = performance.now(), dt = Math.min(0.1, (now - (scoreLastT || now)) / 1000);
  scoreLastT = now;
  // the deck driving the visuals, or a track recognised on external gear (cues.js cueDeck, follow.js)
  const d = typeof cueDeck === 'function' ? cueDeck() : audio.clockDeck && audio.clockDeck.playing ? audio.clockDeck : null, s = d ? sectionNow(d) : null;
  // section changes (and a new deck taking over the visuals) go on the event bus
  if (s && (d !== score.deck || s.index !== score.idx)) {
    const data = { source: 'deck', deck: d.id, section: s.type, bars: s.bars };
    if (typeof emitMusic === 'function') emitMusic(s.type === 'drop' || s.type === 'breakdown' ? s.type : 'section', data);
    // the segment's own choice (segments.js): its type's look, another slot's, its own, or none
    const look = typeof lookForSegment === 'function' ? lookForSegment(s.seg) : score.looks[s.type];
    if (score.on && look && !score.mixing) recallLook(look);
    score.deck = d; score.idx = s.index;
  } else if (!s) { score.deck = null; score.idx = -1; }
  // structure sources: the build ramps 0 -> 1 over the build; "in drop" fades in over a beat and out over a bar
  musicFeat.build = s && s.type === 'build' ? s.progress : 0;
  const inDrop = s ? s.type === 'drop' : score.liveDrop;
  const bps = comp.bpm / 60;
  musicFeat.drop = inDrop ? Math.min(1, musicFeat.drop + dt * bps) : Math.max(0, musicFeat.drop - dt * bps / 4);
  tickTweens();
}
// Without a deck, the live listener's drops and breakdowns (live.js) drive the in-drop source.
function hookLiveEvents() {
  if (typeof onMusic !== 'function') return;
  onMusic((type, data) => {
    if (data && data.source === 'deck') return;
    if (type === 'drop') score.liveDrop = true;
    else if (type === 'breakdown' || type === 'song' || type === 'ended') score.liveDrop = false;
  });
}

// ---------- looks ----------
// A look is the state of the visuals: which clip each layer plays, layer opacity and bypass, and every effect's
// parameters, mix and on/off (matched by the effect's uid, so it survives reordering).
function captureLook() {
  const fx = ch => ch.map(e => ({ uid: e.uid, params: e.params.slice(), mix: e.mix, bypass: e.bypass }));
  return { layers: comp.layers.map(L => ({ active: L.active, opacity: L.opacity, bypass: L.bypass, fx: fx(L.fx) })), fx: fx(comp.fx) };
}
// Apply a look. Clips switch through trigger() (so clip transitions and the beat quantise apply); numbers glide over
// score.morph beats.
function recallLook(look) {
  if (!look) return;
  score.tweens = [];
  const glide = (obj, key, to) => { if (typeof to === 'number' && obj[key] !== to) score.tweens.push({ obj, key, from: obj[key], to }); };
  const fx = (chain, saved) => (saved || []).forEach(sv => {
    const e = chain.find(x => x.uid === sv.uid);
    if (!e) return;
    e.bypass = !!sv.bypass;
    glide(e, 'mix', sv.mix);
    sv.params.forEach((v, k) => { if (k < e.params.length) glide(e.params, k, v); });
  });
  look.layers.forEach((sv, li) => {
    const L = comp.layers[li];
    if (!L || L.locked) return;   // locked layers keep what you set (agent.js layerLocked)
    if (sv.active !== L.active) { if (sv.active < 0 || !L.clips[sv.active]) eject(li); else trigger(li, sv.active); }
    L.bypass = !!sv.bypass;
    glide(L, 'opacity', sv.opacity);
    fx(L.fx, sv.fx);
  });
  fx(comp.fx, look.fx);
  score.t0 = comp.beats;
  if (!score.morph) tickTweens();
  ui.gridDirty = ui.propsDirty = true;
}
function tickTweens() {
  if (!score.tweens.length) return;
  const p = score.morph ? Math.min(1, Math.max(0, (comp.beats - score.t0) / score.morph)) : 1;
  for (const t of score.tweens) t.obj[t.key] = t.from + (t.to - t.from) * p;
  if (p >= 1) { score.tweens = []; ui.propsDirty = true; }
}
// Saved with the composition (engine.js compToJSON / loadComp).
function scoreToJSON() { return { on: score.on, morph: score.morph, looks: score.looks, cues: typeof cuesToJSON === 'function' ? cuesToJSON() : undefined, segments: typeof segmentsToJSON === 'function' ? segmentsToJSON() : undefined }; }
// A saved look, checked field by field (it can come from a shared .svj file). null if it is not a look.
function lookFromJSON(l) {
  if (!l || !Array.isArray(l.layers)) return null;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const fx = a => (Array.isArray(a) ? a : []).filter(e => e && typeof e.uid === 'string').map(e => ({ uid: e.uid, params: (Array.isArray(e.params) ? e.params : []).slice(0, 8).map(v => num(v, 0)), mix: num(e.mix, 1), bypass: !!e.bypass }));
  return { layers: l.layers.map(x => ({ active: num(x && x.active, -1) | 0, opacity: num(x && x.opacity, 1), bypass: !!(x && x.bypass), fx: fx(x && x.fx) })), fx: fx(l.fx) };
}
function scoreFromJSON(j) {
  score.looks = {}; score.on = false; score.tweens = [];
  if (typeof cuesFromJSON === 'function') cuesFromJSON(j && j.cues);   // track scores (cues.js)
  if (typeof segmentsFromJSON === 'function') segmentsFromJSON(j && j.segments);   // edited segments (segments.js)
  if (!j || typeof j !== 'object') return;
  for (const t of LOOK_SLOTS) { const l = lookFromJSON(j.looks && j.looks[t]); if (l) score.looks[t] = l; }
  score.on = !!j.on; score.morph = [0, 1, 4, 8].includes(j.morph) ? j.morph : 4;
}

// ---------- UI: the section looks row in the DJ panel ----------
const scoreUI = {};
function buildScore() {
  scoreUI.slots = {};
  const slots = LOOK_SLOTS.map(t => {
    const name = el('button', { className: 'sl-name', textContent: SECTION_NAMES[t], dataset: { midi: 'deck:look:' + t },
      onclick: () => { if (score.looks[t]) { recallLook(score.looks[t]); setStatus(SECTION_NAMES[t] + ' look recalled'); } else saveLook(t); } });
    const save = el('button', { className: 'sl-save', textContent: 'Save', title: 'Save the visuals as they are now as the ' + SECTION_NAMES[t] + ' look', onclick: () => saveLook(t) });
    const clr = el('button', { className: 'sl-clr', textContent: '×', title: 'Forget the ' + SECTION_NAMES[t] + ' look', onclick: () => { delete score.looks[t]; setStatus(SECTION_NAMES[t] + ' look cleared'); } });
    scoreUI.slots[t] = { box: el('span', { className: 'slot sec-' + t }, name, save, clr), name };
    return scoreUI.slots[t].box;
  });
  scoreUI.on = el('button', { textContent: 'Auto-score', title: 'Recall each section\'s look when the music reaches that section, on the bar', dataset: { midi: 'deck:look:auto' }, onclick: () => setScore(!score.on) });
  scoreUI.morph = el('select', { title: 'How long a look takes to glide in', onchange: e => { score.morph = +e.target.value; } },
    ...[[0, 'Instant'], [1, 'Glide 1 beat'], [4, 'Glide 1 bar'], [8, 'Glide 2 bars']].map(([v, n]) => el('option', { value: v, textContent: n, selected: v === score.morph })));
  scoreUI.txt = el('span', { className: 'mixtxt' });
  const editBtn = el('button', { textContent: 'Edit segments...', title: "Move, resize, split or re-label the sections of a deck's track, and choose the visuals for each one", onclick: () => openSegments() });
  return el('div', { className: 'dmix dscore' }, el('b', { textContent: 'Section looks' }), ...slots, scoreUI.morph, scoreUI.on, editBtn, scoreUI.txt);
}
function saveLook(t) {
  score.looks[t] = captureLook();
  setStatus(SECTION_NAMES[t] + ' look saved: ' + (score.on ? 'it plays at every ' + t : 'turn on Auto-score to play it at every ' + t));
}
function setScore(on) {
  score.on = on;
  if (on && !Object.keys(score.looks).length) setStatus('Auto-score is on. Set up the visuals for a section, then press its name (or Save) to keep that look.');
  else if (on) { setStatus('Auto-score on: each section recalls its look'); score.idx = -1; }   // apply the current section's look now
}
function tickScoreUI() {
  if (!scoreUI.on) return;
  scoreUI.on.classList.toggle('on', score.on);
  const d = typeof cueDeck === 'function' ? cueDeck() : audio.clockDeck && audio.clockDeck.playing ? audio.clockDeck : null, s = d ? sectionNow(d) : null, a = s && sectionAhead(d);
  for (const t of LOOK_SLOTS) {
    const u = scoreUI.slots[t];
    u.box.classList.toggle('has', !!score.looks[t]);
    u.box.classList.toggle('now', t === 'mix' ? !!score.mixing : !score.mixing && !!s && s.type === t);
    u.name.title = score.looks[t] ? 'Recall the ' + SECTION_NAMES[t] + ' look' : 'Nothing saved yet: click to save the visuals as they are now as the ' + SECTION_NAMES[t] + ' look';
  }
  setText(scoreUI.txt, !d ? 'Play an analysed track to follow its sections' : !s ? 'No sections found in this track'
    : SECTION_NAMES[s.type] + ' (' + Math.ceil(s.barsLeft) + ' of ' + s.bars + ' bars left)' + (a ? ', then ' + SECTION_NAMES[a.type].toLowerCase() : ''));
}
// MIDI: "deck:look:<section>" recalls (or saves, when empty) a look; "deck:look:auto" toggles auto-score.
function lookMidiTarget(what) {
  if (what === 'auto') return { fire: () => setScore(!score.on) };
  if (!LOOK_SLOTS.includes(what)) return null;
  return { fire: () => { if (score.looks[what]) recallLook(score.looks[what]); else saveLook(what); } };
}
