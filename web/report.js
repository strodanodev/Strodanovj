// Strodano VJ (web) - track analysis report: run DJ mode's analysis (analysis.js) on your own tracks, listen to what it
// found, mark what is wrong, and export the marks for tuning. Stand-alone page: it loads nothing else from the app.
// GPL-3.0.
'use strict';
const $ = id => document.getElementById(id);
const AUDIO_RE = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|aiff?|weba)$/i;
const MARKS_KEY = 'strodano-vj-report-marks';
const SEC_NAMES = { intro: 'Intro', build: 'Build', drop: 'Drop', breakdown: 'Breakdown', outro: 'Outro' };
const SEC_COL = { intro: '#666', outro: '#666', build: '#e0b23a', drop: '#cc6688', breakdown: '#4f86d9' };
const tracks = [];   // { key, file, name, state: queued|analysing|ready|error, info, err }
let busy = false, sel = null, marks = {};
try { marks = JSON.parse(localStorage.getItem(MARKS_KEY) || '{}') || {}; } catch (e) {}
const saveMarks = () => { try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch (e) {} };
// Marks follow the file by name and length, so they come back when the same tracks are added again.
const fileKey = f => f.name + '|' + f.size;
const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) { if (k === 'style') Object.assign(e.style, props[k]); else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]); else e[k] = props[k]; }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

// ---------- adding and analysing ----------
function addFiles(files) {
  let n = 0;
  for (const f of files) {
    if (!(f.type.startsWith('audio') || AUDIO_RE.test(f.name)) || tracks.some(t => t.key === fileKey(f))) continue;
    tracks.push({ key: fileKey(f), file: f, name: f.name.replace(/\.[^.]+$/, ''), state: 'queued', info: null });
    n++;
  }
  if (n) { renderRows(); analyseQueue(); }
}
async function filesInFolder(dir, depth = 0, out = []) {
  for await (const h of dir.values()) {
    if (h.kind === 'directory') { if (depth < 4 && !h.name.startsWith('.')) await filesInFolder(h, depth + 1, out); }
    else if (AUDIO_RE.test(h.name)) out.push(await h.getFile());
  }
  return out;
}
// Drag and drop of a folder: walk its entries.
async function filesFromEntry(entry, out = []) {
  if (entry.isFile) await new Promise(r => entry.file(f => { out.push(f); r(); }, r));
  else if (entry.isDirectory) {
    const rd = entry.createReader();
    for (let batch; (batch = await new Promise(r => rd.readEntries(r, () => r([])))).length;) for (const e of batch) await filesFromEntry(e, out);
  }
  return out;
}
// One at a time: a decoded six-minute track is over 100 MB.
async function analyseQueue() {
  if (busy) return;
  busy = true;
  for (let t; (t = tracks.find(x => x.state === 'queued'));) {
    t.state = 'analysing'; renderRows();
    try {
      const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await t.file.arrayBuffer());
      const n = buf.length, mono = new Float32Array(n), g = 1 / buf.numberOfChannels;
      for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += x[i] * g; }
      const t0 = performance.now();
      t.info = await analyseAsync(mono, buf.sampleRate);
      t.ms = Math.round(performance.now() - t0);
      t.state = 'ready';
    } catch (e) { t.state = 'error'; t.err = String(e && e.message || e); }
    renderRows();
    if (sel === t) renderDetail();
  }
  busy = false;
  renderRows();
}

// ---------- the table ----------
const markOf = t => marks[t.key] || (marks[t.key] = {});
function verdictCell(t) {
  const m = marks[t.key] || {}, parts = ['bpm', 'grid', 'key', 'sections', 'outro'].filter(k => m[k]);
  if (!parts.length) return el('span', { className: 'v none', textContent: '-' });
  const bad = parts.filter(k => m[k] !== 'ok');
  return el('span', { className: 'v ' + (bad.length ? 'bad' : 'ok'), textContent: bad.length ? bad.join(', ') : 'all OK', title: parts.map(k => k + ': ' + m[k]).join('\n') });
}
function renderRows() {
  const tb = $('rows');
  tb.textContent = '';
  for (const t of tracks) {
    const i = t.info, ok = i && i.ok;
    const secs = i && i.sections ? i.sections.filter(s => s.type === 'drop').length + ' drops, ' + i.sections.filter(s => s.type === 'breakdown').length + ' breakdowns' : '';
    const tr = el('tr', { className: 'row' + (sel === t ? ' sel' : ''), onclick: () => select(t) },
      el('td', { className: 'name', textContent: t.name, title: t.file.name }),
      el('td', { className: 'num' + (i && !ok ? ' lowconf' : ''), textContent: t.state === 'ready' ? (ok ? i.bpm.toFixed(2) : 'no beat') : t.state === 'error' ? 'error' : t.state === 'analysing' ? '...' : '' }),
      el('td', { className: 'num hide' + (i && i.conf < 3 ? ' lowconf' : ''), textContent: i ? i.conf.toFixed(1) : '', title: 'Beat grid confidence: how sharply the beats line up (below about 3 is shaky)' }),
      el('td', { textContent: i ? (i.camelot ? i.camelot + ' ' + i.key : '?') : '', className: i && i.keyConf < 0.03 ? 'lowconf' : '', title: i && i.keyConf !== undefined ? 'Key confidence ' + i.keyConf.toFixed(3) + ' (below 0.03 is a guess)' : '' }),
      el('td', { className: 'num hide', textContent: i ? (i.loudDb.toFixed(1) + ' dB') : '', title: i ? 'Loudness ' + i.loudDb.toFixed(1) + ' dB, drum activity ' + i.flux.toFixed(1) : '' }),
      el('td', { className: 'num hide', textContent: i ? mmss(i.duration) : '' }),
      el('td', { className: 'num hide', textContent: ok ? mmss(i.mixIn) : '' }),
      el('td', { className: 'num', textContent: ok ? mmss(i.mixOut) : '' }),
      el('td', { textContent: secs }),
      el('td', null, i ? verdictCell(t) : null));
    tb.append(tr);
  }
  const ready = tracks.filter(t => t.info), marked = tracks.filter(t => marks[t.key] && Object.keys(marks[t.key]).some(k => k !== 'note' || marks[t.key].note));
  $('sum').textContent = tracks.length ? `${ready.length} of ${tracks.length} analysed, ${marked.length} marked` + (busy ? ', analysing...' : '') : 'Drop your own tracks to check what DJ mode hears in them.';
  $('export').disabled = !ready.length;
  $('drop').hidden = tracks.length > 0;
}

// ---------- the detail panel: waveform, sections, listening, marks ----------
const player = { ctx: null, buf: null, bufFor: null, src: null, t0: 0, offset: 0, playing: false, clicks: true, clickGain: null, nextBeat: 0, timer: 0, raf: 0 };
function select(t) {
  if (sel === t) return;
  stop(); sel = t; player.buf = null; player.bufFor = null;
  renderRows(); renderDetail();
}
function renderDetail() {
  const d = $('detail'), t = sel;
  d.hidden = !t;
  if (!t) return;
  d.textContent = '';
  const i = t.info;
  d.append(el('h2', { textContent: t.name }));
  if (!i) { d.append(el('div', { className: 'hint', textContent: t.state === 'error' ? 'Could not read this file: ' + t.err : 'Analysing...' })); return; }
  const cv = el('canvas', { className: 'wave' });
  player.cv = cv;
  cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(); play(((e.clientX - r.left) / r.width) * i.duration); });
  d.append(
    el('div', { className: 'legend' },
      el('span', null, el('i', { style: { background: '#fff' } }), 'first beat of each bar'),
      el('span', null, el('i', { style: { background: '#cc6688' } }), 'mix in / outro'),
      ...Object.keys(SEC_COL).filter(k => k !== 'outro').map(k => el('span', null, el('i', { style: { background: SEC_COL[k] } }), SEC_NAMES[k] + (k === 'intro' ? ' / Outro' : '')))),
    cv);
  player.playBtn = el('button', { textContent: 'Play', onclick: () => (player.playing ? stop() : play(player.offset)) });
  player.clickBtn = el('button', { className: player.clicks ? 'on' : '', textContent: 'Beat clicks', title: 'A click on every beat the analysis found, higher on the first beat of each bar. They should sit exactly on the kick.', onclick: () => { player.clicks = !player.clicks; player.clickBtn.classList.toggle('on', player.clicks); if (player.clickGain) player.clickGain.gain.value = player.clicks ? 0.5 : 0; } });
  player.pos = el('span', { className: 'dim' });
  d.append(el('div', { className: 'ctl' }, player.playBtn,
    el('button', { textContent: 'From mix in', disabled: !i.ok, onclick: () => play(Math.max(0, i.mixIn - 0.05)) }),
    el('button', { textContent: 'From outro', disabled: !i.ok, onclick: () => play(Math.max(0, i.mixOut - 4 * i.barLen)) }),
    player.clickBtn, player.pos,
    el('span', { className: 'dim', textContent: i.ok ? `${i.bpm.toFixed(2)} BPM, first bar at ${i.grid0.toFixed(3)} s, grid confidence ${i.conf.toFixed(1)}, analysed in ${(t.ms / 1000).toFixed(1)} s` : 'No steady beat found' })));
  const secs = el('div', { className: 'secs' });
  player.secEls = [];
  (i.sections || []).forEach(s => {
    const b = el('span', { className: 'sec ' + s.type, textContent: `${SEC_NAMES[s.type]} · bar ${s.bar + 1} · ${s.bars} bars`, title: 'Play from 2 bars before this section', onclick: () => play(Math.max(0, s.t - 2 * i.barLen)) });
    player.secEls.push({ s, b });
    secs.append(b);
  });
  if (!(i.sections || []).length) secs.append(el('span', { className: 'hint', textContent: 'No sections found (needs a steady beat).' }));
  d.append(el('div', { className: 'hint', textContent: 'Sections (click one to hear it start, 2 bars early):' }), secs);
  d.append(judgePanel(t));
  drawWave();
}
// Rows of answer buttons. A wrong answer opens a small field for the right value.
function judgePanel(t) {
  const m = markOf(t), i = t.info, box = el('div', { className: 'judge' });
  const row = (key, label, opts, extra) => {
    const o = el('div', { className: 'opts' });
    for (const [v, txt, kind] of opts) o.append(el('button', { textContent: txt, className: (m[key] === v ? 'on ' : '') + (kind || 'bad'), onclick: () => { m[key] = m[key] === v ? undefined : v; if (!m[key]) delete m[key]; saveMarks(); renderRows(); renderDetail(); } }));
    if (extra) o.append(extra);
    box.append(el('label', { textContent: label }), o);
  };
  const field = (key, ph, w = 70) => el('input', { type: 'text', placeholder: ph, value: m[key] || '', style: { width: w + 'px' }, onchange: e => { if (e.target.value) m[key] = e.target.value; else delete m[key]; saveMarks(); } });
  row('bpm', 'Tempo ' + (i.ok ? i.bpm.toFixed(1) : '?'), [['ok', 'Right', 'good'], ['half', 'Half the real tempo'], ['double', 'Double the real tempo'], ['wrong', 'Wrong']], field('bpmTrue', 'real BPM'));
  row('grid', 'Beat clicks', [['ok', 'On the kick', 'good'], ['early', 'Early'], ['late', 'Late'], ['offbeat', 'Between kicks'], ['bar', 'Bar starts on wrong beat'], ['drift', 'Drift off over time']]);
  row('key', 'Key ' + (i.camelot ? i.camelot + ' (' + i.key + ')' : '?'), [['ok', 'Right', 'good'], ['relative', 'Relative major/minor'], ['wrong', 'Wrong']], field('keyTrue', 'real key'));
  row('sections', 'Sections', [['ok', 'Right', 'good'], ['missed', 'Missed a drop/breakdown'], ['extra', 'Found one that is not there'], ['shifted', 'Right parts, wrong bars'], ['wrong', 'Mostly wrong']]);
  row('outro', 'Outro at ' + (i.ok ? mmss(i.mixOut) : '?'), [['ok', 'Good place to mix out', 'good'], ['early', 'Too early'], ['late', 'Too late']]);
  box.append(el('label', { textContent: 'Note' }), field('note', 'anything else (e.g. "drop is at 1:32")', 360));
  return box;
}
function drawWave() {
  const t = sel, cv = player.cv;
  if (!t || !t.info || !cv || !cv.isConnected) return;
  const i = t.info, dpr = window.devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const x = cv.getContext('2d'), band = 10 * dpr, wh = H - band - 2 * dpr, per = i.peaks.length / W;
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  for (let px = 0; px < W; px++) {
    let pk = 0, lo = 0, n = 0;
    for (let k = Math.floor(px * per), e = Math.max(k + 1, Math.floor((px + 1) * per)); k < e && k < i.peaks.length; k++) { if (i.peaks[k] > pk) pk = i.peaks[k]; lo += i.lows[k]; n++; }
    const h = Math.max(1, pk * wh), low = n ? lo / n : 0;
    x.fillStyle = `hsl(340 ${Math.round(4 + 50 * low)}% ${Math.round(56 + 4 * low)}%)`;
    x.fillRect(px, (wh - h) / 2, 1, h);
  }
  if (i.ok) {
    // bar lines, thinned so they stay readable on long tracks
    const bars = Math.floor((i.duration - i.grid0) / i.barLen), step = Math.max(1, Math.ceil(bars / (W / (6 * dpr))));
    x.fillStyle = 'rgba(255,255,255,.18)';
    for (let b = 0; b <= bars; b += step) x.fillRect(Math.round((i.grid0 + b * i.barLen) / i.duration * W), 0, 1, wh);
    x.fillStyle = '#cc6688';
    for (const tt of [i.mixIn, i.mixOut]) x.fillRect(Math.round(tt / i.duration * W) - dpr, 0, 2 * dpr, wh);
  }
  for (const s of i.sections || []) { x.fillStyle = SEC_COL[s.type]; x.fillRect(s.t / i.duration * W, H - band, s.bars * i.barLen / i.duration * W - dpr, band); }
  const p = curPos();
  x.fillStyle = '#fff'; x.fillRect(Math.round(p / i.duration * W) - dpr, 0, 2 * dpr, H);
  // where we are, in bars and sections
  if (player.pos) {
    const bar = i.ok ? Math.floor((p - i.grid0) / i.barLen) + 1 : 0, s = (i.sections || []).find(z => p >= z.t && p < z.end);
    player.pos.textContent = mmss(p) + (i.ok ? '  bar ' + bar + (s ? ' (' + SEC_NAMES[s.type] + ')' : '') : '');
    for (const e of player.secEls || []) e.b.classList.toggle('now', e.s === s);
  }
}

// ---------- listening, with a click on every beat of the grid ----------
const curPos = () => (player.playing ? player.offset + (player.ctx.currentTime - player.t0) : player.offset);
async function play(from) {
  const t = sel;
  if (!t || !t.info) return;
  stop();
  if (!player.ctx) {
    player.ctx = new AudioContext();
    player.clickGain = player.ctx.createGain(); player.clickGain.gain.value = player.clicks ? 0.5 : 0; player.clickGain.connect(player.ctx.destination);
  }
  if (player.ctx.state === 'suspended') await player.ctx.resume();
  if (player.bufFor !== t) {   // only the selected track is kept decoded
    player.playBtn.textContent = 'Loading...';
    player.buf = await player.ctx.decodeAudioData(await t.file.arrayBuffer());
    player.bufFor = t;
    if (sel !== t) return;
  }
  const c = player.ctx, s = c.createBufferSource();
  s.buffer = player.buf; s.connect(c.destination);
  player.offset = Math.min(player.buf.duration - 0.05, Math.max(0, from));
  player.t0 = c.currentTime + 0.05;
  s.start(player.t0, player.offset);
  s.onended = () => { if (player.src === s) stop(true); };
  player.src = s; player.playing = true; player.playBtn.textContent = 'Pause';
  const i = t.info;
  player.nextBeat = i.ok ? Math.ceil((player.offset - i.grid0) / i.beatLen) : 0;
  scheduleClicks();
  player.timer = setInterval(scheduleClicks, 100);
  const loop = () => { drawWave(); if (player.playing) player.raf = requestAnimationFrame(loop); };
  loop();
}
// Clicks are scheduled 0.3 s ahead on the audio clock, so they land sample-exact on the grid.
function scheduleClicks() {
  const i = sel && sel.info, c = player.ctx;
  if (!player.playing || !i || !i.ok) return;
  const until = c.currentTime + 0.3;
  for (;;) {
    const tt = i.grid0 + player.nextBeat * i.beatLen, when = player.t0 + (tt - player.offset);
    if (when > until) break;
    if (when >= c.currentTime) {
      const o = c.createOscillator(), g = c.createGain(), bar = ((player.nextBeat % 4) + 4) % 4 === 0;
      o.frequency.value = bar ? 1760 : 1100;
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(bar ? 1 : 0.6, when + 0.002); g.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
      o.connect(g); g.connect(player.clickGain); o.start(when); o.stop(when + 0.05);
    }
    player.nextBeat++;
  }
}
function stop(ended) {
  if (player.playing) player.offset = ended ? 0 : curPos();
  if (player.src) { player.src.onended = null; try { player.src.stop(); } catch (e) {} player.src = null; }
  player.playing = false; clearInterval(player.timer); cancelAnimationFrame(player.raf);
  if (player.playBtn) player.playBtn.textContent = 'Play';
  drawWave();
}

// ---------- export ----------
function exportReport() {
  const r = v => (typeof v === 'number' ? +v.toFixed(4) : v);
  const out = {
    app: 'Strodano VJ track analysis report', version: 1, date: new Date().toISOString(), userAgent: navigator.userAgent,
    tracks: tracks.filter(t => t.info).map(t => {
      const i = t.info;
      return {
        file: t.file.name, size: t.file.size, seconds: r(i.duration), analysisMs: t.ms,
        found: { ok: i.ok, bpm: r(i.bpm), gridConfidence: r(i.conf), firstBar: r(i.grid0), key: i.key || null, camelot: i.camelot || null, keyConfidence: r(i.keyConf),
          loudDb: r(i.loudDb), drumActivity: r(i.flux), mixIn: r(i.mixIn), outro: r(i.mixOut), lastBeat: r(i.beatEnd),
          sections: (i.sections || []).map(s => ({ type: s.type, bar: s.bar + 1, bars: s.bars, at: r(s.t) })) },
        marks: marks[t.key] || {},
      };
    }),
  };
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })), download: 'track-analysis-report.json' });
  document.body.append(a); a.click(); a.remove();
}

// ---------- wiring ----------
$('addFiles').onclick = () => $('fileIn').click();
$('fileIn').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('addFolder').onclick = async () => {
  if (!window.showDirectoryPicker) { $('fileIn').click(); return; }
  try { addFiles(await filesInFolder(await window.showDirectoryPicker({ id: 'strodano-report', mode: 'read' }))); } catch (e) {}
};
$('addFolder').hidden = !window.showDirectoryPicker;
$('export').onclick = exportReport;
$('clear').onclick = () => { stop(); tracks.length = 0; sel = null; renderRows(); renderDetail(); };
window.addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
window.addEventListener('dragleave', () => $('drop').classList.remove('over'));
window.addEventListener('drop', async e => {
  e.preventDefault(); $('drop').classList.remove('over');
  const items = [...(e.dataTransfer.items || [])].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (items.length) { const files = []; for (const en of items) await filesFromEntry(en, files); addFiles(files); }
  else addFiles(e.dataTransfer.files);
});
window.addEventListener('resize', drawWave);
document.addEventListener('keydown', e => { if (e.code === 'Space' && sel && e.target.tagName !== 'INPUT') { e.preventDefault(); if (player.playing) stop(); else play(player.offset); } });
renderRows();
window.report = { tracks, marks, addFiles, select, play, stop, exportReport };   // for automated checks
