// Strodano VJ (web) - hand tracking and gestures from the camera input. GPL-3.0.
// Uses Google's MediaPipe GestureRecognizer (Apache-2.0, web/vendor/mediapipe): 21 points per hand plus 7 trained gestures.
// It runs in a background worker, never on the render thread: one analysis costs 80-100 ms of CPU, which would stall the show.
// Everything is loaded only when hand tracking is switched on. The wasm engine, the model and MediaPipe's own JavaScript are
// stored gzipped + base64 in plain script files (a page opened from file:// can neither fetch binaries nor give a worker a
// script URL), unpacked with DecompressionStream and handed to the worker as Blob URLs / its own Blob source.
// The camera picture goes to the worker as a 320-wide ImageBitmap, up to 15 times a second, one at a time.
// Output, smoothed, all 0..1 (y up, x follows the camera input's Mirror setting):
//   handFeat.present, .x, .y (palm), .pinch (thumb tip to index tip), .open (fingers stretched), .size (hand closer = bigger),
//   .spread (distance between two hands), .hands (0..2), .gesture (stable gesture name) and .score.
// Continuous values are slider sources (~ chip, inputs.js); gestures act like pads: in Map mode, click a control, then
// make the gesture (midi.js onInputEvent, key 'gest:0:<name>').
'use strict';
const handFeat = { present: 0, x: 0.5, y: 0.5, pinch: 0, open: 0, size: 0, spread: 0, hands: 0, gesture: 'None', score: 0 };
const HAND_GESTURES = { Open_Palm: 'Open palm', Closed_Fist: 'Fist', Pointing_Up: 'Point up', Victory: 'V sign', Thumb_Up: 'Thumbs up', Thumb_Down: 'Thumbs down', ILoveYou: 'Rock on' };
const handState = { worker: null, ready: false, loading: false, on: false, busy: false, err: '', last: 0, res: null, cand: 'None', candN: 0, cost: 0, preview: null, delegate: '', loadMs: 0 };
// The worker: MediaPipe's bundle is prepended to this source, so `Vision` exists in the worker's global scope.
const HAND_WORKER = `
let rec = null;
onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    try {
      const fileset = { wasmLoaderPath: d.loaderUrl, wasmBinaryPath: d.wasmUrl };
      const opt = del => ({ baseOptions: { modelAssetBuffer: new Uint8Array(d.model.slice(0)), delegate: del }, runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      let used = d.delegate;
      try { rec = await Vision.GestureRecognizer.createFromOptions(fileset, opt(used)); }
      catch (err) { if (used === 'CPU') throw err; used = 'CPU'; rec = await Vision.GestureRecognizer.createFromOptions(fileset, opt('CPU')); }
      postMessage({ type: 'ready', delegate: used });
    } catch (err) { postMessage({ type: 'error', msg: String((err && err.message) || err) }); }
  } else if (d.type === 'frame') {
    const t = performance.now(); let r = null;
    if (rec) try { r = rec.recognizeForVideo(d.bitmap, d.ts); } catch (err) {}
    d.bitmap.close();
    postMessage({ type: 'result', ms: performance.now() - t,
      landmarks: r ? r.landmarks.map(h => h.map(p => ({ x: p.x, y: p.y }))) : [],
      gestures: r ? r.gestures.map(g => g.slice(0, 1).map(c => ({ categoryName: c.categoryName, score: c.score }))) : [] });
  }
};`;

function loadScriptOnce(src, test) {
  if (test()) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.append(s);
  });
}
async function gunzipB64(b64) {
  let bytes;
  try { bytes = new Uint8Array(await (await fetch('data:application/octet-stream;base64,' + b64)).arrayBuffer()); }
  catch (e) { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
// GPU inside the worker measured ~80 ms per analysis on an RTX 3080 Ti laptop against 240-400 ms on the CPU; the worker falls
// back to the CPU by itself when the GPU path cannot start.
async function handsStart(delegate = 'GPU') {
  if (handState.ready) { handState.on = true; ui.browserDirty = true; return; }
  if (handState.loading) return;
  if (!camState.track) camTrack(camState.devices[0] ? camState.devices[0].deviceId : '');   // hands need the camera input
  handState.loading = true; handState.err = ''; ui.browserDirty = true;
  setStatus('Loading hand tracking (a few seconds, the first time only)...');
  const t0 = performance.now();
  try {
    await loadScriptOnce('vendor/mediapipe/vision_code.gz.js', () => !!window.MP_BUNDLE_GZ);
    await loadScriptOnce('vendor/mediapipe/vision_wasm.gz.js', () => !!window.MP_WASM_GZ);
    await loadScriptOnce('vendor/mediapipe/gesture_model.gz.js', () => !!window.MP_GESTURE_GZ);
    const text = async b64 => new TextDecoder().decode(await gunzipB64(b64));
    const bundle = await text(window.MP_BUNDLE_GZ), loader = await text(window.MP_LOADER_GZ);
    const wasm = await gunzipB64(window.MP_WASM_GZ), model = await gunzipB64(window.MP_GESTURE_GZ);
    for (const k of ['MP_BUNDLE_GZ', 'MP_LOADER_GZ', 'MP_WASM_GZ', 'MP_GESTURE_GZ']) delete window[k];   // ~14 MB of text no longer needed
    const blobUrl = (parts, type) => URL.createObjectURL(new Blob(parts, { type }));
    const w = new Worker(blobUrl([bundle, '\n', HAND_WORKER], 'text/javascript'));
    handState.worker = w;
    await new Promise((res, rej) => {
      w.onmessage = e => { if (e.data.type === 'ready') { handState.delegate = e.data.delegate; res(); } else if (e.data.type === 'error') rej(new Error(e.data.msg)); };
      w.onerror = e => rej(new Error(e.message || 'the background worker failed'));
      w.postMessage({ type: 'init', delegate, loaderUrl: blobUrl([loader], 'text/javascript'), wasmUrl: blobUrl([wasm], 'application/wasm'), model: model.buffer }, [model.buffer]);
    });
    w.onmessage = e => handsResult(e.data);
    w.onerror = () => { handState.err = 'Hand tracking stopped (the background worker failed).'; handState.ready = handState.on = false; ui.browserDirty = true; };
    handState.ready = handState.on = true;
    handState.loadMs = Math.round(performance.now() - t0);
    setStatus('Hand tracking on. Hold a hand up to the camera.');
  } catch (e) {
    if (handState.worker) { handState.worker.terminate(); handState.worker = null; }
    handState.err = 'Hand tracking could not start: ' + (e.message || e);
    setStatus(handState.err);
  }
  handState.loading = false; ui.browserDirty = true;
}
function handsStop() {
  handState.on = false; handState.res = null;
  Object.assign(handFeat, { present: 0, pinch: 0, open: 0, size: 0, spread: 0, hands: 0, score: 0 });
  handGesture('None');
  ui.browserDirty = true;
}

const handDist = (a, b, asp) => Math.hypot((a.x - b.x) * asp, a.y - b.y);
const handEase = (o, k, v, f) => { o[k] += (v - o[k]) * f; };
// A gesture counts once it has been seen in 3 analyses in a row; a change fires the old one's release and the new one's press.
function handGesture(name) {
  if (name === handFeat.gesture) return;
  const old = handFeat.gesture;
  handFeat.gesture = name;
  if (typeof onInputEvent === 'function') {
    if (old !== 'None') onInputEvent('gest', 0, old, 0);
    if (name !== 'None') onInputEvent('gest', 0, name, 1);
  }
}
// Called every frame from the main loop (after camTick): hands the next picture to the worker when it is free.
function handsTick() {
  const v = camState.track && camState.track.video;
  if (!handState.on || !handState.ready || !v || v.readyState < 2) return;
  drawHandPreview();
  const now = performance.now();
  if (handState.busy || now - handState.last < 66) return;
  handState.last = now; handState.busy = true;
  handState.asp = (v.videoWidth || 16) / (v.videoHeight || 9);
  createImageBitmap(v, { resizeWidth: 320, resizeHeight: Math.max(1, Math.round(320 / handState.asp)) })
    .then(b => handState.worker.postMessage({ type: 'frame', bitmap: b, ts: now }, [b]))
    .catch(() => { handState.busy = false; });
}
function handsResult(res) {
  if (res.type !== 'result') return;
  handState.busy = false;
  handState.cost += (res.ms - handState.cost) * 0.2;
  if (!handState.on) return;
  handState.res = res;
  const hands = res.landmarks || [], asp = handState.asp || 16 / 9;
  handFeat.hands = hands.length;
  if (!hands.length) { handEase(handFeat, 'present', 0, 0.3); handEase(handFeat, 'pinch', 0, 0.3); handEase(handFeat, 'open', 0, 0.3); handEase(handFeat, 'spread', 0, 0.3); handState.cand = 'None'; handState.candN = 0; handGesture('None'); return; }
  const palm = h => { const p = [0, 5, 9, 13, 17].map(i => h[i]); return { x: p.reduce((s, q) => s + q.x, 0) / 5, y: p.reduce((s, q) => s + q.y, 0) / 5 }; };
  const h = hands[0], pc = palm(h), size = handDist(h[0], h[9], asp);
  let x = pc.x;
  if (camState.mirror) x = 1 - x;
  const pinch = Math.min(1, Math.max(0, 1 - (handDist(h[4], h[8], asp) / Math.max(size, 1e-3) - 0.25) / 0.75));
  const open = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([tip, pip]) => handDist(h[tip], h[0], asp) > handDist(h[pip], h[0], asp) * 1.15).length / 4;
  handEase(handFeat, 'present', 1, 0.5); handEase(handFeat, 'x', x, 0.5); handEase(handFeat, 'y', 1 - pc.y, 0.5);
  handEase(handFeat, 'pinch', pinch, 0.5); handEase(handFeat, 'open', open, 0.4);
  handEase(handFeat, 'size', Math.min(1, Math.max(0, (size - 0.08) / 0.35)), 0.4);
  handEase(handFeat, 'spread', hands.length > 1 ? Math.min(1, handDist(pc, palm(hands[1]), asp) / 1.2) : 0, 0.4);
  const g = res.gestures && res.gestures[0] && res.gestures[0][0], name = g && g.score > 0.55 && HAND_GESTURES[g.categoryName] ? g.categoryName : 'None';
  handFeat.score = g ? g.score : 0;
  if (name === handState.cand) handState.candN++; else { handState.cand = name; handState.candN = 1; }
  if (handState.candN >= 3) handGesture(name);
}
// The live preview in the Sources tab: the camera picture with the tracked points and the recognised gesture.
const HAND_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
function drawHandPreview() {
  const cv = handState.preview;
  if (!cv || !cv.isConnected || !camState.track) return;
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, v = camState.track.video, m = camState.mirror;
  x.save();
  if (m) { x.translate(W, 0); x.scale(-1, 1); }
  x.drawImage(v, 0, 0, W, H);
  x.restore();
  const acc = (typeof THEME !== 'undefined' && THEME.acc) || '#ff7a1a';
  for (const h of (handState.res && handState.res.landmarks) || []) {
    const P = p => [(m ? 1 - p.x : p.x) * W, p.y * H];
    x.strokeStyle = acc; x.lineWidth = 2; x.beginPath();
    for (const [a, b] of HAND_BONES) { const [ax, ay] = P(h[a]), [bx, by] = P(h[b]); x.moveTo(ax, ay); x.lineTo(bx, by); }
    x.stroke(); x.fillStyle = '#fff';
    for (const p of h) { const [px, py] = P(p); x.fillRect(px - 2, py - 2, 4, 4); }
  }
  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, H - 22, W, 22);
  x.fillStyle = '#fff'; x.font = '13px system-ui, sans-serif';
  x.fillText(handFeat.hands ? (HAND_GESTURES[handFeat.gesture] || 'Hand') + (handFeat.hands > 1 ? '  +  2nd hand' : '') : 'No hand', 8, H - 7);
}

// ---------- Sources tab ----------
const handMeters = [];
function tickHandMeters() { for (const m of handMeters) m.i.style.width = (m.get() * 100).toFixed(0) + '%'; }
SOURCE_PANELS.push(() => {
  handMeters.length = 0;
  const box = el('div', { className: 'cam-box' }, el('h4', { textContent: 'Hands' }));
  if (!canCamera) return [box];
  const on = handState.on && handState.ready;
  box.append(el('div', { className: 'fld' },
    el('button', { className: on ? 'on' : '', disabled: handState.loading,
      textContent: handState.loading ? 'Loading...' : on ? 'Hand tracking on' : 'Track hands',
      title: 'Follow hands and finger gestures on the camera input (starts the camera input if needed)',
      onclick: () => (on ? handsStop() : handsStart()) })));
  if (on) {
    const cv = el('canvas', { className: 'hand-preview', width: 320, height: 180 });
    handState.preview = cv;
    const bar = (label, get) => { const i = el('i'); handMeters.push({ i, get }); return el('div', { className: 'fld' }, el('label', { textContent: label }), el('span', { className: 'cam-meter' }, i)); };
    box.append(cv, bar('Hand X', () => handFeat.x), bar('Hand Y', () => handFeat.y), bar('Pinch', () => handFeat.pinch), bar('Open hand', () => handFeat.open),
      bar('Closeness', () => handFeat.size), bar('Two hands apart', () => handFeat.spread),
      el('div', { className: 'hint', textContent: 'Sliders: click ~ next to a slider and pick a Hand source, or press Detect and move. Gestures (fist, open palm, V sign, thumbs up / down, point up, rock on) work like pads: turn on Map, click a clip or button, then make the gesture.' }));
  }
  if (handState.err) box.append(el('div', { className: 'hint', style: { color: 'var(--bad)' }, textContent: handState.err }));
  return [box];
});
