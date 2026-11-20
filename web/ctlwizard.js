// Strodano VJ (web) - the setup wizard for a MIDI controller that has no profile. GPL-3.0. Desktop page, after midi.js.
// Spec: ../../controller-mapping-spec.md §7. Three listening steps, then a name: "move each fader", "turn each knob",
// "press each pad". While it listens, midi.capture takes that device's input (nothing on screen reacts). What it hears is
// sorted by what the control sends:
//   fader  a CC that sweeps at least half the range
//   knob   a CC that sends many different values; encoder: a CC that keeps sending the same few values, and how it says
//          up / down (midi.js ENC_STYLES) is read from them, so turn knobs both ways
//   pad    a note, or a CC that only jumps between 0 and 127
// The result is a user profile (midi.userProfiles, same format as built-in ones, so it can be shared later): faders = layer
// opacity (track:N, the last one = master when there are more than 8), knobs = the focused parameters (focus:N), pads = the
// clip grid (grid:X:Y, so many pads per row). Mappings made by hand for the device before move over to the profile.
'use strict';
const WZ_STEPS = [
  ['faders', 'Faders', 'Move each fader all the way down and up, from left to right. Skip this step if it has none.'],
  ['knobs', 'Knobs', 'Turn each knob both ways, from left to right. Endless knobs (encoders) are recognised too.'],
  ['pads', 'Pads and buttons', 'Press each pad or button once: the top row first, left to right. These launch clips.'],
  ['done', 'Name and save', ''],
];
let wz = null;

function ctlWizard(dev) {
  const d = midi.devs[dev];
  if (!d || d.kind !== 'midi') { setStatus('Connect the device first (and click MIDI in the menu bar if it is not listed)'); return; }
  wzClose();
  const box = el('div', { className: 'modal small', id: 'ctlWiz', role: 'dialog', ariaLabel: 'Set up ' + d.name });
  document.body.append(box);
  wz = { dev, name: d.name, step: 0, faders: [], knobs: [], pads: [], stats: {}, flash: {}, box, perRow: 0 };
  if (d.profile && d.profile.source === 'user') wz.newName = d.profile.name;   // set up again: keep its name
  midi.capture = { dev, fn: wzInput };
  wzDraw();
}
function wzClose() {
  if (!wz) return;
  midi.capture = null;
  wz.box.remove();
  wz = null;
}
const wzTaken = k => wz.faders.concat(wz.knobs, wz.pads).find(c => c.key === k);
const wzList = () => wz[WZ_STEPS[wz.step][0]];

// What the device sent, while a listening step is open.
function wzInput(type, ch, n, val, raw) {
  const step = WZ_STEPS[wz.step][0], k = type + ':' + ch + ':' + n;
  if (step === 'done') return;
  const s = wz.stats[k] || (wz.stats[k] = { min: 127, max: 0, vals: [], last: -1 });
  s.min = Math.min(s.min, raw); s.max = Math.max(s.max, raw);
  s.vals.push(raw); if (s.vals.length > 60) s.vals.shift();
  const prevRaw = s.last; s.last = raw;
  const had = wzTaken(k);
  if (had) {
    if (wz[step].includes(had)) { wz.flash[k] = performance.now(); if (step === 'knobs') wzKnobKind(had, s); wzDraw(); }
    return;
  }
  let add = null;
  if (step === 'faders' && type === 'cc' && s.max - s.min >= 64) add = { key: k, kind: 'fader' };
  else if (step === 'knobs' && type === 'cc' && s.vals.length >= 4) { add = { key: k, kind: 'knob' }; wzKnobKind(add, s); }
  else if (step === 'pads' && ((type === 'note' && val > 0) || (type === 'cc' && raw === 127 && prevRaw <= 0 && s.vals.every(v => v === 0 || v === 127)))) add = { key: k, kind: 'pad' };
  if (!add) return;
  wz[step].push(add);
  wz.flash[k] = performance.now();
  wzDraw();
}
// Absolute knob or encoder, and the encoder's style, from the values it sent.
function wzKnobKind(c, s) {
  const distinct = new Set(s.vals);
  if (distinct.size > 6 || s.vals.length < 4) { c.kind = 'knob'; delete c.enc; return; }
  const low = s.vals.some(v => v >= 1 && v <= 15), high = s.vals.some(v => v >= 113), mid = s.vals.some(v => v >= 65 && v <= 79), under = s.vals.some(v => v >= 49 && v <= 63);
  c.kind = 'encoder';
  c.enc = high ? 'twos' : under && mid && !low ? 'offset' : low && mid ? 'sign' : !low && mid ? 'offset' : 'twos';
}

function wzDraw() {
  if (!wz) return;
  const [key, title, how] = WZ_STEPS[wz.step], box = wz.box, now = performance.now();
  box.textContent = '';
  box.append(el('div', { className: 'mh' }, el('b', { textContent: 'Set up ' + wz.name + ' · ' + (wz.step + 1) + ' of ' + WZ_STEPS.length + ': ' + title }),
    el('button', { textContent: 'Cancel', onclick: () => { wzClose(); setStatus('Setup cancelled: nothing was changed'); } })));
  const body = el('div', { className: 'wz-body' });
  box.append(body);
  if (key !== 'done') {
    const list = wzList(), label = c => c.kind === 'encoder' ? 'Endless knob' : CTL_KINDS[c.kind];
    body.append(el('p', { textContent: how }),
      el('div', { className: 'wz-list' }, ...(list.length ? list.map((c, i) => el('div', { className: 'wz-row' + (now - (wz.flash[c.key] || 0) < 450 ? ' flash' : '') },
        el('b', { textContent: (i + 1) + '.' }), el('span', { textContent: midiKeyLabel('x|' + c.key) }), el('span', { className: 'hint', textContent: label(c) }),
        el('button', { textContent: '×', title: 'Not this one', onclick: () => { list.splice(i, 1); delete wz.stats[c.key]; wzDraw(); } })))
        : [el('div', { className: 'hint', textContent: 'Listening...' })])));
    if (list.some(c => now - (wz.flash[c.key] || 0) < 450)) setTimeout(wzDraw, 460);   // the flash fades
  } else {
    const pads = wz.pads.length, guess = pads === 16 || pads === 4 ? Math.sqrt(pads) : Math.min(8, pads) || 1;
    if (!wz.perRow) wz.perRow = guess;
    const name = el('input', { type: 'text', value: wz.name, maxLength: 60, spellcheck: false, oninput: e => { wz.newName = e.target.value; } });
    if (wz.newName !== undefined) name.value = wz.newName;
    const f = wz.faders.length, kn = wz.knobs.length;
    body.append(el('div', { className: 'fld' }, el('label', { textContent: 'Name' }), name));
    if (pads) body.append(el('div', { className: 'fld' }, el('label', { textContent: 'Pads per row' }),
      el('input', { type: 'number', min: 1, max: 16, value: wz.perRow, style: { width: '70px' }, onchange: e => { wz.perRow = Math.max(1, Math.min(16, Math.round(+e.target.value) || guess)); wzDraw(); } })));
    const rows = Math.ceil(pads / wz.perRow);
    body.append(el('ul', { className: 'wz-sum' },
      el('li', { textContent: f ? f + ' fader' + (f > 1 ? 's' : '') + ': layer opacity' + (f > 8 ? ', the last one is the master' : '') : 'No faders' }),
      el('li', { textContent: kn ? Math.min(kn, 8) + ' knob' + (kn > 1 ? 's' : '') + ' follow what is selected (effect or clip)' + (kn > 8 ? '; ' + (kn - 8) + ' more stay free to map by hand' : '') : 'No knobs' }),
      el('li', { textContent: pads ? pads + ' pad' + (pads > 1 ? 's' : '') + ' launch clips: ' + wz.perRow + ' layers wide, ' + rows + ' column' + (rows > 1 ? 's' : '') + ' high' : 'No pads' })),
      el('p', { className: 'hint', textContent: 'Anything can be changed later with the MIDI button (Map mode). Your own mappings win over the profile.' }));
  }
  const total = wz.faders.length + wz.knobs.length + wz.pads.length;
  body.append(el('div', { className: 'wz-nav' },
    wz.step ? el('button', { textContent: 'Back', onclick: () => { wz.step--; wzDraw(); } }) : null,
    key === 'done' ? el('button', { className: 'on', textContent: 'Save profile', disabled: !total, title: total ? '' : 'Nothing was captured', onclick: wzSave })
      : el('button', { className: 'on', textContent: wzList().length ? 'Next' : 'Skip', onclick: () => { wz.step++; wzDraw(); } })));
}

function wzSave() {
  const d = midi.devs[wz.dev], name = String(wz.newName ?? wz.name).trim().slice(0, 60) || wz.name;
  const id = 'user:' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'controller').slice(0, 50);
  const port = d ? d.name : wz.name, esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const controls = [], defaults = {};
  const nf = wz.faders.length;
  wz.faders.forEach((c, i) => { controls.push({ key: c.key, kind: 'fader', label: 'Fader ' + (i + 1) }); if (nf > 8 && i === nf - 1) defaults[c.key] = 'master'; else if (i < 8) defaults[c.key] = 'track:' + i + ':opacity'; });
  wz.knobs.forEach((c, i) => { controls.push(Object.assign({ key: c.key, kind: c.kind, label: 'Knob ' + (i + 1) }, c.enc ? { enc: c.enc } : {})); if (i < 8) defaults[c.key] = 'focus:' + i; });
  const w = Math.max(1, Math.min(16, wz.perRow || 8));
  wz.pads.forEach((c, i) => { controls.push({ key: c.key, kind: 'pad', label: 'Pad ' + (i + 1) }); if (Math.floor(i / w) < 16) defaults[c.key] = 'grid:' + (i % w) + ':' + Math.floor(i / w); });
  const p = { id, name, source: 'user', match: { midiPort: '^' + esc(port) + '$' }, controls, defaults };
  if (wz.pads.length) p.grid = { w, h: Math.min(16, Math.ceil(wz.pads.length / w)) };
  if (!validProfile(p)) { setStatus('That profile could not be saved'); return; }
  // one profile per device: replace one with the same id or for the same port
  midi.userProfiles = midi.userProfiles.filter(x => x.id !== id && x.match.midiPort !== p.match.midiPort).concat([p]);
  // mappings made by hand for this device move to the profile's device id
  ctlMoveKeys(wz.dev, id);
  wzClose();
  saveMidiMap();
  if (midi.access) midiHook();   // the device is matched again, now with its profile (sets the grid size, says it is ready)
  ctlChanged();
  const count = (kinds, word) => { const c = controls.filter(x => kinds.includes(x.kind)).length; return c ? c + ' ' + word + (c > 1 ? 's' : '') : ''; };
  setStatus('Saved the ' + name + ' profile: ' + [count(['fader'], 'fader'), count(['knob', 'encoder'], 'knob'), count(['pad'], 'pad')].filter(Boolean).join(', ') + '. It loads by itself whenever this device is plugged in.');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && wz) { wzClose(); setStatus('Setup cancelled: nothing was changed'); } });
