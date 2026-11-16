// Strodano VJ (web) - MIDI control with learn mode (Web MIDI, Chrome / Edge). GPL-3.0.
// Mappable controls carry data-midi="<target id>". Target ids are strings, so mappings survive the UI being rebuilt:
//   master, crossfade, tap, resync, column:C, clip:L:C, layer:L:opacity | bypass | solo | eject   (L, C count from 0)
//   deck:D:play | cue | sync | volume | tempo   (D is A or B)
//   fx:<effect uid>:<param index> | mix | bypass,  gen:<generator clip uid>:<param index>   (uids are saved with the composition)
// Mappings are app-wide (kept in localStorage), not part of a composition.
'use strict';
const MIDI_KEY = 'strodano-vj-midi';
const midi = { access: null, map: {}, learn: false, target: null };   // map: "cc:<ch>:<n>" | "note:<ch>:<n>" -> target id
try { midi.map = JSON.parse(localStorage.getItem(MIDI_KEY) || '{}') || {}; } catch (e) {}
function saveMidiMap() { try { localStorage.setItem(MIDI_KEY, JSON.stringify(midi.map)); } catch (e) {} }

function findFx(uid) {
  for (const [owner, chain] of [['Composition', comp.fx], ...comp.layers.map(L => [L.name, L.fx])]) {
    const e = chain.find(x => x.uid === uid);
    if (e) return { e, owner };
  }
  return null;
}
function findGenClip(uid) {
  for (const L of comp.layers) for (const c of L.clips) if (c && c.params && c.uid === uid) return { c, owner: L.name };   // generator, text and 3D clips
  return null;
}
// What a target id does right now: {set(v)} for faders, {fire()} for buttons. null if it points at nothing (layer removed...).
function midiTarget(id) {
  const [a, b, c] = id.split(':'), L = comp.layers[+b];
  if (a === 'fx') {
    const f = findFx(b);
    if (!f) return null;
    if (c === 'mix') return { set: v => { f.e.mix = v; } };
    if (c === 'bypass') return { fire: () => { f.e.bypass = !f.e.bypass; ui.propsDirty = true; } };
    return { set: v => { f.e.params[+c] = v; } };
  }
  if (a === 'gen') { const g = findGenClip(b); return g ? { set: v => { g.c.params[+c] = v; } } : null; }
  if (a === 'master') return { set: v => { comp.master = v; } };
  if (a === 'crossfade') return { set: v => { comp.crossfade = v; } };
  if (a === 'tap' || a === 'resync') return { fire: () => $(a).click() };
  if (a === 'column') return +b < comp.columns ? { fire: () => triggerColumn(+b) } : null;
  if (a === 'clip') return L && +c < comp.columns ? { fire: () => trigger(+b, +c) } : null;
  if (a === 'deck') return djMidiTarget(b, c);
  if (a === 'agent') return typeof agentMidiTarget === 'function' ? agentMidiTarget(b) : null;
  if (a !== 'layer' || !L) return null;
  if (c === 'opacity') return { set: v => { L.opacity = v; } };
  if (c === 'bypass') return { fire: () => { L.bypass = !L.bypass; ui.gridDirty = true; } };
  if (c === 'solo') return { fire: () => { L.solo = !L.solo; ui.gridDirty = true; } };
  if (c === 'eject') return { fire: () => eject(+b) };
  return null;
}
function midiLabel(id) {
  const [a, b, c] = id.split(':'), ln = i => (comp.layers[+i] ? comp.layers[+i].name : 'Layer ' + (+i + 1));
  const pname = (def, k) => (def && def.params[+k] ? def.params[+k].name : 'parameter ' + (+k + 1));
  if (a === 'fx') {
    const f = findFx(b);
    if (!f) return 'Effect not in this composition';
    return f.owner + ' > ' + f.e.def + ' > ' + (c === 'mix' ? 'Mix' : c === 'bypass' ? 'On/off' : pname(DEFS.fx.get(f.e.def), c));
  }
  if (a === 'gen') { const g = findGenClip(b); return g ? g.owner + ' > ' + g.c.name + ' > ' + pname(DEFS.gen.get(g.c.gen), c) : 'Generator clip not in this composition'; }
  if (a === 'master') return 'Master';
  if (a === 'crossfade') return 'Crossfader';
  if (a === 'tap') return 'Tap tempo';
  if (a === 'resync') return 'Resync';
  if (a === 'column') return 'Column ' + (+b + 1);
  if (a === 'clip') return ln(b) + ', clip ' + (+c + 1);
  if (a === 'deck') return 'Deck ' + b + ' ' + c;
  if (a === 'agent') return { on: 'Agent on/off', next: 'Agent next look', hold: 'Agent hold', drop: 'Agent drop', rec: 'Record' }[b] || 'Agent ' + b;
  if (a === 'layer') return ln(b) + ' ' + c;
  return id;
}
const midiKeyLabel = k => {
  const [t, ch, n] = k.split(':');
  if (t === 'gest') return 'Hand: ' + ((typeof HAND_GESTURES !== 'undefined' && HAND_GESTURES[n]) || n);
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
function markMidi() {
  const mapped = new Set(Object.values(midi.map));
  document.querySelectorAll('[data-midi]').forEach(e => {
    e.classList.toggle('midi-mapped', mapped.has(e.dataset.midi));
    e.classList.toggle('midi-target', e.dataset.midi === midi.target);
  });
}
function bindMidi(key, id) {
  for (const k in midi.map) if (midi.map[k] === id) delete midi.map[k];   // one control per target; learning again replaces it
  midi.map[key] = id;
  saveMidiMap();
  midi.target = null;
  markMidi(); ui.propsDirty = true;
  setStatus('MIDI: ' + midiKeyLabel(key) + ' -> ' + midiLabel(id) + '. Click another control to map it, or press Esc to finish.');
}

const midiLast = {};
function onMidiMessage(data) {
  const st = data[0] & 0xf0, ch = data[0] & 0x0f, n = data[1], v = data[2] || 0;
  let type, val;
  if (st === 0xb0) { type = 'cc'; val = v / 127; }
  else if (st === 0x90 || st === 0x80) { type = 'note'; val = st === 0x90 ? v / 127 : 0; }   // note-on with velocity 0 is a note-off
  else return;
  onInputEvent(type, ch, n, val);
}
// One path for every button-like or knob-like input: MIDI notes and CCs, and hand gestures (hands.js, type 'gest').
// In Map mode the first input that arrives is bound to the picked control; otherwise it drives what it is mapped to.
function onInputEvent(type, ch, n, val) {
  const key = type + ':' + ch + ':' + n, prev = midiLast[key] || 0;
  midiLast[key] = val;
  if (midi.learn && midi.target) { if (val > 0) bindMidi(key, midi.target); return; }
  const id = midi.map[key], t = id && midiTarget(id);
  if (!t) return;
  if (t.set) {
    const x = type === 'cc' ? val : (val > 0 ? 1 : 0);
    t.set(x); reflectMidi(id, x);
    if (typeof cueRecord === 'function') cueRecord(id, x);   // track score recording (cues.js)
  } else if (type === 'cc' ? val >= 0.5 && prev < 0.5 : val > 0) { t.fire(); if (typeof cueRecord === 'function') cueRecord(id, null); }   // buttons fire on press only
}

async function connectMidi() {
  if (midi.access) return true;
  if (!navigator.requestMIDIAccess) { setStatus('This browser has no Web MIDI. Use Chrome or Edge.'); return false; }
  try { midi.access = await navigator.requestMIDIAccess(); } catch (e) { setStatus('MIDI access was refused'); return false; }
  // MIDI clock (0xF8 ticks, start / continue / stop, song position) goes to follow.js; everything else is a control
  const hook = () => { midi.access.inputs.forEach(i => { i.onmidimessage = ev => { if (typeof midiClockMsg === 'function' && midiClockMsg(ev.data, ev.timeStamp)) return; onMidiMessage(ev.data); }; }); ui.propsDirty = true; };
  hook();
  midi.access.onstatechange = hook;   // devices plugged in later
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
  const block = e => { if (midi.learn && e.target.closest && e.target.closest('[data-midi]')) { e.preventDefault(); e.stopPropagation(); } };
  ['pointerdown', 'mousedown', 'touchstart', 'dblclick', 'contextmenu'].forEach(t => document.addEventListener(t, block, { capture: true, passive: false }));
  document.addEventListener('click', e => {
    const t = midi.learn && e.target.closest && e.target.closest('[data-midi]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    midi.target = t.dataset.midi; markMidi();
    setStatus('MIDI learn: now move a knob or press a pad for ' + midiLabel(midi.target));
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && midi.learn) setMidiLearn(false); });
  // Reconnect silently on start when the browser already allows MIDI; otherwise wait for the MIDI button.
  if (navigator.requestMIDIAccess && navigator.permissions) navigator.permissions.query({ name: 'midi' }).then(p => { if (p.state === 'granted') connectMidi(); }).catch(() => {});
}
// The MIDI section of the Composition tab: devices and current mappings.
function midiPanel() {
  const box = el('div', null, el('h4', { textContent: 'MIDI' }));
  const ins = midi.access ? [...midi.access.inputs.values()].map(i => i.name) : [];
  box.append(el('div', { className: 'hint', textContent: !navigator.requestMIDIAccess ? 'Web MIDI is not available in this browser.'
    : !midi.access ? 'Click MIDI in the menu bar to connect a controller and map controls.' : ins.length ? 'Devices: ' + ins.join(', ') : 'No MIDI device connected.' }));
  const keys = Object.keys(midi.map).sort();
  keys.forEach(k => box.append(el('div', { className: 'fld' }, el('label', { textContent: midiKeyLabel(k) }), el('span', { textContent: midiLabel(midi.map[k]), style: { flex: '1' } }),
    el('button', { textContent: '×', title: 'Remove this mapping', onclick: () => { delete midi.map[k]; saveMidiMap(); markMidi(); ui.propsDirty = true; } }))));
  if (keys.length) box.append(el('button', { textContent: 'Clear all mappings', onclick: () => { midi.map = {}; saveMidiMap(); markMidi(); ui.propsDirty = true; } }));
  return box;
}
