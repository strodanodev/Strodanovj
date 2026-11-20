// Strodano VJ (web) - gamepads: Xbox, PlayStation, ROG Ally (game mode) and anything Steam Input presents as a standard pad.
// GPL-3.0. Loaded after midi.js and apc40.js (desktop page). Spec: ../../controller-mapping-spec.md §6.
// Polled every frame (snapshots.js vjTick -> gpTick). Only pads with the browser's "standard" layout count; every pad
// connected acts as the one device "gamepad", so a mapping learnt on one pad works on any. Buttons go through midi.js
// onInputEvent as keys "gamepad|btn:0:<n>" (so Map mode, profiles, the Shift layer and several inputs per target work as
// for MIDI); sticks are handled here because they act every frame: "nudge" moves the value while pushed and leaves it
// there, "spring" offsets it from where it was and goes back on release (per mapping, midi.stick[key]). Triggers on a
// bipolar target (the clip nudge) bend it by how far they are pressed. Chromium reports a pad only after a button press.
// Gyro: none here on purpose; Steam Input or Armoury Crate can turn tilt into stick motion, which arrives as a stick.
'use strict';
const GP_DEV = 'gamepad';
const GP_NAMES = ['A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'View / Share', 'Menu / Options',
  'L3 (press left stick)', 'R3 (press right stick)', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Guide'];
const GP_AXES = ['Left stick left / right', 'Left stick up / down', 'Right stick left / right', 'Right stick up / down'];
const GP_DEAD = 0.15;     // stick dead zone
const GP_SWEEP = 1.5;     // nudge: a full push moves a value from 0 to 1 in 1.5 s
const GP_SPRING = 0.5;    // spring: a full push moves it half the range from where it rests
const GP_BPM_RATE = 20;   // a stick on the tempo: 20 steps (2 BPM) a second at full push
const gp = { btn: [], axis: [] };

const GP_PROFILE = (() => {
  const defaults = {
    'btn:0:12': 'sel:layer+', 'btn:0:13': 'sel:layer-', 'btn:0:14': 'sel:col-', 'btn:0:15': 'sel:col+',
    'btn:0:0': 'sel:trigger', 'btn:0:1': 'selected:eject', 'btn:0:2': 'sel:column', 'btn:0:3': 'selected:bypass',
    'btn:0:5': 'tap', 'btn:0:6': 'selected:nudge', 'btn:0:7': 'selected:nudge', 'btn:0:9': 'agent:on',
    'btn:0:10': 'blackout', 'btn:0:11': 'focus:reset',
    'axis:0:0': 'crossfade', 'axis:0:1': 'master', 'axis:0:2': 'focus:0', 'axis:0:3': 'focus:1',
  };
  const shiftDefaults = { 'btn:0:0': 'snap:0', 'btn:0:1': 'snap:1', 'btn:0:2': 'snap:2', 'btn:0:3': 'snap:3',
    'btn:0:12': 'snap:4', 'btn:0:13': 'snap:5', 'btn:0:14': 'snap:6', 'btn:0:15': 'snap:7', 'btn:0:5': 'resync', 'btn:0:9': 'fullscreen' };
  const controls = [
    { key: 'btn:0:6', kind: 'pad', analog: true, sign: -1, label: 'LT' }, { key: 'btn:0:7', kind: 'pad', analog: true, sign: 1, label: 'RT' },
    { key: 'btn:0:10', kind: 'pad', holdMs: 500, label: 'L3' },   // blackout only after half a second: never by accident
    ...GP_AXES.map((label, n) => ({ key: 'axis:0:' + n, kind: 'stick', invert: n % 2 === 1, label })),   // up is "more"
  ];
  const overlay = (dev, shift) => {
    const rows = [];
    for (const n of [0, 1, 2, 3, 12, 13, 14, 15, 5, 6, 7, 9, 10, 11]) {
      const m = ctlLookup(dev, 'btn:0:' + n);
      if (!m || !m.id) continue;
      if ((n === 6 || n === 7) && /:nudge$/.test(m.id)) rows.push([GP_NAMES[n], null, 'Nudge the selected layer\'s clip ' + (n === 6 ? 'slower' : 'faster') + ' (press harder = more)']);
      else rows.push([GP_NAMES[n] + (n === 10 ? ' (hold)' : ''), m.id]);
    }
    rows.push([GP_NAMES[4], null, shift ? 'Held: the Shift layer' : 'Hold: Shift layer (snapshots, resync)'], [GP_NAMES[8], null, 'Hold: this list']);
    for (let n = 0; n < 4; n++) {
      const m = ctlLookup(dev, 'axis:0:' + n);
      if (m && m.id) rows.push([GP_AXES[n], null, ctlNowLabel(m.id) + ' · ' + (midi.stick[dev + '|axis:0:' + n] || 'nudge')]);
    }
    return rows;
  };
  return { id: 'gamepad', name: 'Gamepad', match: { gamepad: true }, shift: 'btn:0:4', overlayKey: 'btn:0:8', controls, defaults, shiftDefaults, overlay };
})();
registerProfile(GP_PROFILE);
const gpCtl = k => GP_PROFILE.controls.find(c => c.key === k) || {};
const gpName = id => String(id || 'Gamepad').replace(/\s*\((STANDARD GAMEPAD )?Vendor: \w+ Product: \w+\)\s*$/i, '').replace(/\s*\((XInput )?STANDARD GAMEPAD[^)]*\)\s*$/i, '').trim() || 'Gamepad';   // Chromium adds "(XInput STANDARD GAMEPAD)" or "(... Vendor: ... Product: ...)"

// Each frame: read every standard pad (a button counts as pressed on any pad, a stick takes the pad pushed furthest).
function gpTick(dt) {
  if (!navigator.getGamepads) return;
  let list;
  try { list = navigator.getGamepads(); } catch (e) { return; }
  const pads = [...(list || [])].filter(g => g && g.connected && g.mapping === 'standard');
  if (!pads.length) { if (midi.devs[GP_DEV]) gpGone(); return; }
  if (!midi.devs[GP_DEV]) {
    midi.devs[GP_DEV] = { kind: 'gamepad', name: gpName(pads[0].id), profile: GP_PROFILE, input: null, output: null };
    midi.shiftHeld[GP_DEV] = false;
    setStatus('Controller ready: ' + midi.devs[GP_DEV].name + '. Hold View / Share to see what each button does.');
    markMidi(); ui.propsDirty = true;
  }
  const now = performance.now();
  for (let n = 0; n < 17; n++) {
    let v = 0;
    for (const g of pads) { const b = g.buttons[n]; if (b) v = Math.max(v, b.value || (b.pressed ? 1 : 0)); }
    gpButton(n, v, now);
  }
  for (let n = 0; n < 4; n++) {
    let raw = 0;
    for (const g of pads) { const a = g.axes[n] || 0; if (Math.abs(a) > Math.abs(raw)) raw = a; }
    let v = Math.abs(raw) < GP_DEAD ? 0 : Math.sign(raw) * (Math.abs(raw) - GP_DEAD) / (1 - GP_DEAD);
    if (gpCtl('axis:0:' + n).invert) v = -v;
    gpStick(n, v, dt || 1 / 60);
  }
}
function gpButton(n, v, now) {
  const k = 'btn:0:' + n, pc = gpCtl(k), st = gp.btn[n] || (gp.btn[n] = { v: 0, down: false, t0: 0, sent: false });
  if (pc.analog && !midi.learn) {   // a trigger on a bipolar target: bend it by how far it is pressed
    const m = ctlLookup(GP_DEV, k), t = m && m.id && midiTarget(m.id);
    if (t && t.bend) {
      const a = v < 0.05 ? 0 : v;
      if (Math.abs(a - st.v) > 0.02 || (a === 0 && st.v !== 0)) { t.bend((pc.sign || 1) * a, GP_DEV + '|' + k); st.v = a; }
      return;
    }
  }
  const down = v > 0.5;
  if (pc.holdMs && !midi.learn) {   // acts only after being held that long
    if (down && !st.down) { st.t0 = now; st.sent = false; }
    if (down && !st.sent && now - st.t0 >= pc.holdMs) { st.sent = true; onInputEvent('btn', 0, n, 1, GP_DEV); }
    if (!down && st.down && st.sent) onInputEvent('btn', 0, n, 0, GP_DEV);
    st.down = down;
    return;
  }
  if (down !== st.down) { st.down = down; onInputEvent('btn', 0, n, down ? 1 : 0, GP_DEV); }
}
function gpStick(n, v, dt) {
  const k = 'axis:0:' + n, key = GP_DEV + '|' + k, st = gp.axis[n] || (gp.axis[n] = { v: 0, rest: null, on: false, acc: 0 });
  const was = st.v;
  st.v = v;
  if (Math.abs(v) > 0.5 && Math.abs(was) <= 0.5 && typeof ctlMapSeen === 'function') ctlMapSeen(GP_DEV, k);
  if (midi.learn) { if (midi.target && Math.abs(v) > 0.6 && Math.abs(was) <= 0.6) bindMidi(key, midi.target); return; }
  const m = ctlLookup(GP_DEV, k), t = m && m.id && midiTarget(m.id);
  if (!t) return;
  const id = t.rid || m.id;
  if (t.bend) { if (v !== was) t.bend(v, key); return; }
  if (t.hold) { const on = Math.abs(v) > 0.5; if (on !== st.on) { st.on = on; t.hold(on, key); } return; }
  if (t.step) { st.acc += v * dt * GP_BPM_RATE; while (Math.abs(st.acc) >= 1) { const s = Math.sign(st.acc); t.step(s); st.acc -= s; } if (!v) st.acc = 0; return; }
  if (!t.set) { if (t.fire && v > 0.6 && was <= 0.6) t.fire(); return; }   // a stick pushed on a button target: once per push
  const mode = midi.stick[key] || 'nudge', g = t.get ? t.get() : null, cur = g ?? encAcc[id] ?? 0.5;
  let x;
  if (mode === 'spring') {
    if (v === 0 && st.rest === null) return;
    if (st.rest === null) st.rest = cur;   // where it was when the stick left the centre
    x = v === 0 ? st.rest : st.rest + v * GP_SPRING;
    if (v === 0) st.rest = null;
  } else {
    if (v === 0) return;
    x = cur + v * dt / GP_SWEEP;
  }
  x = Math.min(1, Math.max(0, x));
  encAcc[id] = x;
  t.set(x, key); reflectMidi(id, x);
  if (typeof cueRecord === 'function') cueRecord(id, x);
}
// All pads gone: let go of everything still held (a nudge, a held button), and forget the device.
function gpGone() {
  gp.btn.forEach((st, n) => {
    if (!st) return;
    const k = 'btn:0:' + n, m = ctlLookup(GP_DEV, k), t = m && m.id && midiTarget(m.id);
    if (gpCtl(k).analog && t && t.bend && st.v) t.bend(0, GP_DEV + '|' + k);
    else if (st.down) onInputEvent('btn', 0, n, 0, GP_DEV);
  });
  gp.axis.forEach((st, n) => { if (st && st.v) gpStick(n, 0, 0); });
  gp.btn = []; gp.axis = [];
  ctlOverlay(GP_DEV, false);
  delete midi.devs[GP_DEV];
  setStatus('Controller disconnected');
  markMidi(); ui.propsDirty = true;
}
// Controllers panel rows (midi.js midiPanel): each stick, what it drives, and Nudge or Spring.
function gpPanelRows() {
  if (!midi.devs[GP_DEV]) return [];
  const rows = [el('div', { className: 'hint', textContent: midi.devs[GP_DEV].name + ' sticks', style: { marginTop: '6px', fontWeight: '600' } })];
  for (let n = 0; n < 4; n++) {
    const key = GP_DEV + '|axis:0:' + n, m = ctlLookup(GP_DEV, 'axis:0:' + n);
    rows.push(el('div', { className: 'fld' }, el('label', { textContent: GP_AXES[n] }), el('span', { textContent: m && m.id ? ctlNowLabel(m.id) : 'nothing', style: { flex: '1' } }),
      el('select', { title: 'Nudge: the value moves while you push and stays there. Spring: it moves from where it was and goes back when you let go', style: { flex: '0 0 auto', width: '74px' },
        onchange: e => { if (e.target.value === 'nudge') delete midi.stick[key]; else midi.stick[key] = e.target.value; saveMidiMap(); } },
        el('option', { value: 'nudge', textContent: 'Nudge', selected: midi.stick[key] !== 'spring' }), el('option', { value: 'spring', textContent: 'Spring', selected: midi.stick[key] === 'spring' }))));
  }
  return rows;
}
