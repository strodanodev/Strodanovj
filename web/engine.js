// Strodano VJ (web) - WebGL2 engine: clips, mixing, effects, output mapping. GPL-3.0.
'use strict';
const glc = document.createElement('canvas');
glc.width = 1920; glc.height = 1080;
const gl = glc.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
if (!gl) { document.body.innerHTML = '<p style="padding:30px;font-size:15px">This browser does not support WebGL 2. Use a current version of Chrome or Edge.</p>'; throw new Error('WebGL 2 is not available'); }
const ui = { gridDirty: true, propsDirty: true, browserDirty: true, status: '' };
function setStatus(s) { ui.status = s; const el = document.getElementById('status'); if (el) el.textContent = s; }

// ---------- GL helpers ----------
const VS = `#version 300 es
out vec2 uv; out vec2 isf_FragNormCoord;
void main(){ vec2 c = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); uv = c; isf_FragNormCoord = c; gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float; precision highp int;
`;
function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log || 'compile failed'); }
  return s;
}
function mkProg(fs, vs = VS) {
  const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(log || 'link failed'); }
  const cache = {};
  return { p, loc: n => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))) };
}
function mkTex(w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function mkFbo(w, h) {
  const tex = mkTex(w, h), fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}
function freeFbo(f) { if (f) { gl.deleteFramebuffer(f.fbo); gl.deleteTexture(f.tex); } }
function mkRT(w, h) { return { f: [mkFbo(w, h), mkFbo(w, h)], cur: 0 }; }
function freeRT(rt) { if (rt) rt.f.forEach(freeFbo); }
const rtSrc = rt => rt.f[rt.cur], rtDst = rt => rt.f[1 - rt.cur], rtSwap = rt => { rt.cur = 1 - rt.cur; };
function bindFbo(f) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo); gl.viewport(0, 0, f.w, f.h); }
function clearFbo(f, a = 0) { bindFbo(f); gl.clearColor(0, 0, 0, a); gl.clear(gl.COLOR_BUFFER_BIT); }
const vao = gl.createVertexArray();
function tri() { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

// ---------- shader registry (built-in, custom and ISF) ----------
const FX_PRE = HEAD + `uniform sampler2D tex; uniform vec4 p; uniform vec4 q; uniform float time; uniform float beat; uniform float bar; uniform float phrase; uniform vec4 audio; uniform float kick; uniform vec4 cam; uniform sampler2D camTex; uniform vec2 res; uniform float mixAmt;
in vec2 uv; out vec4 o;
vec3 hsv2rgb(vec3 c){ vec3 k = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(k - 1.0, 0.0, 1.0), c.y); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 v){ return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
`;
const FX_POST = `\nvoid main(){ o = mix(texture(tex, uv), fx(), mixAmt); }\n`;
const GEN_POST = `\nvoid main(){ o = gen(); }\n`;
const ISF_PRE = HEAD + `uniform vec2 RENDERSIZE; uniform float TIME; uniform float TIMEDELTA; uniform int FRAMEINDEX; uniform int PASSINDEX; uniform vec4 DATE;
in vec2 isf_FragNormCoord; out vec4 isf_FragColor;
#define vv_FragNormCoord isf_FragNormCoord
#define IMG_THIS_PIXEL(i) texture(i, isf_FragNormCoord)
#define IMG_THIS_NORM_PIXEL(i) texture(i, isf_FragNormCoord)
#define IMG_NORM_PIXEL(i, c) texture(i, c)
#define IMG_PIXEL(i, c) texture(i, (c) / RENDERSIZE)
#define IMG_SIZE(i) RENDERSIZE
`;
const DEFS = { fx: new Map(), gen: new Map() };
let customShaders = [];   // [{name, kind, code, isf}] - saved with the composition
function registerDef(kind, d) { d.kind = kind; d.prog = null; d.err = null; d.tried = false; DEFS[kind].set(d.name, d); return d; }
BUILTIN_FX.forEach(d => registerDef('fx', d));
BUILTIN_GEN.forEach(d => registerDef('gen', d));
function defProg(d) {
  if (!d.tried) {
    d.tried = true;
    // #line makes compile errors count lines from the start of the user's code, not the hidden preamble.
    try { d.prog = mkProg(d.isf ? d.src : FX_PRE + '#line 1\n' + d.body + (d.kind === 'fx' ? FX_POST : GEN_POST)); d.err = null; }
    catch (e) { d.prog = null; d.err = String(e.message || e); }
  }
  return d.prog;
}
function parseParams(code) {
  const out = [], re = /^\s*\/\/\s*@param\s+(.+?)\s+(-?[\d.]+)\s*$/gm;
  let m;
  while ((m = re.exec(code)) && out.length < 8) out.push({ name: m[1], def: Math.min(1, Math.max(0, parseFloat(m[2]) || 0)) });
  return out;
}
function parseISF(text) {
  const m = text.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);
  if (!m) return null;
  let hdr;
  try { hdr = JSON.parse(m[1]); } catch (e) { throw new Error('ISF header is not valid JSON'); }
  if ((hdr.PASSES || []).length > 1 || (hdr.PASSES || []).some(x => x.TARGET || x.PERSISTENT)) throw new Error('multi-pass ISF shaders are not supported yet');
  if (hdr.IMPORTED && Object.keys(hdr.IMPORTED).length) throw new Error('ISF shaders with imported images are not supported yet');
  const params = [], us = [];
  let decl = '', isFx = false;
  const norm = (v, lo, hi) => (hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0);
  for (const inp of hdr.INPUTS || []) {
    const label = inp.LABEL || inp.NAME, i = params.length;
    switch (inp.TYPE) {
      case 'image':
        if (inp.NAME !== 'inputImage') throw new Error('extra image input "' + inp.NAME + '" is not supported yet');
        isFx = true; decl += 'uniform sampler2D inputImage;\n'; break;
      case 'float': {
        const lo = inp.MIN ?? 0, hi = inp.MAX ?? 1;
        params.push({ name: label, def: norm(inp.DEFAULT ?? lo, lo, hi) });
        us.push({ name: inp.NAME, type: 'float', i, lo, hi }); decl += `uniform float ${inp.NAME};\n`; break;
      }
      case 'bool': case 'event':
        params.push({ name: label, def: inp.DEFAULT ? 1 : 0, bool: true });
        us.push({ name: inp.NAME, type: 'bool', i }); decl += `uniform bool ${inp.NAME};\n`; break;
      case 'long': {
        const vals = inp.VALUES || [0, 1], di = Math.max(0, vals.indexOf(inp.DEFAULT ?? vals[0]));
        params.push({ name: label, def: vals.length > 1 ? di / (vals.length - 1) : 0 });
        us.push({ name: inp.NAME, type: 'long', i, vals }); decl += `uniform int ${inp.NAME};\n`; break;
      }
      case 'color': {
        const d = inp.DEFAULT || [1, 1, 1, 1];
        'RGBA'.split('').forEach((ch, k) => params.push({ name: label + ' ' + ch, def: d[k] ?? 1 }));
        us.push({ name: inp.NAME, type: 'color', i }); decl += `uniform vec4 ${inp.NAME};\n`; break;
      }
      case 'point2D': {
        const d = inp.DEFAULT || [0, 0], lo = inp.MIN, hi = inp.MAX;
        params.push({ name: label + ' X', def: hi ? norm(d[0], lo ? lo[0] : 0, hi[0]) : 0.5 });
        params.push({ name: label + ' Y', def: hi ? norm(d[1], lo ? lo[1] : 0, hi[1]) : 0.5 });
        us.push({ name: inp.NAME, type: 'point', i, lo, hi }); decl += `uniform vec2 ${inp.NAME};\n`; break;
      }
      default: throw new Error('ISF input type "' + inp.TYPE + '" is not supported yet');
    }
  }
  const bodyLine = text.slice(0, m.index + m[0].length).split('\n').length;   // line of the .fs file the code after the header starts on
  const body = text.slice(m.index + m[0].length).replace(/\bgl_FragColor\b/g, 'isf_FragColor').replace(/\btexture2D\b/g, 'texture').replace(/\bvarying\b/g, 'in');
  return { kind: isFx ? 'fx' : 'gen', params, isfU: us, src: ISF_PRE + decl + '#line ' + bodyLine + '\n' + body };
}
// Drop every custom shader from the registry (before loading another composition), restoring any built-in one a custom shader had replaced.
function clearCustomDefs() {
  for (const kind of ['fx', 'gen']) for (const d of [...DEFS[kind].values()]) {
    if (!d.custom) continue;
    if (d.prog) gl.deleteProgram(d.prog.p);
    DEFS[kind].delete(d.name);
  }
  BUILTIN_FX.forEach(d => { if (!DEFS.fx.has(d.name)) registerDef('fx', d); });
  BUILTIN_GEN.forEach(d => { if (!DEFS.gen.has(d.name)) registerDef('gen', d); });
}
// Register (or replace) a custom shader. Returns the def; def.err is set if it does not compile.
function applyCustom(s) {
  let d;
  const isf = parseISF(s.code);
  if (isf) { s.kind = isf.kind; s.isf = true; d = { name: s.name, custom: true, isf: true, params: isf.params, isfU: isf.isfU, src: isf.src }; }
  else { s.isf = false; d = { name: s.name, custom: true, params: parseParams(s.code), body: s.code }; }
  const old = DEFS[s.kind].get(s.name);
  if (old && old.prog) gl.deleteProgram(old.prog.p);
  DEFS[s.kind === 'fx' ? 'gen' : 'fx'].delete(s.name);
  registerDef(s.kind, d);
  defProg(d);
  return d;
}
function setDefUniforms(d, prog, params, c) {
  const P = prog.loc;
  if (d.isf) {
    gl.uniform2f(P('RENDERSIZE'), c.w, c.h);
    gl.uniform1f(P('TIME'), c.time % 3600);
    gl.uniform1f(P('TIMEDELTA'), 1 / 60);
    gl.uniform1i(P('FRAMEINDEX'), c.frame | 0);
    gl.uniform1i(P('PASSINDEX'), 0);
    for (const u of d.isfU) {
      const v = params[u.i] ?? 0;
      if (u.type === 'float') gl.uniform1f(P(u.name), u.lo + (u.hi - u.lo) * v);
      else if (u.type === 'bool') gl.uniform1i(P(u.name), v > 0.5 ? 1 : 0);
      else if (u.type === 'long') gl.uniform1i(P(u.name), u.vals[Math.round(v * (u.vals.length - 1))] | 0);
      else if (u.type === 'color') gl.uniform4f(P(u.name), v, params[u.i + 1] ?? 1, params[u.i + 2] ?? 1, params[u.i + 3] ?? 1);
      else if (u.type === 'point') {
        const y = params[u.i + 1] ?? 0;
        if (u.hi) gl.uniform2f(P(u.name), (u.lo ? u.lo[0] : 0) + (u.hi[0] - (u.lo ? u.lo[0] : 0)) * v, (u.lo ? u.lo[1] : 0) + (u.hi[1] - (u.lo ? u.lo[1] : 0)) * y);
        else gl.uniform2f(P(u.name), v * c.w, y * c.h);
      }
    }
    return;
  }
  const g = i => params[i] ?? 0;
  gl.uniform4f(P('p'), g(0), g(1), g(2), g(3));
  gl.uniform4f(P('q'), g(4), g(5), g(6), g(7));
  gl.uniform1f(P('time'), c.time % 3600);
  const b = ((c.beats % 1024) + 1024) % 1024;   // beats run negative before a track's first bar
  gl.uniform1f(P('beat'), b);
  gl.uniform1f(P('bar'), b / 4);
  gl.uniform1f(P('phrase'), b / 32);
  gl.uniform4f(P('audio'), audioFeat.bass, audioFeat.mid, audioFeat.high, audioFeat.level);
  gl.uniform1f(P('kick'), audioFeat.kick);
  // camera input (camera.js): cam = (motion, motion x, motion y, brightness), camTex = the tracked camera picture
  gl.uniform4f(P('cam'), camFeat.motion, camFeat.x, camFeat.y, camFeat.bright);
  if (P('camTex')) { bindTex(3, camState.tex); gl.uniform1i(P('camTex'), 3); }
  gl.uniform2f(P('res'), c.w, c.h);
}

// ---------- core programs ----------
const srcProg = mkProg(HEAD + `uniform sampler2D tex; uniform vec2 scl; uniform vec2 off; in vec2 uv; out vec4 o;
void main(){ vec2 s = (uv - 0.5 - off) / scl + 0.5;
 if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { o = vec4(0.0); return; }
 o = texture(tex, s); }`);
const blendProg = mkProg(HEAD + `uniform sampler2D base; uniform sampler2D top; uniform float opacity; uniform int mode; in vec2 uv; out vec4 o;
void main(){ vec4 b = texture(base, uv); vec4 t = texture(top, uv); float a = t.a * opacity; vec3 r;
 if (mode == 1) r = b.rgb + t.rgb; else if (mode == 2) r = b.rgb - t.rgb; else if (mode == 3) r = b.rgb * t.rgb;
 else if (mode == 4) r = 1.0 - (1.0 - b.rgb) * (1.0 - t.rgb); else if (mode == 5) r = max(b.rgb, t.rgb);
 else if (mode == 6) r = min(b.rgb, t.rgb); else if (mode == 7) r = abs(b.rgb - t.rgb); else r = t.rgb;
 o = vec4(clamp(mix(b.rgb, r, a), 0.0, 1.0), b.a + a * (1.0 - b.a)); }`);
const copyProg = mkProg(HEAD + `uniform sampler2D tex; uniform float gain; in vec2 uv; out vec4 o;
void main(){ vec4 c = texture(tex, uv); o = vec4(c.rgb * gain, 1.0); }`);
// Clip transitions: the new clip (A) replaces the old one (B) as t goes 0 -> 1.
const TRANSITION_TYPES = ['Fade', 'Wipe right', 'Wipe left', 'Wipe up', 'Wipe down', 'Dissolve', 'Luma', 'Through black', 'Zoom', 'Iris'];
const transProg = mkProg(HEAD + `uniform sampler2D A; uniform sampler2D B; uniform float t; uniform int mode; uniform vec2 res; in vec2 uv; out vec4 o;
float h(vec2 v){ return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float edge(float r, float t){ const float s = 0.06; return 1.0 - smoothstep(t * (1.0 + s) - s, t * (1.0 + s), r); }
void main(){
 vec4 n = texture(A, uv), b = texture(B, uv); float k = t;
 if (mode == 1) k = edge(uv.x, t); else if (mode == 2) k = edge(1.0 - uv.x, t);
 else if (mode == 3) k = edge(uv.y, t); else if (mode == 4) k = edge(1.0 - uv.y, t);
 else if (mode == 5) k = edge(h(floor(uv * res / 6.0)), t);
 else if (mode == 6) k = edge(1.0 - dot(n.rgb, vec3(0.299, 0.587, 0.114)), t);
 else if (mode == 7) { o = t < 0.5 ? mix(b, vec4(0.0, 0.0, 0.0, b.a), t * 2.0) : mix(vec4(0.0, 0.0, 0.0, n.a), n, t * 2.0 - 1.0); return; }
 else if (mode == 8) { b = texture(B, (uv - 0.5) / (1.0 + t * 0.8) + 0.5); n = texture(A, (uv - 0.5) * (1.0 + (1.0 - t) * 0.5) + 0.5); }
 else if (mode == 9) k = edge(length((uv - 0.5) * vec2(res.x / res.y, 1.0)) / 1.05, t);
 o = mix(b, n, k); }`);
const BLENDS = ['Alpha', 'Add', 'Subtract', 'Multiply', 'Screen', 'Lighten', 'Darken', 'Difference'];

// ---------- media pool and clips ----------
// Extra clip types (camera.js, text.js, smart3d.js) register here instead of editing the engine:
//   CLIP_TYPES[type] = { toJSON(c), fromJSON(j), free(c), props(c, panel, layer) }; such clips draw themselves through c.draw(fbo, layer).
// SOURCE_PANELS holds functions that return extra elements for the Sources tab.
const CLIP_TYPES = {}, SOURCE_PANELS = [];
const media = [];   // {id, name, url, kind}
let mediaSeq = 1;
const isVideoName = n => /\.(mp4|mov|m4v|webm|mkv|avi|ogv)$/i.test(n);
const isImageName = n => /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(n);
function addMediaFiles(files) {
  const added = [];
  for (const f of files) {
    const kind = f.type.startsWith('video') || isVideoName(f.name) ? 'video' : f.type.startsWith('image') || isImageName(f.name) ? 'image' : null;
    if (!kind) continue;
    let m = media.find(x => x.name === f.name);
    if (!m) { m = { id: mediaSeq++, name: f.name, url: URL.createObjectURL(f), kind }; media.push(m); }
    added.push(m);
    // relink clips that were saved with this file name
    comp.layers.forEach((L, li) => L.clips.forEach((c, ci) => {
      if (c && c.missing && c.fileName === m.name) { const n = mediaClip(m); n.speed = c.speed; n.name = c.name; L.clips[ci] = n; }
    }));
  }
  ui.gridDirty = ui.browserDirty = true;
  return added;
}
function thumbOf(source, w, h) {
  try {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const x = c.getContext('2d'), s = Math.max(160 / w, 90 / h);
    x.drawImage(source, (160 - w * s) / 2, (90 - h * s) / 2, w * s, h * s);
    return c.toDataURL('image/jpeg', 0.7);
  } catch (e) { return null; }
}
function mediaClip(m) {
  const c = { type: m.kind, name: m.name.replace(/\.[^.]+$/, ''), fileName: m.name, tex: null, w: 0, h: 0, speed: 1, thumb: null };
  if (m.kind === 'video') {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto' });
    v.addEventListener('loadeddata', () => { c.w = v.videoWidth; c.h = v.videoHeight; c.thumb = thumbOf(v, c.w, c.h); ui.gridDirty = true; }, { once: true });
    v.addEventListener('error', () => { c.error = true; setStatus('This browser cannot play ' + m.name); ui.gridDirty = true; });
    v.src = m.url;
    c.video = v;
  } else {
    const img = new Image();
    img.onload = () => { c.w = img.naturalWidth; c.h = img.naturalHeight; c.thumb = thumbOf(img, c.w, c.h); c.dirty = true; ui.gridDirty = true; };
    img.src = m.url;
    c.img = img;
  }
  return c;
}
function genClip(name) {
  const d = DEFS.gen.get(name);
  if (!d) return null;
  return { uid: newUid(), type: 'gen', name, gen: name, params: d.params.map(x => x.def), speed: 1, thumb: null, needThumb: true };
}
function freeClip(c) {
  if (!c) return;
  if (CLIP_TYPES[c.type] && CLIP_TYPES[c.type].free) CLIP_TYPES[c.type].free(c);
  if (c.video) { c.video.pause(); c.video.removeAttribute('src'); c.video.load(); }
  if (c.tex) gl.deleteTexture(c.tex);
}
function uploadClip(c) {
  const src = c.video || c.img;
  if (!c.tex) c.tex = mkTex(0, 0);
  gl.bindTexture(gl.TEXTURE_2D, c.tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  c.ready = true;
}

// ---------- composition ----------
const comp = { w: 1920, h: 1080, columns: 8, layers: [], fx: [], master: 1, crossfade: 0.5, bpm: 120, beats: 0, time: 0, frame: 0, rt: null, outTex: null };
function newLayer() {
  return { name: 'Layer ' + (comp.layers.length + 1), clips: new Array(comp.columns).fill(null), active: -1, pendingCol: -1, opacity: 1, blend: 0, bypass: false, solo: false,
    xfade: 0, scale: 1, x: 0, y: 0, fit: 0, fx: [], rt: mkRT(comp.w, comp.h), outTex: null,
    trans: 0, transType: 0, from: -1, transT0: 0, transDur: 0, tf: null };   // trans: transition length in beats (0 = cut), transType: TRANSITION_TYPES index; from: clip going out
}
function addLayer() { comp.layers.push(newLayer()); ui.gridDirty = true; }
function removeLayer(i) {
  if (comp.layers.length <= 1) return;
  const L = comp.layers[i];
  L.clips.forEach(freeClip); freeRT(L.rt); freeFbo(L.tf);
  comp.layers.splice(i, 1); ui.gridDirty = ui.propsDirty = true;
}
function setColumns(n) {
  n = Math.min(32, Math.max(1, n));
  comp.layers.forEach((L, i) => {
    if (L.active >= n || L.pendingCol >= n) eject(i);
    L.clips.slice(n).forEach(freeClip);
    L.clips.length = n;
    for (let k = 0; k < n; k++) if (L.clips[k] === undefined) L.clips[k] = null;
  });
  comp.columns = n; ui.gridDirty = true;
}
function resizeComp(w, h) {
  comp.w = w; comp.h = h;
  freeRT(comp.rt); comp.rt = mkRT(w, h);
  comp.layers.forEach(L => { freeRT(L.rt); L.rt = mkRT(w, h); freeFbo(L.tf); L.tf = null; });
}
function resetComp(layers = 3, columns = 8) {
  comp.layers.forEach(L => { L.clips.forEach(freeClip); freeRT(L.rt); freeFbo(L.tf); });
  comp.layers = []; comp.fx = []; comp.columns = columns; comp.master = 1; comp.crossfade = 0.5;
  freeRT(comp.rt); comp.rt = mkRT(comp.w, comp.h);
  for (let i = 0; i < layers; i++) addLayer();
  ui.gridDirty = ui.propsDirty = true;
}
function setClip(li, ci, clip) {
  const L = comp.layers[li];
  if (!L || ci < 0 || ci >= comp.columns) return;
  if (L.active === ci || L.pendingCol === ci) eject(li);
  if (L.from === ci) endTransition(L);
  freeClip(L.clips[ci]);
  L.clips[ci] = clip;
  ui.gridDirty = ui.propsDirty = true;
}
const pauseClip = c => { if (c && c.video) c.video.pause(); };
function eject(li) {
  const L = comp.layers[li];
  if (!L) return;
  [L.active, L.pendingCol, L.from].forEach(k => pauseClip(L.clips[k]));
  L.active = L.pendingCol = L.from = -1; L.outTex = null;
}
// The clip in column ci takes over the layer. With a transition set and a clip on screen, the old one keeps playing and fades out.
function switchActive(L, ci) {
  const prev = L.active;
  if (L.from >= 0 && L.from !== ci && L.from !== prev) pauseClip(L.clips[L.from]);
  if (prev >= 0 && prev !== ci && L.trans > 0 && L.outTex) { L.from = prev; L.transT0 = comp.time; L.transDur = L.trans * 60 / comp.bpm; }
  else { if (prev !== ci) pauseClip(L.clips[prev]); L.from = -1; }
  L.active = ci; L.pendingCol = -1;
}
function endTransition(L) { if (L.from >= 0 && L.from !== L.active) pauseClip(L.clips[L.from]); L.from = -1; }
function trigger(li, ci) {
  const L = comp.layers[li], c = L && L.clips[ci];
  if (!c || c.missing || c.error) return;
  if (typeof quantHold === 'function' && quantHold(li, ci)) return;   // mix.js: wait for the next beat or bar while music plays
  if (c.video) {
    try { c.video.currentTime = 0; } catch (e) {}
    c.video.playbackRate = Math.min(16, Math.max(0.0625, c.speed || 1));
    if (c.speed > 0) c.video.play().catch(() => {});
    if (L.active === ci) return;
    L.pendingCol = ci;   // the old clip keeps playing until this one has a frame
  } else switchActive(L, ci);
}
function triggerColumn(ci) { comp.layers.forEach((L, li) => { if (L.clips[ci]) trigger(li, ci); }); }
// Effects and generator clips carry a uid that is saved with the composition, so MIDI mappings can find them after reordering.
function newUid() { return Math.random().toString(36).slice(2, 10); }
const keepUid = (o, u) => { if (typeof u === 'string' && u) o.uid = u; };
function mkEffect(name) { const d = DEFS.fx.get(name); return d ? { uid: newUid(), def: name, params: d.params.map(x => x.def), mix: 1, bypass: false } : null; }

function applyChain(chain, rt) {
  for (const e of chain) {
    if (e.bypass) continue;
    const d = DEFS.fx.get(e.def), prog = d && defProg(d);
    if (!prog) continue;
    bindFbo(rtDst(rt));
    gl.useProgram(prog.p);
    bindTex(0, rtSrc(rt).tex);
    gl.uniform1i(prog.loc(d.isf ? 'inputImage' : 'tex'), 0);
    gl.uniform1f(prog.loc('mixAmt'), e.mix);
    setDefUniforms(d, prog, modParams(e.params, e.mod), comp);
    tri();
    rtSwap(rt);
  }
}
// Live audio levels, 0..1, written by audio.js every frame and read by every shader (audio.xyzw = bass, mid, high, level).
const audioFeat = { bass: 0, mid: 0, high: 0, level: 0, kick: 0 };
// Set by audio.js. Returns { beats, bpm } while a deck with a beat grid is playing, so the visuals follow the music itself.
let musicClock = null;
// dt is capped for animation; beatDt is the real time since the last frame, so a stalled frame never puts the beat behind.
function update(dt, beatDt = dt) {
  comp.time += dt; comp.frame++;
  const mc = musicClock && musicClock();
  if (mc) { comp.beats = mc.beats; comp.bpm = mc.bpm; } else comp.beats += beatDt * comp.bpm / 60;
  for (const L of comp.layers) {
    if (L.pendingCol >= 0) {
      const c = L.clips[L.pendingCol];
      if (!c || c.error) L.pendingCol = -1;
      else if (c.video.readyState >= 2) switchActive(L, L.pendingCol);
    }
  }
}
// Draw clip c (generator, video or image, with the layer's fit / scale / position) into framebuffer f. False if it has no picture yet.
function drawSource(L, c, f) {
  if (c.draw) return c.draw(f, L);   // camera / text / 3D clips (CLIP_TYPES)
  if (c.type === 'gen') {
    const d = DEFS.gen.get(c.gen), prog = d && defProg(d);
    if (!prog) return false;
    bindFbo(f); gl.useProgram(prog.p); setDefUniforms(d, prog, modParams(c.params, c.mod), comp); tri();
    return true;
  }
  if (c.video ? c.video.readyState >= 2 : c.dirty) { uploadClip(c); c.dirty = false; if (c.video) { c.w = c.video.videoWidth; c.h = c.video.videoHeight; } }
  if (!c.ready || !c.w || !c.h) return false;
  const va = c.w / c.h, ca = comp.w / comp.h;
  let sx = 1, sy = 1;
  if (L.fit === 0) { if (va > ca) sx = va / ca; else sy = ca / va; }
  else if (L.fit === 1) { if (va > ca) sy = ca / va; else sx = va / ca; }
  clearFbo(f);
  gl.useProgram(srcProg.p);
  bindTex(0, c.tex);
  gl.uniform1i(srcProg.loc('tex'), 0);
  gl.uniform2f(srcProg.loc('scl'), sx * L.scale, sy * L.scale);
  gl.uniform2f(srcProg.loc('off'), L.x, L.y);
  tri();
  return true;
}
// While a transition runs, cross-fade from the outgoing clip to the new one (smoothstep, timed in beats at the tempo it started with).
function applyTransition(L) {
  const fc = L.from >= 0 ? L.clips[L.from] : null;
  if (!fc) { L.from = -1; return; }
  const t = L.transDur > 0 ? (comp.time - L.transT0) / L.transDur : 1;
  if (t >= 1) { endTransition(L); return; }
  if (!L.tf) L.tf = mkFbo(comp.w, comp.h);
  if (!drawSource(L, fc, L.tf)) return;
  bindFbo(rtDst(L.rt));
  gl.useProgram(transProg.p);
  bindTex(0, rtSrc(L.rt).tex); bindTex(1, L.tf.tex);
  gl.uniform1i(transProg.loc('A'), 0); gl.uniform1i(transProg.loc('B'), 1);
  gl.uniform1f(transProg.loc('t'), t * t * (3 - 2 * t)); gl.uniform1i(transProg.loc('mode'), L.transType | 0);
  gl.uniform2f(transProg.loc('res'), comp.w, comp.h);
  tri(); rtSwap(L.rt);
}
function renderComp() {
  gl.disable(gl.BLEND);
  const anySolo = comp.layers.some(L => L.solo);
  for (const L of comp.layers) {
    const c = L.clips[L.active];
    if (!c || L.bypass || (anySolo && !L.solo)) { L.outTex = null; continue; }
    L.rt.cur = 0;
    if (!drawSource(L, c, rtDst(L.rt))) { L.outTex = null; continue; }
    rtSwap(L.rt);
    applyTransition(L);
    applyChain(L.fx, L.rt);
    L.outTex = rtSrc(L.rt).tex;
  }
  const rt = comp.rt;
  rt.cur = 0;
  clearFbo(rtSrc(rt));
  for (const L of comp.layers) {
    if (!L.outTex) continue;
    let gain = 1;
    if (L.xfade === 1) gain = Math.min(1, Math.max(0, (1 - comp.crossfade) * 2));
    if (L.xfade === 2) gain = Math.min(1, Math.max(0, comp.crossfade * 2));
    const op = L.opacity * gain;
    if (op <= 0) continue;
    bindFbo(rtDst(rt));
    gl.useProgram(blendProg.p);
    bindTex(1, L.outTex); bindTex(0, rtSrc(rt).tex);
    gl.uniform1i(blendProg.loc('base'), 0); gl.uniform1i(blendProg.loc('top'), 1);
    gl.uniform1f(blendProg.loc('opacity'), op); gl.uniform1i(blendProg.loc('mode'), L.blend);
    tri(); rtSwap(rt);
  }
  applyChain(comp.fx, rt);
  bindFbo(rtDst(rt));
  gl.useProgram(copyProg.p);
  bindTex(0, rtSrc(rt).tex);
  gl.uniform1i(copyProg.loc('tex'), 0); gl.uniform1f(copyProg.loc('gain'), comp.master);
  tri(); rtSwap(rt);
  comp.outTex = rtSrc(rt).tex;
}

// Draw a texture into the hidden GL canvas, then copy that region into a 2D canvas (preview or output window).
function ensureCanvas(w, h) { if (glc.width < w || glc.height < h) { glc.width = Math.max(glc.width, w); glc.height = Math.max(glc.height, h); } }
function present(tex, w, h) {
  ensureCanvas(w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(copyProg.p);
  bindTex(0, tex);
  gl.uniform1i(copyProg.loc('tex'), 0); gl.uniform1f(copyProg.loc('gain'), tex ? 1 : 0);
  tri();
}
function grab(ctx, w, h) { ctx.drawImage(glc, 0, glc.height - h, w, h, 0, 0, ctx.canvas.width, ctx.canvas.height); }

// ---------- output mapping ----------
const meshProg = mkProg(HEAD + `uniform sampler2D tex; uniform float feather; uniform float bright; uniform int mask; uniform int pattern;
in vec2 uv; in vec2 st; out vec4 o;
void main(){ float a = 1.0;
 if (feather > 0.0) { vec2 d = min(st, 1.0 - st); a = smoothstep(0.0, feather, d.x) * smoothstep(0.0, feather, d.y); }
 if (mask == 1) { o = vec4(0.0, 0.0, 0.0, a); return; }
 vec3 c = texture(tex, uv).rgb * bright;
 if (pattern == 1) { vec2 g = abs(fract(st * 8.0) - 0.5); float line = step(0.46, max(g.x, g.y));
  float edge = step(min(min(st.x, st.y), min(1.0 - st.x, 1.0 - st.y)), 0.01);
  float diag = step(abs(st.x - st.y), 0.004) + step(abs(st.x + st.y - 1.0), 0.004);
  c = mix(vec3(st.x * 0.35, 0.12, st.y * 0.35), vec3(1.0), clamp(line + edge + diag, 0.0, 1.0)); }
 o = vec4(c, a); }`, `#version 300 es
layout(location=0) in vec2 pos; layout(location=1) in vec2 tc; layout(location=2) in vec2 st0;
out vec2 uv; out vec2 st;
void main(){ uv = tc; st = st0; gl_Position = vec4(pos, 0.0, 1.0); }`);
const TESS = 24;
const meshVao = gl.createVertexArray(), meshVbo = gl.createBuffer();
const meshData = new Float32Array(TESS * TESS * 6 * 6);
gl.bindVertexArray(meshVao);
gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
gl.bufferData(gl.ARRAY_BUFFER, meshData.byteLength, gl.STREAM_DRAW);
for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 2, gl.FLOAT, false, 24, i * 8); }
gl.bindVertexArray(null);

function newSlice(name, mask) {
  return { name, enabled: true, mask: !!mask, in: [0, 0, 1, 1], c: mask ? [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]] : [[0, 0], [1, 0], [1, 1], [0, 1]],
    grid: 0, warp: [], feather: 0, bright: 1, flipH: false, flipV: false };
}
function setGrid(sl, n) { sl.grid = Math.min(8, Math.max(0, n | 0)); sl.warp = new Array(sl.grid ? (sl.grid + 1) * (sl.grid + 1) * 2 : 0).fill(0); }
const screens = [{ name: 'Screen 1', win: null, ctx: null, slices: [newSlice('Slice 1')] }];
const out = { testPattern: false };
// Projective map of the unit square onto the quad (TL, TR, BR, BL), plus the mesh-warp offsets.
function slicePoint(sl, s, t) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = sl.c;
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  let g = 0, h = 0;
  if (Math.abs(den) > 1e-9) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  let wq = g * s + h * t + 1;
  if (Math.abs(wq) < 1e-6) wq = 1e-6;
  let x = (a * s + b * t + x0) / wq, y = (d * s + e * t + y0) / wq;
  const n = sl.grid;
  if (n > 0 && sl.warp.length >= (n + 1) * (n + 1) * 2) {
    const fs = s * n, ft = t * n, i = Math.min(Math.floor(fs), n - 1), j = Math.min(Math.floor(ft), n - 1), u = fs - i, v = ft - j;
    const at = (ii, jj, k) => sl.warp[(jj * (n + 1) + ii) * 2 + k];
    x += (at(i, j, 0) * (1 - u) + at(i + 1, j, 0) * u) * (1 - v) + (at(i, j + 1, 0) * (1 - u) + at(i + 1, j + 1, 0) * u) * v;
    y += (at(i, j, 1) * (1 - u) + at(i + 1, j, 1) * u) * (1 - v) + (at(i, j + 1, 1) * (1 - u) + at(i + 1, j + 1, 1) * u) * v;
  }
  return [x, y];
}
function drawSlice(sl) {
  let k = 0;
  const vert = (i, j) => {
    const s = i / TESS, t = j / TESS, [x, y] = slicePoint(sl, s, t);
    const ss = sl.flipH ? 1 - s : s, tt = sl.flipV ? 1 - t : t;
    meshData[k++] = x * 2 - 1; meshData[k++] = 1 - y * 2;
    meshData[k++] = sl.in[0] + ss * sl.in[2]; meshData[k++] = 1 - (sl.in[1] + tt * sl.in[3]);
    meshData[k++] = s; meshData[k++] = t;
  };
  for (let j = 0; j < TESS; j++) for (let i = 0; i < TESS; i++) { vert(i, j); vert(i + 1, j); vert(i + 1, j + 1); vert(i, j); vert(i + 1, j + 1); vert(i, j + 1); }
  gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, meshData);
  gl.uniform1f(meshProg.loc('feather'), sl.feather);
  gl.uniform1f(meshProg.loc('bright'), sl.bright);
  gl.uniform1i(meshProg.loc('mask'), sl.mask ? 1 : 0);
  gl.uniform1i(meshProg.loc('pattern'), out.testPattern && !sl.mask ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, TESS * TESS * 6);
}
function renderScreen(scr, w, h) {
  ensureCanvas(w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
  if (!comp.outTex) return;
  gl.useProgram(meshProg.p);
  bindTex(0, comp.outTex);
  gl.uniform1i(meshProg.loc('tex'), 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(meshVao);
  for (const sl of scr.slices) if (sl.enabled) drawSlice(sl);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(vao);
}
function openOutput(i) {
  const s = screens[i];
  if (s.win && !s.win.closed) { s.win.focus(); return true; }
  const w = window.open('', 'strodano_out_' + i, 'width=960,height=540');
  if (!w) { setStatus('The browser blocked the output window. Allow pop-ups for this page.'); return false; }
  w.document.open();
  w.document.write(`<!DOCTYPE html><title>Strodano VJ output</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
canvas{width:100vw;height:100vh;display:block}#h{position:fixed;left:12px;bottom:10px;color:#999;font:13px system-ui;transition:opacity 1s}</style>
<canvas id="c"></canvas><div id="h">Drag this window onto the projector or second display, then double-click for fullscreen.</div>`);
  w.document.close();
  w.document.title = s.name + ' - Strodano VJ output';   // set as text: the name can come from a shared .svj file
  const c = w.document.getElementById('c');
  const fit = () => { c.width = Math.max(16, Math.round(w.innerWidth * w.devicePixelRatio)); c.height = Math.max(16, Math.round(w.innerHeight * w.devicePixelRatio)); };
  fit();
  w.addEventListener('resize', fit);
  w.addEventListener('dblclick', () => { if (w.document.fullscreenElement) w.document.exitFullscreen(); else w.document.documentElement.requestFullscreen().catch(() => {}); });
  w.document.addEventListener('fullscreenchange', () => { w.document.body.style.cursor = w.document.fullscreenElement ? 'none' : ''; });
  w.setTimeout(() => { const hint = w.document.getElementById('h'); if (hint) hint.style.opacity = 0; }, 6000);
  s.win = w; s.ctx = c.getContext('2d', { alpha: false });
  return true;
}
function closeOutput(i) { const s = screens[i]; if (s.win && !s.win.closed) s.win.close(); s.win = null; s.ctx = null; }
const liveScreens = () => screens.filter(s => s.win && !s.win.closed);
window.addEventListener('beforeunload', () => screens.forEach((s, i) => closeOutput(i)));

// ---------- save / load ----------
function compToJSON() {
  const fxJ = ch => ch.map(e => ({ uid: e.uid, def: e.def, params: e.params, mix: e.mix, bypass: e.bypass, mod: e.mod }));
  return {
    app: 'Strodano VJ', version: 2, w: comp.w, h: comp.h, columns: comp.columns, master: comp.master, crossfade: comp.crossfade, bpm: comp.bpm,
    shaders: customShaders.map(s => ({ name: s.name, kind: s.kind, code: s.code })),
    fx: fxJ(comp.fx),
    agentTags: comp.agentTags || {},   // the Agent's column tags (agent.js)
    score: typeof scoreToJSON === 'function' ? scoreToJSON() : undefined,   // section looks (score.js)
    layers: comp.layers.map(L => ({
      name: L.name, locked: L.locked || undefined, opacity: typeof agentLevel === 'function' ? agentLevel(L) : L.opacity,   // your level, not the Agent's fade blend: L.blend, bypass: L.bypass, solo: L.solo, xfade: L.xfade, scale: L.scale, x: L.x, y: L.y, fit: L.fit, trans: L.trans, transType: L.transType, fx: fxJ(L.fx),
      clips: L.clips.map(c => c && (CLIP_TYPES[c.type] ? CLIP_TYPES[c.type].toJSON(c) : c.type === 'gen' ? { type: 'gen', uid: c.uid, gen: c.gen, name: c.name, params: c.params, mod: c.mod } : { type: c.type, name: c.name, fileName: c.fileName, speed: c.speed })),
    })),
    screens: screens.map(s => ({ name: s.name, slices: s.slices.map(sl => ({ ...sl, c: sl.c.map(q => [...q]), in: [...sl.in], warp: [...sl.warp] })) })),
  };
}
function loadComp(j) {
  if (!j || !Array.isArray(j.layers)) return false;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const fxL = arr => (Array.isArray(arr) ? arr : []).map(e => { const n = mkEffect(e.def); if (!n) return null; (e.params || []).forEach((v, i) => { if (i < n.params.length) n.params[i] = num(v, 0); }); n.mix = num(e.mix, 1); n.bypass = !!e.bypass; keepUid(n, e.uid); n.mod = loadMod(e.mod); return n; }).filter(Boolean);
  comp.w = Math.min(8192, Math.max(16, num(j.w, 1920) | 0)); comp.h = Math.min(8192, Math.max(16, num(j.h, 1080) | 0));
  clearCustomDefs();
  customShaders = (Array.isArray(j.shaders) ? j.shaders : []).filter(s => s && s.name && s.code).map(s => ({ name: String(s.name), kind: s.kind === 'gen' ? 'gen' : 'fx', code: String(s.code) }));
  customShaders.forEach(s => { try { applyCustom(s); } catch (e) {} });
  resetComp(0, Math.min(32, Math.max(1, num(j.columns, 8) | 0)));
  comp.master = num(j.master, 1); comp.crossfade = num(j.crossfade, 0.5); comp.bpm = num(j.bpm, 120);
  comp.agentTags = {};
  if (j.agentTags && typeof j.agentTags === 'object') for (const k in j.agentTags) if (+k >= 0 && +k < 32 && ['Calm', 'Groove', 'Peak', 'Drop'].includes(j.agentTags[k])) comp.agentTags[+k] = j.agentTags[k];
  comp.fx = fxL(j.fx);
  for (const l of j.layers) {
    addLayer();
    const L = comp.layers[comp.layers.length - 1];
    Object.assign(L, { name: String(l.name || L.name), locked: !!l.locked, opacity: num(l.opacity, 1), blend: Math.min(7, Math.max(0, num(l.blend, 0) | 0)), bypass: !!l.bypass, solo: !!l.solo,
      xfade: Math.min(2, Math.max(0, num(l.xfade, 0) | 0)), scale: num(l.scale, 1), x: num(l.x, 0), y: num(l.y, 0), fit: Math.min(2, Math.max(0, num(l.fit, 0) | 0)), trans: Math.min(16, Math.max(0, num(l.trans, 0))), transType: Math.min(TRANSITION_TYPES.length - 1, Math.max(0, num(l.transType, 0) | 0)) });
    L.fx = fxL(l.fx);
    (l.clips || []).slice(0, comp.columns).forEach((c, ci) => {
      if (!c) return;
      if (CLIP_TYPES[c.type]) { const x = CLIP_TYPES[c.type].fromJSON(c); if (x) { keepUid(x, c.uid); x.mod = loadMod(c.mod); L.clips[ci] = x; } return; }
      if (c.type === 'gen') { const g = genClip(c.gen); if (g) { g.name = c.name || g.name; keepUid(g, c.uid); g.mod = loadMod(c.mod); (c.params || []).forEach((v, i) => { if (i < g.params.length) g.params[i] = num(v, 0); }); L.clips[ci] = g; } }
      else if (c.fileName) {
        const m = media.find(x => x.name === c.fileName);
        const n = m ? mediaClip(m) : { type: c.type === 'image' ? 'image' : 'video', missing: true, fileName: c.fileName, thumb: null };
        n.name = c.name || c.fileName; n.speed = num(c.speed, 1); L.clips[ci] = n;
      }
    });
  }
  if (!comp.layers.length) addLayer();
  if (Array.isArray(j.screens) && j.screens.length) {
    screens.forEach((s, i) => closeOutput(i));
    screens.length = 0;
    for (const s of j.screens) {
      screens.push({ name: String(s.name || 'Screen'), win: null, ctx: null, slices: (s.slices || []).map(q => {
        const sl = newSlice(String(q.name || 'Slice'), q.mask);
        sl.enabled = q.enabled !== false; sl.feather = num(q.feather, 0); sl.bright = num(q.bright, 1); sl.flipH = !!q.flipH; sl.flipV = !!q.flipV;
        if (Array.isArray(q.in) && q.in.length === 4) sl.in = q.in.map(v => num(v, 0));
        if (Array.isArray(q.c) && q.c.length === 4) sl.c = q.c.map(pt => [num(pt[0], 0), num(pt[1], 0)]);
        setGrid(sl, num(q.grid, 0));
        if (Array.isArray(q.warp) && q.warp.length === sl.warp.length) sl.warp = q.warp.map(v => num(v, 0));
        return sl;
      }) });
    }
  }
  if (typeof scoreFromJSON === 'function') scoreFromJSON(j.score);   // after the layers and effects exist: looks refer to them
  ui.gridDirty = ui.propsDirty = ui.browserDirty = true;
  return true;
}
function demoComp() {
  resetComp(3, 8);
  if (typeof scoreFromJSON === 'function') scoreFromJSON(null);   // a new composition starts with no section looks
  [['Plasma', 'Tunnel', 'Gradient'], ['Lines', 'Checkerboard'], ['Beat Flash']].forEach((row, li) => row.forEach((g, ci) => { comp.layers[li].clips[ci] = genClip(g); }));
  comp.layers[1].blend = 1; comp.layers[2].blend = 1;
  // 4 different random 3D visuals (smart3d.js) in the first free slots: one per layer, the 4th on layer 1. Layer 2's starts playing.
  if (typeof SCENES3D !== 'undefined' && typeof THREE !== 'undefined') {
    const keys = Object.keys(SCENES3D).sort(() => Math.random() - 0.5).slice(0, 4);
    keys.forEach((k, i) => { const L = comp.layers[i % 3], ci = L.clips.findIndex(c => !c); if (ci >= 0) L.clips[ci] = clip3d(k); });
    const L2 = comp.layers[1], c3d = L2.clips.findIndex(c => c && c.type === '3d');
    if (c3d >= 0) trigger(1, c3d);
  }
  trigger(0, 0);
}
