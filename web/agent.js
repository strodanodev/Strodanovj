// Strodano VJ (web) - Agent: an autopilot that plays YOUR composition. It listens (live.js, the decks) and directs the
// layers and clips you set up: which clip each layer plays, and which layers are up, following the music's energy.
// GPL-3.0.
// A scene is the Agent's unit of change: { band, drop, col, show: { layerIndex: column } }. Layers in `show` play that
// clip at their full level; the other layers it may play fade out. Calm scenes keep only the bottom layer up, groove
// brings in about two thirds, peak shows them all, so energy reads as layers joining and leaving.
// Columns you tag Calm / Groove / Peak / Drop are finished looks: the Agent plays a fitting column exactly as you built
// it. Untagged clips are combined by the Agent itself. Locked and bypassed layers are never touched; your layer
// transitions and effects apply as you set them. Your layer opacity is the ceiling: the Agent fades between 0 and it.
// When: a new scene on each song, the drop scene cut in on each drop, a calm scene in breakdowns, intros and outros, a
// variation every N bars; analysed playlist songs bring their planned scene per section (playlist.js). It steps aside
// for 8 bars when you trigger a clip yourself, and while DJ section looks (score.js) are on.
'use strict';
const AGENT_KEY = 'strodano-vj-agent';
const agent = {
  on: false, onSong: true, vary: 16, hold: false, vibe: 'club',
  scene: null, lookBeat: 0, history: [], pending: null, holdUntil: -1, snap: '', mixLookBeat: -1e9, lastB: undefined,
  base: new Map(), vis: new Map(), fades: new Map(), written: new Map(),   // per layer object: your level, shown 0..1, fade, last opacity written
  dim: 1, build: 0, empty: false, scored: false,
};
// Vibes: one choice that sets everything a newcomer should not have to think about. shift moves every scene one energy
// band down (-1) or up (+1); mix / bars are the auto-mix's style and length (mix.js).
const AGENT_VIBES = {
  chill: { label: 'Chill', title: 'Fewer layers, slow changes; long smooth blends between songs', vary: 32, shift: -1, mix: 'blend', bars: 16 },
  club: { label: 'Club', title: 'Balanced: layers follow the energy of the music; bass-swap mixes', vary: 16, shift: 0, mix: 'bass', bars: 8 },
  festival: { label: 'Festival', title: 'High energy: more layers up, frequent changes; quicker mixes', vary: 8, shift: 1, mix: 'bass', bars: 4 },
};
try { const s = JSON.parse(localStorage.getItem(AGENT_KEY) || '{}'); for (const k of ['onSong', 'vary', 'vibe']) if (k in s) agent[k] = s[k]; } catch (e) {}
if (!AGENT_VIBES[agent.vibe]) agent.vibe = 'club';
function saveAgent() { try { localStorage.setItem(AGENT_KEY, JSON.stringify({ onSong: agent.onSong, vary: agent.vary, vibe: agent.vibe })); } catch (e) {} }
function setVibe(v) {
  const p = AGENT_VIBES[v];
  if (!p) return;
  agent.vibe = v; agent.vary = p.vary;
  if (typeof mixer !== 'undefined') { mixer.style = p.mix; mixer.bars = p.bars; if (typeof saveMixer === 'function') saveMixer(); }
  saveAgent();
  if (typeof plReplanAll === 'function') plReplanAll();   // planned scenes follow the vibe (playlist.js)
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
const BANDS = ['calm', 'groove', 'peak'];
const vibeBand = band => BANDS[Math.min(2, Math.max(0, BANDS.indexOf(band) + (AGENT_VIBES[agent.vibe] || AGENT_VIBES.club).shift))] || band;
// Locked layers (L.locked) are left alone by the Agent, section looks (score.js) and track scores (cues.js).
const layerLocked = li => !!(comp.layers[li] && comp.layers[li].locked);
const COL_TAGS = ['', 'Calm', 'Groove', 'Peak', 'Drop'];
const TAG_BAND = { Calm: 'calm', Groove: 'groove', Peak: 'peak', Drop: 'peak' };
const colTag = ci => (comp.agentTags && comp.agentTags[ci]) || '';
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- what it may play ----------
const playable = c => !!(c && !c.missing && !c.error);
// Your layers it may play, bottom first: unlocked, not bypassed, with at least one clip that can play.
const agentLayers = () => comp.layers.map((L, li) => li).filter(li => { const L = comp.layers[li]; return !L.locked && !L.bypass && L.clips.some(playable); });
// A tagged column that fits (Drop columns first on a drop), not the one shown now when there is a choice; -1 if none.
function taggedColumn(band, drop, avoid) {
  const lis = agentLayers(), has = ci => lis.some(li => playable(comp.layers[li].clips[ci]));
  const cols = [...Array(comp.columns).keys()].filter(ci => colTag(ci) && has(ci));
  let c = drop ? cols.filter(ci => colTag(ci) === 'Drop') : [];
  if (!c.length) c = cols.filter(ci => TAG_BAND[colTag(ci)] === band && (band !== 'peak' || colTag(ci) === 'Peak' || drop));
  if (!c.length && band === 'peak') c = cols.filter(ci => colTag(ci) === 'Drop');
  if (!c.length) return -1;
  const other = c.filter(ci => ci !== avoid);
  return pick(other.length ? other : c);
}
// A clip for layer li: from untagged columns or columns tagged for this band, not the one it plays now when possible.
function pickClip(li, band, avoid) {
  const cs = [];
  comp.layers[li].clips.forEach((c, ci) => { if (playable(c)) cs.push(ci); });
  const fit = cs.filter(ci => !colTag(ci) || TAG_BAND[colTag(ci)] === band);
  const pool = fit.length ? fit : cs, fresh = pool.filter(ci => ci !== avoid);
  return pick(fresh.length ? fresh : pool);
}
const layersFor = (band, n) => (band === 'calm' ? Math.max(1, Math.round(n * 0.34)) : band === 'groove' ? Math.max(1, Math.round(n * 0.67)) : n);
// A scene for this band. prev: the scene it follows (so the next one differs).
function makeScene(band, drop, prev) {
  const lis = agentLayers();
  if (!lis.length) return null;
  const sc = { band, drop: !!drop, col: -1, show: {} };
  const col = taggedColumn(band, drop, prev && prev.col);
  if (col >= 0) {
    for (const li of lis) if (playable(comp.layers[li].clips[col])) sc.show[li] = col;
    sc.col = col;
    return sc;
  }
  const [base, ...upper] = lis;
  for (const li of [base, ...shuffle(upper).slice(0, layersFor(band, lis.length) - 1)]) sc.show[li] = pickClip(li, band, prev && prev.show[li]);
  return sc;
}
// A variation: another column of the same kind, one layer on a different clip, or one layer swapped for another.
function varyScene(prev) {
  if (prev.col >= 0) { const c = taggedColumn(prev.band, prev.drop, prev.col); if (c >= 0 && c !== prev.col) return makeScene(prev.band, prev.drop, prev); }
  const lis = agentLayers(), sc = { band: prev.band, drop: false, col: -1, show: {} };
  for (const li of lis) if (prev.show[li] !== undefined && playable(comp.layers[li].clips[prev.show[li]])) sc.show[li] = prev.show[li];
  const shown = Object.keys(sc.show).map(Number), hidden = lis.filter(li => sc.show[li] === undefined);
  if (!shown.length) return makeScene(prev.band, false, prev);
  if (Math.random() < 0.35 && hidden.length && shown.length > 1) {   // a different upper layer joins instead of one that was up
    const out = pick(shown.filter(li => li !== lis[0])), inn = pick(hidden);
    delete sc.show[out]; sc.show[inn] = pickClip(inn, sc.band);
  } else { const li = pick(shown); sc.show[li] = pickClip(li, sc.band, sc.show[li]); }
  return sc;
}
// Drop entries that no longer exist (a layer locked or a clip removed since the scene was planned).
function validScene(sc) {
  if (!sc) return null;
  const lis = agentLayers(), out = { ...sc, show: {} };
  for (const k in sc.show) if (lis.includes(+k) && playable(comp.layers[+k].clips[sc.show[k]])) out.show[k] = sc.show[k];
  if (!Object.keys(out.show).length) return null;
  out.src = sc;   // the planned scene it came from (the playlist highlights it)
  return out;
}
const clipName = (li, ci) => { const c = comp.layers[li] && comp.layers[li].clips[ci]; return c ? c.name : '?'; };
function sceneLabel(sc) {
  if (!sc) return '';
  const names = Object.keys(sc.show).map(Number).sort((a, b) => a - b).map(li => clipName(li, sc.show[li]));
  return (sc.col >= 0 ? 'Column ' + (sc.col + 1) + ': ' : '') + names.join(' + ') + ' (' + sc.band + ')';
}

// ---------- showing a scene ----------
// The Agent's own triggers skip the clip quantise (it already times them) and are not mistaken for yours.
function agentTrigger(li, ci) {
  const was = quantFiring;
  quantFiring = true;
  try { trigger(li, ci); } finally { quantFiring = was; }
  agent.snap = userSnap();
}
// Fade layer L to `to` (0 or 1 of your level) over `beats` (0 = at once).
function fadeTo(L, to, beats) {
  baseOf(L);
  const v = agent.vis.get(L) || 0;
  if (Math.abs(v - to) < 1e-3 && !agent.fades.has(L)) return;
  agent.fades.set(L, { from: v, to, b0: comp.beats, len: beats });
}
function applyScene(sc, beats) {
  agentClockSync();
  for (const li of agentLayers()) {
    const L = comp.layers[li], ci = sc.show[li];
    baseOf(L);   // its level and whether it is up, taken before the Agent first changes it
    if (ci !== undefined) {
      if (L.active !== ci && L.pendingCol !== ci) agentTrigger(li, ci);
      fadeTo(L, 1, beats);
    } else fadeTo(L, 0, beats);
  }
  agent.scene = sc; agent.lookBeat = comp.beats; agent.empty = false;
  agent.history.push(sc); if (agent.history.length > 12) agent.history.shift();
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
// One decision. reason: song | drop | breakdown | section | band | vary | next
// A playlist song's planned scene for the section playing now (playlist.js) wins, except for variations and the
// New look button, which always bring something new.
function change(reason) {
  const drop = reason === 'drop', band = vibeBand(drop ? 'peak' : reason === 'breakdown' ? 'calm' : live.band);
  const beats = drop ? 0 : reason === 'song' ? 8 : reason === 'breakdown' ? 16 : 4;
  const planned = reason !== 'vary' && reason !== 'next' && typeof plannedScene === 'function' ? validScene(plannedScene()) : null;
  let sc = planned;
  if (!sc && reason === 'vary' && agent.scene && agent.scene.band === band) sc = varyScene(agent.scene);
  if (!sc) sc = makeScene(band, drop, agent.scene);
  if (!sc) { if (!agent.empty) { agent.empty = true; if (typeof agentUIDirty === 'function') agentUIDirty(); } return; }
  applyScene(sc, sc.drop && drop ? 0 : beats);
}
// An auto-mix has started (mix.js): bring in the incoming song's first planned scene, timed by the playlist's visual
// transition for this junction: 'mix' fades over the whole mix, 'quick' over a bar, 'cut' cuts.
function agentMixStart(m) {
  if (!agent.on) return;
  agentClockSync();
  if (agent.hold || agent.scored || comp.beats < agent.holdUntil) return;
  const sc = typeof plannedSceneAt === 'function' ? validScene(plannedSceneAt(m.inn, typeof inPoint === 'function' ? inPoint(m.inn) : m.inn.info.mixIn)) : null;
  if (!sc) return;
  const vis = (typeof plJunction === 'function' && plJunction(m.out).vis) || 'mix';
  agent.pending = null;
  applyScene(sc, vis === 'cut' ? 0 : vis === 'quick' ? 4 : Math.max(4, m.lenBeats || 8));
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
  agentClockSync();
  // A playlist song with planned scenes: every section change brings its own scene (a mix that just brought in the
  // new song's scene is left to finish first).
  if (d.source === 'deck' && typeof plannedScene === 'function' && (type === 'section' || type === 'breakdown') && plannedScene()) {
    if (comp.beats - agent.mixLookBeat > 32) agentSchedule('section');
    return;
  }
  if (type === 'song') { if (agent.onSong) agentSchedule('song'); }
  else if (type === 'drop') agentSchedule('drop');
  else if (type === 'breakdown') agentSchedule('breakdown');
  else if (type === 'section' && (d.section === 'intro' || d.section === 'outro') && comp.beats - agent.lookBeat >= 16) agentSchedule('breakdown');   // calm scenes for intros and outros
  else if (type === 'band') { if ((!agent.scene || agent.scene.band !== vibeBand(d.band)) && comp.beats - agent.lookBeat >= 32) agentSchedule('band'); }   // a scene stays 8 bars at least
});

// What clip each layer is showing (or about to): a change the Agent did not make is you playing live.
// Locked layers are yours to play without the Agent stepping aside, so they are not counted.
const layerClip = L => (L.pendingCol >= 0 ? L.pendingCol : L.active);
const userSnap = () => comp.layers.map(L => (L.locked ? 'L' : layerClip(L))).join(',');

// Your level for layer L: what its opacity was when the Agent took it over, or where you have moved its fader since.
function baseOf(L) {
  if (!agent.base.has(L)) { agent.base.set(L, L.opacity > 0.05 ? L.opacity : 1); agent.vis.set(L, L.active >= 0 || L.pendingCol >= 0 ? 1 : 0); }
  return agent.base.get(L);
}
// The level to save for layer L (engine.js compToJSON): yours, not where an Agent fade has it right now.
const agentLevel = L => (agent.base.has(L) ? agent.base.get(L) : L.opacity);
// Give layers back: your levels restored, nothing of the Agent's left on them.
function agentRelease(L) {
  if (agent.base.has(L)) { L.opacity = agent.base.get(L); if (typeof reflectMidi === 'function') reflectMidi('layer:' + comp.layers.indexOf(L) + ':opacity', L.opacity); }
  agent.base.delete(L); agent.vis.delete(L); agent.fades.delete(L); agent.written.delete(L);
}
const agentReleaseAll = () => [...agent.base.keys()].forEach(agentRelease);

// The beat count jumps when another deck takes over the clock (a song starts, a mix ends), on Resync or a seek: move
// every beat stamp with it, or the Agent would wait for the old count to come round again (or think a scene is old).
// Called first at every way in (frame tick, music events, mix start), so a jump is applied exactly once, before
// anything new is stamped in the new count.
function agentClockSync() {
  const b = comp.beats;
  if (agent.lastB !== undefined && (b < agent.lastB - 1 || b > agent.lastB + 16)) {
    const dj = b - agent.lastB;
    agent.lookBeat += dj; agent.mixLookBeat += dj;
    if (agent.holdUntil >= 0) agent.holdUntil += dj;
    if (agent.pending) agent.pending.at = 4 * Math.ceil((b + 0.05) / 4);
    for (const f of agent.fades.values()) f.b0 += dj;
  }
  agent.lastB = b;
}
function agentTick() {
  if (!agent.on) return;
  agentClockSync();
  const b = comp.beats;
  // DJ section looks (score.js) are switching the clips: the Agent hands the layers back and changes nothing
  if (typeof scoreActive === 'function' && scoreActive()) {
    if (!agent.scored) { agent.scored = true; agent.pending = null; agentReleaseAll(); }
    return;
  } else if (agent.scored) { agent.scored = false; agent.holdUntil = -1; agent.scene = null; agent.snap = userSnap(); }
  // you triggered a clip: the Agent waits 8 bars, and the layer you played is brought up so you see it
  const s = userSnap();
  if (s !== agent.snap) {
    const was = agent.snap.split(',');
    agent.snap = s;
    comp.layers.forEach((L, li) => { if (!L.locked && String(layerClip(L)) !== was[li] && layerClip(L) >= 0) { baseOf(L); fadeTo(L, 1, 1); } });
    agent.holdUntil = b + 32; agent.pending = null;
    if (typeof agentUIDirty === 'function') agentUIDirty();
  }
  if (!agent.scene && !agent.hold && b >= agent.holdUntil) change('song');   // first scene as soon as the Agent starts
  // Variations every agent.vary bars, counted on comp.beats itself: it always runs (music clock, MIDI clock, live beat or
  // just the tapped tempo), so the picture keeps moving with no music playing too. The change lands on the next bar.
  if (agent.vary && agent.scene && !agent.pending && !agent.hold && b >= agent.holdUntil && b - agent.lookBeat >= agent.vary * 4 - 0.5) agentSchedule('vary');
  if (agent.pending && b >= agent.pending.at - 0.02) { const r = agent.pending.reason; agent.pending = null; change(r); }
  // Build-up into a drop (analysed deck songs, score.js): the picture goes nearly black for the last two beats, so the
  // cut to the drop scene lands on the drop.
  const d = live.src === 'dj' ? audio.clockDeck : null;
  const ahead = d && typeof dropAhead === 'function' ? dropAhead(d) : null;
  let dim = 1;
  if (ahead !== null && ahead > 0 && ahead <= 0.5) { const q = 1 - ahead / 0.5; dim = 1 - 0.85 * q * q * (3 - 2 * q); }
  agent.build = d && typeof musicFeat !== 'undefined' ? musicFeat.build : 0; agent.dim = dim;
  // layer levels: fades (smoothstep, in beats) between 0 and your level
  comp.layers.forEach((L, li) => {
    if (L.locked) { if (agent.base.has(L)) agentRelease(L); return; }
    if (!agent.base.has(L) && !agent.fades.has(L)) return;   // a layer the Agent has not touched yet keeps its own level
    const base = baseOf(L), w = agent.written.get(L);
    if (w !== undefined && Math.abs(L.opacity - w) > 0.004) {   // you moved its fader: that is its level from now on
      agent.base.set(L, Math.max(0.05, L.opacity)); agent.vis.set(L, 1); agent.fades.delete(L); agent.written.set(L, L.opacity); return;
    }
    const f = agent.fades.get(L);
    let v = agent.vis.get(L) || 0;
    if (f) {
      let p = f.len > 0 ? Math.min(1, Math.max(0, (b - f.b0) / f.len)) : 1;
      p = p * p * (3 - 2 * p);
      v = f.from + (f.to - f.from) * p;
      if (p >= 1) { agent.fades.delete(L); if (f.to === 0 && (L.active >= 0 || L.pendingCol >= 0)) { eject(li); agent.snap = userSnap(); } }   // a layer faded out stops playing
      agent.vis.set(L, v);
    }
    const o = base * v * dim;
    if (Math.abs(o - L.opacity) > 1e-4) { L.opacity = o; if (typeof reflectMidi === 'function' && Math.abs(o - (agent.written.get(L) || 0)) > 0.01) reflectMidi('layer:' + li + ':opacity', o); }
    agent.written.set(L, L.opacity);
  });
}
function setAgent(on) {
  if (on === agent.on) return;
  agent.on = on;
  if (on) {
    audioCtx();
    agent.scene = null; agent.pending = null; agent.holdUntil = -1; agent.lastB = undefined; agent.scored = false; agent.empty = false;
    agent.snap = userSnap();
    setStatus(agentLayers().length ? 'Agent on: it plays your layers with the music' : 'Agent on, but there is nothing to play: add clips to your layers (or unlock them)');
  } else { agentReleaseAll(); setStatus('Agent off: your layers are back as you set them'); }
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
function agentNext() { if (!agent.on) return setAgent(true); agent.hold = false; agent.holdUntil = -1; agentSchedule('next'); }
function agentDrop() { if (!agent.on) return; agent.hold = false; agent.holdUntil = -1; change('drop'); }
function agentHold(v) { agent.hold = v === undefined ? !agent.hold : v; agent.pending = null; if (typeof agentUIDirty === 'function') agentUIDirty(); }
// Nothing to play yet: put starter clips in YOUR grid (generators, columns tagged by energy), so the Agent has a
// composition to work with and you can change any of it.
const STARTER = [['Calm', ['Gradient']], ['Calm', ['Plasma']], ['Groove', ['Tunnel', 'Lines']], ['Groove', ['Plasma', 'Checkerboard']],
  ['Peak', ['Tunnel', 'Lines', 'Beat Flash']], ['Peak', ['Noise', 'Audio Rings', 'Beat Flash']], ['Drop', ['Audio Rings', 'Lines', 'Beat Flash']]];
function agentStarter() {
  while (comp.layers.length < 3) addLayer();
  if (comp.columns < STARTER.length) setColumns(STARTER.length);
  const fresh = comp.layers.map(L => !L.clips.some(Boolean));
  comp.agentTags = comp.agentTags || {};
  STARTER.forEach(([tag, gens], ci) => {
    gens.forEach((g, li) => { if (comp.layers[li] && !comp.layers[li].clips[ci] && DEFS.gen.has(g)) comp.layers[li].clips[ci] = genClip(g); });
    if (!colTag(ci)) comp.agentTags[ci] = tag;
  });
  comp.layers.forEach((L, li) => { if (li > 0 && fresh[li] && L.blend === 0) L.blend = 1; });   // upper layers add onto the ones below
  ui.gridDirty = ui.propsDirty = true; agent.empty = false;
  if (typeof plDirty === 'function') plDirty();
  setStatus('Starter clips added to your layers, with their columns tagged Calm / Groove / Peak / Drop: change any of them');
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
// MIDI: agent:on | next | hold | drop | rec
function agentMidiTarget(what) {
  if (what === 'on') return { fire: () => (typeof startShow === 'function' ? startShow() : setAgent(!agent.on)) };   // the panel's Start / Stop
  if (what === 'next') return { fire: agentNext };
  if (what === 'hold') return { fire: () => agentHold() };
  if (what === 'drop') return { fire: agentDrop };
  if (what === 'rec') return { fire: () => { if (typeof recToggle === 'function') recToggle(); } };
  return null;
}
