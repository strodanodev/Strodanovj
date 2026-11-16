// Strodano VJ (web) - beat-synced motion: LFOs on effect / generator parameters, and the beat lengths used by clip transitions. GPL-3.0.
// Everything runs on comp.beats, so it follows tap tempo, or the music itself while a DJ deck plays.
// An LFO lives on the effect or generator clip as owner.mod = { <param index>: { shape, rate (beats per cycle), depth } }
// and is saved with the composition. The slider stays the centre value; the LFO swings around it by +/- depth / 2.
// A modulator can instead follow the music (src: kick, bass, mid, high, level from audioFeat; build, drop from musicFeat in
// score.js). Those start at the slider value and push it up by up to depth.
'use strict';
const LFO_SHAPES = ['Sine', 'Triangle', 'Saw up', 'Saw down', 'Square', 'Random'];
const BEAT_LENGTHS = [[0.25, '1/4 beat'], [0.5, '1/2 beat'], [1, '1 beat'], [2, '2 beats'], [4, '1 bar'], [8, '2 bars'], [16, '4 bars']];
const TRANSITIONS = [[0, 'Cut'], ...BEAT_LENGTHS];
const MOD_SOURCES = [['lfo', 'Beat LFO'], ['kick', 'Kick'], ['bass', 'Bass'], ['mid', 'Mids'], ['high', 'Highs'], ['level', 'Loudness'], ['build', 'Build-up'], ['drop', 'In drop'],
  ['cmotion', 'Camera motion'], ['camx', 'Camera X'], ['camy', 'Camera Y'], ['clight', 'Camera light'],   // camera input, camera.js
  ['mix', 'Mix progress'], ['midmix', 'Mid-mix']];   // during an auto-mix (mix.js, score.js)
const CAM_SOURCES = { cmotion: 'motion', camx: 'x', camy: 'y', clight: 'bright' };
// 0..1 from the music (or the camera input) right now.
function sourceValue(src) {
  if (CAM_SOURCES[src]) return typeof camFeat !== 'undefined' ? camFeat[CAM_SOURCES[src]] : 0;
  if (typeof musicFeat !== 'undefined' && src in musicFeat) return musicFeat[src];   // song structure and mixing (score.js)
  return audioFeat[src] || 0;
}

const hash1 = n => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
// 0..1, one cycle per `rate` beats. Random holds a new value for each cycle (different for each parameter).
function lfoWave(m, k) {
  const cyc = comp.beats / m.rate, ph = cyc - Math.floor(cyc);
  switch (m.shape) {
    case 1: return 1 - Math.abs(ph * 2 - 1);
    case 2: return ph;
    case 3: return 1 - ph;
    case 4: return ph < 0.5 ? 1 : 0;
    case 5: return hash1(Math.floor(cyc) * 7.31 + k * 1.7);
    default: return 0.5 - 0.5 * Math.cos(ph * 6.2831853);
  }
}
function modValue(params, mod, k) {
  const base = params[k] ?? 0, m = mod && mod[k];
  if (!m || !m.depth) return base;
  if (m.src && m.src !== 'lfo') return Math.min(1, Math.max(0, base + sourceValue(m.src) * m.depth));
  return Math.min(1, Math.max(0, base + (lfoWave(m, +k) * 2 - 1) * m.depth * 0.5));
}
// The values a shader should get this frame. Returns the same array when nothing is modulated (no allocation).
function modParams(params, mod) {
  if (!mod) return params;
  let out = null;
  for (const k in mod) { if (!out) out = params.slice(); out[k] = modValue(params, mod, k); }
  return out || params;
}
function loadMod(j) {
  if (!j || typeof j !== 'object') return undefined;
  const out = {};
  for (const k in j) {
    const m = j[k], i = +k;
    if (!m || !(i >= 0 && i < 8)) continue;
    const rate = BEAT_LENGTHS.some(b => b[0] === m.rate) ? m.rate : 4;
    out[i] = { shape: Math.min(LFO_SHAPES.length - 1, Math.max(0, m.shape | 0)), rate, depth: Math.min(1, Math.max(0, +m.depth || 0)) };
    if (MOD_SOURCES.some(s => s[0] === m.src) && m.src !== 'lfo') out[i].src = m.src;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------- UI: the ~ button on a parameter row, and the LFO row under it ----------
const lfoMeters = [];   // rebuilt with the properties panel; moved every frame by tickLfoMeters()
function lfoControls(owner, k, row) {
  const m = owner.mod && owner.mod[k];
  row.append(el('button', { className: 'lfo-btn' + (m ? ' on' : ''), textContent: '~', title: m ? 'Stop moving this parameter' : 'Move this parameter with the beat or the music (kick, bass, build-up, drop...)',
    onclick: () => {
      if (m) { delete owner.mod[k]; if (!Object.keys(owner.mod).length) owner.mod = undefined; }
      else { owner.mod = owner.mod || {}; owner.mod[k] = { shape: 0, rate: 4, depth: 0.5 }; }   // a beat LFO to start with; the first list switches to a music source
      ui.propsDirty = true;
    } }));
  if (!m) return [row];
  const bar = el('i');
  lfoMeters.push({ bar, owner, k });
  const isLfo = !m.src || m.src === 'lfo';
  const sub = el('div', { className: 'fld lfo' },
    el('select', { title: 'What moves this parameter: a beat LFO, or the music itself (Build-up and In drop follow the song sections)',
      onchange: e => { if (e.target.value === 'lfo') delete m.src; else m.src = e.target.value; ui.propsDirty = true; } },
      ...MOD_SOURCES.map(([v, n]) => el('option', { value: v, textContent: n, selected: v === (m.src || 'lfo') }))),
    isLfo ? el('select', { title: 'Shape', onchange: e => { m.shape = +e.target.value; } }, ...LFO_SHAPES.map((n, i) => el('option', { value: i, textContent: n, selected: i === m.shape }))) : null,
    isLfo ? el('select', { title: 'One cycle lasts', onchange: e => { m.rate = +e.target.value; } }, ...BEAT_LENGTHS.map(([v, n]) => el('option', { value: v, textContent: n, selected: v === m.rate }))) : null,
    el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: m.depth, title: isLfo ? 'Depth' : 'How far the music pushes the value up', oninput: e => { m.depth = +e.target.value; } }),
    el('span', { className: 'lfo-meter', title: 'Value now' }, bar));
  return [row, sub];
}
function tickLfoMeters() {
  for (const t of lfoMeters) if (t.owner.mod) t.bar.style.width = (modValue(t.owner.params, t.owner.mod, t.k) * 100).toFixed(1) + '%';
}
// Layer tab: how long a newly triggered clip takes to fade in over the old one.
function transitionField(L) {
  return el('div', { className: 'fld' }, el('label', { textContent: 'Transition', title: 'How a newly triggered clip replaces the old one on this layer, and how long it takes in beats' }),
    el('select', { title: 'Transition type', onchange: e => { L.transType = +e.target.value; } }, ...TRANSITION_TYPES.map((n, i) => el('option', { value: i, textContent: n, selected: i === (L.transType | 0) }))),
    el('select', { title: 'Length', onchange: e => { L.trans = +e.target.value; } }, ...TRANSITIONS.map(([v, n]) => el('option', { value: v, textContent: n, selected: v === L.trans }))));
}
