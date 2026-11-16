// Strodano VJ (web) - Agent: an autopilot for the visuals. It listens (live.js) and directs: a new look on each song,
// a peak look cut in on each drop, calm looks in breakdowns, small variations every few bars, and it steps aside for a
// while when you trigger clips yourself. GPL-3.0.
// Its looks are built from the shader generators and effects, coloured by the song's key and paced by its tempo and energy,
// and drawn on three layers of its own on top of the composition (two look slots that cross-fade, and an accent layer).
// It can also play your own clip columns, tagged Calm / Groove / Peak / Drop, which is how a set is pre-programmed.
'use strict';
const AGENT_KEY = 'strodano-vj-agent';
const agent = {
  on: false, visuals: 'gen', onSong: true, vary: 16, strobe: false, hold: false, useMedia: true, vibe: 'club',
  slots: [null, null], accent: null, op: [0, 0], build: 0, dim: 1, cur: 0, fade: null, look: null, lookBeat: 0, history: [], pending: null,
  holdUntil: -1, snap: '', hueShift: Math.random(), boost: 0, lastBand: 'groove', showingClips: false, col: -1, mixLookBeat: -1e9,
};
// Vibes: one choice that sets everything a newcomer should not have to think about. shift moves every look one energy
// band down (-1) or up (+1); mix / bars are the auto-mix's style and length (mix.js).
const AGENT_VIBES = {
  chill: { label: 'Chill', title: 'Slow, soft looks that change rarely; long smooth blends between songs', vary: 32, shift: -1, mix: 'blend', bars: 16 },
  club: { label: 'Club', title: 'Balanced: looks follow the energy of the music; bass-swap mixes', vary: 16, shift: 0, mix: 'bass', bars: 8 },
  festival: { label: 'Festival', title: 'High energy: busier looks that change often; quicker mixes', vary: 8, shift: 1, mix: 'bass', bars: 4 },
};
try { const s = JSON.parse(localStorage.getItem(AGENT_KEY) || '{}'); for (const k of ['visuals', 'onSong', 'vary', 'strobe', 'useMedia', 'vibe']) if (k in s) agent[k] = s[k]; } catch (e) {}
if (!AGENT_VIBES[agent.vibe]) agent.vibe = 'club';
function saveAgent() { try { localStorage.setItem(AGENT_KEY, JSON.stringify({ visuals: agent.visuals, onSong: agent.onSong, vary: agent.vary, strobe: agent.strobe, useMedia: agent.useMedia, vibe: agent.vibe })); } catch (e) {} }
function setVibe(v) {
  const p = AGENT_VIBES[v];
  if (!p) return;
  agent.vibe = v; agent.vary = p.vary;
  if (typeof mixer !== 'undefined') { mixer.style = p.mix; mixer.bars = p.bars; if (typeof saveMixer === 'function') saveMixer(); }
  saveAgent();
  if (typeof plReplanAll === 'function') plReplanAll();   // planned looks follow the vibe (playlist.js)
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
const BANDS = ['calm', 'groove', 'peak'];
const vibeBand = band => BANDS[Math.min(2, Math.max(0, BANDS.indexOf(band) + (AGENT_VIBES[agent.vibe] || AGENT_VIBES.club).shift))] || band;
// Locked layers (L.locked) are left alone by the Agent, section looks (score.js) and track scores (cues.js).
const layerLocked = li => !!(comp.layers[li] && comp.layers[li].locked);
const COL_TAGS = ['', 'Calm', 'Groove', 'Peak', 'Drop'];
const colTag = ci => (comp.agentTags && comp.agentTags[ci]) || '';

// ---------- layers ----------
function agentLayer(name) {
  const L = newLayer();
  L.name = name; L.agent = true;
  return L;
}
// The Agent's layers always sit on top, in this order: slot 1, slot 2, accent.
function ensureAgentLayers() {
  const want = [agent.slots[0], agent.slots[1], agent.accent];
  if (want.some(L => !L || !comp.layers.includes(L))) {
    for (const L of want) if (L && comp.layers.includes(L)) removeLayer(comp.layers.indexOf(L));
    agent.slots = [agentLayer('Agent look 1'), agentLayer('Agent look 2')];
    agent.accent = agentLayer('Agent accent');
    agent.accent.blend = 1; agent.accent.opacity = 0;
    agent.slots[0].opacity = 0; agent.slots[1].opacity = 0; agent.op = [0, 0];
    comp.layers.push(agent.slots[0], agent.slots[1], agent.accent);
    agent.look = null; agent.fade = null;
    const fl = genClip('Beat Flash');
    if (fl) { agent.accent.clips[0] = fl; agent.accent.active = 0; }
    ui.gridDirty = ui.propsDirty = true;
    return;
  }
  const n = comp.layers.length;
  if (comp.layers[n - 3] !== want[0] || comp.layers[n - 2] !== want[1] || comp.layers[n - 1] !== want[2]) {   // a layer was added above them
    comp.layers = comp.layers.filter(L => !want.includes(L)).concat(want);
    ui.gridDirty = true;
  }
}
function dropAgentLayers() {
  for (const L of [agent.slots[0], agent.slots[1], agent.accent]) if (L && comp.layers.includes(L)) { const i = comp.layers.indexOf(L); L.clips.forEach(freeClip); freeRT(L.rt); comp.layers.splice(i, 1); }
  agent.slots = [null, null]; agent.accent = null; agent.look = null; agent.fade = null;
  if (typeof sel !== 'undefined') sel.l = Math.min(sel.l, comp.layers.length - 1);
  ui.gridDirty = ui.propsDirty = true;
}

// ---------- looks ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const GEN_POOL = {
  calm: ['Gradient', 'Plasma', 'Audio Rings', 'Tunnel'],
  groove: ['Plasma', 'Tunnel', 'Lines', 'Audio Rings', 'Checkerboard', 'Gradient'],
  peak: ['Tunnel', 'Lines', 'Checkerboard', 'Noise', 'Plasma', 'Audio Rings'],
};
// Effect recipes: parameter name -> [lo, hi] (random in range), 'r' (anything), 'b' (on or off), or a number.
// lfo: [param name, beats per cycle, shape, depth]. Tuned by hand for the built-in effects.
const FX_POOL = {
  calm: [
    { def: 'Kaleidoscope', p: { Segments: [0.15, 0.45], Rotation: 'r', 'Auto Speed': [0.02, 0.06] } },
    { def: 'Mirror', p: { Vertical: 'b', 'Flip Side': 'b' } },
    { def: 'Wave Warp', p: { Amount: [0.05, 0.14], Frequency: [0.08, 0.25], Speed: [0.04, 0.12] } },
    { def: 'Hue Rotate', p: { Hue: 'r', 'Auto Speed': [0.005, 0.03] } },
    { def: 'Blur', p: { Radius: [0.05, 0.15] } },
    { def: 'Vignette', p: { Size: [0.35, 0.55], Softness: [0.4, 0.7] } },
  ],
  groove: [
    { def: 'Kaleidoscope', p: { Segments: [0.2, 0.6], Rotation: 'r', 'Auto Speed': [0.04, 0.15] } },
    { def: 'Mirror', p: { Vertical: 'b', 'Flip Side': 'b' } },
    { def: 'RGB Shift', p: { Amount: [0.06, 0.14], Angle: 'r' }, lfo: ['Amount', 2, 0, 0.5] },
    { def: 'Audio Pulse', p: { Zoom: [0.15, 0.35], Flash: [0.1, 0.3], 'Kick Bass Mid High': 0 } },
    { def: 'Hue Rotate', p: { Hue: 'r', 'Auto Speed': [0.02, 0.06] } },
    { def: 'Wave Warp', p: { Amount: [0.08, 0.2], Frequency: [0.15, 0.4], Speed: [0.1, 0.3] } },
    { def: 'Tile', p: { 'Tiles X': [0.05, 0.14], 'Tiles Y': [0.05, 0.14] } },
    { def: 'Edge Detect', p: { Strength: [0.3, 0.6], 'Mix Original': [0.4, 0.7] } },
    { def: 'Transform', p: { Scale: [0.45, 0.6], Rotation: 'r', X: 0.5, Y: 0.5 }, lfo: ['Rotation', 16, 2, 1] },
  ],
  peak: [
    { def: 'Audio Pulse', p: { Zoom: [0.4, 0.7], Flash: [0.3, 0.6], 'Kick Bass Mid High': 0 } },
    { def: 'RGB Shift', p: { Amount: [0.15, 0.3], Angle: 'r' }, lfo: ['Amount', 1, 4, 0.8] },
    { def: 'Kaleidoscope', p: { Segments: [0.3, 0.8], Rotation: 'r', 'Auto Speed': [0.15, 0.4] } },
    { def: 'Pixelate', p: { Size: [0.05, 0.15] }, lfo: ['Size', 2, 5, 0.4] },
    { def: 'Mirror', p: { Vertical: 'b', 'Flip Side': 'b' } },
    { def: 'Edge Detect', p: { Strength: [0.5, 0.8], 'Mix Original': [0.2, 0.5] } },
    { def: 'Tile', p: { 'Tiles X': [0.1, 0.25], 'Tiles Y': [0.1, 0.25] }, lfo: ['Tiles X', 4, 4, 0.3] },
  ],
};
const FX_COUNT = { calm: [1, 2], groove: [2, 2], peak: [2, 3] };
function specValue(s) { return Array.isArray(s) ? rnd(s[0], s[1]) : s === 'r' ? Math.random() : s === 'b' ? (Math.random() < 0.5 ? 0 : 1) : s; }
// Colour from the key: Camelot numbers go round the colour wheel (neighbouring keys get neighbouring colours).
function lookHue() {
  const k = musicKey(), n = parseInt(k);
  return n ? ((n - 1) / 12 + agent.hueShift * 0.08) % 1 : agent.hueShift;
}
// Generator parameters by name: hue from the key, speed from the tempo and energy, the rest picked at random.
function genParams(d, band, hue) {
  const sp = { calm: 0.12, groove: 0.25, peak: 0.45 }[band] * Math.min(1.6, Math.max(0.6, comp.bpm / 125));
  return d.params.map(pd => {
    const n = pd.name.toLowerCase();
    if (n === 'hue' || n === 'hue a') return hue;
    if (n === 'hue b') return (hue + rnd(0.06, 0.18)) % 1;
    if (n.includes('speed')) return Math.min(1, sp * rnd(0.8, 1.25));
    if (n === 'saturation') return band === 'calm' ? 0.55 : 0.85;
    if (n === 'brightness') return 1;
    if (n === 'vertical') return Math.random() < 0.5 ? 0 : 1;
    return rnd(0.2, 0.7);
  });
}
function makeFx(r, d) {
  const e = { def: r.def, params: d.params.map(pd => (pd.name in r.p ? specValue(r.p[pd.name]) : pd.def)), mod: undefined };
  if (r.lfo) {
    const k = d.params.findIndex(pd => pd.name === r.lfo[0]);
    if (k >= 0) e.mod = { [k]: { rate: r.lfo[1], shape: r.lfo[2], depth: r.lfo[3] } };
  }
  return e;
}
// A look: a source (generator, or one of your video clips) and a short effect chain, chosen for the energy band.
// hue: colour to use (default: from the key playing now); recent: sources to avoid (default: the last three shown).
function makeLook(band, drop, hue, recent) {
  recent = recent || agent.history.slice(-3).map(l => l.src);
  const gens = (GEN_POOL[band] || GEN_POOL.groove).filter(g => DEFS.gen.has(g));
  const customs = [...DEFS.gen.values()].filter(d => d.custom).map(d => d.name);
  const videos = agent.useMedia ? media.filter(m => m.kind === 'video') : [];
  let src, mediaItem = null;
  if (videos.length && Math.random() < 0.35) { mediaItem = pick(videos.filter(m => !recent.includes(m.name)).length ? videos.filter(m => !recent.includes(m.name)) : videos); src = mediaItem.name; }
  else {
    const pool = gens.concat(customs).filter(g => !recent.includes(g));
    src = pick(pool.length ? pool : gens.concat(customs));
  }
  if (hue === undefined) hue = lookHue();
  const rec = FX_POOL[band].filter(r => DEFS.fx.has(r.def));
  const [lo, hi] = FX_COUNT[band], n = lo + Math.floor(Math.random() * (hi - lo + 1)), fx = [];
  const bag = rec.slice();
  while (fx.length < n && bag.length) { const r = bag.splice(Math.floor(Math.random() * bag.length), 1)[0]; fx.push(makeFx(r, DEFS.fx.get(r.def))); }
  if (drop && agent.strobe && DEFS.fx.has('Strobe')) fx.push(makeFx({ def: 'Strobe', p: { Rate: 0.5, 'Beat Sync': 1, Duty: 0.5 } }, DEFS.fx.get('Strobe')));
  const look = { band, src, media: mediaItem, hue, fx };
  if (!mediaItem) { const d = DEFS.gen.get(src); look.params = genParams(d, band, hue); }
  return look;
}
// A variation of the current look: one effect swapped, or a step round the colour wheel, or a new source.
function varyLook(base) {
  const l = { ...base, fx: base.fx.map(e => ({ ...e, params: e.params.slice() })), params: base.params && base.params.slice() };
  const r = Math.random();
  if (r < 0.5 && l.fx.length) {
    const used = new Set(l.fx.map(e => e.def)), cand = FX_POOL[l.band].filter(x => DEFS.fx.has(x.def) && !used.has(x.def));
    if (cand.length) { const x = pick(cand); l.fx[Math.floor(Math.random() * l.fx.length)] = makeFx(x, DEFS.fx.get(x.def)); return l; }
  }
  if (r < 0.8 && l.params) {
    const d = DEFS.gen.get(l.src), step = (Math.random() < 0.5 ? 1 : -1) / 12;
    l.hue = (l.hue + step + 1) % 1;
    if (d) d.params.forEach((pd, k) => { const n = pd.name.toLowerCase(); if (n === 'hue' || n === 'hue a') l.params[k] = l.hue; if (n === 'hue b') l.params[k] = (l.params[k] + step + 1) % 1; });
    return l;
  }
  const fresh = makeLook(l.band, false);
  fresh.fx = l.fx;
  return fresh;
}
const lookLabel = l => (l ? l.src + (l.fx.length ? ' + ' + l.fx.map(e => e.def).join(', ') : '') + ' (' + l.band + ')' : '');

function putLook(L, look) {
  const li = comp.layers.indexOf(L);
  if (li < 0) return;
  L.fx = look.fx.map(f => { const e = mkEffect(f.def); if (!e) return null; e.params = f.params.slice(); e.mod = f.mod; return e; }).filter(Boolean);
  let clip;
  if (look.media) clip = mediaClip(look.media);
  else { clip = genClip(look.src); if (clip) clip.params = look.params.slice(); }
  if (!clip) return;
  clip.name = 'Agent: ' + (look.media ? look.media.name.replace(/\.[^.]+$/, '') : look.src);
  setClip(li, 0, clip);
  if (clip.video) clip.video.loop = true;
  agentTrigger(li, 0);
  L.fit = 0; L.blend = 0;
}
// The Agent's own triggers skip the clip quantise (it already times them) and are not mistaken for yours.
function agentTrigger(li, ci) {
  const was = quantFiring;
  quantFiring = true;
  try { trigger(li, ci); } finally { quantFiring = was; }
  agent.snap = userSnap();
}
// Show a look: it goes onto the slot that is not on screen, which then fades in over `beats` (0 = cut).
function showLook(look, beats) {
  const inc = 1 - agent.cur;
  putLook(agent.slots[inc], look);
  agent.fade = { to: inc, b0: comp.beats, len: beats };
  agent.cur = inc; agent.look = look; agent.lookBeat = comp.beats; agent.showingClips = false;
  agent.history.push(look); if (agent.history.length > 12) agent.history.shift();
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
// Your clips: trigger a tagged column (your layer transitions apply), and fade the Agent's look away.
function bestColumn(band, drop) {
  const want = drop ? ['Drop', 'Peak'] : { calm: ['Calm'], groove: ['Groove'], peak: ['Peak'] }[band];
  const has = ci => comp.layers.some(L => !L.agent && !L.locked && L.clips[ci]);
  const cols = [...Array(comp.columns).keys()].filter(has);
  if (!cols.length) return -1;
  let c = cols.filter(ci => want.includes(colTag(ci)));
  if (!c.length) c = cols.filter(ci => !colTag(ci));
  if (!c.length) c = cols;
  const other = c.filter(ci => ci !== agent.col);
  return pick(other.length ? other : c);
}
function showColumn(ci, beats) {
  comp.layers.forEach((L, li) => { if (!L.agent && !L.locked && L.clips[ci]) agentTrigger(li, ci); });
  agent.col = ci; agent.showingClips = true;
  agent.fade = { to: -1, b0: comp.beats, len: Math.max(beats, 2) };   // both look slots fade out
  agent.lookBeat = comp.beats;
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
// One decision: a look or one of your columns, for this band. reason: song | drop | breakdown | section | band | vary | next
// A playlist track's planned look for the section playing now (playlist.js) wins over a freshly made one, except for
// variations and the Next look button, which always bring something new.
function change(reason) {
  const drop = reason === 'drop', band = vibeBand(drop ? 'peak' : reason === 'breakdown' ? 'calm' : live.band);
  const beats = drop ? 0 : reason === 'song' ? 8 : reason === 'breakdown' ? 16 : 4;
  let useClips = agent.visuals === 'clips' || (agent.visuals === 'both' && Math.random() < 0.5);
  const col = useClips ? bestColumn(band, drop) : -1;
  if (useClips && col >= 0) { showColumn(col, beats); return; }
  const planned = reason !== 'vary' && reason !== 'next' && typeof plannedLook === 'function' ? plannedLook() : null;
  if (planned) showLook(planned, planned.band === 'peak' && drop ? 0 : beats);
  else if (reason === 'vary' && agent.look && agent.look.band === band && !agent.showingClips) showLook(varyLook(agent.look), beats);
  else showLook(makeLook(band, drop), beats);
  if (drop) agent.boost = 1;
}
// An auto-mix has started (mix.js): bring in the incoming track's first planned look, timed by the playlist's visual
// transition for this junction: 'mix' fades over the whole mix, 'quick' over a bar, 'cut' cuts with a flash.
function agentMixStart(m) {
  if (!agent.on || agent.hold || agent.scored || comp.beats < agent.holdUntil) return;
  const look = typeof plannedLookAt === 'function' ? plannedLookAt(m.inn, typeof inPoint === 'function' ? inPoint(m.inn) : m.inn.info.mixIn) : null;
  if (!look || agent.visuals === 'clips') return;
  const vis = (typeof plJunction === 'function' && plJunction(m.out).vis) || 'mix';
  const beats = vis === 'cut' ? 0 : vis === 'quick' ? 4 : Math.max(4, m.lenBeats || 8);
  agent.pending = null;
  showLook(look, beats);
  if (vis === 'cut') agent.boost = 1;
  agent.mixLookBeat = comp.beats;
}
// Changes wait for the next bar (drops do not), so the visuals turn over on the downbeat.
function agentSchedule(reason) {   // (not 'schedule': ui.js owns that name)
  if (agent.hold || comp.beats < agent.holdUntil) return;
  if (reason === 'drop') { agent.pending = null; change('drop'); return; }
  const at = 4 * Math.ceil((comp.beats + 0.05) / 4);
  const rank = { song: 4, breakdown: 3, section: 3, band: 2, vary: 1, next: 5 };
  if (agent.pending && rank[agent.pending.reason] >= rank[reason]) return;
  agent.pending = { at, reason };
}
onMusic((type, d) => {
  if (!agent.on) return;
  // A playlist track with planned looks: every section change brings its own look (a mix that just brought in the
  // new track's look is left to finish first).
  if (d.source === 'deck' && typeof plannedLook === 'function' && (type === 'section' || type === 'breakdown') && plannedLook()) {
    if (comp.beats - agent.mixLookBeat > 32) agentSchedule('section');
    return;
  }
  if (type === 'song') { agent.hueShift = Math.random(); if (agent.onSong) agentSchedule('song'); }
  else if (type === 'drop') agentSchedule('drop');
  else if (type === 'breakdown') agentSchedule('breakdown');
  else if (type === 'section' && (d.section === 'intro' || d.section === 'outro') && comp.beats - agent.lookBeat >= 16) agentSchedule('breakdown');   // calm looks for intros and outros
  else if (type === 'band') { if ((!agent.look || agent.look.band !== d.band) && comp.beats - agent.lookBeat >= 32) agentSchedule('band'); }   // a look stays 8 bars at least
  else if (type === 'phrase') { if (agent.vary && comp.beats - agent.lookBeat >= agent.vary * 4 - 0.5) agentSchedule('vary'); }
});

// What clip each of your layers is showing (or about to): a change the Agent did not make is you playing live.
// Locked layers are yours to play without the Agent stepping aside, so they are not counted.
const userSnap = () => comp.layers.filter(L => !L.agent).map(L => (L.locked ? 'L' : L.pendingCol >= 0 ? L.pendingCol : L.active)).join(',');

function agentTick() {
  if (!agent.on) return;
  ensureAgentLayers();
  const b = comp.beats;
  // DJ section looks (score.js) are switching the clips: the Agent's looks step aside and it changes nothing
  if (typeof scoreActive === 'function' && scoreActive()) {
    agent.pending = null;
    if (!agent.showingClips) { agent.fade = { to: -1, b0: b, len: 4 }; agent.showingClips = true; agent.col = -1; agent.scored = true; }
  } else if (agent.scored) { agent.scored = false; agent.holdUntil = -1; agent.showingClips = false; agent.look = null; }   // back to the Agent: a fresh look
  // you triggered a clip: the Agent's look fades away and it waits 8 bars before taking over again
  const s = userSnap();
  if (s !== agent.snap) {
    agent.snap = s;
    if (!agent.scored && (!agent.showingClips || agent.visuals === 'gen')) {
      agent.holdUntil = b + 32; agent.pending = null;
      agent.fade = { to: -1, b0: b, len: 2 }; agent.showingClips = true; agent.col = -1;
      if (typeof agentUIDirty === 'function') agentUIDirty();
    }
  }
  if (!agent.look && !agent.showingClips && !agent.hold) change('song');   // first look as soon as the Agent starts
  if (agent.showingClips && agent.col < 0 && agent.holdUntil >= 0 && b >= agent.holdUntil && !agent.hold) { agent.holdUntil = -1; agentSchedule('next'); }
  if (agent.pending && !agent.scored && b >= agent.pending.at - 0.02) { const r = agent.pending.reason; agent.pending = null; change(r); }
  // cross-fade between the two look slots (smoothstep, in beats), on the slots' base opacities (agent.op)
  const [s0, s1] = agent.slots, f = agent.fade, op = agent.op;
  if (f) {
    let p = f.len > 0 ? Math.min(1, Math.max(0, (b - f.b0) / f.len)) : 1;
    p = p * p * (3 - 2 * p);
    if (f.to === 1) { op[0] = op[0] > 0 ? 1 : 0; op[1] = p; }
    else if (f.to === 0) { op[0] = 1; op[1] = Math.min(op[1], 1 - p); }
    else { op[0] = Math.min(op[0], 1 - p); op[1] = Math.min(op[1], 1 - p); }
    if (p >= 1) {
      agent.fade = null;
      const out = f.to === 1 ? 0 : f.to === 0 ? 1 : -1;
      if (out >= 0) { op[out] = 0; eject(comp.layers.indexOf(agent.slots[out])); }   // free the slot that is no longer seen
    }
  }
  // Build-up into a drop (analysed deck tracks, score.js): flashes rise and sharpen through the build, and the picture
  // goes nearly black for the last two beats, so the cut to the drop look lands on the drop.
  const d = live.src === 'dj' ? audio.clockDeck : null;
  const ahead = d && typeof dropAhead === 'function' ? dropAhead(d) : null;
  const build = d && typeof musicFeat !== 'undefined' ? musicFeat.build : 0;
  let dim = 1;
  if (ahead !== null && ahead > 0 && ahead <= 0.5 && !agent.showingClips) { const q = 1 - ahead / 0.5; dim = 1 - 0.85 * q * q * (3 - 2 * q); }
  agent.build = build; agent.dim = dim;
  s0.opacity = op[0] * dim; s1.opacity = op[1] * dim;
  // accent: a flash on the beat in peaks, after a drop, and rising through a build
  const A = agent.accent;
  if (A) {
    agent.boost = Math.max(0, agent.boost - 1 / (32 * 60));
    const peak = !agent.showingClips && agent.look && agent.look.band === 'peak';
    A.opacity = ((peak ? 0.25 : 0) + agent.boost * 0.5 + (agent.showingClips ? 0 : build * 0.55)) * dim;
    const fl = A.clips[0];
    if (fl && fl.params) { fl.params[0] = agent.look ? agent.look.hue : 0; fl.params[1] = 0.3; fl.params[2] = 0.5 + 0.4 * build; }
  }
}
function setAgent(on) {
  if (on === agent.on) return;
  agent.on = on;
  if (on) {
    audioCtx();
    agent.look = null; agent.pending = null; agent.holdUntil = -1; agent.showingClips = false; agent.col = -1;
    ensureAgentLayers(); agent.snap = userSnap();
    setStatus('Agent on: it picks and changes the visuals with the music');
  } else { dropAgentLayers(); setStatus('Agent off'); }
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
function agentNext() { if (!agent.on) return setAgent(true); agent.hold = false; agent.holdUntil = -1; agentSchedule('next'); }
function agentDrop() { if (!agent.on) return; agent.hold = false; agent.holdUntil = -1; change('drop'); }
function agentHold(v) { agent.hold = v === undefined ? !agent.hold : v; agent.pending = null; if (typeof agentUIDirty === 'function') agentUIDirty(); }
// MIDI: agent:on | next | hold | drop | rec
function agentMidiTarget(what) {
  if (what === 'on') return { fire: () => (typeof startShow === 'function' ? startShow() : setAgent(!agent.on)) };   // the panel's Start / Stop
  if (what === 'next') return { fire: agentNext };
  if (what === 'hold') return { fire: () => agentHold() };
  if (what === 'drop') return { fire: agentDrop };
  if (what === 'rec') return { fire: () => { if (typeof recToggle === 'function') recToggle(); } };
  return null;
}
