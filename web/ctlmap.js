// Strodano VJ (web) - the Controllers tab of the Shortcuts popup: every control of a device and what it does. GPL-3.0.
// Desktop page, after ctlwizard.js. Control first (the other way round from Map mode, which is screen control first):
// pick a device, find a control in the list (or press it: its row lights up), then choose an action from the list, or
// "Pick on screen" and click any fader, button or clip in the app. Reset goes back to the profile's default; Off silences
// a control. Mappings land in midi.map like Map mode's ("<dev>|<key>" -> target id, '' = off).
'use strict';
const ctlMap = { dev: null, seen: {} };
// Actions offered in the list (labels come from midi.js midiLabel). Clips, effects and generator sliders: Pick on screen.
function ctlActionGroups() {
  const n = (count, f) => Array.from({ length: count }, (_, i) => f(i));
  const g = [
    ['Selection', ['sel:layer+', 'sel:layer-', 'sel:col-', 'sel:col+', 'sel:trigger', 'sel:column']],
    ['Selected layer', ['selected:bypass', 'selected:solo', 'selected:eject', 'selected:nudge-', 'selected:nudge+', 'selected:nudge', 'selected:speed1']],
    ['Mix', ['master', 'crossfade', 'stopall']],
    ['Tempo', ['tap', 'resync', 'bpm']],
    ['Show', ['blackout', 'fullscreen', ...n(SNAP_COUNT, i => 'snap:' + i)]],
    ['Knobs follow the selection', [...n(8, i => 'focus:' + i), 'focus:prev', 'focus:next', 'focus:page-', 'focus:page+', 'focus:bypass', 'focus:reset']],
    ['Controller pad window', ['win:up', 'win:down', 'win:left', 'win:right']],
    ['Layers', comp.layers.flatMap((L, i) => ['opacity', 'bypass', 'solo', 'eject'].map(k => 'layer:' + i + ':' + k))],
    ['Columns', n(comp.columns, i => 'column:' + i)],
  ];
  if (typeof agentMidiTarget === 'function') g.splice(5, 0, ['Agent', ['agent:on', 'agent:next', 'agent:hold', 'agent:drop', 'agent:rec']]);
  return g;
}
// Devices to show: connected ones, then ones that only have saved mappings.
function ctlMapDevices() {
  const list = Object.keys(midi.devs);
  for (const k of Object.keys(midi.map)) { const d = k.slice(0, k.indexOf('|')); if (!list.includes(d)) list.push(d); }
  return list;
}
function ctlMapProfile(dev) { const d = midi.devs[dev]; return (d && d.profile) || allProfiles().find(p => p.id === dev) || null; }
// Every control the device is known to have: the profile's list, its defaults, and keys mapped by hand.
function ctlMapControls(dev) {
  const p = ctlMapProfile(dev), out = new Map();
  const add = (k, label) => { if (!out.has(k)) out.set(k, label || (p && typeof p.label === 'function' && p.label(k)) || midiKeyLabel('x|' + k)); };
  if (dev === GP_DEV && typeof GP_NAMES !== 'undefined') { GP_NAMES.forEach((nm, i) => add('btn:0:' + i, nm)); GP_AXES.forEach((nm, i) => add('axis:0:' + i, nm)); }
  if (p && p.controls) for (const c of p.controls) add(c.key, c.label);
  if (p && p.defaults) for (const k of Object.keys(p.defaults)) add(k);
  for (const full of Object.keys(midi.map)) if (full.startsWith(dev + '|')) add(full.slice(dev.length + 1));
  return [...out].map(([k, name]) => ({ k, name }));
}

function ctlMapUI() {
  const box = $('ctlMapBody');
  box.textContent = '';
  const devs = ctlMapDevices();
  if (!devs.length) {
    box.append(el('p', { textContent: 'No controller yet. Plug in a MIDI controller (then click the MIDI button once to allow it), or press any button on a gamepad.' }));
    return;
  }
  if (!devs.includes(ctlMap.dev)) ctlMap.dev = devs[0];
  const dev = ctlMap.dev, p = ctlMapProfile(dev), live = !!midi.devs[dev];
  box.append(el('div', { className: 'cm-devs' }, ...devs.map(d => el('button', { className: d === dev ? 'on' : '', textContent: devLabel(d) + (midi.devs[d] ? '' : ' (not connected)'),
    onclick: () => { ctlMap.dev = d; ctlMapUI(); } }))));
  box.append(el('p', { className: 'hint', textContent: (live ? 'Press a control on the device to find it here. ' : '') +
    'Choose what it does from the list, or Pick on screen and click any fader, button or clip in the app. ' + (p ? 'Reset goes back to the ' + p.name + ' profile.' : '') }));
  const groups = ctlActionGroups(), rows = el('div', { className: 'cm-rows' }), pads = [], shiftRows = [];
  for (const c of ctlMapControls(dev)) {
    const full = dev + '|' + c.k;
    if (p && p.shift === c.k) { rows.append(ctlMapFixed(c, 'Shift: hold for the second layer of controls')); continue; }
    if (p && p.overlayKey === c.k) { rows.append(ctlMapFixed(c, 'Hold: shows what every control does')); continue; }
    const row = ctlMapRow(dev, c, full, groups, p);
    const def = p && p.defaults && p.defaults[c.k];
    if (def && def.startsWith('grid:') && midi.map[full] === undefined) pads.push(row); else rows.append(row);
    if (p && p.shiftDefaults && p.shiftDefaults[c.k]) shiftRows.push([c.name, p.shiftDefaults[c.k]]);
  }
  box.append(rows);
  if (pads.length) box.append(el('details', { className: 'cm-group' }, el('summary', { textContent: pads.length + ' clip pads: they launch the clips under the pad window (bank arrows move it)' }), ...pads));
  if (shiftRows.length) box.append(el('details', { className: 'cm-group' }, el('summary', { textContent: 'With Shift held' }),
    ...shiftRows.map(([nm, id]) => el('div', { className: 'cm-row' }, el('b', { textContent: nm }), el('span', { textContent: midiLabel(id) })))));
}
function ctlMapFixed(c, text) {
  return el('div', { className: 'cm-row', dataset: { k: c.k } }, el('b', { textContent: c.name }), el('span', { className: 'hint', textContent: text }));
}
function ctlMapRow(dev, c, full, groups, p) {
  const own = midi.map[full], def = p && p.defaults ? p.defaults[c.k] : undefined;
  const cur = own !== undefined ? own : def !== undefined ? def : (midi.map['*|' + c.k] ?? '');
  const known = new Set(groups.flatMap(g => g[1]));
  const sel = el('select', { title: 'What this control does', onchange: e => { const v = e.target.value; if (v === '__def') delete midi.map[full]; else midi.map[full] = v; ctlMapSaved(); } },
    def !== undefined ? el('option', { value: '__def', textContent: 'Default: ' + midiLabel(def), selected: own === undefined }) : null,
    el('option', { value: '', textContent: 'Nothing', selected: cur === '' && (own !== undefined || def === undefined) }),
    cur && !known.has(cur) ? el('option', { value: cur, textContent: midiLabel(cur), selected: own !== undefined || def === undefined }) : null,
    ...groups.filter(g => g[1].length).map(([gname, ids]) => el('optgroup', { label: gname }, ...ids.map(id => el('option', { value: id, textContent: midiLabel(id), selected: (own !== undefined || def === undefined) && id === cur })))));
  const extra = [];
  if (c.k.startsWith('axis:')) extra.push(el('select', { title: 'Nudge: the value moves while you push and stays. Spring: it moves from where it was and goes back when you let go', className: 'cm-kind',
    onchange: e => { if (e.target.value === 'nudge') delete midi.stick[full]; else midi.stick[full] = e.target.value; saveMidiMap(); } },
    el('option', { value: 'nudge', textContent: 'Nudge', selected: midi.stick[full] !== 'spring' }), el('option', { value: 'spring', textContent: 'Spring', selected: midi.stick[full] === 'spring' })));
  else if (c.k.startsWith('cc:')) {
    const pc = p && p.controls && p.controls.find(x => x.key === c.k), base = (pc && pc.kind) || 'knob';
    extra.push(el('select', { title: 'Knob or Fader: absolute, with pickup. Encoder: an endless knob. Pad: a button', className: 'cm-kind',
      onchange: e => { if (e.target.value === base) delete midi.kinds[full]; else midi.kinds[full] = e.target.value; delete ctlPick[full]; saveMidiMap(); } },
      ...['knob', 'fader', 'encoder', 'pad'].map(v => el('option', { value: v, textContent: CTL_KINDS[v], selected: (midi.kinds[full] || base) === v }))));
  }
  return el('div', { className: 'cm-row' + (performance.now() - (ctlMap.seen[full] || 0) < 900 ? ' seen' : ''), dataset: { k: c.k } },
    el('b', { textContent: c.name }), sel, ...extra,
    el('button', { textContent: 'Pick on screen', title: 'Close this, then click the fader, button or clip in the app this control should drive', onclick: () => ctlMapPick(full, c.name) }),
    own !== undefined && def !== undefined ? el('button', { textContent: 'Reset', title: 'Back to the profile default', onclick: () => { delete midi.map[full]; ctlMapSaved(); } }) : null);
}
function ctlMapSaved() { saveMidiMap(); markMidi(); ui.propsDirty = true; ctlMapUI(); }
// Close the popup, then the next click on a mappable control on screen becomes this control's action (midi.js initMidi).
function ctlMapPick(full, name) {
  midi.pick = { key: full, name };
  toggleKeysHelp(false);
  document.body.classList.add('midi-learn');
  markMidi();
  setStatus('Click the fader, button or clip that ' + name + ' should control. Esc cancels.');
}
function ctlMapPicked(id) {
  const p = midi.pick;
  midi.pick = null;
  document.body.classList.toggle('midi-learn', midi.learn);
  if (id) { midi.map[p.key] = id; saveMidiMap(); setStatus(p.name + ' -> ' + midiLabel(id)); } else setStatus('Nothing changed');
  markMidi(); ui.propsDirty = true;
  toggleKeysHelp(true, 'ctl');
}
// Any input (midi.js onInputEvent, gamepad.js): light its row while the tab is open.
function ctlMapSeen(dev, k) {
  const m = $('keysModal');
  if (!m || m.hidden || keysTab !== 'ctl') return;
  const full = dev + '|' + k, now = performance.now();
  if (now - (ctlMap.seen[full] || 0) < 150) { ctlMap.seen[full] = now; return; }   // a fader sends many messages: redraw at most every 150 ms
  ctlMap.seen[full] = now;
  if (ctlMap.dev !== dev) { ctlMap.dev = dev; ctlMapUI(); }
  const row = [...$('ctlMapBody').querySelectorAll('.cm-row')].find(r => r.dataset.k === k);
  if (!row) return;
  const det = row.closest('details');
  if (det) det.open = true;
  row.classList.remove('seen'); void row.offsetWidth; row.classList.add('seen');
  row.scrollIntoView({ block: 'nearest' });
}
