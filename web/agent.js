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
  on: false, onSong: true, vary: 16, hold: false, vibe: 'club', strobe: 32,   // strobe: beats of flashes per drop (0 off, -1 the whole drop)
  scene: null, lookBeat: 0, recent: [], pending: null, holdUntil: -1, snap: '', mixLookBeat: -1e9, lastB: undefined,
  base: new Map(), vis: new Map(), fades: new Map(), written: new Map(),   // per layer object: your level, shown 0..1, fade, last opacity written
  dim: 1, build: 0, empty: false, scored: false,
  seenPlan: null, prerolled: null, fxGate: 0, gateB: undefined, dropBeat: -1e9, manualDrop: -1e9, wasDrop: false,
  fxBase: new Map(), fxWritten: new Map(),   // per flash effect (Strobe) in a chain: your mix, last mix written
};
// Vibes: one choice that sets everything a newcomer should not have to think about. shift moves every scene one energy
// band down (-1) or up (+1); mix / bars are the auto-mix's style and length (mix.js).
const AGENT_VIBES = {
  chill: { label: 'Chill', title: 'Fewer layers, slow changes; long smooth blends between songs', vary: 32, shift: -1, mix: 'blend', bars: 16 },
  club: { label: 'Club', title: 'Balanced: layers follow the energy of the music; bass-swap mixes', vary: 16, shift: 0, mix: 'bass', bars: 8 },
  festival: { label: 'Festival', title: 'High energy: more layers up, frequent changes; quicker mixes', vary: 8, shift: 1, mix: 'bass', bars: 4 },
};
try { const s = JSON.parse(localStorage.getItem(AGENT_KEY) || '{}'); for (const k of ['onSong', 'vary', 'vibe', 'strobe']) if (k in s) agent[k] = s[k]; } catch (e) {}
if (!AGENT_VIBES[agent.vibe]) agent.vibe = 'club';
function saveAgent() { try { localStorage.setItem(AGENT_KEY, JSON.stringify({ onSong: agent.onSong, vary: agent.vary, vibe: agent.vibe, strobe: agent.strobe })); } catch (e) {} }
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
// ---------- layer roles ----------
// What a layer is for, so scenes never pile everything up at once:
//   main    - the picture: videos, generators, 3D, camera. At most two are up together.
//   overlay - logos, text, still images. At most one, never during a drop.
//   fx      - flashes and strobes (Beat Flash clips). Only on drops, for the first FX_BEATS of each drop.
// Each layer's role can be set in the Agent panel (L.agentRole, saved with the composition). On Auto, a layer named
// "Logo" / "Text" / "Overlay" or "FX" / "Strobe" / "Flash" takes that role; otherwise it is worked out from its clips. Strobe effects in your layer and master effect chains are held off outside drops the same way.
const FX_GENS = new Set(['Beat Flash']);
const FLASH_FX = new Set(['Strobe']);
const FX_BEATS = 32;   // a Drop! button press opens the effects for this long when no drop is playing
// How long effects strobe on each drop (agent.strobe, beats); after it they fade out over a bar.
const STROBE_LENS = [[16, '4 bars'], [32, '8 bars'], [-1, 'Whole drop'], [0, 'Off']];
const AGENT_ROLES = [['', 'Auto'], ['main', 'Picture'], ['overlay', 'Logo / overlay'], ['fx', 'Effect (drops only)']];
const clipRole = c => (c.type === 'gen' && FX_GENS.has(c.gen) ? 'fx' : c.type === 'image' || c.type === 'text' ? 'overlay' : 'main');
function layerRole(li) {
  const L = comp.layers[li], n = (L.name || '').toLowerCase();
  if (L.agentRole === 'main' || L.agentRole === 'overlay' || L.agentRole === 'fx') return L.agentRole;
  if (/\b(fx|effects?|strobes?|flash(es)?)\b/.test(n)) return 'fx';
  if (/\b(logos?|text|titles?|overlays?|brand)\b/.test(n)) return 'overlay';
  const rs = new Set(L.clips.filter(playable).map(clipRole));
  return rs.size === 1 ? [...rs][0] : 'main';
}
const MAX_MAIN = 2;
// ---------- variety ----------
// Every clip the Agent puts up (and every clip a playlist plan uses) goes into a short memory; a clip in it is picked
// again far less often, so the picture works through all your clips instead of flipping between two.
const RECENT = 10;
const recentKey = (li, ci) => li + ':' + ci;
function remember(sc) {
  if (!sc) return;
  for (const li in sc.show) agent.recent.push(recentKey(+li, sc.show[li]));
  if (agent.recent.length > RECENT * 3) agent.recent.splice(0, agent.recent.length - RECENT * 3);
}
// 1 for a clip not up lately, down to ~0.15 for one just used (each use in the memory makes it rarer).
function freshness(li, ci) {
  const k = recentKey(li, ci), r = agent.recent;
  let w = 1;
  for (let i = r.length - 1, age = 0; i >= 0 && age < RECENT; i--, age++) if (r[i] === k) w *= 0.15 + 0.6 * (age / RECENT);
  return Math.max(0.03, w);
}
// How well a column suits this part: a column tagged for this band (or Drop on a drop) fits best, untagged columns
// fit anything, the neighbouring band now and then, the opposite band (calm vs peak) rarely.
function bandFit(ci, band, drop) {
  const t = colTag(ci);
  if (!t) return 2;
  if (t === 'Drop') return drop ? 4 : band === 'peak' ? 1.2 : 0.1;
  const tb = TAG_BAND[t];
  if (tb === band) return 3;
  return Math.abs(BANDS.indexOf(tb) - BANDS.indexOf(band)) === 1 ? 0.6 : 0.1;
}
function weighted(items, w) {
  let sum = 0;
  const ws = items.map(x => { const v = Math.max(0, w(x)); sum += v; return v; });
  if (sum <= 0) return pick(items);
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
const clipsFor = (li, drop) => { const cs = []; comp.layers[li].clips.forEach((c, ci) => { if (playable(c) && (drop || clipRole(c) !== 'fx')) cs.push(ci); }); return cs; };
// How much layer li has to offer this part: its best clip's fit x freshness (picks which picture layers go up).
const layerAppeal = (li, band, drop) => Math.max(0, ...clipsFor(li, drop).map(ci => bandFit(ci, band, drop) * freshness(li, ci)));
// A clip for layer li: weighted by how well its column suits the part and how long since it was last up; never the
// one it plays now when there is another. Picture layers skip flash clips unless it is a drop.
function pickClipFor(li, band, avoid, drop) {
  const cs = clipsFor(li, drop);
  if (!cs.length) return undefined;
  const pool = cs.length > 1 ? cs.filter(ci => ci !== avoid) : cs;
  // a clip tagged for the opposite part (a Drop clip in a calm part) only when nothing else on the layer fits
  const ok = pool.filter(ci => bandFit(ci, band, drop) > 0.1);
  if (!ok.length && cs.includes(avoid) && bandFit(avoid, band, drop) > 0.1) return avoid;
  return weighted(ok.length ? ok : pool, ci => bandFit(ci, band, drop) * freshness(li, ci));
}
// A scene for this band. prev: the scene it follows (so the next one differs). opts.logo: bring an overlay in (a new
// song); otherwise calm scenes show one, and a third of the others.
function makeScene(band, drop, prev, opts) {
  const lis = agentLayers();
  if (!lis.length) return null;
  const sc = { band, drop: !!drop, col: -1, show: {} };
  // A tagged column is a finished look, played whole about a third of the time (half the time on a drop); otherwise
  // the scene is put together clip by clip, guided by the tags.
  const col = Math.random() < (drop ? 0.5 : 0.33) ? taggedColumn(band, drop, prev && prev.col) : -1;
  if (col >= 0) {
    for (const li of lis) if (playable(comp.layers[li].clips[col])) sc.show[li] = col;
    sc.col = col;
    return sc;
  }
  const role = {}; for (const li of lis) role[li] = layerRole(li);
  let mains = lis.filter(li => role[li] === 'main');
  const overs = lis.filter(li => role[li] === 'overlay'), fxs = lis.filter(li => role[li] === 'fx');
  if (!mains.length) mains = overs.length ? [overs.shift()] : [];
  const nMain = band === 'calm' ? 1 : band === 'groove' ? (Math.random() < 0.5 ? 2 : 1) : MAX_MAIN;
  const put = li => { const ci = pickClipFor(li, band, prev && prev.show[li], drop); if (ci !== undefined) sc.show[li] = ci; };
  // which picture layers go up: weighted by what each has to offer now, so one layer is not up in every scene
  const up = [];
  for (let left = mains.slice(); up.length < nMain && left.length;) { const li = weighted(left, l => layerAppeal(l, band, drop) + 0.05); up.push(li); left = left.filter(l => l !== li); }
  up.sort((a, b) => a - b).forEach(put);
  if (drop) { if (fxs.length) put(pick(fxs)); }
  else if (overs.length && ((opts && opts.logo) || band === 'calm' || Math.random() < 0.33)) put(pick(overs));
  if (!Object.keys(sc.show).length) { if (fxs.length && drop) put(fxs[0]); else return null; }
  return sc;
}
const pickClip = (li, band, avoid) => pickClipFor(li, band, avoid, false);
// A variation: another column of the same kind, one picture layer on a different clip or swapped for another, or the
// overlay in or out.
function varyScene(prev) {
  if (prev.col >= 0) return makeScene(prev.band, prev.drop, prev);   // after a finished look the next scene is built afresh
  const lis = agentLayers(), sc = { band: prev.band, drop: !!prev.drop, col: -1, show: {} };
  for (const li of lis) if (prev.show[li] !== undefined && playable(comp.layers[li].clips[prev.show[li]])) sc.show[li] = prev.show[li];
  const role = {}; for (const li of lis) role[li] = layerRole(li);
  const shown = Object.keys(sc.show).map(Number), mainsUp = shown.filter(li => role[li] === 'main');
  if (!mainsUp.length) return makeScene(prev.band, prev.drop, prev);
  const mainsDown = lis.filter(li => role[li] === 'main' && sc.show[li] === undefined), overs = lis.filter(li => role[li] === 'overlay');
  const r = Math.random();
  if (r < 0.25 && !sc.drop && overs.length) {   // the overlay comes in or goes out
    const up = shown.filter(li => role[li] === 'overlay');
    if (up.length) up.forEach(li => delete sc.show[li]);
    else { const li = pick(overs), ci = pickClip(li, sc.band); if (ci !== undefined) sc.show[li] = ci; }
  } else if (r < 0.55 && mainsDown.length && mainsUp.length > 1) {   // a different upper picture layer instead
    const out = pick(mainsUp.filter(li => li !== lis[0])), inn = pick(mainsDown), ci = pickClipFor(inn, sc.band, undefined, sc.drop);
    if (ci !== undefined) { delete sc.show[out]; sc.show[inn] = ci; }
  } else { const li = pick(mainsUp), ci = pickClipFor(li, sc.band, sc.show[li], sc.drop); if (ci !== undefined) sc.show[li] = ci; }
  return sc;
}
// The limits every scene is shown with (planned, tagged and older ones too): no flashes outside a drop, no overlay on
// top of a drop's flashes, at most MAX_MAIN picture layers outside tagged columns.
function tame(sc) {
  const out = { ...sc, show: {}, src: sc.src || sc };
  const ks = Object.keys(sc.show).map(Number).sort((a, b) => a - b);
  const role = {}; for (const li of ks) role[li] = layerRole(li);
  const flash = li => role[li] === 'fx' || clipRole(comp.layers[li].clips[sc.show[li]]) === 'fx';
  const hasFx = sc.drop && ks.some(flash);
  let mains = 0;
  for (const li of ks) {
    if (flash(li)) { if (sc.drop) out.show[li] = sc.show[li]; continue; }
    if (role[li] === 'overlay') { if (!hasFx) out.show[li] = sc.show[li]; continue; }
    if (sc.col < 0 && ++mains > MAX_MAIN) continue;
    out.show[li] = sc.show[li];
  }
  return Object.keys(out.show).length ? out : sc;
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
  sc = tame(sc);
  for (const li of agentLayers()) {
    const L = comp.layers[li], ci = sc.show[li];
    baseOf(L);   // its level and whether it is up, taken before the Agent first changes it
    if (ci !== undefined) {
      if (L.active !== ci && L.pendingCol !== ci) agentTrigger(li, ci);
      fadeTo(L, 1, beats);
    } else fadeTo(L, 0, beats);
  }
  agent.scene = sc; agent.lookBeat = comp.beats; agent.empty = false;
  remember(sc);
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
// One decision. reason: song | drop | breakdown | section | band | vary | next
// A playlist song's planned scene for the section playing now (playlist.js) wins, except for variations and the
// New look button, which always bring something new.
// Fade lengths in beats. Changes land on the downbeat they belong to and finish within a bar, so the picture turns
// with the music rather than after it (the new clip starts at once; the fade only blends the levels).
const FADE = { drop: 0, section: 2, next: 2, song: 4, breakdown: 4, band: 4, vary: 4 };
function change(reason) {
  const drop = reason === 'drop', inDrop = drop || agentInDrop();
  const band = vibeBand(inDrop ? 'peak' : reason === 'breakdown' ? 'calm' : live.band);
  const beats = FADE[reason] !== undefined ? FADE[reason] : 4;
  const now = typeof plannedScene === 'function' ? plannedScene() : null;
  const planned = reason !== 'vary' && reason !== 'next' ? validScene(now) : null;
  let sc = planned;
  if (!sc && reason === 'vary' && agent.scene && agent.scene.band === band) sc = varyScene({ ...agent.scene, drop: inDrop });
  if (!sc) sc = makeScene(band, inDrop, agent.scene, { logo: reason === 'song' });
  agent.seenPlan = now;   // the planned part this decision answers (variations included): the next part brings a change
  if (!sc) { if (!agent.empty) { agent.empty = true; if (typeof agentUIDirty === 'function') agentUIDirty(); } return; }
  if (drop) agent.dropBeat = comp.beats;
  applyScene(sc, sc.drop && drop ? 0 : beats);
}
// In a drop now: the analysed section of the playing song, else the live listener's last drop (score.js).
function agentInDrop() {
  const d = live.src === 'dj' ? audio.clockDeck : null;
  if (d && typeof sectionNow === 'function' && sectionNow(d)) return dropAhead(d) === 0;
  return typeof score !== 'undefined' && !!score.liveDrop;
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
  agent.seenPlan = sc.src;   // the incoming song's first part: when the mix ends, its next part follows on time
}
// Changes land on a downbeat (drops at once). A call in the first half beat of a bar belongs to that bar's downbeat and
// goes now: section changes arrive just after the downbeat they start on, and used to wait a whole bar for the next.
function agentSchedule(reason) {   // (not 'schedule': ui.js owns that name)
  if (agent.hold || comp.beats < agent.holdUntil) return;
  if (reason === 'drop') { agent.pending = null; change('drop'); return; }
  const at = 4 * Math.ceil((comp.beats - 0.5) / 4);
  const rank = { song: 4, breakdown: 3, section: 3, band: 2, vary: 1, next: 5 };
  if (agent.pending && rank[agent.pending.reason] >= rank[reason]) return;
  agent.pending = { at, reason };
}
onMusic((type, d) => {
  if (!agent.on) return;
  agentClockSync();
  // A playlist song with planned scenes: every section change brings its own scene. During an auto-mix the sections
  // are the outgoing song's: the incoming one's scene is already up, and agentTick catches its next part when the mix ends.
  if (d.source === 'deck' && typeof plannedScene === 'function' && (type === 'section' || type === 'breakdown') && plannedScene()) {
    if (!(typeof mixer !== 'undefined' && mixer.m)) agentSchedule('section');
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
// Flash effects (Strobe) in a chain follow the drop gate: your mix during a drop's first bars, off otherwise.
function gateFlashFx(chain) {
  for (const e of chain) {
    if (!FLASH_FX.has(e.def)) continue;
    const w = agent.fxWritten.get(e);
    if (!agent.fxBase.has(e) || (w !== undefined && Math.abs(e.mix - w) > 0.004)) agent.fxBase.set(e, e.mix);   // you set its mix
    e.mix = agent.fxBase.get(e) * agent.fxGate;
    agent.fxWritten.set(e, e.mix);
  }
}
function releaseFlashFx(chain) { for (const e of chain) if (agent.fxBase.has(e)) { e.mix = agent.fxBase.get(e); agent.fxBase.delete(e); agent.fxWritten.delete(e); } }
// The mix to save for effect e (engine.js compToJSON): yours, not the gate's.
const agentFxMix = e => (agent.fxBase.has(e) ? agent.fxBase.get(e) : e.mix);
const agentReleaseAll = () => { [...agent.base.keys()].forEach(agentRelease); releaseFlashFx(comp.fx); comp.layers.forEach(L => releaseFlashFx(L.fx)); };
// Just before a planned section starts, rewind the paused videos it will play, so they show on the downbeat instead of
// a seek later (engine.js trigger skips the seek for a video already at its in point).
function prerollNext() {
  const d = live.src === 'dj' ? audio.clockDeck : null;
  if (!d || !d.playing || !d.info || typeof sectionAhead !== 'function' || typeof plannedSceneAt !== 'function') return;
  const a = sectionAhead(d);
  if (!a || a.bars > 0.5 || a.bars <= 0) return;
  const sc = plannedSceneAt(d, deckHeard(d) + a.bars * d.info.barLen + 0.06);
  if (!sc || sc === agent.prerolled) return;
  agent.prerolled = sc;
  for (const li in sc.show) {
    const L = comp.layers[+li], c = L && L.clips[sc.show[li]];
    if (!c || !c.video || L.active === sc.show[li] || !c.video.paused) continue;
    const start = typeof clipStart === 'function' ? clipStart(c) : 0;   // the clip's in point (clipopts.js), where trigger() starts it
    if (Math.abs(c.video.currentTime - start) > 0.05) { try { c.video.currentTime = start; } catch (e) {} }
  }
}

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
    // a clip the Agent started that could not play (a video that failed to load falls back to the clip before it) is
    // not you playing: no 8-bar wait for that
    const failed = (L, li) => { const c = L.clips[+was[li]]; return !!(c && (c.error || c.missing)); };
    const yours = comp.layers.map((L, li) => li).filter(li => { const L = comp.layers[li]; return !L.locked && String(layerClip(L)) !== was[li] && !failed(L, li); });
    if (yours.length) {
      yours.forEach(li => { const L = comp.layers[li]; if (layerClip(L) >= 0) { baseOf(L); fadeTo(L, 1, 1); } });
      agent.holdUntil = b + 32; agent.pending = null;
      if (typeof agentUIDirty === 'function') agentUIDirty();
    }
  }
  if (!agent.scene && !agent.hold && b >= agent.holdUntil) change('song');   // first scene as soon as the Agent starts
  // Variations every agent.vary bars, counted on comp.beats itself: it always runs (music clock, MIDI clock, live beat or
  // just the tapped tempo), so the picture keeps moving with no music playing too. The change lands on the next bar.
  if (agent.vary && agent.scene && !agent.pending && !agent.hold && b >= agent.holdUntil && b - agent.lookBeat >= agent.vary * 4 - 0.5) agentSchedule('vary');
  // The playing song has moved into another planned part without a section event reaching the Agent (it was mixing,
  // holding for you, or the part began during a mix): catch up on the next downbeat instead of a whole section late.
  if (agent.scene && !agent.pending && !agent.hold && b >= agent.holdUntil && !(typeof mixer !== 'undefined' && mixer.m) && typeof plannedScene === 'function') {
    const p = plannedScene();
    if (p && p !== agent.seenPlan) agentSchedule('section');
  }
  if (agent.pending && b >= agent.pending.at - 0.02) { const r = agent.pending.reason; agent.pending = null; change(r); }
  prerollNext();
  // Effects gate: 1 from the moment a drop lands, for FX_BEATS, then down over a bar; 0 otherwise.
  const inDrop = agentInDrop() || b - agent.manualDrop < FX_BEATS;
  if (inDrop && !agent.wasDrop && b - agent.dropBeat > 1) agent.dropBeat = b;   // a drop that came without a 'drop' change
  agent.wasDrop = inDrop;
  const len = agent.strobe < 0 ? Infinity : agent.strobe;
  const gt = inDrop && b - agent.dropBeat < len ? 1 : 0, step = Math.max(0, b - (agent.gateB === undefined ? b : agent.gateB));
  agent.gateB = b;
  agent.fxGate = gt >= agent.fxGate ? gt : Math.max(0, agent.fxGate - step / 4);
  gateFlashFx(comp.fx);
  // Build-up into a drop (analysed deck songs, score.js): the picture goes nearly black for the last two beats, so the
  // cut to the drop scene lands on the drop.
  const d = live.src === 'dj' ? audio.clockDeck : null;
  const ahead = d && typeof dropAhead === 'function' ? dropAhead(d) : null;
  let dim = 1;
  if (ahead !== null && ahead > 0 && ahead <= 0.5) { const q = 1 - ahead / 0.5; dim = 1 - 0.85 * q * q * (3 - 2 * q); }
  agent.build = d && typeof musicFeat !== 'undefined' ? musicFeat.build : 0; agent.dim = dim;
  // layer levels: fades (smoothstep, in beats) between 0 and your level
  comp.layers.forEach((L, li) => {
    if (L.locked) { if (agent.base.has(L)) agentRelease(L); releaseFlashFx(L.fx); return; }
    gateFlashFx(L.fx);
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
    const flash = L.active >= 0 && L.clips[L.active] && (layerRole(li) === 'fx' || clipRole(L.clips[L.active]) === 'fx');
    const o = base * v * dim * (flash ? agent.fxGate : 1);
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
    agent.seenPlan = null; agent.prerolled = null; agent.fxGate = 0; agent.gateB = undefined; agent.dropBeat = agent.manualDrop = -1e9; agent.wasDrop = false;
    agent.snap = userSnap();
    setStatus(agentLayers().length ? 'Agent on: it plays your layers with the music' : 'Agent on, but there is nothing to play: add clips to your layers (or unlock them)');
  } else { agentReleaseAll(); setStatus('Agent off: your layers are back as you set them'); }
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
function agentNext() { if (!agent.on) return setAgent(true); agent.hold = false; agent.holdUntil = -1; agentSchedule('next'); }
function agentDrop() { if (!agent.on) return; agent.hold = false; agent.holdUntil = -1; agent.manualDrop = comp.beats; change('drop'); }
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
