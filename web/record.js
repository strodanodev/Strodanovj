// Strodano VJ (web) - record the show (picture + sound) to a video file, and auto-render a whole mix. GPL-3.0.
// The composition output is copied into a canvas whose stream, with the final audio mix, goes to a MediaRecorder.
// MP4 (H.264 + AAC) when the browser can record it (current Chrome and Edge), WebM otherwise. With the File System
// Access API the file is written to disk as it records, so an hour at 1080p never has to fit in memory.
// Recording and rendering run in real time: the page must keep drawing frames (keep this window visible, or open the
// output window, which keeps the loop running even when this window is covered).
'use strict';
// The longest recording is the plan's (entRecMax, plan.js): one hour on Pro, ten on Festival.
const REC_QUALITY = { high: { w: 1920, h: 1080, vbr: 8e6, label: '1080p, 8 Mbit/s (about 3.6 GB per hour)' },
  std: { w: 1280, h: 720, vbr: 4e6, label: '720p, 4 Mbit/s (about 1.8 GB per hour)' },
  small: { w: 1280, h: 720, vbr: 2e6, label: '720p, 2 Mbit/s (about 0.9 GB per hour)' } };
const rec = { on: false, quality: 'high', mr: null, canvas: null, cx: null, dest: null, writable: null, writeQ: null, chunks: [], bytes: 0,
  t0: 0, lastCopy: 0, mime: '', ext: '', name: '', render: null, stopping: false };
try { const q = localStorage.getItem('strodano-vj-rec-quality'); if (REC_QUALITY[q]) rec.quality = q; } catch (e) {}

function recFormat() {
  const types = [['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']];
  if (typeof MediaRecorder === 'undefined') return null;
  const t = types.find(([m]) => MediaRecorder.isTypeSupported(m));
  return t ? { mime: t[0], ext: t[1] } : null;
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'set';
// A source the recording should hear besides the mix bus (the microphone: what it hears is the music).
function recAddInput(node) { if (rec.dest) node.connect(rec.dest); }

async function recStart(title) {
  if (rec.on) return true;
  if (!entGate('record')) return false;
  const fmt = recFormat();
  if (!fmt) { setStatus('This browser cannot record video. Use a current Chrome or Edge.'); return false; }
  audioCtx();
  rec.mime = fmt.mime; rec.ext = fmt.ext;
  rec.name = 'Strodano ' + safeName(title || 'set') + ' ' + stamp() + '.' + fmt.ext;
  rec.writable = null; rec.chunks = []; rec.bytes = 0; rec.writeQ = Promise.resolve();
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: rec.name, types: [{ description: fmt.ext.toUpperCase() + ' video', accept: { [fmt.ext === 'mp4' ? 'video/mp4' : 'video/webm']: ['.' + fmt.ext] } }] });
      rec.writable = await h.createWritable();
      rec.name = h.name;
    } catch (e) { if (e && e.name === 'AbortError') return false; }   // cancelled: do not record; any other failure: record in memory
  }
  const q = REC_QUALITY[rec.quality], ar = comp.w / comp.h;
  let w = q.w, h = Math.round(q.w / ar);
  if (h > q.h) { h = q.h; w = Math.round(q.h * ar); }
  w -= w % 2; h -= h % 2;   // encoders want even sizes
  rec.canvas = document.createElement('canvas'); rec.canvas.width = w; rec.canvas.height = h;
  rec.cx = rec.canvas.getContext('2d', { alpha: false });
  rec.cx.fillStyle = '#000'; rec.cx.fillRect(0, 0, w, h);
  rec.dest = audio.ctx.createMediaStreamDestination();
  audio.out.connect(rec.dest);
  if (live.micNode) live.micNode.connect(rec.dest);
  const stream = new MediaStream([...rec.canvas.captureStream(30).getVideoTracks(), ...rec.dest.stream.getAudioTracks()]);
  try { rec.mr = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: q.vbr, audioBitsPerSecond: 192000 }); }
  catch (e) { setStatus('Could not start recording: ' + (e.message || e)); recCleanup(); return false; }
  rec.mr.ondataavailable = e => {
    if (!e.data || !e.data.size) return;
    rec.bytes += e.data.size;
    if (rec.writable) { const d = e.data; rec.writeQ = rec.writeQ.then(() => rec.writable.write(d)).catch(err => { setStatus('Writing the recording failed: ' + (err.message || err)); }); }
    else rec.chunks.push(e.data);
  };
  rec.mr.onstop = async () => {
    try {
      await rec.writeQ;
      if (rec.writable) await rec.writable.close();
      else {
        const url = URL.createObjectURL(new Blob(rec.chunks, { type: rec.mime }));
        const a = el('a', { href: url, download: rec.name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      setStatus('Saved ' + rec.name + ' (' + (rec.bytes / 1048576).toFixed(0) + ' MB)');
    } catch (e) { setStatus('Saving the recording failed: ' + (e.message || e)); }
    recCleanup();
  };
  rec.mr.start(1000);   // a chunk every second, written to disk as it comes
  rec.on = true; rec.stopping = false; rec.t0 = performance.now(); rec.lastCopy = 0;
  audio.recording = true;
  setStatus('Recording to ' + rec.name + (rec.writable ? '' : ' (kept in memory until you stop: long recordings need a lot of RAM)'));
  if (typeof agentUIDirty === 'function') agentUIDirty();
  return true;
}
function recStop() {
  if (!rec.on || rec.stopping) return;
  rec.stopping = true;
  rec.render = null;
  try { rec.mr.stop(); } catch (e) { recCleanup(); }
  setStatus('Finishing ' + rec.name + '...');
}
function recCleanup() {
  if (rec.dest) { try { audio.out.disconnect(rec.dest); } catch (e) {} try { if (live.micNode) live.micNode.disconnect(rec.dest); } catch (e) {} }
  if (rec.mr) rec.mr.stream.getTracks().forEach(t => t.stop());
  rec.on = false; rec.stopping = false; rec.mr = null; rec.dest = null; rec.canvas = null; rec.cx = null; rec.writable = null; rec.chunks = [];
  audio.recording = false;
  if (typeof agentUIDirty === 'function') agentUIDirty();
}
function recToggle() { if (rec.on) recStop(); else recStart(live.src === 'file' ? live.fileName : 'set'); }
const recElapsed = () => (rec.on ? (performance.now() - rec.t0) / 1000 : 0);

// Called every frame from audioTick: copy the latest output frame (30 times a second) and stop at the hour.
function recTick() {
  if (!rec.on || rec.stopping) return;
  const now = performance.now();
  if (recElapsed() >= entRecMax()) { setStatus('Recording reached ' + (entRecMax() / 3600) + (entRecMax() > 3600 ? ' hours' : ' hour') + ' and was stopped'); recStop(); return; }
  if (now - rec.lastCopy < 1000 / 31) return;
  rec.lastCopy = now;
  const c = rec.canvas, w = c.width, h = c.height;
  if (comp.outTex) { present(comp.outTex, w, h); rec.cx.drawImage(glc, 0, glc.height - h, w, h, 0, 0, w, h); }
  renderTick();
}

// ---------- auto render ----------
// 'file': the loaded music file or mix, from the start to its end, with the Agent directing.
// 'list': the DJ track list, mixed by autopilot, with the Agent directing, until the list runs out.
// Both stop at the plan's longest recording.
async function renderMix(kind) {
  if (rec.on) { setStatus('Already recording'); return; }
  if (!entGate('agent') || !entGate('record')) return;
  if (kind === 'file' && !(live.src === 'file' && live.el)) { setStatus('Open a music file in the Agent panel first'); return; }
  if (kind === 'list' && !crate.tracks.some(t => t.state === 'ready' && !t.played)) { setStatus('Add tracks to the DJ track list first'); return; }
  if (kind === 'file') { live.el.pause(); live.el.currentTime = 0; }
  else { if (live.src !== 'dj') useDecks(); audio.decks.forEach(d => { deckPause(d); }); }
  setAgent(true);
  if (!(await recStart(kind === 'file' ? live.fileName : 'mix'))) return;
  rec.render = { kind, t0: performance.now(), total: kind === 'list' ? crate.tracks.filter(t => t.state === 'ready' && !t.played).length : 0, idleSince: 0 };
  if (kind === 'file') live.el.play().catch(() => {});
  else setAuto(true);
  setStatus('Rendering: keep this window visible, or open the output window, until it finishes');
}
function renderTick() {
  const r = rec.render;
  if (!r) return;
  if (r.kind === 'file') { if (!live.el || live.el.ended) recStop(); return; }
  // the list is done when nothing has played for 3 seconds after the start
  const playing = audio.decks.some(d => d.playing);
  if (playing) r.idleSince = 0;
  else if (performance.now() - r.t0 > 8000) { if (!r.idleSince) r.idleSince = performance.now(); else if (performance.now() - r.idleSince > 3000) { setAuto(false); recStop(); } }
}
onMusic(type => { if (type === 'ended' && rec.render && rec.render.kind === 'file') recStop(); });
function renderProgress() {
  const r = rec.render;
  if (!r) return null;
  if (r.kind === 'file') { const d = fileDur(); return d ? Math.min(1, fileTime() / Math.min(d, entRecMax())) : 0; }
  return r.total ? Math.min(1, crate.tracks.filter(t => t.played).length / r.total) : 0;
}
