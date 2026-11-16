// Strodano VJ (web) - one place to make any slider follow something: the input chip and its picker. GPL-3.0.
// Every modulatable slider (effect and generator parameters, text and 3D clip sliders) gets a chip on its row. The chip says
// what drives the slider ("~" when nothing does) and fills with the live value. Clicking it opens a picker with every source:
// Beat (LFO), Music (DJ decks), Camera input, Hands, plus a MIDI knob. "Detect" watches all sources while you move and picks
// the one that moved most. The data stays in owner.mod[k] (motion.js: src, shape, rate, depth, inv, follow) and midi.map.
'use strict';
const INPUT_GROUPS = [
  ['Beat', ['lfo']],
  ['Camera', ['cmotion', 'camx', 'camy', 'clight']],
  ['Hands', ['hx', 'hy', 'pinch', 'hopen', 'hsize', 'hspread', 'hseen']],
];   // every other MOD_SOURCES entry (kick, bass, build, mix...) is shown under Music
const SRC_ICON = { Beat: '◷', Music: '♪', Camera: '◉', Hands: '✋' };
const FOLLOW_BY_DEFAULT = new Set(['camx', 'camy', 'hx', 'hy', 'pinch', 'hopen', 'hsize', 'hspread']);
const srcName = s => (MOD_SOURCES.find(x => x[0] === s) || [s, s])[1];
// Short names inside their group (the group already says Camera / Hands).
const SHORT = { cmotion: 'Motion', camx: 'X', camy: 'Y', clight: 'Light', hx: 'X', hy: 'Y', pinch: 'Pinch', hopen: 'Open hand', hsize: 'Closeness', hspread: 'Two hands apart', hseen: 'Hand seen' };
const srcShort = s => SHORT[s] || srcName(s);
const srcGroup = s => (INPUT_GROUPS.find(g => g[1].includes(s)) || ['Music'])[0];
function inputGroups() {
  const known = new Set(INPUT_GROUPS.flatMap(g => g[1]));
  const music = MOD_SOURCES.map(s => s[0]).filter(s => !known.has(s));
  return [INPUT_GROUPS[0], ['Music', music], INPUT_GROUPS[1], INPUT_GROUPS[2]];
}
const inp = { pop: null, detect: null, oneShotMidi: false };

// ---------- the chip on a slider row ----------
function chipText(owner, k, midiId) {
  const m = owner.mod && owner.mod[k], hasMidi = midiId && Object.values(midi.map).includes(midiId);
  if (!m && !hasMidi) return '~';
  const s = m ? (m.src || 'lfo') : null;
  const label = m ? SRC_ICON[srcGroup(s)] + ' ' + (s === 'lfo' ? 'LFO' : srcShort(s)) : '';
  return [label, hasMidi ? 'MIDI' : ''].filter(Boolean).join(' + ');
}
function inputChip(owner, k, row) {
  const id = row.slider && row.slider.dataset.midi, name = (row.querySelector('label') || {}).textContent || 'Parameter';
  const b = el('button', { className: 'in-chip', title: 'Make this slider follow the beat, the music, the camera, your hands or a MIDI knob',
    onclick: e => { e.stopPropagation(); openPicker(owner, k, name, id, b); } });
  b.textContent = chipText(owner, k, id);
  lfoMeters.push({ b, owner, k, id });
  row.append(b);
  return row;
}
function tickInputs() {
  for (const t of lfoMeters) {
    const m = t.owner.mod && t.owner.mod[t.k], txt = chipText(t.owner, t.k, t.id);
    if (t.b.textContent !== txt) t.b.textContent = txt;
    t.b.classList.toggle('on', txt !== '~');
    t.b.style.setProperty('--v', m ? modValue(t.owner.params, t.owner.mod, t.k).toFixed(3) : 0);
  }
  if (inp.pop) tickPicker();
  if (inp.oneShotMidi && midi.learn && !midi.target) { inp.oneShotMidi = false; setMidiLearn(false); if (inp.pop) inp.pop.redraw(); }
}

// ---------- the picker ----------
function closePicker() { if (inp.pop) { inp.pop.el.remove(); inp.pop = null; } inp.detect = null; }
function openPicker(owner, k, name, midiId, anchor) {
  closePicker();
  const box = el('div', { className: 'in-pop' });
  inp.pop = { el: box, owner, k, name, midiId, bars: [], redraw: null, out: null };
  const ensure = () => { owner.mod = owner.mod || {}; return owner.mod[k] || (owner.mod[k] = { shape: 0, rate: 4, depth: 0.6 }); };
  const choose = s => {
    const m = ensure();
    if (s === 'lfo') delete m.src; else m.src = s;
    m.follow = FOLLOW_BY_DEFAULT.has(s);
    if (m.follow && !(m.depth > 0.9)) m.depth = 1;
    draw();
  };
  const draw = () => {
    const m = owner.mod && owner.mod[k], cur = m ? (m.src || 'lfo') : null;
    inp.pop.bars = [];
    box.textContent = '';
    box.append(el('div', { className: 'in-hd' }, el('b', { textContent: name }), el('span', { className: 'hint', textContent: 'follows' }),
      el('button', { textContent: '×', title: 'Close (Esc)', onclick: closePicker })));
    for (const [g, list] of inputGroups()) {
      if (!list.length) continue;
      const row = el('div', { className: 'in-grp' }, el('span', { className: 'in-gl', textContent: SRC_ICON[g] + ' ' + g }));
      for (const s of list) {
        const i = el('i');
        if (s !== 'lfo') inp.pop.bars.push({ i, s });
        row.append(el('button', { className: 'in-src' + (s === cur ? ' on' : ''), title: s === 'lfo' ? 'A wave in time with the beat' : 'Live: the bar shows its value now',
          onclick: () => choose(s) }, s === 'lfo' ? 'Beat LFO' : srcShort(s), el('span', { className: 'in-lvl' }, i)));
      }
      box.append(row);
    }
    box.append(el('div', { className: 'in-row' },
      el('button', { className: 'in-detect' + (inp.detect ? ' on' : ''), textContent: inp.detect ? 'Move now...' : 'Detect',
        title: 'Start, then do the movement (hand, body, music) you want this slider to follow; the source that moved most is picked',
        onclick: startDetect }),
      el('span', { className: 'hint', textContent: 'Press Detect, then move your hand or body for 3 seconds.' })));
    if (m) {
      if (cur === 'lfo') box.append(
        el('div', { className: 'in-row' }, ...LFO_SHAPES.map((n, i) => el('button', { className: 'in-opt' + (i === m.shape ? ' on' : ''), textContent: n, onclick: () => { m.shape = i; draw(); } }))),
        el('div', { className: 'in-row' }, el('span', { className: 'in-gl', textContent: 'One wave lasts' }),
          ...BEAT_LENGTHS.map(([v, n]) => el('button', { className: 'in-opt' + (v === m.rate ? ' on' : ''), textContent: n, onclick: () => { m.rate = v; draw(); } }))));
      const amt = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: m.depth, oninput: e => { m.depth = +e.target.value; } });
      inp.pop.out = el('i');
      box.append(
        el('div', { className: 'in-row' }, el('span', { className: 'in-gl', textContent: 'Amount' }), amt),
        el('div', { className: 'in-row' },
          el('button', { className: 'in-opt' + (!m.follow ? ' on' : ''), textContent: cur === 'lfo' ? 'Swing around the slider' : 'Push up from the slider', onclick: () => { m.follow = false; draw(); } }),
          el('button', { className: 'in-opt' + (m.follow ? ' on' : ''), textContent: 'Follow it', title: 'At full Amount the slider goes exactly where the input is', onclick: () => { m.follow = true; draw(); } }),
          el('label', { className: 'chk' }, el('input', { type: 'checkbox', checked: !!m.inv, onchange: e => { m.inv = e.target.checked; } }), ' Invert')),
        el('div', { className: 'in-row' }, el('span', { className: 'in-gl', textContent: 'Now' }), el('span', { className: 'in-out' }, inp.pop.out)));
    }
    // a MIDI knob can drive the same slider directly (set mode); it is learnt from here without entering Map mode
    if (midiId) {
      const key = Object.keys(midi.map).find(x => midi.map[x] === midiId);
      box.append(el('div', { className: 'in-row' }, el('span', { className: 'in-gl', textContent: '🎛 MIDI' }),
        key ? el('span', { textContent: midiKeyLabel(key) }) : null,
        key ? el('button', { textContent: 'Remove', onclick: () => { delete midi.map[key]; saveMidiMap(); draw(); } })
          : el('button', { className: midi.learn && midi.target === midiId ? 'on' : '', textContent: midi.learn && midi.target === midiId ? 'Move a knob...' : 'Learn a knob',
            onclick: async () => { await setMidiLearn(true); midi.target = midiId; inp.oneShotMidi = true; markMidi(); setStatus('Move a knob or fader on your MIDI controller for ' + name); draw(); } })));
    }
    if (m) box.append(el('div', { className: 'in-row end' }, el('button', { textContent: 'Unlink', title: 'The slider stops following anything', onclick: () => { delete owner.mod[k]; if (!Object.keys(owner.mod).length) owner.mod = undefined; draw(); } })));
  };
  inp.pop.redraw = draw;
  draw();
  document.body.append(box);
  const r = anchor.getBoundingClientRect(), w = Math.min(420, innerWidth - 16);
  box.style.width = w + 'px';
  box.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  const h = box.offsetHeight, below = r.bottom + 6;
  box.style.top = (below + h < innerHeight - 8 ? below : Math.max(8, r.top - h - 6)) + 'px';
}
function tickPicker() {
  const p = inp.pop;
  if (!p.el.isConnected) { inp.pop = null; return; }
  for (const b of p.bars) b.i.style.width = (sourceValue(b.s) * 100).toFixed(0) + '%';
  if (p.out) p.out.style.width = (modValue(p.owner.params, p.owner.mod || {}, p.k) * 100).toFixed(1) + '%';
  const d = inp.detect;
  if (d) {
    const age = performance.now() - d.t0;
    // the first 0.4 s is ignored: a hand entering the picture makes every hand value jump once, which is not the movement meant
    if (age > 400) for (const s of d.list) { const v = sourceValue(s); if (!(s in d.min)) { d.min[s] = d.max[s] = v; } d.min[s] = Math.min(d.min[s], v); d.max[s] = Math.max(d.max[s], v); }
    if (age > 3400) {
      inp.detect = null;
      let best = null, range = 0.15;
      for (const s of d.list) if (d.max[s] - d.min[s] > range) { range = d.max[s] - d.min[s]; best = s; }
      if (best) { p.owner.mod = p.owner.mod || {}; const m = p.owner.mod[p.k] || (p.owner.mod[p.k] = { shape: 0, rate: 4, depth: 0.6 }); m.src = best; m.follow = FOLLOW_BY_DEFAULT.has(best); if (m.follow) m.depth = 1; setStatus(p.name + ' now follows ' + srcName(best)); }
      else setStatus('Nothing moved enough. Turn on the camera input or Track hands (Sources tab), or play a track, then try again.');
      p.redraw();
    }
  }
}
function startDetect() {
  // on / off sources (a hand appearing, a song section starting) would always look like the biggest movement, so they are left out
  const list = MOD_SOURCES.map(s => s[0]).filter(s => !['lfo', 'hseen', 'build', 'drop'].includes(s));
  inp.detect = { t0: performance.now(), list, min: {}, max: {} };
  if (inp.pop) inp.pop.redraw();
}
document.addEventListener('pointerdown', e => { if (inp.pop && !inp.pop.el.contains(e.target) && !e.target.closest('.in-chip')) closePicker(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && inp.pop) closePicker(); });
