// Strodano VJ (web) - DJ panel: two decks with waveforms and beat grids. GPL-3.0.
// The panel is built once and refreshed in place every frame (it is not part of the dirty-flag rebuilds in ui.js),
// so a waveform never causes the clip grid to be rebuilt.
'use strict';
const DJ_KEY = 'strodano-vj-dj';
const DJ_ZOOM = 8;   // seconds of music across the scrolling waveform
const djUI = { open: false, decks: [], loadFor: null };

function buildDeck(d) {
  const u = { d, ovFor: null, ov: document.createElement('canvas') };
  const btn = (text, title, mid, fn) => el('button', { textContent: text, title, dataset: { midi: 'deck:' + d.id + ':' + mid }, onclick: fn });
  u.name = el('span', { className: 'dn' });
  u.bpm = el('b'); u.time = el('span', { className: 'dt' }); u.rate = el('span', { className: 'dt' });
  u.wave = el('canvas');
  u.play = btn('Play', 'Play / pause', 'play', () => deckToggle(d));
  u.sync = btn('Sync', 'Follow the other deck: same tempo, beats and bars lined up', 'sync', () => deckSyncToggle(d));
  u.tempo = el('input', { type: 'range', min: 0, max: 1, step: 0.001, value: 0.5, title: 'Tempo, -8 % to +8 % (double-click to reset). Moving it turns Sync off.',
    dataset: { midi: 'deck:' + d.id + ':tempo' }, oninput: e => deckTempo(d, +e.target.value), ondblclick: () => deckTempo(d, 0.5) });
  u.vol = el('input', { type: 'range', min: 0, max: 1, step: 0.001, value: d.volume, title: 'Deck volume', dataset: { midi: 'deck:' + d.id + ':volume' }, oninput: e => { d.volume = +e.target.value; } });
  u.bass = el('input', { type: 'range', min: 0, max: 1, step: 0.001, value: d.bass, title: 'Bass: left kills it, middle leaves it alone (double-click to reset)', dataset: { midi: 'deck:' + d.id + ':bass' },
    oninput: e => { d.bass = +e.target.value; }, ondblclick: () => { d.bass = 0.5; } });
  u.cue = el('span', { className: 'dq' });
  u.root = el('div', { className: 'deck' },
    el('div', { className: 'dh' }, el('b', { className: 'did', textContent: d.id }), u.name, el('i', { className: 'dk', textContent: 'DRIVING VISUALS' }), u.cue, u.bpm, u.time),
    u.wave,
    el('div', { className: 'dc' },
      el('button', { textContent: 'Load...', title: 'Load a track (or drop an audio file on this deck)', onclick: () => { djUI.loadFor = d; $('trackInput').click(); } }),
      u.play, btn('Cue', 'Stop and go back to the first bar', 'cue', () => deckCue(d)), u.sync,
      el('button', { textContent: 'Bar 1', title: 'If the bright bar lines sit on the wrong beat: press this on the first beat of a bar', onclick: () => deckSetDownbeat(d) }),
      el('span', { textContent: 'Tempo' }), u.tempo, u.rate, el('span', { textContent: 'Bass' }), u.bass, el('span', { textContent: 'Vol' }), u.vol));
  dropTarget(u.root, hasFiles, e => {
    rememberDropped(e.dataTransfer);
    const f = [...e.dataTransfer.files].find(isAudioFile);
    if (f) deckLoad(d, f); else setStatus('Drop an audio file (MP3, WAV, FLAC, M4A...) on a deck');
  });
  // Click the scrolling waveform to jump relative to the playhead, or the overview strip underneath to jump anywhere.
  u.wave.addEventListener('pointerdown', e => {
    if (!d.buffer || (midi.learn)) return;
    const r = u.wave.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    deckSeek(d, fy > 0.7 ? fx * d.buffer.duration : deckPos(d) + (fx - 0.5) * DJ_ZOOM * d.rate);
  });
  return u;
}
function initDJ() {
  const root = $('dj');
  djUI.decks = audio.decks.map(buildDeck);
  const off = el('input', { type: 'number', min: -500, max: 500, step: 5, value: audio.offsetMs, title: 'Raise it if the visuals hit before the sound, lower it if they hit late',
    onchange: e => { audio.offsetMs = Math.min(500, Math.max(-500, +e.target.value || 0)); e.target.value = audio.offsetMs; try { localStorage.setItem(OFFSET_KEY, audio.offsetMs); } catch (err) {} } });
  root.append(...djUI.decks.map(u => u.root), buildMixer(), buildScore(), buildCues(), buildFollow(), buildCrate(), el('div', { className: 'df' },
    el('span', { textContent: 'The A/B crossfader below blends the two decks together with the layers set to A and B.' }),
    el('span', { style: { marginLeft: 'auto' }, textContent: 'Visual delay (ms)' }), off));
  $('trackInput').addEventListener('change', e => { const f = e.target.files[0]; if (f && djUI.loadFor) deckLoad(djUI.loadFor, f); e.target.value = ''; });
  initCrate(); hookLiveEvents(); initCueCapture();
  try { if (localStorage.getItem(DJ_KEY) === '1' && entCan('dj')) toggleDJ(true); } catch (e) {}
}
function toggleDJ(on) {
  if (on && !entGate('dj')) on = false;
  djUI.open = on;
  $('dj').hidden = !on;
  $('djBtn').classList.toggle('on', on);
  $('app').classList.toggle('djopen', on);
  try { localStorage.setItem(DJ_KEY, on ? '1' : '0'); } catch (e) {}
}

const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const setText = (e, s) => { if (e.textContent !== s) e.textContent = s; };
const waveCol = low => `hsl(${THEME.hue} ${Math.round((4 + 50 * low) * THEME.sat)}% ${Math.round(56 + 4 * low)}%)`;   // grey for highs, theme accent for bass
// Whole-track strip, drawn once per analysis.
function buildOverview(u) {
  const i = u.d.info, c = u.ov, W = 900, H = 40;
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  const per = i.peaks.length / W;
  for (let px = 0; px < W; px++) {
    let pk = 0, lo = 0, n = 0;
    for (let k = Math.floor(px * per), e = Math.max(k + 1, Math.floor((px + 1) * per)); k < e && k < i.peaks.length; k++) { if (i.peaks[k] > pk) pk = i.peaks[k]; lo += i.lows[k]; n++; }
    const h = Math.max(1, pk * H);
    x.fillStyle = waveCol(n ? lo / n : 0);
    x.fillRect(px, (H - h) / 2, 1, h);
  }
  // song sections as a coloured band along the bottom
  for (const s of segmentsOf(u.d) || []) { x.fillStyle = sectionCol(s.type); x.fillRect(s.t / i.duration * W, H - 4, s.bars * i.barLen / i.duration * W, 4); }
  u.ovFor = i; u.ovVer = seg.ver;   // drawn again when the segments are edited (segments.js)
}
const sectionCol = t => (t === 'drop' ? THEME.acc : t === 'build' ? '#d9a531' : t === 'breakdown' ? '#4f86d9' : '#5a5a5a');
function drawDeck(u) {
  const d = u.d, cv = u.wave, dpr = window.devicePixelRatio || 1;
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const x = cv.getContext('2d'), i = d.info, zh = Math.round(H * 0.7), oh = H - zh - Math.round(3 * dpr), oy = H - oh;
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  if (!i) {
    x.fillStyle = '#888'; x.font = 12 * dpr + 'px Inter, system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText(d.state === 'loading' ? 'Reading the file...' : d.state === 'analysing' ? 'Finding the beat...' : d.state === 'error' ? 'Could not read that file' : 'Drop a track here, or press Load', W / 2, H / 2);
    return;
  }
  if (u.ovFor !== i || u.ovVer !== seg.ver) buildOverview(u);
  const pos = deckHeard(d), span = DJ_ZOOM * d.rate, t0 = pos - span / 2, perPx = span * i.fps / W, mid = zh / 2;
  // scrolling waveform
  for (let px = 0; px < W; px++) {
    const a = Math.floor((t0 * i.fps) + px * perPx), b = Math.max(a + 1, Math.floor((t0 * i.fps) + (px + 1) * perPx));
    if (b <= 0 || a >= i.peaks.length) continue;
    let pk = 0, lo = 0;
    for (let k = Math.max(0, a); k < b && k < i.peaks.length; k++) if (i.peaks[k] > pk) { pk = i.peaks[k]; lo = i.lows[k]; }
    const h = Math.max(1, pk * zh * 0.96);
    x.fillStyle = waveCol(lo);
    x.fillRect(px, mid - h / 2, 1, h);
  }
  // beat grid: every beat a faint line, the first beat of each bar a bright one
  if (i.ok) {
    for (let k = Math.ceil((t0 - i.grid0) / i.beatLen), t; (t = i.grid0 + k * i.beatLen) < t0 + span; k++) {
      const px = Math.round((t - t0) / span * W), bar = ((k % 4) + 4) % 4 === 0;
      x.fillStyle = bar ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.22)';
      x.fillRect(px, bar ? 0 : zh * 0.2, Math.max(1, Math.round((bar ? 1.5 : 1) * dpr)), bar ? zh : zh * 0.6);
    }
  }
  // mix-in and outro markers: a flag at the top of the waveform
  const flag = (t, label) => {
    if (t === undefined || t < t0 || t > t0 + span) return;
    const px = Math.round((t - t0) / span * W);
    x.fillStyle = THEME.acc; x.fillRect(px, 0, Math.max(1, Math.round(2 * dpr)), zh);
    x.font = '600 ' + 10 * dpr + 'px Inter, system-ui, sans-serif'; x.textAlign = 'left';
    const w = x.measureText(label).width + 8 * dpr;
    x.fillRect(px, 0, w, 14 * dpr); x.fillStyle = '#000'; x.fillText(label, px + 4 * dpr, 10.5 * dpr);
  };
  if (i.ok) { flag(inPoint(d), 'MIX IN'); flag(outPoint(d), 'OUTRO'); }
  // track score cues: short ticks along the top, taller for buttons than for fader moves
  const cl = i.ok && cuesFor(d);
  if (cl) { x.fillStyle = 'rgba(255,255,255,.75)'; for (const e of cl) { const t = i.grid0 + e.b * i.beatLen; if (t >= t0 && t <= t0 + span) x.fillRect(Math.round((t - t0) / span * W), 0, Math.max(1, dpr), (e.v === undefined ? 10 : 4) * dpr); } }
  // sections under the scrolling waveform, named where each one starts
  for (const s of segmentsOf(d) || []) {
    if (s.end < t0 || s.t > t0 + span) continue;
    const a = Math.max(0, (s.t - t0) / span * W), b = Math.min(W, (s.end - t0) / span * W);
    x.fillStyle = sectionCol(s.type); x.fillRect(a, zh - 3 * dpr, b - a, 3 * dpr);
    if (s.t >= t0) { x.font = '600 ' + 9 * dpr + 'px Inter, system-ui, sans-serif'; x.textAlign = 'left'; x.fillText(SECTION_NAMES[s.type].toUpperCase(), a + 3 * dpr, zh - 6 * dpr); }
  }
  x.fillStyle = THEME.acc; x.fillRect(Math.round(W / 2) - dpr, 0, 2 * dpr, zh);
  // overview strip with the played part dimmed
  const f = Math.min(1, Math.max(0, pos / i.duration));
  x.drawImage(u.ov, 0, oy, W, oh);
  x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, oy, f * W, oh);
  x.fillStyle = THEME.acc; x.fillRect(Math.round(f * W) - dpr, oy, 2 * dpr, oh);
  if (i.ok) for (const t of [inPoint(d), outPoint(d)]) { x.fillStyle = 'rgba(255,255,255,.7)'; x.fillRect(Math.round(t / i.duration * W), oy, Math.max(1, dpr), oh); }
}
// Called from tickUI every frame the control window is visible.
function tickDJ() {
  const clock = audio.clockDeck;
  if (clock && document.activeElement !== $('bpm')) { const s = comp.bpm.toFixed(1); if ($('bpm').value !== s) $('bpm').value = s; }
  if (!djUI.open) return;
  tickMixUI(); tickCrate(); tickScoreUI(); tickCuesUI(); tickFollowUI(); tickSegmentsUI();
  for (const u of djUI.decks) {
    const d = u.d, i = d.info;
    setText(u.name, d.name || 'Empty');
    const t = i && d.file && crate.tracks.find(x => x.key === fileKey(d.file));
    setText(u.bpm, i ? (i.ok ? (i.bpm * d.rate).toFixed(1) + ' BPM' : 'no beat') + (i.camelot ? '  ' + i.camelot : '') + (t ? '  E' + t.energy : '') : '');
    let q = '';
    if (d.playing && i && i.ok && outPoint(d)) { const bars = Math.floor((deckBeats(d, outPoint(d)) - deckBeats(d, deckHeard(d))) / 4); q = bars > 0 && bars <= 32 ? 'outro in ' + bars : bars <= 0 && deckHeard(d) < i.beatEnd ? 'outro' : ''; }
    // a drop coming up beats the outro countdown: that is what the visuals should get ready for
    if (d.playing) { const da = dropAhead(d); if (da !== null && da > 0 && da <= 16) q = 'drop in ' + Math.ceil(da); else if (da === 0) q = 'drop'; }
    setText(u.cue, q);
    setText(u.time, d.buffer ? mmss(Math.max(0, deckHeard(d))) + ' / ' + mmss(d.buffer.duration) : '');
    setText(u.rate, (d.rate >= 1 ? '+' : '') + ((d.rate - 1) * 100).toFixed(1) + '%');
    setText(u.play, d.playing ? 'Pause' : 'Play');
    u.play.classList.toggle('on', d.playing);
    u.sync.classList.toggle('on', d.sync);
    u.root.classList.toggle('clock', clock === d);
    if (document.activeElement !== u.tempo) u.tempo.value = 0.5 + (d.rate - 1) / 0.16;
    if (document.activeElement !== u.vol) u.vol.value = d.volume;
    if (document.activeElement !== u.bass) u.bass.value = d.bass;
    drawDeck(u);
  }
}
