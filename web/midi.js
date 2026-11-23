// Strodano VJ (web) - controllers: MIDI with learn mode (Web MIDI, Chrome / Edge), device profiles, LED feedback. GPL-3.0.
// Mappable controls carry data-midi="<target id>". Target ids are strings, so mappings survive the UI being rebuilt:
//   master, crossfade, tap, resync, column:C, clip:L:C, layer:L:opacity | bypass | solo | eject   (L, C count from 0)
//   layer:L:<k> and clip:L:C:<k> with k = nudge+ | nudge- (held) | nudge (bipolar knob / stick) | speed+ | speed- | speed1 (clipopts.js)
//   deck:D:play | cue | sync | volume | tempo   (D is A or B)
//   fx:<effect uid>:<param index> | mix | bypass,  gen:<generator clip uid>:<param index>   (uids are saved with the composition)
// Inputs are keyed "<dev>|<type>:<ch>:<n>": dev is a profile id (a known controller), "midi:<port name>" (any other MIDI
// device) or "*" (any device: hand gestures, and mappings made before devices were told apart). An input is looked up as
// its own device's mapping, then the device profile's default, then the "*" mapping. Several inputs may drive one target.
// Kinds (per input): knob / fader (absolute, with pickup), encoder (relative, two's complement), pad.
// Mappings are app-wide (localStorage CTL_KEY), not part of a composition; Export / Import in the Controllers panel.
// Controller tech spec: ../../controller-mapping-spec.md
'use strict';
const MIDI_KEY = 'strodano-vj-midi';          // before 2026-11-20: { "cc:0:7": id }. Read once to migrate, never written, so an older app keeps its map
const CTL_KEY = 'strodano-vj-controllers';    // { format: 1, map, kinds, pickup, profiles }
const CTL_KINDS = { knob: 'Knob', fader: 'Fader', encoder: 'Encoder', pad: 'Pad', stick: 'Stick' };   // encoder = relative (endless) knob
const PICK_TOL = 0.03;                        // pickup: a control takes over within 3 % of the value, or when it crosses it
const ENC_STEP = 1 / 100;                     // an encoder detent moves a value 1 %
// How a relative encoder says up / down: twos = 1..63 up, 127..65 down (most); sign = 1..63 up, 65..127 down;
// offset = 65.. up, 63.. down (64 = no move)
const ENC_STYLES = ['twos', 'sign', 'offset'];
const encDelta = (r, style) => (style === 'offset' ? r - 64 : r === 0 || r === 64 ? 0 : r < 64 ? r : style === 'sign' ? -(r - 64) : r - 128);
// map: full key -> target id ('' = switched off: hides a profile's default). devs: dev id -> { kind, name, profile, input, output }
// capture: { dev, fn(type, ch, n, val, raw) } while the setup wizard (ctlwizard.js) listens to a device: its input drives nothing
const midi = { capture: null, pick: null, access: null, sysex: false, map: {}, kinds: {}, stick: {}, mt: {}, dead: {}, ledHold: {}, pickup: true, userProfiles: [], learn: false, target: null, devs: {}, shiftHeld: {} };
const CONTROLLER_PROFILES = [];               // built-in profiles (registerProfile); user profiles live in midi.userProfiles
function registerProfile(p) { if (validProfile(p)) CONTROLLER_PROFILES.push(p); }
const allProfiles = () => CONTROLLER_PROFILES.concat(midi.userProfiles);
const ctlFull = k => (k.includes('|') ? k : '*|' + k);
const KEY_RE = /^[^|]{1,80}\|(cc|note|gest|btn|axis):[^:|]{1,40}:[^:|]{1,60}$/;

// A profile: { id, name, match: { midiPort: regex source }, init: [[sysex bytes]], controls: [{ key, kind, label, led }],
// defaults: { key: target id }, leds(dev): [[key, 0..127]] (built-in only) }. Keys inside a profile have no device part.
function validProfile(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[\w:.-]{1,60}$/.test(p.id) || typeof p.name !== 'string') return false;
  if (!p.match || (typeof p.match.midiPort !== 'string' && p.match.gamepad !== true)) return false;
  if (p.match.midiPort !== undefined) { try { new RegExp(p.match.midiPort, 'i'); } catch (e) { return false; } }
  if (p.init && !(Array.isArray(p.init) && p.init.every(m => Array.isArray(m) && m.length && m.every(b => Number.isInteger(b) && b >= 0 && b < 256)))) return false;
  if (p.controls && !(Array.isArray(p.controls) && p.controls.every(c => c && typeof c.key === 'string' && (!c.kind || CTL_KINDS[c.kind]) && (!c.enc || ENC_STYLES.includes(c.enc))))) return false;
  if (p.grid && !(Number.isInteger(p.grid.w) && Number.isInteger(p.grid.h) && p.grid.w > 0 && p.grid.h > 0 && p.grid.w <= 16 && p.grid.h <= 16)) return false;
  if (p.defaults && (typeof p.defaults !== 'object' || Object.values(p.defaults).some(v => typeof v !== 'string'))) return false;
  return true;
}
// Takes saved or imported settings. replace: start from nothing (load); else merge, the incoming entries win (import).
// Returns how many mappings came in, or -1 when it is not a controllers file.
function ctlApply(s, replace) {
  if (!s || typeof s !== 'object' || s.format !== 1 || typeof s.map !== 'object') return -1;
  if (replace) {
    midi.map = {}; midi.kinds = {}; midi.stick = {}; midi.userProfiles = []; midi.mt = {}; midi.dead = {};
    for (const [src, dst] of [[s.mt, midi.mt], [s.dead, midi.dead]]) if (src && typeof src === 'object') for (const k in src) if (/^[mksp]:/.test(k) && k.length < 260 && Number.isFinite(src[k])) dst[k] = src[k];
  }
  let n = 0;
  for (const k in s.map) if (KEY_RE.test(k) && typeof s.map[k] === 'string') { midi.map[k] = s.map[k]; n++; }
  if (s.kinds) for (const k in s.kinds) if (KEY_RE.test(k) && CTL_KINDS[s.kinds[k]]) midi.kinds[k] = s.kinds[k];
  if (s.stick) for (const k in s.stick) if (KEY_RE.test(k) && (s.stick[k] === 'nudge' || s.stick[k] === 'spring')) midi.stick[k] = s.stick[k];
  if (typeof s.pickup === 'boolean') midi.pickup = s.pickup;
  if (Array.isArray(s.profiles)) for (const p of s.profiles) if (validProfile(p) && !p.leds) {
    midi.userProfiles = midi.userProfiles.filter(x => x.id !== p.id).concat([p]);
  }
  return n;
}
const ctlExport = () => ({ format: 1, app: 'strodano-vj-controllers', map: midi.map, kinds: midi.kinds, stick: midi.stick, pickup: midi.pickup, profiles: midi.userProfiles, mt: midi.mt, dead: midi.dead });
// ---------- change times: when two computers changed the settings, each entry keeps the side that touched it last ----------
// Every mapping, control kind, stick mode and user profile has the time it was last set (midi.mt) or removed (midi.dead,
// kept 90 days so a removal also reaches computers that were offline). They are worked out by comparing with the state as
// last saved (ctlStamp, from saveMidiMap), so no code that changes a mapping has to report what it did. Flat entry keys:
// 'm:' mapping, 'k:' kind, 's:' stick mode (each followed by the input key), 'p:' user profile id.
const CTL_DEAD_DAYS = 90;
let ctlSnap = null;   // flat entry -> JSON text, as last saved
function ctlFlat(s) {
  const f = {};
  for (const k in s.map || {}) f['m:' + k] = s.map[k];
  for (const k in s.kinds || {}) f['k:' + k] = s.kinds[k];
  for (const k in s.stick || {}) f['s:' + k] = s.stick[k];
  for (const p of s.profiles || []) if (p && p.id) f['p:' + p.id] = p;
  return f;
}
function ctlSnapText() { const f = ctlFlat(ctlExport()), t = {}; for (const k in f) t[k] = JSON.stringify(f[k]); return t; }
function ctlStamp() {
  const now = Date.now(), cur = ctlSnapText();
  if (ctlSnap) {
    for (const k in cur) if (ctlSnap[k] !== cur[k]) { midi.mt[k] = now; delete midi.dead[k]; }
    for (const k in ctlSnap) if (!(k in cur)) { midi.dead[k] = now; delete midi.mt[k]; }
  }
  for (const k in midi.dead) if (now - midi.dead[k] > CTL_DEAD_DAYS * 864e5) delete midi.dead[k];
  ctlSnap = cur;
}
// Two copies (this computer's and the account's) merged entry by entry: the later change wins; a tie keeps this computer's.
// A copy that lacks an entry and has no removal record for it never had it, so the other side's value stays.
function ctlMerge(mine, theirs) {
  const L = ctlFlat(mine), R = ctlFlat(theirs), Lmt = mine.mt || {}, Ldead = mine.dead || {}, Rmt = theirs.mt || {}, Rdead = theirs.dead || {};
  const out = { format: 1, app: 'strodano-vj-controllers', map: {}, kinds: {}, stick: {}, profiles: [], pickup: mine.pickup, mt: {}, dead: {} };
  const keys = new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(Ldead), ...Object.keys(Rdead)]);
  for (const k of keys) {
    const tl = Lmt[k] || Ldead[k] || 0, tr = Rmt[k] || Rdead[k] || 0;
    let side = tr > tl ? 'r' : 'l';
    const has = x => (x === 'l' ? k in L : k in R), gone = x => (x === 'l' ? k in Ldead : k in Rdead);
    if (!has(side) && !gone(side)) side = side === 'l' ? 'r' : 'l';   // that side never had it
    if (gone(side) && !has(side)) { out.dead[k] = side === 'l' ? Ldead[k] : Rdead[k]; continue; }
    const v = side === 'l' ? L[k] : R[k], t = side === 'l' ? Lmt[k] : Rmt[k];
    if (t) out.mt[k] = t;
    const i = k.indexOf(':'), kind = k.slice(0, i), key = k.slice(i + 1);
    if (kind === 'm') out.map[key] = v; else if (kind === 'k') out.kinds[key] = v; else if (kind === 's') out.stick[key] = v; else if (kind === 'p') out.profiles.push(v);
  }
  return out;
}
function saveMidiMap(fromCloud) {
  if (fromCloud) ctlSnap = ctlSnapText(); else ctlStamp();   // what came from the account is not a change made here
  try { localStorage.setItem(CTL_KEY, JSON.stringify(ctlExport())); } catch (e) {}
  if (!fromCloud) ctlSyncChanged();
}
(function loadCtl() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(CTL_KEY) || 'null'); } catch (e) {}
  if (ctlApply(s, true) < 0) {
    try { const old = JSON.parse(localStorage.getItem(MIDI_KEY) || '{}') || {}; for (const k in old) if (typeof old[k] === 'string' && KEY_RE.test(ctlFull(k))) midi.map[ctlFull(k)] = old[k]; } catch (e) {}
  }
  ctlSnap = ctlSnapText();   // changes are counted from here
})();

function findFx(uid) {
  for (const [owner, chain] of [['Composition', comp.fx], ...comp.layers.map(L => [L.name, L.fx]), ...(typeof clipChains === 'function' ? clipChains() : [])]) {   // clip effects: clipopts.js
    const e = chain.find(x => x.uid === uid);
    if (e) return { e, owner };
  }
  return null;
}
function findGenClip(uid) {
  for (const L of comp.layers) for (const c of L.clips) if (c && c.params && c.uid === uid) return { c, owner: L.name };   // generator, text and 3D clips
  return null;
}
// What a target id does right now: {set(v), get()} for faders, {fire()} for buttons, {hold(down, src)} for momentary controls
// that act while held (press and release both count). A bipolar target also has bend(a) with a in -1..1 (sticks; set(v) reads
// 0.5 as centre). get() (optional) returns the value now, or null when unknown; pickup and encoders use it.
// null if it points at nothing (layer removed...). step(delta) (optional): an encoder detent moves it (BPM).
// Virtual targets resolve to a real one when the input arrives (rid = the real id, for on-screen sliders and score recording):
//   grid:X:Y  the clip at the controller's window (ctlWin) offset, X = track (layer), Y = row (column)
//   track:X:<k>  layer:(window layer + X):<k>     scene:Y  column (window column + Y)     selected:<k>  layer:<selected>:<k>
//   win:up|down|left|right  move the window     focus:0..7 | prev | next | page- | page+ | bypass  (what the properties panel shows)
//   stopall, bpm (encoder), layer:L:select, sel:layer+|layer-|col-|col+|trigger|column (move / use the selection, for gamepads)
function midiTarget(id) {
  const [a, b, c, d] = id.split(':'), L = comp.layers[+b];
  const via = rid => { const t = midiTarget(rid); if (t && !t.rid) t.rid = rid; return t; };
  if (a === 'grid') { ctlWinClamp(); return via('clip:' + (ctlWin.l + +b) + ':' + (ctlWin.c + +c)); }
  if (a === 'track') { ctlWinClamp(); return via('layer:' + (ctlWin.l + +b) + ':' + c); }
  if (a === 'scene') { ctlWinClamp(); return via('column:' + (ctlWin.c + +b)); }
  if (a === 'selected') return via('layer:' + sel.l + ':' + b);
  if (a === 'sel') return selTarget(b);
  if (a === 'win') return { fire: () => ctlWinMove(b) };
  if (a === 'focus') return focusTarget(b);
  if (a === 'stopall') return { fire: () => comp.layers.forEach((_, i) => eject(i)) };
  if (a === 'fullscreen') return typeof appFullscreen === 'function' ? { fire: () => appFullscreen() } : null;
  if (a === 'bpm') return { step: n => { comp.bpm = Math.min(300, Math.max(20, Math.round((comp.bpm + n * 0.1) * 10) / 10)); if (typeof syncTransport === 'function') syncTransport(); } };
  if (a === 'fx') {
    const f = findFx(b);
    if (!f) return null;
    if (c === 'mix') return { set: v => { f.e.mix = v; }, get: () => f.e.mix ?? null };
    if (c === 'bypass') return { fire: () => { f.e.bypass = !f.e.bypass; ui.propsDirty = true; } };
    return { set: v => { f.e.params[+c] = v; }, get: () => f.e.params[+c] ?? null };
  }
  if (a === 'gen') {
    const g = findGenClip(b);
    return g ? { set: v => { if (c === 'trail') g.c.trail = v; else g.c.params[+c] = v; }, get: () => (c === 'trail' ? g.c.trail : g.c.params[+c]) ?? null } : null;   // 'trail': a 3D clip's Trails
  }
  if (a === 'master') return { set: v => { comp.master = v; }, get: () => comp.master };
  if (a === 'crossfade') return { set: v => { comp.crossfade = v; }, get: () => comp.crossfade };
  if (a === 'tap' || a === 'resync') return { fire: () => {   // the phone page has no #tap / #resync: its BPM button taps
    const b = $(a) || (a === 'tap' ? $('bpmBtn') : null);
    if (b) b.click(); else if (a === 'resync') comp.beats = 0;
  } };
  if (a === 'column') return +b < comp.columns ? { fire: () => triggerColumn(+b) } : null;
  if (a === 'clip' && d) return L && +c < comp.columns && typeof nudgeTarget === 'function' ? nudgeTarget(+b, +c, d) : null;   // clipopts.js
  if (a === 'clip') return L && +c < comp.columns ? { fire: () => trigger(+b, +c) } : null;
  if (a === 'deck') return djMidiTarget(b, c);
  if (a === 'blackout') return { fire: () => setBlackout() };   // safety.js
  if (a === 'snap') return +b < SNAP_COUNT ? { fire: () => snapRecall(+b) } : null;   // snapshots.js
  if (a === 'agent') return typeof agentMidiTarget === 'function' ? agentMidiTarget(b) : null;
  if (a !== 'layer' || !L) return null;
  if (c === 'opacity') return { set: v => { L.opacity = v; }, get: () => L.opacity };
  if (c === 'bypass') return { fire: () => { L.bypass = !L.bypass; ui.gridDirty = true; } };
  if (c === 'solo') return { fire: () => { L.solo = !L.solo; ui.gridDirty = true; } };
  if (c === 'eject') return { fire: () => eject(+b) };
  if (c === 'select') return { fire: () => { sel.l = +b; sel.c = -1; propTab = 'layer'; ui.gridDirty = ui.propsDirty = true; } };
  if (typeof NUDGE_KINDS !== 'undefined' && NUDGE_KINDS[c]) return nudgeTarget(+b, -1, c);
  return null;
}
function midiLabel(id) {
  const [a, b, c, d] = id.split(':'), ln = i => (comp.layers[+i] ? comp.layers[+i].name : 'Layer ' + (+i + 1));
  const pname = (def, k) => (def && def.params[+k] ? def.params[+k].name : 'parameter ' + (+k + 1));
  if (a === 'grid') return 'Pad ' + (+b + 1) + ', row ' + (+c + 1);
  if (a === 'track') return 'Track ' + (+b + 1) + ' ' + c;
  if (a === 'scene') return 'Scene ' + (+b + 1);
  if (a === 'sel') return { 'layer+': 'Select the layer above', 'layer-': 'Select the layer below', 'col-': 'Select the clip to the left', 'col+': 'Select the clip to the right', trigger: 'Launch the selected clip', column: 'Launch the selected column' }[b] || b;
  if (a === 'selected') return 'Selected layer ' + ((typeof NUDGE_KINDS !== 'undefined' && NUDGE_KINDS[b]) || b);
  if (a === 'win') return 'Move the controller grid ' + b;
  if (a === 'focus') return /^\d+$/.test(b) ? 'Focused parameter ' + (+b + 1) : { reset: 'Focused parameters to default', prev: 'Previous effect', next: 'Next effect', 'page-': 'Previous parameters', 'page+': 'Next parameters', bypass: 'Focused effect on/off' }[b] || b;
  if (a === 'stopall') return 'Stop all clips';
  if (a === 'fullscreen') return 'Full screen on / off';
  if (a === 'bpm') return 'Tempo';
  if (a === 'layer' && c === 'select') return ln(b) + ' select';
  if (a === 'fx') {
    const f = findFx(b);
    if (!f) return 'Effect not in this composition';
    return f.owner + ' > ' + f.e.def + ' > ' + (c === 'mix' ? 'Mix' : c === 'bypass' ? 'On/off' : pname(DEFS.fx.get(f.e.def), c));
  }
  if (a === 'gen') { const g = findGenClip(b); return g ? g.owner + ' > ' + g.c.name + ' > ' + (c === 'trail' ? 'Trails' : g.c.type === '3d' && SCENES3D[g.c.scene] ? (SCENES3D[g.c.scene].params[+c] || {}).name || 'parameter ' + (+c + 1) : pname(DEFS.gen.get(g.c.gen), c)) : 'Generator clip not in this composition'; }
  if (a === 'master') return 'Master';
  if (a === 'crossfade') return 'Crossfader';
  if (a === 'tap') return 'Tap tempo';
  if (a === 'resync') return 'Resync';
  if (a === 'column') return 'Column ' + (+b + 1);
  const nk = k => (typeof NUDGE_KINDS !== 'undefined' && NUDGE_KINDS[k]) || k;
  if (a === 'clip') return ln(b) + ', clip ' + (+c + 1) + (d ? ' ' + nk(d) : '');
  if (a === 'deck') return 'Deck ' + b + ' ' + c;
  if (a === 'blackout') return 'Blackout';
  if (a === 'snap') return 'Snapshot ' + (+b + 1);
  if (a === 'agent') return { on: 'Agent on/off', next: 'Agent next look', hold: 'Agent hold', drop: 'Agent drop', rec: 'Record' }[b] || 'Agent ' + b;
  if (a === 'layer') return ln(b) + ' ' + nk(c);
  return id;
}
// "Any device" / the profile's name / the MIDI port name
function devLabel(dev) {
  if (dev === '*') return 'Any device';
  const d = midi.devs[dev], p = (d && d.profile) || allProfiles().find(x => x.id === dev);
  return p ? p.name : dev.replace(/^midi:/, '');
}
// The input part of a key, for people: "CC 7 / ch 1", "Note 36 / ch 10", "Hand: Thumbs up"
const midiKeyLabel = full => {
  const [t, ch, n] = full.slice(full.indexOf('|') + 1).split(':');
  if (t === 'gest') return 'Hand: ' + ((typeof HAND_GESTURES !== 'undefined' && HAND_GESTURES[n]) || n);
  if (t === 'btn') return 'Button ' + n;
  if (t === 'axis') return 'Stick axis ' + n;
  return (t === 'cc' ? 'CC ' : 'Note ') + n + ' / ch ' + (+ch + 1);
};

// Move every on-screen fader bound to this target (grid, properties, transport).
function reflectMidi(id, v) {
  document.querySelectorAll('[data-midi="' + id + '"]').forEach(e => {
    if (e.type !== 'range') return;
    e.value = v;
    const o = e.nextElementSibling;
    if (o && o.tagName === 'OUTPUT') o.textContent = v.toFixed(2);
  });
}
// Targets something drives: the user's mappings plus the defaults of the profiles of connected devices.
function mappedTargets() {
  const s = new Set(Object.values(midi.map).filter(Boolean));
  for (const dev in midi.devs) { const p = midi.devs[dev].profile; if (p && p.defaults) for (const k in p.defaults) if (midi.map[dev + '|' + k] === undefined) s.add(p.defaults[k]); }
  return s;
}
function markMidi() {
  const mapped = mappedTargets();
  document.querySelectorAll('[data-midi]').forEach(e => {
    e.classList.toggle('midi-mapped', mapped.has(e.dataset.midi));
    e.classList.toggle('midi-target', e.dataset.midi === midi.target);
  });
}
// Learning replaces what the SAME device had on this target (and an old "any device" mapping of the same family), so a
// pad on one controller and a button on another can both drive it.
function bindMidi(key, id) {
  const dev = key.slice(0, key.indexOf('|')), fam = k => (/\|gest:/.test(k) ? 'gest' : 'ctl');
  for (const k in midi.map) {
    if (midi.map[k] !== id) continue;
    const kd = k.slice(0, k.indexOf('|'));
    if ((kd === dev || kd === '*') && fam(k) === fam(key)) delete midi.map[k];
  }
  midi.map[key] = id;
  saveMidiMap();
  midi.target = null;
  markMidi(); ui.propsDirty = true;
  setStatus('Mapped: ' + (dev === '*' ? '' : devLabel(dev) + ' ') + midiKeyLabel(key) + ' -> ' + midiLabel(id) + '. Click another control to map it, or press Esc to finish.');
}
// What an input drives: { id, key, kind } or null. own mapping > profile default > any-device mapping
function ctlLookup(dev, k) {
  const full = dev + '|' + k, d = midi.devs[dev], p = d && d.profile;
  const pc = p && p.controls && p.controls.find(c => c.key === k);
  const kind = midi.kinds[full] || (pc && pc.kind) || (k.startsWith('cc:') ? 'knob' : 'pad'), sync = !!(pc && pc.sync && !midi.kinds[full]), enc = pc && pc.enc;
  if (midi.shiftHeld[dev] && p && p.shiftDefaults && p.shiftDefaults[k]) return { id: p.shiftDefaults[k], key: full, kind };   // the Shift layer
  if (midi.map[full] !== undefined) return { id: midi.map[full], key: full, kind, sync, enc };
  if (p && p.defaults && p.defaults[k]) return { id: p.defaults[k], key: full, kind, sync, enc };
  if (dev !== '*' && midi.map['*|' + k] !== undefined) return { id: midi.map['*|' + k], key: full, kind: midi.kinds['*|' + k] || kind };
  return null;
}

const midiLast = {};
const ctlPick = {};     // pickup state per input key: { raw: last position of the control, set: last value it gave }
const encAcc = {};      // encoders on targets that cannot report their value: the value they were given last
function onMidiMessage(data, dev = '*') {
  const st = data[0] & 0xf0, ch = data[0] & 0x0f, n = data[1], v = data[2] || 0;
  let type, val;
  if (st === 0xb0) { type = 'cc'; val = v / 127; }
  else if (st === 0x90 || st === 0x80) { type = 'note'; val = st === 0x90 ? v / 127 : 0; }   // note-on with velocity 0 is a note-off
  else return;
  onInputEvent(type, ch, n, val, dev, v);
}
let pickSaid = 0;
function pickHint(id, x, cur) {
  const now = performance.now();
  if (now - pickSaid < 400) return;
  pickSaid = now;
  const pc = v => Math.round(v * 100) + '%';
  setStatus('Pickup: ' + midiLabel(id) + ' is at ' + pc(cur) + ', the control at ' + pc(x) + '. Move it ' + (x < cur ? 'up' : 'down') + ' to take over.');
}
// One path for every button-like or knob-like input: MIDI notes and CCs, hand gestures (hands.js, type 'gest') and, later,
// gamepads. dev says which device it came from; raw is the MIDI data byte (0..127, encoders need it).
// In Map mode the first input that arrives is bound to the picked control; otherwise it drives what it is mapped to.
function onInputEvent(type, ch, n, val, dev = '*', raw) {
  const d = midi.devs[dev], p = d && d.profile;
  if (midi.capture && midi.capture.dev === dev) { midi.capture.fn(type, ch, n, val, raw ?? Math.round(val * 127)); return; }   // the setup wizard listens
  let k = type + ':' + ch + ':' + n;
  if (p && typeof p.alias === 'function') k = p.alias(k) || k;   // one key for a control that sends on several channels
  if (typeof ctlMapSeen === 'function') ctlMapSeen(dev, k);   // the Controllers tab lights this control's row
  if (type !== 'cc' && type !== 'note' && typeof ctlMonIn === 'function') ctlMonIn(dev, null, k, val);   // gamepad buttons, gestures: the monitor
  if (p && p.shift === k) {   // the profile's Shift button only switches layers (and, held, shows the overlay when the profile says so)
    midi.shiftHeld[dev] = val > 0;
    if (p.overlayOnShift) ctlOverlay(dev, val > 0, 400); else if (ovl.dev === dev) ctlOverlayDraw();
    return;
  }
  if (p && p.overlayKey === k) { ctlOverlay(dev, val > 0); return; }
  const key = dev + '|' + k, prev = midiLast[key] || 0;
  midiLast[key] = val;
  if (midi.learn && midi.target) { if (val > 0) bindMidi(key, midi.target); return; }
  const m = ctlLookup(dev, k), t = m && m.id && midiTarget(m.id), id = t && (t.rid || m.id);
  if (!t) return;
  if (t.hold) {   // momentary: acts on press and on release (cc: crossing the middle)
    const on = type === 'cc' ? val >= 0.5 : val > 0, was = type === 'cc' ? prev >= 0.5 : prev > 0;
    if (on !== was) t.hold(on, key);
    return;
  }
  if (t.bend && type !== 'cc') { t.bend(val > 0 ? 1 : 0, key); return; }   // a pad or gesture on a bipolar target pushes forward while held
  if (type === 'cc' && m.kind === 'encoder') {   // relative: 1..63 up, 65..127 down (two's complement)
    const r = raw ?? Math.round(val * 127), delta = encDelta(r, m.enc);
    if (!delta) return;
    if (t.step) { t.step(delta); return; }
    if (!t.set) { if (delta > 0 && t.fire) { t.fire(); if (typeof cueRecord === 'function') cueRecord(id, null); } return; }
    const g = t.get ? t.get() : null, cur = g ?? encAcc[id] ?? 0.5, x = Math.min(1, Math.max(0, cur + delta * ENC_STEP));
    encAcc[id] = x;
    t.set(x, key); reflectMidi(id, x);
    if (typeof cueRecord === 'function') cueRecord(id, x);
    return;
  }
  if (t.set) {
    const x = type === 'cc' ? val : (val > 0 ? 1 : 0);
    if (type === 'cc' && midi.pickup && !m.sync && t.get && (m.kind === 'knob' || m.kind === 'fader')) {   // sync: the device shows the value and turns from it (LED rings)
      const cur = t.get(), pk = ctlPick[key] || (ctlPick[key] = {});
      if (cur !== null && (pk.set === undefined || Math.abs(cur - pk.set) > PICK_TOL)) {   // first touch, or the value moved without this control
        const crossed = pk.raw !== undefined && (pk.raw - cur) * (x - cur) <= 0;
        pk.raw = x;
        if (!crossed && Math.abs(x - cur) > PICK_TOL) { pickHint(id, x, cur); return; }
      }
      pk.raw = x; pk.set = x;
    }
    t.set(x, key); reflectMidi(id, x);
    if (typeof cueRecord === 'function') cueRecord(id, x);   // track score recording (cues.js)
  } else if (t.fire && (type === 'cc' ? val >= 0.5 && prev < 0.5 : val > 0)) { t.fire(); if (typeof cueRecord === 'function') cueRecord(id, null); }   // buttons fire on press only
}

// ---------- the controller's window on the clip grid (grid:, track:, scene: targets) ----------
// l = first layer (track 1), c = first column (row 1); w x h is the size of the controller's pad grid.
const ctlWin = { l: 0, c: 0, w: 8, h: 5 };
function ctlWinClamp() {
  ctlWin.l = Math.max(0, Math.min(ctlWin.l, comp.layers.length - ctlWin.w));
  ctlWin.c = Math.max(0, Math.min(ctlWin.c, comp.columns - ctlWin.h));
}
function ctlWinMove(dir) {
  const was = ctlWin.l + ':' + ctlWin.c;
  if (dir === 'left') ctlWin.l--; else if (dir === 'right') ctlWin.l++; else if (dir === 'up') ctlWin.c--; else if (dir === 'down') ctlWin.c++;
  ctlWinClamp();
  const span = (a, n, max) => (a + 1) + '-' + Math.min(a + n, max);
  setStatus((was === ctlWin.l + ':' + ctlWin.c ? 'Controller grid is at the edge: ' : 'Controller grid: ') + 'layers ' + span(ctlWin.l, ctlWin.w, comp.layers.length) + ', columns ' + span(ctlWin.c, ctlWin.h, comp.columns));
}

// ---------- focus: knobs follow what the properties panel shows (focus: targets) ----------
// The "devices" there: the Composition or Layer tab = its effects; the Clip tab = the clip's own parameters (generator, text,
// 3D) then its effects. i = which device, page = which 8 of its parameters. Selecting something else starts again at 0.
const ctlFocus = { i: 0, page: 0, sig: '' };
function focusDevices() {
  if (propTab === 'comp') return comp.fx.map(e => ({ e }));
  const L = comp.layers[sel.l];
  if (!L) return [];
  if (propTab === 'layer') return L.fx.map(e => ({ e }));
  const c = L.clips[sel.c];
  return c ? (c.params ? [{ c }] : []).concat((c.fx || []).map(e => ({ e }))) : [];
}
function focusIds(dv) {
  if (!dv) return [];
  if (dv.e) { const d = DEFS.fx.get(dv.e.def); return d ? d.params.map((_, k) => 'fx:' + dv.e.uid + ':' + k).concat(d.isf ? [] : ['fx:' + dv.e.uid + ':mix']) : []; }
  const pre = 'gen:' + dv.c.uid + ':';   // the sliders the Clip tab shows, in its order (generator, text and 3D clips differ)
  const shown = [...document.querySelectorAll('#props input[type=range][data-midi^="' + pre + '"]')].map(x => x.dataset.midi);
  if (shown.length) return shown;
  const d = dv.c.gen && DEFS.gen.get(dv.c.gen);
  return d ? d.params.map((_, k) => pre + k) : [];
}
function focusNow() {
  const sig = propTab + ':' + sel.l + ':' + sel.c;
  if (sig !== ctlFocus.sig) { ctlFocus.sig = sig; ctlFocus.i = 0; ctlFocus.page = 0; }
  const devs = focusDevices();
  ctlFocus.i = Math.max(0, Math.min(ctlFocus.i, devs.length - 1));
  const dv = devs[ctlFocus.i] || null, ids = focusIds(dv), pages = Math.max(1, Math.ceil(ids.length / 8));
  ctlFocus.page = Math.max(0, Math.min(ctlFocus.page, pages - 1));
  return { dv, devs, ids, pages, page: ctlFocus.page, onPage: ids.slice(ctlFocus.page * 8, ctlFocus.page * 8 + 8) };
}
function focusSay() {
  const f = focusNow(), name = !f.dv ? 'nothing here (select a layer, a clip or the composition)' : f.dv.e ? f.dv.e.def + (f.devs.length > 1 ? ' (effect ' + (ctlFocus.i + 1 - (f.devs[0].c ? 1 : 0)) + ')' : '') : f.dv.c.name;
  setStatus('Knobs: ' + name + (f.pages > 1 ? ', parameters page ' + (f.page + 1) + ' of ' + f.pages : ''));
}
function focusTarget(b) {
  if (/^\d+$/.test(b)) {
    const id = focusNow().onPage[+b], t = id && midiTarget(id);
    if (t && !t.rid) t.rid = id;
    return t;
  }
  const step = fn => ({ fire: () => { fn(); focusSay(); } });
  if (b === 'next') return step(() => { ctlFocus.i++; ctlFocus.page = 0; });   // focusNow clamps
  if (b === 'prev') return step(() => { ctlFocus.i--; ctlFocus.page = 0; });
  if (b === 'page+') return step(() => { ctlFocus.page++; });
  if (b === 'page-') return step(() => { ctlFocus.page--; });
  if (b === 'reset') return step(() => { for (const id of focusNow().onPage) { const v = paramDefault(id), t = v === null ? null : midiTarget(id); if (t && t.set) { t.set(v); reflectMidi(id, v); } } });
  if (b === 'bypass') { const f = focusNow(); return f.dv && f.dv.e ? { fire: () => { f.dv.e.bypass = !f.dv.e.bypass; ui.propsDirty = true; } } : null; }
  return null;
}
// The default value of a parameter target (fx / gen), or null when it has none.
function paramDefault(id) {
  const [a, b, c] = id.split(':');
  if (a === 'fx') { const f = findFx(b); if (!f) return null; if (c === 'mix') return 1; const d = DEFS.fx.get(f.e.def); return d && d.params[+c] ? d.params[+c].def ?? null : null; }
  if (a !== 'gen') return null;
  const g = findGenClip(b);
  if (!g || c === 'trail') return null;
  const P = g.c.type === '3d' && SCENES3D[g.c.scene] ? SCENES3D[g.c.scene].params : g.c.gen && DEFS.gen.get(g.c.gen) ? DEFS.gen.get(g.c.gen).params : null;
  return P && P[+c] ? P[+c].def ?? null : null;
}
function selTarget(b) {
  const L = comp.layers[sel.l], ok = () => { ui.gridDirty = ui.propsDirty = true; };
  if (b === 'layer+' || b === 'layer-') return { fire: () => { const i = Math.min(comp.layers.length - 1, Math.max(0, sel.l + (b === 'layer+' ? 1 : -1))); if (typeof selectLayer === 'function') selectLayer(i); else { sel.l = i; sel.c = -1; propTab = 'layer'; ok(); } } };
  if (b === 'col-' || b === 'col+') return { fire: () => { sel.c = Math.min(comp.columns - 1, Math.max(0, (sel.c < 0 ? 0 : sel.c + (b === 'col+' ? 1 : -1)))); propTab = L && L.clips[sel.c] ? 'clip' : 'layer'; ok(); } };
  if (b === 'trigger') return L && sel.c >= 0 ? { fire: () => trigger(sel.l, sel.c) } : null;
  if (b === 'column') return sel.c >= 0 ? { fire: () => triggerColumn(sel.c) } : null;
  return null;
}
// ---------- overlay: hold a button to see what every control of the device does right now (control screen only) ----------
// A profile lists its rows with overlay(dev, shift) -> [[control name, target id, text]] (text instead of the target's label).
const ovl = { dev: null, timer: 0 };
function ctlNowLabel(id) {
  if (!id) return 'nothing';
  const t = midiTarget(id);
  return t && t.rid ? midiLabel(t.rid) : midiLabel(id) + (t ? '' : ' (nothing to control right now)');
}
function ctlOverlay(dev, on, delay = 0) {
  clearTimeout(ovl.timer);
  if (!on) { ovl.dev = null; const o = document.getElementById('ctlOverlay'); if (o) o.remove(); return; }
  if (delay) { ovl.timer = setTimeout(() => ctlOverlay(dev, true), delay); return; }
  ovl.dev = dev;
  ctlOverlayDraw();
}
function ctlOverlayDraw() {
  const d = midi.devs[ovl.dev], p = d && d.profile;
  if (!p || typeof p.overlay !== 'function' || !document.getElementById('app')) return;
  let o = document.getElementById('ctlOverlay');
  if (!o) { o = el('div', { id: 'ctlOverlay', role: 'dialog', ariaLabel: p.name + ' controls' }); document.body.append(o); }
  const shift = !!midi.shiftHeld[ovl.dev];
  o.textContent = '';
  o.append(el('h3', { textContent: p.name + (shift ? ' — Shift held' : '') }));
  const grid = el('div', { className: 'rows' });
  for (const [name, id, text] of p.overlay(ovl.dev, shift)) grid.append(el('b', { textContent: name }), el('span', { textContent: text || ctlNowLabel(id) }));
  o.append(grid);
}
// Desktop page: a frame around the grid cells the controller's pads cover, and an outline on the effect and the sliders its
// knobs drive. Only while a device whose profile has a pad grid (profile.grid) is connected.
let outlineT = 0;
function ctlOutline() {
  const now = performance.now();
  if (now - outlineT < 100) return;
  outlineT = now;
  const g = document.getElementById('grid'), props = document.getElementById('props');
  if (!g || !props || typeof cellEls === 'undefined') return;
  const on = Object.values(midi.devs).some(d => d.profile && d.profile.grid);
  let box = document.getElementById('ctlWinBox');
  const want = new Set();
  if (on) {
    ctlWinClamp();
    let r = null;
    for (let li = ctlWin.l; li < ctlWin.l + ctlWin.w; li++) for (let ci = ctlWin.c; ci < ctlWin.c + ctlWin.h; ci++) {
      const cell = cellEls[li] && cellEls[li][ci];
      if (!cell) continue;
      const q = cell.getBoundingClientRect();
      r = r ? { l: Math.min(r.l, q.left), t: Math.min(r.t, q.top), r: Math.max(r.r, q.right), b: Math.max(r.b, q.bottom) } : { l: q.left, t: q.top, r: q.right, b: q.bottom };
    }
    if (r) {
      if (!box || box.parentNode !== g) { if (box) box.remove(); box = el('div', { id: 'ctlWinBox' }); g.append(box); }   // renderGrid empties #grid
      const gr = g.getBoundingClientRect(), pad = 3;
      Object.assign(box.style, { left: (r.l - gr.left + g.scrollLeft - pad) + 'px', top: (r.t - gr.top + g.scrollTop - pad) + 'px', width: (r.r - r.l + pad * 2) + 'px', height: (r.b - r.t + pad * 2) + 'px' });
    } else if (box) box.remove();
    const f = focusNow();
    for (const id of f.onPage) { const s = props.querySelector('[data-midi="' + id + '"]'); if (s) want.add(s.closest('.fld') || s); }
    if (f.dv && f.dv.e) { const cb = props.querySelector('[data-midi="fx:' + f.dv.e.uid + ':bypass"]'), card = cb && cb.closest('.fx'); if (card) want.add(card); }
  } else if (box) box.remove();
  document.querySelectorAll('.ctl-focus').forEach(e => { if (!want.has(e)) e.classList.remove('ctl-focus'); });
  want.forEach(e => e.classList.add('ctl-focus'));
}

// ---------- devices: profiles, init messages, LED feedback ----------
const midiPortName = s => String(s || '').replace(/^\d+-\s*/, '').replace(/\|/g, '/').trim().slice(0, 60);   // Windows numbers a second identical device "2- Name"
const ctlProfileFor = name => allProfiles().find(p => { if (typeof p.match.midiPort !== 'string') return false; try { return new RegExp(p.match.midiPort, 'i').test(name); } catch (e) { return false; } }) || null;
const wantSysex = () => allProfiles().some(p => p.init && p.init.some(m => m[0] === 0xf0));
const fb = { sent: {}, t: 0 };   // LED feedback: "dev|key" -> value last sent
function ctlSend(dev, msg) {
  const d = midi.devs[dev];
  if (!d || !d.output || (msg[0] === 0xf0 && !midi.sysex)) return false;
  try { d.output.send(msg); } catch (e) { return false; }
  if (typeof ctlMonOut === 'function') ctlMonOut(dev, msg);   // ctlmonitor.js
  return true;
}
function ctlGreet(dev) {
  const d = midi.devs[dev], p = d.profile;
  for (const k in fb.sent) if (k.startsWith(dev + '|')) delete fb.sent[k];   // a re-plugged device starts dark: send every LED again
  if (!p) { setStatus('New MIDI device: ' + d.name + '. Set it up in one go under Settings > Controllers > Set up, or map controls one by one with the MIDI button.'); return; }
  if (p.grid) { ctlWin.w = p.grid.w; ctlWin.h = p.grid.h; }
  midi.shiftHeld[dev] = false;
  let ok = true;
  for (const m of p.init || []) ok = ctlSend(dev, m) && ok;
  setStatus(p.name + ' ready' + (p.init && p.init.length && !ok ? ' (it could not be set up fully: allow MIDI system messages for this page, or use the desktop app)' : ''));
}
// Each frame (vjTick): every ~30 ms, send the LEDs that changed. A profile's leds(dev) lists [key, value] or raw messages.
function ctlTick() {
  const now = performance.now();
  if (now - fb.t < 30) return;
  fb.t = now;
  for (const dev in midi.devs) {
    const d = midi.devs[dev], p = d.profile;
    if (!d.output || !p || typeof p.leds !== 'function' || midi.ledHold[dev] > now) continue;   // ledHold: a light test is showing
    let list;
    try { list = p.leds(dev) || []; } catch (e) { continue; }
    for (const [k, v, chOver] of list) {   // chOver: send on another channel (the APC40 mkII's pulse / blink modes), same LED
      const fk = dev + '|' + k, sv = (chOver || 0) + '/' + v;
      if (fb.sent[fk] === sv) continue;
      const [t, ch, n] = k.split(':');
      const st = t === 'note' ? 0x90 : t === 'cc' ? 0xb0 : -1;
      if (st < 0 || !ctlSend(dev, [st | ((chOver ?? +ch) & 15), +n & 127, v & 127])) continue;
      fb.sent[fk] = sv;
    }
  }
  ctlOutline();
  if (ovl.dev && now - (ovl.t || 0) > 300) { ovl.t = now; ctlOverlayDraw(); }   // labels follow what the controls drive now
}
// Connects every MIDI input (and its output, by name) and greets devices that are new.
function midiHook() {
  const seen = new Set(), outs = [...midi.access.outputs.values()].filter(o => o.state !== 'disconnected');
  midi.access.inputs.forEach(i => {
    if (i.state === 'disconnected') return;
    const name = midiPortName(i.name), p = ctlProfileFor(name), dev = p ? p.id : 'midi:' + name;
    if (seen.has(dev)) return;   // a second identical device: the first one wins
    seen.add(dev);
    const was = midi.devs[dev], output = outs.find(o => midiPortName(o.name) === name) || null;
    midi.devs[dev] = { kind: 'midi', name, profile: p, input: i, output };
    i.onmidimessage = ev => { if (typeof ctlMonIn === 'function') ctlMonIn(dev, ev.data); if (midiClockMsg(ev.data, ev.timeStamp)) return; onMidiMessage(ev.data, dev); };   // clock goes to follow.js; ctlmonitor.js sees everything
    if (!was || was.input !== i || was.output !== output) ctlGreet(dev);
  });
  for (const dev in midi.devs) if (midi.devs[dev].kind === 'midi' && !seen.has(dev)) {
    const still = [...seen].some(x => midi.devs[x].name === midi.devs[dev].name);   // same device under a new profile: not gone
    if (!still) setStatus(devLabel(dev) + ' disconnected');
    if (midi.capture && midi.capture.dev === dev && typeof wzClose === 'function') wzClose();
    delete midi.devs[dev];
  }
  markMidi(); ui.propsDirty = true;
}
async function connectMidi() {
  if (midi.access) return true;
  if (!navigator.requestMIDIAccess) { setStatus('This browser has no Web MIDI. Use Chrome or Edge.'); return false; }
  // system messages (SysEx) only when a profile needs them to set its device up: asking for them is a stronger permission
  if (wantSysex()) { try { midi.access = await navigator.requestMIDIAccess({ sysex: true }); midi.sysex = true; } catch (e) {} }
  if (!midi.access) { try { midi.access = await navigator.requestMIDIAccess(); } catch (e) { setStatus('MIDI access was refused'); return false; } }
  midiHook();
  midi.access.onstatechange = midiHook;   // devices plugged in later
  return true;
}
async function setMidiLearn(on) {
  if (on) await connectMidi();   // Map mode works without MIDI too: hand gestures can be mapped as well
  midi.learn = on; midi.target = null;
  document.body.classList.toggle('midi-learn', on);
  $('midiBtn').classList.toggle('on', on);
  markMidi();
  const devs = midi.access ? midi.access.inputs.size : 0;
  const gest = typeof handState !== 'undefined' && handState.on;
  setStatus(!on ? 'Map mode off' : 'Map: click a fader, clip or button, then ' + [devs ? 'move a knob or press a pad' : '', gest ? 'make a hand gesture' : ''].filter(Boolean).join(', or ')
    + (devs || gest ? '. Esc to finish.' : 'connect a MIDI device or turn on Track hands (Sources tab). Esc to finish.'));
}
function initMidi() {
  // In learn mode a click on a mappable control picks it as the target instead of using it.
  const block = e => { if ((midi.learn || midi.pick) && e.target.closest && e.target.closest('[data-midi]')) { e.preventDefault(); e.stopPropagation(); } };
  ['pointerdown', 'mousedown', 'touchstart', 'dblclick', 'contextmenu'].forEach(t => document.addEventListener(t, block, { capture: true, passive: false }));
  document.addEventListener('click', e => {
    const t = (midi.learn || midi.pick) && e.target.closest && e.target.closest('[data-midi]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (midi.pick) { ctlMapPicked(t.dataset.midi); return; }   // ctlmap.js: control first, then the screen control
    midi.target = t.dataset.midi; markMidi();
    setStatus('MIDI learn: now move a knob or press a pad for ' + midiLabel(midi.target));
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && midi.pick) ctlMapPicked(null); else if (e.key === 'Escape' && midi.learn) setMidiLearn(false); });
  // Reconnect silently on start when the browser already allows MIDI; otherwise wait for the MIDI button.
  if (navigator.requestMIDIAccess && navigator.permissions) navigator.permissions.query({ name: 'midi', sysex: wantSysex() }).then(p => { if (p.state === 'granted') connectMidi(); }).catch(() => {});
}

// ---------- sync with the Strodano account (website /api/app/controllers; plan.js ent.token, entFetch) ----------
// One document per account. sync.at = the server's updatedAt of the copy this app last saw or saved; dirty = changed here
// since. A change is pushed 5 s later; the server refuses a push made from an older copy (409, with the newer copy), so
// the app merges them entry by entry, the later change winning (ctlMerge: a mapping removed on one computer stays removed
// unless another changed it afterwards). The copy replaced by the account's is kept in CTL_BACKUP_KEY. Signed out or
// offline: localStorage only, as before; it catches up at the next start, sign-in or coming back online.
const CTL_SYNC_KEY = 'strodano-vj-ctlsync', CTL_BACKUP_KEY = 'strodano-vj-controllers-backup';
const ctlSync = { at: null, dirty: false, timer: 0, busy: false };
try { Object.assign(ctlSync, JSON.parse(localStorage.getItem(CTL_SYNC_KEY) || '{}')); } catch (e) {}
const ctlSyncSave = () => { try { localStorage.setItem(CTL_SYNC_KEY, JSON.stringify({ at: ctlSync.at, dirty: ctlSync.dirty })); } catch (e) {} };
const ctlSignedIn = () => typeof ent !== 'undefined' && !!ent.token && typeof entFetch === 'function';
const ctlHasAny = () => Object.keys(midi.map).length || midi.userProfiles.length || Object.keys(midi.kinds).length || Object.keys(midi.stick).length;
function ctlSyncChanged() {
  ctlSync.dirty = true; ctlSyncSave();
  clearTimeout(ctlSync.timer);
  if (ctlSignedIn()) ctlSync.timer = setTimeout(ctlSyncPush, 5000);
}
// Puts the account's copy in place; with merge, the two are merged entry by entry (ctlMerge).
function ctlTakeRemote(data, at, merge) {
  const mine = JSON.parse(JSON.stringify(ctlExport()));
  try { localStorage.setItem(CTL_BACKUP_KEY, JSON.stringify(mine)); } catch (e) {}
  if (!data || data.format !== 1 || typeof data.map !== 'object') return false;
  if (ctlApply(merge ? ctlMerge(mine, data) : data, true) < 0) return false;
  ctlSync.at = at;
  saveMidiMap(true); ctlSyncSave();
  if (midi.access) midiHook(); else { markMidi(); if (typeof ui !== 'undefined') ui.propsDirty = true; }   // profiles may now match devices
  return true;
}
async function ctlSyncPull() {
  if (!ctlSignedIn() || ctlSync.busy) return;
  ctlSync.busy = true;
  let r = null;
  try { r = await entFetch('/api/app/controllers', null, ent.token); } catch (e) {}
  ctlSync.busy = false;
  if (!r || !r.ok) return;
  const { data, updatedAt } = r.json;
  if (!data) { if (ctlHasAny()) { ctlSync.at = null; ctlSync.dirty = true; ctlSyncPush(); } return; }   // first device: send what is here
  if (updatedAt === ctlSync.at) { if (ctlSync.dirty) ctlSyncPush(); return; }
  const merge = ctlSync.dirty;
  if (!ctlTakeRemote(data, updatedAt, merge)) return;
  if (merge) ctlSyncPush(); else setStatus('Controller mappings updated from your Strodano account');
}
async function ctlSyncPush(retry = true) {
  clearTimeout(ctlSync.timer);
  if (!ctlSignedIn() || ctlSync.busy) return;
  ctlSync.busy = true;
  let r = null;
  try { r = await entFetch('/api/app/controllers/save', { data: ctlExport(), baseAt: ctlSync.at }, ent.token); } catch (e) {}
  ctlSync.busy = false;
  if (!r) return;   // offline: stays dirty
  if (r.ok) { ctlSync.at = r.json.updatedAt; ctlSync.dirty = false; ctlSyncSave(); return; }
  if (r.status === 409 && r.json.data && retry) { ctlTakeRemote(r.json.data, r.json.updatedAt, true); return ctlSyncPush(false); }
  if (r.status === 413) setStatus('Controller mappings are too large to sync to your account (they are still saved on this computer)');
}
if (typeof window !== 'undefined') {
  window.addEventListener('strodano-plan', () => ctlSyncPull());   // signed in or out, plan checked
  window.addEventListener('online', () => ctlSyncPull());
  setTimeout(() => (typeof entReady !== 'undefined' ? entReady : Promise.resolve()).then(() => ctlSyncPull()).catch(() => {}), 1500);
}

// ---------- the Controllers section of the Composition tab: devices, mappings, pickup, export / import ----------
function ctlChanged() { saveMidiMap(); markMidi(); ui.propsDirty = true; if (typeof drawKeysTabs === 'function' && !$('keysModal').hidden) drawKeysTabs(); }
// A device's own mappings follow it to a new device id (a profile made for it, or deleted). Existing ones there win.
function ctlMoveKeys(from, to) {
  if (from === to) return;
  for (const store of [midi.map, midi.kinds, midi.stick]) for (const k of Object.keys(store)) {
    if (!k.startsWith(from + '|')) continue;
    const nk = to + k.slice(from.length);
    if (store[nk] === undefined) store[nk] = store[k];
    delete store[k];
  }
}
function ctlExportFile() {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(ctlExport(), null, 1)], { type: 'application/json' })), download: 'strodano-controllers.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus('Controller mappings exported (strodano-controllers.json)');
}
function ctlImportFile() {
  const inp = el('input', { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let s = null;
    try { s = JSON.parse(await f.text()); } catch (e) {}
    const n = ctlApply(s, false);
    if (n < 0) { setStatus(f.name + ' is not a Strodano controllers file'); return; }
    ctlChanged();
    setStatus('Imported ' + n + ' mapping' + (n === 1 ? '' : 's') + ' from ' + f.name);
  };
  inp.click();
}
// inTab: drawn at the top of Settings > Controllers (keys.js), right above the mapping editor
function midiPanel(inTab) {
  const box = el('div', null, el('h4', { textContent: inTab ? 'Devices' : 'Controllers' }));
  const devs = Object.keys(midi.devs);
  box.append(el('div', { className: 'hint', textContent: devs.length ? 'Connected: ' + devs.map(d => midi.devs[d].name + (midi.devs[d].profile && midi.devs[d].profile.name !== midi.devs[d].name ? ' (' + midi.devs[d].profile.name + ' profile)' : '')).join(', ')
    : !navigator.requestMIDIAccess ? 'Web MIDI is not available in this browser. A gamepad works: press any button on it.'
    : !midi.access ? 'Click the MIDI button in the sidebar to connect a MIDI controller and map controls, or press a button on a gamepad.' : 'No controller connected.' }));
  box.append(el('div', { className: 'hint', textContent: ctlSignedIn() ? 'Synced with your Strodano account' + (ctlSync.dirty ? ' (changes waiting to be sent)' : '') : 'Sign in to keep these mappings on every computer you use' }));
  box.append(el('label', { className: 'chk', title: 'A knob or fader that does not match the value on screen takes over only when it reaches it, so nothing jumps' },
    el('input', { type: 'checkbox', checked: midi.pickup, onchange: e => { midi.pickup = e.target.checked; saveMidiMap(); } }), ' Pickup: faders take over only when they reach the value'));
  if (typeof ctlMapUI === 'function' && !inTab) box.append(el('div', { className: 'fld' }, el('span', { textContent: Object.keys(midi.map).length + ' mapping' + (Object.keys(midi.map).length === 1 ? '' : 's') + ' made by hand', style: { flex: '1' } }),
    el('button', { className: 'on', textContent: 'Edit mappings...', title: 'Every control of each device and what it does (Settings > Controllers)', onclick: () => toggleKeysHelp(true, 'ctl') })));
  // mappings, grouped by device (the phone page, which has no Controllers tab)
  const byDev = {};
  if (typeof ctlMapUI !== 'function')
  for (const k of Object.keys(midi.map).sort()) { const d = k.slice(0, k.indexOf('|')); (byDev[d] = byDev[d] || []).push(k); }
  for (const d of Object.keys(byDev)) {
    box.append(el('div', { className: 'hint', textContent: devLabel(d), style: { marginTop: '6px', fontWeight: '600' } }));
    for (const k of byDev[d]) {
      const kindSel = k.includes('|cc:') ? el('select', { title: 'Knob or Fader: absolute, with pickup. Encoder: an endless knob that sends up / down steps. Pad: a button', style: { flex: '0 0 auto', width: '74px' }, onchange: e => { if (e.target.value === 'knob') delete midi.kinds[k]; else midi.kinds[k] = e.target.value; delete ctlPick[k]; saveMidiMap(); } },
        ...['knob', 'fader', 'encoder', 'pad'].map(v => el('option', { value: v, textContent: CTL_KINDS[v], selected: (midi.kinds[k] || 'knob') === v }))) : null;
      box.append(el('div', { className: 'fld' }, el('label', { textContent: midiKeyLabel(k) }),
        el('span', { textContent: midi.map[k] ? midiLabel(midi.map[k]) : 'Off', style: { flex: '1' } }), kindSel,
        el('button', { textContent: '×', title: 'Remove this mapping', onclick: () => { delete midi.map[k]; delete midi.kinds[k]; ctlChanged(); } })));
    }
  }
  if (typeof ctlWizard === 'function') {   // ctlwizard.js (desktop page): the guided setup for a device without a profile, and the profiles it made
    for (const d of devs) if (midi.devs[d].kind === 'midi' && !midi.devs[d].profile) box.append(el('div', { className: 'fld' }, el('span', { textContent: midi.devs[d].name + ' has no profile', style: { flex: '1' } }),
      el('button', { className: 'on', textContent: 'Set up...', title: 'Move its faders, turn its knobs, press its pads: Strodano maps them for you', onclick: () => ctlWizard(d) })));
    for (const p of midi.userProfiles) {
      const dev = devs.find(d => midi.devs[d].profile === p);
      box.append(el('div', { className: 'fld' }, el('span', { textContent: 'Your profile: ' + p.name, style: { flex: '1' } }),
        dev ? el('button', { textContent: 'Set up again', onclick: () => ctlWizard(dev) }) : null,
        el('button', { textContent: '×', title: 'Delete this profile (its device goes back to no profile)', onclick: e => armThen(e.currentTarget, 'delete the ' + p.name + ' profile', () => { midi.userProfiles = midi.userProfiles.filter(x => x !== p); if (dev) ctlMoveKeys(p.id, 'midi:' + midi.devs[dev].name); saveMidiMap(); if (midi.access) midiHook(); ctlChanged(); }) })));
    }
  }
  if (typeof gpPanelRows === 'function' && typeof ctlMapUI !== 'function') box.append(...gpPanelRows());   // gamepad.js: Nudge / Spring per stick
  for (const d of devs) { const p = midi.devs[d].profile; if (p && p.defaults) box.append(el('div', { className: 'hint', textContent: p.name + ': ' + Object.keys(p.defaults).length + ' controls mapped by its profile (map one again to change it)' })); }
  box.append(el('div', { className: 'fld' },
    el('button', { textContent: 'Export', title: 'Save every controller mapping to a file (backup, or take them to another computer)', onclick: ctlExportFile }),
    el('button', { textContent: 'Import', title: 'Add the mappings from an exported file (they replace mappings of the same controls)', onclick: ctlImportFile }),
    Object.keys(midi.map).length || Object.keys(midi.stick).length ? el('button', { textContent: 'Clear all mappings', onclick: e => armThen(e.currentTarget, 'remove every mapping', () => { midi.map = {}; midi.kinds = {}; midi.stick = {}; ctlChanged(); }) }) : null));
  return box;
}

// ---------- MIDI clock in (24 ticks a beat; start, continue, stop, song position): the visuals follow external gear ----------
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
