// Strodano VJ NDI sender thread. GPL-3.0.
// Talks to the NDI Runtime the user installed (ndi.video/tools), found at run time and called through koffi (FFI):
// the NDI SDK is not compiled in or shipped with this GPL app. NDI(R) is a registered trademark of Vizrt NDI AB.
// Messages in:  {op:'init'} | {op:'create', id, name, groups} | {op:'destroy', id} | {op:'list'}
// Messages out: {seq, ok, ...result} answering each message's `seq`.
// Frames do not come through Electron IPC (an 8 MB frame through the context bridge and IPC took ~15 ms of the page's
// render thread, and MessagePortMain stalled the main process): the page's Web Worker POSTs them straight to this
// thread's HTTP endpoint on 127.0.0.1 (random port, random token, loopback only):
//   POST /frame?t=<token>&id=<source id>&w=<width>&h=<height>&fps=<rate>   body = UYVY 4:2:2, top row first, w*h*2 bytes
// -> {ok, conns, ms}. The GPU packs and flips the frame, so this thread hands it to NDI as is (UYVY is NDI's own format).
// Frames are sent with the synchronous NDI call: it compresses here, on this thread, and its return is the back-pressure.
'use strict';
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

let lib = null, api = null, libPath = '', initError = '';
const senders = new Map();   // id -> {inst, name}
let server = null, port = 0;
const token = crypto.randomBytes(18).toString('base64url');

function candidates() {
  const env = ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDI_RUNTIME_DIR_V4'].map(k => process.env[k]).filter(Boolean);
  if (process.platform === 'win32') {
    const dll = 'Processing.NDI.Lib.x64.dll';
    return [...env.map(d => path.join(d, dll)), 'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\' + dll, 'C:\\Program Files\\NDI\\NDI 5 Runtime\\v5\\' + dll];
  }
  if (process.platform === 'darwin') {
    return [...env.map(d => path.join(d, 'libndi.dylib')), '/usr/local/lib/libndi.dylib', '/Library/NDI SDK for Apple/lib/macOS/libndi.dylib', '/Library/Application Support/NewTek/NDI/libndi.dylib'];
  }
  return [...env.map(d => path.join(d, 'libndi.so.6')), ...env.map(d => path.join(d, 'libndi.so.5')), '/usr/lib/libndi.so.6', '/usr/lib/libndi.so.5', '/usr/local/lib/libndi.so.6', '/usr/local/lib/libndi.so.5', '/usr/lib/libndi.so'];
}

function init() {
  if (api) return true;
  if (initError) return false;
  let koffi;
  try { koffi = require('koffi'); } catch (e) { initError = 'The NDI bridge (koffi) did not load: ' + e.message; return false; }
  for (const p of candidates()) {
    if (!fs.existsSync(p)) continue;
    try { lib = koffi.load(p); libPath = p; break; } catch (e) { initError = 'Could not load ' + p + ': ' + e.message; }
  }
  if (!lib) { initError = initError || 'NDI Runtime not found. Install NDI Tools or the NDI Runtime from ndi.video, then restart Strodano VJ.'; return false; }
  try {
    const SendCreate = koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' });
    const VideoFrame = koffi.struct('NDIlib_video_frame_v2_t', {
      xres: 'int', yres: 'int', FourCC: 'uint32_t', frame_rate_N: 'int', frame_rate_D: 'int', picture_aspect_ratio: 'float', frame_format_type: 'int',
      timecode: 'int64_t', p_data: 'void *', line_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64_t',
    });
    api = {
      koffi,
      initialize: lib.func('bool NDIlib_initialize()'),
      version: lib.func('const char * NDIlib_version()'),
      create: lib.func('void * NDIlib_send_create(const NDIlib_send_create_t *settings)'),
      destroy: lib.func('void NDIlib_send_destroy(void *inst)'),
      send: lib.func('void NDIlib_send_send_video_v2(void *inst, const NDIlib_video_frame_v2_t *frame)'),
      conns: lib.func('int NDIlib_send_get_no_connections(void *inst, uint32_t timeout_ms)'),
      SendCreate, VideoFrame,
    };
    if (!api.initialize()) { api = null; initError = 'NDI did not start on this computer (its CPU may be unsupported).'; return false; }
  } catch (e) { api = null; initError = 'This NDI Runtime is not compatible: ' + e.message; return false; }
  return true;
}

const FOURCC_UYVY = 0x59565955;   // 'U','Y','V','Y'
const TIMECODE_SYNTH = 9223372036854775807n;   // NDIlib_send_timecode_synthesize

function create(id, name, groups) {
  const old = senders.get(id);
  if (old && old.name === name) return { reused: true };   // the page reloaded (GPU reset): receivers stay connected
  if (old) destroy(id);
  const inst = api.create({ p_ndi_name: name, p_groups: groups || null, clock_video: false, clock_audio: false });
  if (!inst) throw new Error('NDI could not create the source "' + name + '" (is the name already used?)');
  senders.set(id, { inst, name });
  return { reused: false };
}
function frame(id, w, h, fps, data) {
  const s = senders.get(id);
  if (!s) throw new Error('no such NDI source');
  const stride = w * 2;
  if (!(w > 0 && h > 0 && w % 2 === 0) || data.length !== stride * h) throw new Error('bad frame size');
  const t0 = performance.now();
  api.send(s.inst, { xres: w, yres: h, FourCC: FOURCC_UYVY, frame_rate_N: Math.round(fps * 1000), frame_rate_D: 1000, picture_aspect_ratio: w / h,
    frame_format_type: 1 /* progressive */, timecode: TIMECODE_SYNTH, p_data: data, line_stride_in_bytes: stride, p_metadata: null, timestamp: 0n });
  return { conns: api.conns(s.inst, 0), ms: +(performance.now() - t0).toFixed(1) };
}
// the page's frame endpoint (see the top of this file)
function startServer() {
  if (server) return Promise.resolve();
  server = http.createServer((req, res) => {
    const out = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'POST' || u.pathname !== '/frame') { req.resume(); return out(404, { ok: false }); }
    if (u.searchParams.get('t') !== token) { req.resume(); return out(403, { ok: false, error: 'bad token' }); }
    const w = +u.searchParams.get('w'), h = +u.searchParams.get('h'), fps = +u.searchParams.get('fps') || 30, id = u.searchParams.get('id') || '';
    const size = w * h * 2;
    if (!(size > 0 && size <= 7680 * 4320 * 2)) { req.resume(); return out(400, { ok: false, error: 'bad size' }); }
    const body = Buffer.allocUnsafe(size);
    let got = 0, over = false;
    req.on('data', c => { if (over || got + c.length > size) { over = true; return; } c.copy(body, got); got += c.length; });
    req.on('end', () => {
      if (over || got !== size) return out(400, { ok: false, error: 'bad frame size' });
      try { out(200, { ok: true, ...frame(id, w, h, fps, body) }); } catch (e) { out(200, { ok: false, error: String(e.message || e) }); }
    });
  });
  server.keepAliveTimeout = 30000;
  return new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', () => { port = server.address().port; res(); }); });
}
function destroy(id) {
  const s = senders.get(id);
  if (!s) return;
  senders.delete(id);
  api.destroy(s.inst);
}

parentPort.on('message', async m => {
  const reply = (ok, r) => parentPort.postMessage({ seq: m.seq, ok, ...r });
  try {
    if (m.op === 'init') {
      if (!init()) return reply(false, { error: initError });
      await startServer();
      return reply(true, { version: String(api.version() || ''), lib: libPath, port, token });
    }
    if (!init()) return reply(false, { error: initError });
    if (m.op === 'create') return reply(true, create(m.id, m.name, m.groups));
    if (m.op === 'destroy') { destroy(m.id); return reply(true, {}); }
    if (m.op === 'list') return reply(true, { ids: [...senders.keys()] });
    reply(false, { error: 'unknown op' });
  } catch (e) { reply(false, { error: String(e && e.message || e) }); }
});
