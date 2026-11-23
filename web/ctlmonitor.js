// Strodano VJ (web) - the MIDI monitor in Settings > Controllers: every message a controller sends, decoded, and what it
// does in the app right now. GPL-3.0. Desktop page, after ctlmap.js. Made for checking a controller against its profile
// (the APC40 mkII's note and CC numbers come from AKAI's documentation): press each control and read the line; a red line
// drives nothing. Optionally lists what the app sends back (lights), and a Light test lights every LED of a device whose
// profile has ledTest(). Copy puts the whole log on the clipboard, to paste into a support message.
// Hooks: midi.js calls ctlMonIn(dev, bytes) for every MIDI message (before MIDI clock is taken out), ctlMonIn(dev, null,
// key, val) for gamepad buttons and gestures, and ctlMonOut(dev, bytes) for every message it sends.
'use strict';
const MON_MAX = 400;
const mon = { log: [], paused: false, out: false, clock: 0, el: null, list: null, clockEl: null, drawT: 0, timer: 0 };
const hex = b => Array.from(b, x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const monTime = () => { const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };

// What a message is, in words: { what, k } (k = the input key the app looks up, or null)
function monDecode(b) {
  const s = b[0], st = s & 0xf0, ch = s & 15;
  if (s === 0xf0) return { what: 'SysEx, ' + b.length + ' bytes' + (b[1] === 0x47 ? ' (Akai)' : '') };
  if (s >= 0xf8) return { what: { 0xf8: 'Clock', 0xfa: 'Start', 0xfb: 'Continue', 0xfc: 'Stop', 0xfe: 'Active sensing' }[s] || 'System' };
  if (s === 0xf2) return { what: 'Song position' };
  if (st === 0x90 || st === 0x80) { const on = st === 0x90 && b[2] > 0; return { what: (on ? 'Note on ' + b[2] : 'Note off') + ' · note ' + b[1] + ' ch ' + (ch + 1), k: 'note:' + ch + ':' + b[1], press: on }; }
  if (st === 0xb0) return { what: 'CC ' + b[1] + ' = ' + b[2] + ' · ch ' + (ch + 1), k: 'cc:' + ch + ':' + b[1], press: true };
  if (st === 0xe0) return { what: 'Pitch bend ' + ((b[2] << 7) | b[1]) + ' · ch ' + (ch + 1) };
  if (st === 0xc0) return { what: 'Program change ' + b[1] + ' · ch ' + (ch + 1) };
  if (st === 0xa0 || st === 0xd0) return { what: 'Pressure · ch ' + (ch + 1) };
  return { what: 'Unknown' };
}
// Name of the control (profile names first) and what it drives now (null = nothing).
function monResolve(dev, k) {
  const d = midi.devs[dev], p = d && d.profile;
  if (p && typeof p.alias === 'function') k = p.alias(k) || k;
  const name = (p && typeof p.label === 'function' && p.label(k)) || (p && p.controls && (p.controls.find(c => c.key === k) || {}).label) || null;
  if (p && p.shift === k) return { k, name: name || 'Shift', act: 'Shift (second layer)' };
  if (p && p.overlayKey === k) return { k, name, act: 'Shows the controls overlay' };
  const m = ctlLookup(dev, k);
  return { k, name, act: m && m.id ? ctlNowLabel(m.id) : null };
}
function monAdd(e) {
  if (mon.paused) return;
  mon.log.push(e);
  if (mon.log.length > MON_MAX) mon.log.splice(0, mon.log.length - MON_MAX);
  monSoon();
}
function ctlMonIn(dev, bytes, key, val) {
  if (!mon.el || !mon.el.open) return;   // costs nothing while the monitor is closed
  if (bytes) {
    if (bytes[0] === 0xf8) { mon.clock++; monSoon(); return; }   // 24 a beat: counted, not listed
    const dec = monDecode(bytes), r = dec.k ? monResolve(dev, dec.k) : null;
    monAdd({ t: monTime(), dir: 'in', dev, bytes: hex(bytes), what: dec.what, name: r && r.name, act: r ? r.act : undefined, press: dec.press });
  } else {
    const r = monResolve(dev, key);
    monAdd({ t: monTime(), dir: 'in', dev, bytes: '', what: midiKeyLabel('x|' + key) + (val > 0 ? ' pressed' : ' released'), name: r.name, act: r.act, press: val > 0 });
  }
}
function ctlMonOut(dev, bytes) {
  if (!mon.el || !mon.el.open || !mon.out) return;
  const dec = monDecode(bytes), d = midi.devs[dev], p = d && d.profile;
  const name = dec.k && p && typeof p.label === 'function' ? p.label(dec.k) : null;
  monAdd({ t: monTime(), dir: 'out', dev, bytes: hex(bytes.length > 24 ? bytes.slice(0, 24) : bytes) + (bytes.length > 24 ? ' …' : ''), what: dec.what, name });
}
function monSoon() {
  if (mon.timer) return;
  mon.timer = setTimeout(() => { mon.timer = 0; monDraw(); }, 100);
}
function monLine(e) {
  const arrow = e.dir === 'in' ? '→' : '←', who = devLabel(e.dev);
  const tail = e.dir === 'out' ? (e.name ? 'light · ' + e.name : 'sent')
    : e.act === undefined ? '' : (e.name ? e.name + ': ' : '') + (e.act || (e.press ? 'drives nothing' : 'released'));
  return e.t + '  ' + (e.dir === 'in' ? 'IN ' : 'OUT') + '  ' + who + '  ' + (e.bytes ? e.bytes + '  ' : '') + e.what + (tail ? '  ' + arrow + ' ' + tail : '');
}
function monDraw() {
  if (!mon.list || !mon.el.isConnected || !mon.el.open) return;
  const rows = mon.log.slice(-120).reverse();
  mon.list.replaceChildren(...(rows.length ? rows.map(e => el('div', { className: 'mon-l ' + e.dir + (e.dir === 'in' && e.press && e.act === null ? ' none' : ''), textContent: monLine(e) }))
    : [el('div', { className: 'hint', textContent: midi.access || Object.keys(midi.devs).length ? 'Waiting: press a pad, move a fader or turn a knob.' : 'No MIDI yet: use Connect MIDI above, or press a button on a gamepad.' })]));
  mon.clockEl.hidden = !mon.clock;
  mon.clockEl.textContent = 'MIDI clock: ' + mon.clock + ' ticks received (24 a beat; counted, not listed)';
}
function monCopy() {
  const devs = Object.keys(midi.devs).map(d => '  ' + midi.devs[d].name + (midi.devs[d].profile ? ' (profile ' + midi.devs[d].profile.id + ')' : ' (no profile)') + (midi.devs[d].output ? ', output connected' : ', no output'));
  const text = ['Strodano VJ MIDI monitor, ' + new Date().toString(), 'Devices:', ...(devs.length ? devs : ['  none']), 'SysEx allowed: ' + (midi.sysex ? 'yes' : 'no'), 'MIDI clock ticks: ' + mon.clock, '', ...mon.log.map(monLine)].join('\n');
  const done = () => setStatus('MIDI monitor log copied: ' + mon.log.length + ' lines');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => monCopyFallback(text, done));
  else monCopyFallback(text, done);
}
function monCopyFallback(text, done) {
  const t = el('textarea', { value: text, style: { position: 'fixed', left: '-9999px' } });
  document.body.append(t); t.select();
  try { document.execCommand('copy'); done(); } catch (e) { setStatus('Copy did not work: select the log and copy it by hand'); }
  t.remove();
}
// Light test: the profile's ledTest(dev) messages are sent and held 3 s (ctlTick leaves the device alone meanwhile),
// then every LED is sent again from the app's state.
function ctlLedTest(dev) {
  const d = midi.devs[dev], p = d && d.profile;
  if (!d || !d.output || !p || typeof p.ledTest !== 'function') return;
  midi.ledHold[dev] = performance.now() + 3000;
  let n = 0;
  for (const m of p.ledTest(dev)) if (ctlSend(dev, m)) n++;
  setStatus('Light test on ' + d.name + ': ' + n + ' messages sent. ' + (p.ledTestHint || 'Every light should be on for 3 seconds.'));
  setTimeout(() => { delete midi.ledHold[dev]; for (const k in fb.sent) if (k.startsWith(dev + '|')) delete fb.sent[k]; }, 3000);
}
// The section (kept between redraws of the tab, so the log and its open state stay).
function ctlMonUI() {
  if (!mon.el) {
    mon.list = el('div', { className: 'mon-log', role: 'log', ariaLive: 'off' });
    mon.clockEl = el('div', { className: 'hint', hidden: true });
    mon.tools = el('div', { className: 'mon-tools' });
    mon.el = el('details', { className: 'mon' },
      el('summary', { textContent: 'MIDI monitor: see exactly what each controller sends' }),
      el('p', { className: 'hint', textContent: 'Every message from your controllers, and what it does in the app right now. Press each pad, button and knob once: a red line means that control drives nothing. Copy the log to send it for support.' }),
      mon.tools, mon.clockEl, mon.list);
    mon.el.addEventListener('toggle', () => { if (mon.el.open) { monTools(); monDraw(); } });
  }
  monTools();
  return mon.el;
}
function monTools() {
  const tools = [
    !midi.access && navigator.requestMIDIAccess ? el('button', { className: 'on', textContent: 'Connect MIDI', onclick: async () => { await connectMidi(); monTools(); monDraw(); } }) : null,
    el('button', { textContent: mon.paused ? 'Resume' : 'Pause', onclick: () => { mon.paused = !mon.paused; monTools(); } }),
    el('button', { textContent: 'Clear', onclick: () => { mon.log = []; mon.clock = 0; monDraw(); } }),
    el('button', { textContent: 'Copy log', title: 'Copy every line (and the connected devices) to paste into a message', onclick: monCopy }),
    el('label', { className: 'chk', title: 'Also list what the app sends to the devices (pad colours, button lights, knob rings)' },
      el('input', { type: 'checkbox', checked: mon.out, onchange: e => { mon.out = e.target.checked; } }), ' Show lights sent'),
  ];
  for (const dev of Object.keys(midi.devs)) {
    const p = midi.devs[dev].profile;
    if (p && typeof p.ledTest === 'function' && midi.devs[dev].output) tools.push(el('button', { textContent: 'Light test: ' + midi.devs[dev].name, title: p.ledTestHint || '', onclick: () => ctlLedTest(dev) }));
  }
  mon.tools.replaceChildren(...tools.filter(Boolean));
}
