// Strodano VJ (web) - live camera: camera clips, and the camera as a control input for "smart" effects. GPL-3.0.
// Camera input: one camera is analysed every other frame on a 64 x 36 copy of its picture, giving
//   camFeat.motion (how much is moving, 0..1), camFeat.x / .y (where the movement is, 0..1, y up), camFeat.bright (0..1).
// Shaders read them as uniform vec4 cam = (motion, x, y, bright) and can sample the picture as camTex; sliders can follow
// them through the ~ modulation menu (motion.js). Each camera stream is opened once and shared by every clip that shows it.
'use strict';
const camFeat = { motion: 0, x: 0.5, y: 0.5, bright: 0 };
// mirror flips camFeat.x only (camTex is never mirrored), so it is off by default: then a spot that follows x lines up with the picture.
const camState = { streams: new Map(), devices: [], track: null, mirror: false, tex: null, small: null, prev: null, tick: 0, err: '' };
const canCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

function camOpen(deviceId) {
  const key = deviceId || 'default';
  let s = camState.streams.get(key);
  if (!s) {
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    s = { users: 0, promise: navigator.mediaDevices.getUserMedia({ video, audio: false }) };
    camState.streams.set(key, s);
    s.promise.then(() => { camState.err = ''; camListDevices(); }).catch(e => {
      camState.streams.delete(key);
      camState.err = e && e.name === 'NotAllowedError' ? 'Camera permission was refused' : 'No camera found' + (e && e.message ? ': ' + e.message : '');
      setStatus(camState.err); ui.browserDirty = true;
    });
  }
  s.users++;
  return s.promise;
}
function camClose(deviceId) {
  const key = deviceId || 'default', s = camState.streams.get(key);
  if (!s || --s.users > 0) return;
  camState.streams.delete(key);
  s.promise.then(st => st.getTracks().forEach(t => t.stop())).catch(() => {});
}
async function camListDevices() {
  try { camState.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) {}
  ui.browserDirty = true;
}
function camVideo(deviceId, onReady) {
  const v = document.createElement('video');
  Object.assign(v, { muted: true, playsInline: true, autoplay: true });
  camOpen(deviceId).then(st => { v.srcObject = st; v.play().catch(() => {}); if (onReady) v.addEventListener('loadeddata', () => onReady(v), { once: true }); }).catch(() => {});
  return v;
}
const camLabel = id => { const d = camState.devices.find(x => x.deviceId === id); return d && d.label ? d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') : 'Camera'; };

// ---------- camera clips: shown like a video clip; trigger / eject / layer fit work as usual ----------
function camClip(deviceId, name) {
  const c = { uid: newUid(), type: 'cam', name: name || camLabel(deviceId), deviceId: deviceId || '', w: 0, h: 0, speed: 1, thumb: null };
  c.video = camVideo(c.deviceId, v => { c.w = v.videoWidth; c.h = v.videoHeight; c.thumb = thumbOf(v, c.w, c.h); ui.gridDirty = true; });
  c.video.addEventListener('error', () => { c.error = true; ui.gridDirty = true; });
  return c;
}
CLIP_TYPES.cam = {
  toJSON: c => ({ type: 'cam', uid: c.uid, name: c.name, deviceId: c.deviceId }),
  fromJSON: j => (canCamera ? camClip(typeof j.deviceId === 'string' ? j.deviceId : '', String(j.name || 'Camera')) : null),
  free: c => { if (c.video) { c.video.pause(); c.video.srcObject = null; } camClose(c.deviceId); c.video = null; },
  props: (c, p) => p.append(el('div', { className: 'hint', textContent: `Live camera${c.w ? `  -  ${c.w} x ${c.h}` : ' (waiting for the camera)'}. Use the layer's Scaling, Scale and Position to frame it.` })),
};

// One click: a new top layer called Camera, playing the camera, so it is part of the show (effects, transitions, blend, opacity).
function camToLayer(deviceId) {
  addLayer();
  const li = comp.layers.length - 1;
  comp.layers[li].name = 'Camera';
  setClip(li, 0, camClip(deviceId));
  trigger(li, 0);
  sel.l = li; sel.c = 0; propTab = 'layer';
  ui.gridDirty = ui.propsDirty = true;
  setStatus('Camera is on the new top layer "Camera". Add effects to it, or lower its opacity / change its blend mode to mix it in.');
}

// ---------- camera input for smart effects ----------
function camTrack(deviceId) {
  camUntrack();
  const t = { deviceId: deviceId || '', video: null };
  t.video = camVideo(t.deviceId);
  camState.track = t;
  if (!camState.small) { camState.small = document.createElement('canvas'); camState.small.width = 64; camState.small.height = 36; }
  ui.browserDirty = true;
}
function camUntrack() {
  const t = camState.track;
  if (!t) return;
  t.video.pause(); t.video.srcObject = null; camClose(t.deviceId);
  camState.track = null; camState.prev = null;
  Object.assign(camFeat, { motion: 0, x: 0.5, y: 0.5, bright: 0 });
  ui.browserDirty = true;
}
// Called every frame from the main loop.
function camTick() {
  const t = camState.track, v = t && t.video;
  if (!v || v.readyState < 2) return;
  // the picture, for shaders that sample camTex
  if (!camState.tex) camState.tex = mkTex(0, 0);
  gl.bindTexture(gl.TEXTURE_2D, camState.tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (camState.tick++ % 2) return;   // the analysis runs at half the frame rate
  const x = camState.small.getContext('2d', { willReadFrequently: true });
  x.drawImage(v, 0, 0, 64, 36);
  const d = x.getImageData(0, 0, 64, 36).data, n = 64 * 36, lum = new Float32Array(n);
  let sum = 0, diff = 0, wx = 0, wy = 0, w = 0;
  for (let i = 0; i < n; i++) {
    const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
    lum[i] = l; sum += l;
    if (camState.prev) {
      const m = Math.abs(l - camState.prev[i]);
      diff += m;
      if (m > 0.08) { wx += (i % 64) * m; wy += Math.floor(i / 64) * m; w += m; }
    }
  }
  camState.prev = lum;
  const motion = Math.min(1, (diff / n) * 12);
  camFeat.motion += (motion - camFeat.motion) * (motion > camFeat.motion ? 0.6 : 0.12);   // quick to rise, slow to fall
  camFeat.bright += (sum / n - camFeat.bright) * 0.2;
  if (w > 0.5) {
    let cx = (wx / w + 0.5) / 64, cy = 1 - (wy / w + 0.5) / 36;
    if (camState.mirror) cx = 1 - cx;
    camFeat.x += (cx - camFeat.x) * 0.25; camFeat.y += (cy - camFeat.y) * 0.25;
  }
}

// ---------- smart effects: they follow the camera input by themselves (nothing happens until "Use as input" is on) ----------
[
  { name: 'Follow Spot (cam)', params: [P('Size', 0.3), P('Softness', 0.3), P('Darkness', 0.85)],
    body: `vec4 fx(){ vec4 c = texture(tex, uv); vec2 d = (uv - cam.yz) * vec2(res.x / res.y, 1.0); float r = 0.08 + p.x * 0.6;
 float m = 1.0 - smoothstep(r, r + 0.02 + p.y * 0.4, length(d)); return vec4(c.rgb * mix(1.0 - p.z, 1.0, m), c.a); }` },
  { name: 'Motion Glitch (cam)', params: [P('Sensitivity', 0.5), P('Bands', 0.3)],
    body: `vec4 fx(){ float m = clamp(cam.x * (0.5 + p.x * 3.0), 0.0, 1.0); float row = floor(uv.y * (8.0 + p.y * 60.0));
 float j = (hash(vec2(row, floor(time * 20.0))) - 0.5) * m * 0.15; vec2 s = uv + vec2(j, 0.0), o = vec2(m * 0.02, 0.0);
 vec4 c = texture(tex, s); return vec4(texture(tex, s + o).r, c.g, texture(tex, s - o).b, c.a); }` },
  { name: 'Motion Zoom (cam)', params: [P('Amount', 0.5), P('Follow', 0.5)],
    body: `vec4 fx(){ float z = 1.0 + cam.x * p.x * 0.6; vec2 c0 = mix(vec2(0.5), cam.yz, p.y); return texture(tex, (uv - c0) / z + c0); }` },
  { name: 'Camera Key (cam)', params: [P('Amount', 0.8), P('Threshold', 0.4), P('Hue', 0.55), P('Tint', 0)],
    body: `vec4 fx(){ vec4 c = texture(tex, uv); vec3 k = texture(camTex, uv).rgb; float l = luma(k);
 float m = smoothstep(p.y, p.y + 0.1, l) * p.x; vec3 t = mix(k, hsv2rgb(vec3(p.z, 1.0, 1.0)) * l, p.w); return vec4(mix(c.rgb, t, m), c.a); }` },
  { name: 'Camera Displace (cam)', params: [P('Edges', 0.4), P('Push', 0.2)],
    body: `vec4 fx(){ vec2 px = 4.0 / res; float l = luma(texture(camTex, uv).rgb);
 float lx = luma(texture(camTex, uv + vec2(px.x, 0.0)).rgb) - l, ly = luma(texture(camTex, uv + vec2(0.0, px.y)).rgb) - l;
 return texture(tex, uv + vec2(lx, ly) * p.x * 2.0 + (l - 0.5) * p.y * 0.1); }` },
  { name: 'Camera Mix (cam)', params: [P('Amount', 0.6), P('Plain', 0)],
    body: `vec4 fx(){ vec4 c = texture(tex, uv); vec3 k = texture(camTex, uv).rgb; vec3 s = 1.0 - (1.0 - c.rgb) * (1.0 - k);
 return vec4(mix(c.rgb, mix(s, k, p.y), p.x), c.a); }` },
].forEach(d => { BUILTIN_FX.push(d); registerDef('fx', d); });

// ---------- Camera tab ----------
function camBar(label, get) {
  const i = el('i');
  camMeters.push({ i, get });
  return el('div', { className: 'fld' }, el('label', { textContent: label }), el('span', { className: 'cam-meter' }, i));
}
const camMeters = [];
function tickCamMeters() { for (const m of camMeters) m.i.style.width = (m.get() * 100).toFixed(0) + '%'; }
CAMERA_PANELS.push(() => {
  camMeters.length = 0;
  const box = el('div', { className: 'cam-box' }, el('h4', { textContent: 'Camera' }));
  if (!canCamera) { box.append(el('div', { className: 'hint', textContent: 'This browser cannot open a camera.' })); return [box]; }
  if (!camState.devices.length) camListDevices();
  const pick = el('select', { title: 'Camera' }, el('option', { value: '', textContent: 'Default camera' }),
    ...camState.devices.filter(d => d.deviceId).map(d => el('option', { value: d.deviceId, textContent: d.label || 'Camera', selected: camState.track && camState.track.deviceId === d.deviceId })));
  const item = el('div', { className: 'src-item', textContent: 'Camera clip', title: 'Drag onto a clip slot, or double-click to fill the selected slot',
    ondblclick: () => { const ci = sel.c >= 0 ? sel.c : comp.layers[sel.l].clips.findIndex(x => !x); if (ci >= 0) setClip(sel.l, ci, camClip(pick.value)); } });
  draggable(item, { kind: 'make', make: () => camClip(pick.value) });
  box.append(el('div', { className: 'fld' }, el('label', { textContent: 'Device' }), pick),
    el('div', { className: 'fld' }, el('button', { textContent: 'Show on a layer', title: 'Adds a top layer playing this camera', onclick: () => camToLayer(pick.value) })),
    el('div', { className: 'list' }, item));
  const on = !!camState.track;
  box.append(el('div', { className: 'fld' },
    el('button', { className: on ? 'on' : '', textContent: on ? 'Camera input on' : 'Use as input', title: 'Analyse this camera so effects and sliders can follow movement and light', onclick: () => (on ? camUntrack() : camTrack(pick.value)) }),
    el('label', { className: 'chk' }, el('input', { type: 'checkbox', checked: camState.mirror, onchange: e => { camState.mirror = e.target.checked; } }), ' Mirror')));
  if (on) box.append(camBar('Motion', () => camFeat.motion), camBar('Where (x)', () => camFeat.x), camBar('Where (y)', () => camFeat.y), camBar('Light', () => camFeat.bright),
    el('div', { className: 'hint', textContent: 'Sliders can follow these: click ~ next to a slider and pick a Camera source. Effects marked (cam) react by themselves.' }));
  if (camState.err) box.append(el('div', { className: 'hint', style: { color: 'var(--bad)' }, textContent: camState.err }));
  return [box];
});
