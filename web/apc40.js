// Strodano VJ (web) - built-in controller profile: AKAI APC40 mkII. GPL-3.0.
// Loaded after midi.js (desktop page). Layout (controller-mapping-spec.md §5): an APC track strip = a layer, the 5 pad rows
// = 5 clip columns, and the bank arrows move that 8 x 5 window over the composition (ctlWin). Device knobs follow what the
// properties panel shows (focus:). Shift + top pad row = snapshots 1-8, Shift + track 1 Activator = blackout.
// The connect message puts the APC in Ableton Live mode (0x41): it then lights nothing by itself, every LED comes from
// leds() below (midi.js ctlTick sends only changes, every 30 ms), and the device knobs take the ring value we send as their
// position, so they turn on from the value on screen (sync: no pickup needed).
// Message numbers follow AKAI's APC40 mkII communication protocol. NOT YET CHECKED ON A REAL UNIT: verify every note / CC.
'use strict';
(function () {
  const PAD = (x, y) => (4 - y) * 8 + x;   // y = 0 is the top row (notes 32-39); the bottom row is notes 0-7
  // pad colours (the mkII's 128-colour palette): one hue per track, "+ 2" is the darker shade of the same hue
  const HUE = [5, 9, 13, 21, 37, 45, 49, 57], WHITE = 3, PLAY = 21, PULSE_CH = 9;   // note-on channel 9 = pulsing (channels 6-10)
  const defaults = {}, shiftDefaults = {}, controls = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 5; y++) defaults['note:0:' + PAD(x, y)] = 'grid:' + x + ':' + y;
    defaults['cc:' + x + ':7'] = 'track:' + x + ':opacity';
    controls.push({ key: 'cc:' + x + ':7', kind: 'fader', label: 'Track ' + (x + 1) + ' fader' });
    defaults['note:' + x + ':52'] = 'track:' + x + ':eject';     // Clip Stop
    defaults['note:' + x + ':51'] = 'track:' + x + ':select';    // Track Select
    defaults['note:' + x + ':50'] = 'track:' + x + ':bypass';    // Activator
    defaults['note:' + x + ':49'] = 'track:' + x + ':solo';      // Solo
    defaults['cc:0:' + (16 + x)] = 'focus:' + x;                  // Device knobs
    controls.push({ key: 'cc:0:' + (16 + x), kind: 'knob', sync: true, label: 'Device knob ' + (x + 1) });
    controls.push({ key: 'cc:0:' + (48 + x), kind: 'knob', sync: true, label: 'Track knob ' + (x + 1) });   // free for the user
    shiftDefaults['note:0:' + PAD(x, 0)] = 'snap:' + x;
  }
  for (let y = 0; y < 5; y++) defaults['note:0:' + (82 + y)] = 'scene:' + y;
  Object.assign(defaults, {
    'cc:0:14': 'master', 'cc:0:15': 'crossfade', 'note:0:81': 'stopall',
    'note:0:94': 'win:up', 'note:0:95': 'win:down', 'note:0:96': 'win:right', 'note:0:97': 'win:left',
    'note:0:58': 'focus:prev', 'note:0:59': 'focus:next', 'note:0:60': 'focus:page-', 'note:0:61': 'focus:page+', 'note:0:62': 'focus:bypass',
    'note:0:99': 'tap', 'note:0:100': 'selected:nudge-', 'note:0:101': 'selected:nudge+', 'cc:0:13': 'bpm', 'note:0:91': 'resync', 'note:0:93': 'agent:rec',
  });
  shiftDefaults['note:0:50'] = 'blackout';
  controls.push({ key: 'cc:0:14', kind: 'fader', label: 'Master' }, { key: 'cc:0:15', kind: 'fader', label: 'Crossfader' },
    { key: 'cc:0:13', kind: 'encoder', label: 'Tempo' }, { key: 'cc:0:47', kind: 'encoder', label: 'Cue level' });

  function leds(dev) {
    const out = [], W = ctlWin;
    ctlWinClamp();
    for (let x = 0; x < 8; x++) {
      const li = W.l + x, L = comp.layers[li];
      for (let y = 0; y < 5; y++) {
        const ci = W.c + y, c = L && L.clips[ci];
        let v = 0, ch = 0;
        if (c) {
          if (L.active === ci) v = PLAY;
          else if (L.pendingCol === ci) { v = PLAY; ch = PULSE_CH; }   // launched, waiting for its first frame
          else if (sel.l === li && sel.c === ci) v = WHITE;
          else v = HUE[li % 8] + 2;
        }
        out.push(['note:0:' + PAD(x, y), v, ch]);
      }
      out.push(['note:' + x + ':50', L && !L.bypass ? 1 : 0], ['note:' + x + ':49', L && L.solo ? 1 : 0],
        ['note:' + x + ':51', L && sel.l === li ? 1 : 0], ['note:' + x + ':52', L && L.active >= 0 ? 1 : 0], ['note:' + x + ':48', 0]);
    }
    for (let y = 0; y < 5; y++) out.push(['note:0:' + (82 + y), comp.layers.slice(W.l, W.l + W.w).some(L => L.clips[W.c + y]) ? 1 : 0]);
    // rings: type (CC 24-31 / 56-63: 0 off, 1 single dot) and value. Device knobs show the focused parameters; track knobs
    // show what the user mapped them to, if it reports a value.
    const f = focusNow(), ring = (k, t) => { const g = t && t.get ? t.get() : null; return g === null || g === undefined ? null : Math.round(Math.min(1, Math.max(0, g)) * 127); };
    for (let k = 0; k < 8; k++) {
      const dv = ring(k, f.onPage[k] && midiTarget(f.onPage[k]));
      out.push(['cc:0:' + (24 + k), dv === null ? 0 : 1], ['cc:0:' + (16 + k), dv ?? 0]);
      const m = ctlLookup(dev, 'cc:0:' + (48 + k)), tv = ring(k, m && m.id && midiTarget(m.id));
      out.push(['cc:0:' + (56 + k), tv === null ? 0 : 1], ['cc:0:' + (48 + k), tv ?? 0]);
    }
    out.push(['note:0:62', f.dv && f.dv.e && !f.dv.e.bypass ? 1 : 0]);
    return out;
  }
  // Hold Shift for 0.4 s: the overlay lists what the controls do right now (midi.js ctlOverlay)
  function overlay(dev, shift) {
    ctlWinClamp();
    const W = ctlWin, span = (a, n, max) => (a + 1) + '–' + Math.min(a + n, max), f = focusNow();
    const layers = 'layers ' + span(W.l, W.w, comp.layers.length), cols = 'columns ' + span(W.c, W.h, comp.columns);
    const rows = shift ? [['Top row of pads', null, 'Snapshots 1–8'], ['Activator 1', 'blackout'], ['Other controls', null, 'As without Shift']]
      : [['Pads', null, 'Clips of ' + layers + ', ' + cols], ['Scene launch 1–5', null, 'Launch ' + cols], ['Faders 1–8', null, 'Opacity of ' + layers],
        ['Clip Stop · Select · Activator · Solo', null, 'Eject · select · bypass · solo the layer'], ['Bank arrows', null, 'Move the pads over the grid'],
        ['Device ◀ ▶ · Bank ◀ ▶', null, 'Previous / next effect · parameter page ' + (f.page + 1) + ' of ' + f.pages]];
    if (!shift) for (let k = 0; k < 8; k++) rows.push(['Device knob ' + (k + 1), null, f.onPage[k] ? ctlNowLabel(f.onPage[k]) : '—']);
    if (!shift) rows.push(['Master', 'master'], ['Crossfader', 'crossfade'], ['Stop All Clips', 'stopall'], ['Tap · Nudge − / +', null, 'Tap tempo · nudge the selected layer\'s clip'], ['Tempo knob', 'bpm'], ['Play · Record', null, 'Resync · record']);
    return rows;
  }
  registerProfile({
    id: 'apc40mk2', name: 'AKAI APC40 mkII', match: { midiPort: '^APC40 mkII' }, overlay, overlayOnShift: true,
    init: [[0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, 0x41, 0x01, 0x00, 0x00, 0xf7]],   // Ableton Live mode
    grid: { w: 8, h: 5 }, shift: 'note:0:98', controls, defaults, shiftDefaults, leds,
    // device knobs and device buttons can arrive on the selected track's channel: one key for each control
    alias: k => { const m = /^(cc|note):(\d+):(\d+)$/.exec(k); if (!m || m[2] === '0') return k; const n = +m[3]; return (m[1] === 'cc' && n >= 16 && n <= 23) || (m[1] === 'note' && n >= 58 && n <= 65) ? m[1] + ':0:' + n : k; },
  });
})();
