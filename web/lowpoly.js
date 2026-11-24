// Strodano VJ (web) - low-poly 3D scenes: endless themed worlds and stylized objects, added to SCENES3D (smart3d.js). GPL-3.0.
// The scenery (trees, rocks, towers...) is built here: every such model is a short list of parts (boxes, cylinders, cones,
// low spheres) joined into one flat-shaded geometry when the scene is built. The hero models (dinosaurs, tank, ships,
// weapons...) are artist-made CC0 models from models3d.js (lpModelGeo); each keeps a built-in stand-in for a page without that file.
//   part = [shape, colour, size x, y, z, place x, y, z, turn x, y, z (degrees)]
//   shape: 'b' box, 'c6' cylinder with 6 sides, 't6' tapered (top half as wide), 'k6' cone, 's' / 'S' sphere of 20 / 80 faces
//   colour: 0xRRGGBB, or LP_E | 0xRRGGBB for a part that glows (lava, neon, eyes, engines) and flashes on the kick
// Two engines draw them. lpWorld(theme): a flight through props that wrap round from the far end to the near one
// (instances placed in the vertex shader, like Neon City), over a scrolling ground, under a sky, through drifting
// particles. lpObject(model): one model on a turntable with a rim light and a cloud of points sampled from its own
// surface, which the kick bursts apart and Dissolve turns the model into.
'use strict';
const LP_E = 0x1000000, LP_UNIT = {};
function lpUnit(shape) {   // a unit shape (1 wide, 1 high, centred) as a flat list of triangle corners
  if (LP_UNIT[shape]) return LP_UNIT[shape];
  const k = shape[0], n = +shape.slice(1) || 6, v = [], tri = (a, b, c) => v.push(...a, ...b, ...c);
  if (k === 'b') {
    const q = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(p => p.map(x => x / 2));
    [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]].forEach(f => { tri(q[f[0]], q[f[1]], q[f[2]]); tri(q[f[0]], q[f[2]], q[f[3]]); });
  } else if (k === 's' || k === 'S') v.push(...new THREE.IcosahedronGeometry(0.5, k === 's' ? 0 : 1).attributes.position.array);
  else {
    const top = k === 'c' ? 1 : k === 't' ? 0.5 : 0;
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.2832, b = (i + 1) / n * 6.2832, A = [Math.cos(a) / 2, -0.5, Math.sin(a) / 2], B = [Math.cos(b) / 2, -0.5, Math.sin(b) / 2];
      const C = [B[0] * top, 0.5, B[2] * top], D = [A[0] * top, 0.5, A[2] * top];
      tri(A, B, C); tri([0, -0.5, 0], B, A);
      if (top) { tri(A, C, D); tri([0, 0.5, 0], D, C); }
    }
  }
  return (LP_UNIT[shape] = v);
}
// Parts -> one geometry: position, a flat normal per face (turned to point away from its part's middle, so the corner
// order of the unit shapes does not matter) and aCol = colour, each face a touch lighter or darker, + glow in alpha.
// fit: centre the model and scale it so its longest side is that long (the objects; world props keep their own size).
function lpGeo(parts, fit) {
  const pos = [], nor = [], col = [], m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3(), o = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), D = Math.PI / 180;
  let rnd = 7;
  for (const p of parts) {
    const u = lpUnit(p[0]), hex = p[1] & 0xffffff, em = p[1] > 0xffffff ? 1 : 0;
    o.set(p[5] || 0, p[6] || 0, p[7] || 0); e.set((p[8] || 0) * D, (p[9] || 0) * D, (p[10] || 0) * D); m.compose(o, q.setFromEuler(e), s.set(p[2], p[3], p[4]));
    for (let i = 0; i < u.length; i += 9) {
      a.set(u[i], u[i + 1], u[i + 2]).applyMatrix4(m); b.set(u[i + 3], u[i + 4], u[i + 5]).applyMatrix4(m); c.set(u[i + 6], u[i + 7], u[i + 8]).applyMatrix4(m);
      n.copy(b).sub(a).cross(t.copy(c).sub(a)).normalize();
      if (n.dot(t.copy(a).add(b).add(c).divideScalar(3).sub(o)) < 0) n.negate();
      rnd = (rnd * 16807) % 2147483647; const sh = em ? 1 : 0.84 + 0.3 * (rnd % 1000) / 1000;
      for (const w of [a, b, c]) { pos.push(w.x, w.y, w.z); nor.push(n.x, n.y, n.z); col.push((hex >> 16 & 255) / 255 * sh, (hex >> 8 & 255) / 255 * sh, (hex & 255) / 255 * sh, em); }
    }
  }
  if (fit) {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], pos[i]); hi[i % 3] = Math.max(hi[i % 3], pos[i]); }
    const k = fit / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    for (let i = 0; i < pos.length; i++) pos[i] = (pos[i] - (lo[i % 3] + hi[i % 3]) / 2) * k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', attr(new Float32Array(pos), 3)); g.setAttribute('normal', attr(new Float32Array(nor), 3)); g.setAttribute('aCol', attr(new Float32Array(col), 4));
  return g;
}
// An artist-made model from models3d.js (LP_MODELS, built by tools/models3d.py from CC0 .glb files), as the same kind of
// geometry lpGeo makes. The file has no normals: every corner gets the average of the faces that meet in it, weighted by
// their size, and since corners on a hard edge or a colour border are stored apart, those edges stay hard. fit = the
// length of its longest side; ground: stand it on y = 0 (a world prop) instead of centring it (an object).
const lpHas = name => typeof LP_MODELS !== 'undefined' && !!LP_MODELS[name];
function lpModelGeo(name, fit, ground) {
  const m = LP_MODELS[name], bin = atob(m.d), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const n = m.n, P = new Int16Array(buf.buffer, 0, n * 3), C = buf.subarray(n * 6, n * 7), I = new Uint16Array(buf.buffer, n * 7 + (n * 7) % 2, m.t * 3);
  const N = new Float32Array(n * 3), ext = [0, 0, 0];
  for (let i = 0; i < P.length; i++) ext[i % 3] = Math.max(ext[i % 3], Math.abs(P[i]) * 2);
  const k = ground ? fit / 65534 : fit / Math.max(ext[0] / 1.5, ext[1], ext[2] / 1.5);
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;   // as long as the face is big
    for (const j of [a, b, c]) { N[j] += x; N[j + 1] += y; N[j + 2] += z; }
  }
  let low = 0; if (ground) { low = 1e9; for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i]); }
  const pos = new Float32Array(I.length * 3), nor = new Float32Array(I.length * 3), col = new Float32Array(I.length * 4);
  for (let i = 0; i < I.length; i++) {
    const v = I[i] * 3, l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1, hex = m.pal[C[I[i]]] || 0;
    pos[i * 3] = P[v] * k; pos[i * 3 + 1] = (P[v + 1] - low) * k; pos[i * 3 + 2] = P[v + 2] * k;
    nor[i * 3] = N[v] / l; nor[i * 3 + 1] = N[v + 1] / l; nor[i * 3 + 2] = N[v + 2] / l;
    col[i * 4] = (hex >> 16 & 255) / 255; col[i * 4 + 1] = (hex >> 8 & 255) / 255; col[i * 4 + 2] = (hex & 255) / 255; col[i * 4 + 3] = hex > 0xffffff ? 1 : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', attr(pos, 3)); g.setAttribute('normal', attr(nor, 3)); g.setAttribute('aCol', attr(col, 4));
  return g;
}
// A model by name when models3d.js has it, else the parts given (the built-in stand-in): [name, size, parts].
const lpPick = (x, fit, ground) => (!Array.isArray(x[0]) && typeof x[0] === 'string' && x.length === 3 && Array.isArray(x[2])
  ? (lpHas(x[0]) ? lpModelGeo(x[0], x[1], ground) : lpGeo(x[2], fit)) : lpGeo(x, fit));
// The uniforms every material of one scene shares (one object, so a value is set once a frame for all of them).
const lpShared = o => Object.assign({ uT: { value: 0 }, uTravel: { value: 0 }, uDepth: { value: 96 }, uWrap: { value: 0 }, uCurve: { value: 0 }, uDens: { value: 2 }, uPulse: { value: 0 },
  uKick: { value: 0 }, uAmb: { value: new THREE.Color(0x404050) }, uKey: { value: new THREE.Color(0xffffff) }, uRim: { value: new THREE.Color(0xffffff) }, uRimK: { value: 0 },
  uFog: { value: new THREE.Color(0) }, uFogD: { value: 0 }, uTint: { value: new THREE.Color(0xffffff) }, uTintK: { value: 0 }, uDis: { value: 0 }, uSpin: { value: 0 }, uSpec: { value: 0 } }, o);
const LP_END = `c = mix(uFog, c, exp(-length(vP) * uFogD)); c = mix(c, c * uTint * 1.8, uTintK);`;   // distance haze, then the colour wash
// Flat-shaded, lit by one key light and the sky. aI = an instance's place (x, y, z) and its own random number; aJ = its
// size, turn, how much it sways in the wind and how far it bobs. uWrap: its z runs round the loop with the travel.
function lpMat(sh) {
  return new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: sh,
    vertexShader: `attribute vec4 aCol, aI, aJ; uniform float uT, uTravel, uDepth, uWrap, uCurve, uDens, uPulse, uSpin; varying vec4 vCol; varying vec3 vN, vP, vL;
      void main() {
        float s = aJ.x * step(aI.w, uDens) * (1.0 + uPulse * fract(aI.w * 7.7)), c = cos(aJ.y + uSpin), sn = sin(aJ.y + uSpin);
        vec3 p = position * s; p.x += sin(uT * 1.3 + aI.w * 40.0) * aJ.z * position.y * s;
        p = vec3(p.x * c + p.z * sn, p.y, p.z * c - p.x * sn);
        vec3 o = aI.xyz; if (uWrap > 0.5) o.z = mod(o.z + uTravel, uDepth) - uDepth + 8.0;
        o.y += sin(uT * (0.6 + fract(aI.w * 5.1)) + aI.w * 20.0) * aJ.w;
        p += o; p.y -= uCurve * p.z * p.z;   // the world falls away with distance, so things rise over a horizon
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vCol = aCol; vN = normalMatrix * vec3(normal.x * c + normal.z * sn, normal.y, normal.z * c - normal.x * sn); vP = mv.xyz; vL = position;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uKick, uRimK, uFogD, uTintK, uDis, uSpec; uniform vec3 uAmb, uKey, uRim, uFog, uTint; varying vec4 vCol; varying vec3 vN, vP, vL;
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        if (uDis > 0.0 && hash2(floor(vL.xy * 30.0) + floor(vL.z * 30.0) * 7.0) < uDis) discard;   // Dissolve: the model goes in small squares
        vec3 N = normalize(vN), V = normalize(-vP), L = normalize(vec3(0.35, 0.8, 0.5));
        if (dot(N, V) < 0.0) N = -N;   // a thin part seen from behind
        vec3 c = vCol.rgb * (uAmb * (0.65 + 0.35 * N.y) + uKey * max(dot(N, L), 0.0)) + uRim * pow(1.0 - abs(dot(N, V)), 3.0) * uRimK;
        c += uKey * pow(max(dot(N, normalize(L + V)), 0.0), 28.0) * uSpec;   // a highlight (the objects; the worlds stay matt)
        c = mix(c, vCol.rgb * (1.4 + uKick * 1.6), vCol.a);
        ${LP_END}
        gl_FragColor = vec4(c, 1.0); }` });
}

// ---------- the models ----------
const lpAt = (parts, x, y, z, k = 1) => parts.map(p => [p[0], p[1], p[2] * k, p[3] * k, p[4] * k, (p[5] || 0) * k + x, (p[6] || 0) * k + y, (p[7] || 0) * k + z, p[8] || 0, p[9] || 0, p[10] || 0]);
const lpRing = (n, f) => Array.from({ length: n }, (_, k) => f(Math.cos(k / n * 6.2832), Math.sin(k / n * 6.2832), k / n * 360));
const LPM = {
  pine: (g = 0x2f7d4a, t = 0x5a3d26) => [['c6', t, 0.22, 0.7, 0.22, 0, 0.35, 0], ['k6', g, 1.3, 1, 1.3, 0, 1.1, 0], ['k6', g, 1, 0.9, 1, 0, 1.7, 0], ['k6', g, 0.65, 0.8, 0.65, 0, 2.3, 0]],
  palm: () => [['c6', 0x7a5a36, 0.2, 1.3, 0.2, 0, 0.65, 0, 0, 0, 6], ['c6', 0x7a5a36, 0.17, 1.3, 0.17, -0.2, 1.85, 0, 0, 0, 12],
    ...lpRing(6, (c, s, d) => ['b', 0x2fa35a, 1.5, 0.05, 0.4, -0.35 + c * 0.7, 2.45, s * 0.7, 0, -d, -22]), ['s', 0x4a3320, 0.2, 0.2, 0.2, -0.3, 2.4, 0.1]],
  bush: (g = 0x3a9150) => [['s', g, 1, 0.7, 1, 0, 0.3, 0], ['s', g, 0.7, 0.5, 0.7, 0.5, 0.22, 0.2]],
  rock: (c = 0x6b6f7a) => [['s', c, 1, 0.7, 0.9, 0, 0.25, 0, 20, 30, 0]],
  tower: (c = 0x38e8ff) => [['b', 0x141a2e, 1.6, 6, 1.6, 0, 3, 0], ['b', LP_E | c, 1.66, 0.12, 1.66, 0, 4.6, 0], ['b', LP_E | c, 1.66, 0.12, 1.66, 0, 2.2, 0],
    ['b', LP_E | 0xfff2c0, 0.5, 0.3, 1.64, 0.2, 3.4, 0], ['b', LP_E | 0xfff2c0, 1.64, 0.3, 0.4, 0, 1.2, 0.3], ['c4', 0x2a3350, 0.08, 1.5, 0.08, 0.4, 6.7, 0.3]],
  block: (c = 0xff3df0) => [['b', 0x1a2038, 2.2, 1.6, 1.8, 0, 0.8, 0], ['b', LP_E | c, 2.26, 0.1, 1.86, 0, 1.3, 0], ['b', LP_E | c, 0.08, 1, 1.2, 1.12, 2.1, 0]],
  spike: () => [['k5', 0x221a1a, 1.2, 3.4, 1.2, 0, 1.7, 0], ['k4', 0x2e2222, 0.6, 1.8, 0.6, 0.55, 0.8, 0.2, 0, 0, -22]],
  volcano: () => [['t8', 0x2a1f1f, 7, 4, 7, 0, 2, 0], ['c8', LP_E | 0xff5a1a, 3.3, 0.25, 3.3, 0, 4, 0]],
  eyeTower: () => [['t4', 0x1a1414, 1.6, 7, 1.6, 0, 3.5, 0], ['k4', 0x1a1414, 0.35, 1.6, 0.35, -0.45, 7.6, 0, 0, 0, 12], ['k4', 0x1a1414, 0.35, 1.6, 0.35, 0.45, 7.6, 0, 0, 0, -12],
    ['S', LP_E | 0xff7a1a, 0.7, 1, 0.35, 0, 7.7, 0]],
  cloud: () => [['S', 0xf4f7ff, 2.2, 1.1, 1.5, 0, 0, 0], ['S', 0xe6ecfa, 1.5, 0.9, 1.2, 1.3, -0.1, 0.2], ['S', 0xffffff, 1.3, 0.8, 1.1, -1.3, -0.15, -0.1]],
  island: () => [['k6', 0x6b4a32, 3, 2.4, 3, 0, -1.2, 0, 180], ['c6', 0x4fae5a, 3.1, 0.35, 3.1, 0, 0.15, 0], ...lpAt(LPM.pine(), 0.5, 0.3, 0, 0.7), ['s', 0x8a8f99, 0.6, 0.4, 0.6, -0.8, 0.45, 0.4]],
  heart: (c = 0xff3b6b) => [['S', c, 1, 1, 0.62, -0.36, 0.42, 0], ['S', c, 1, 1, 0.62, 0.36, 0.42, 0], ['k4', c, 1.66, 1, 0.62, 0, -0.26, 0, 180]],
  arch: () => [['c8', 0xfaf3ea, 0.28, 3, 0.28, -1.3, 1.5, 0], ['c8', 0xfaf3ea, 0.28, 3, 0.28, 1.3, 1.5, 0], ['b', 0xfaf3ea, 3.1, 0.3, 0.4, 0, 3.1, 0],
    ['s', 0xff8fb3, 0.4, 0.4, 0.4, -1.3, 3.2, 0], ['s', 0xffd1e0, 0.4, 0.4, 0.4, 1.3, 3.2, 0], ['s', 0xff8fb3, 0.35, 0.35, 0.35, 0, 3.4, 0], ...lpAt(LPM.heart(LP_E | 0xff4d88), 0, 3.9, 0, 0.5)],
  candle: () => [['c6', 0xfff6e6, 0.15, 0.7, 0.15, 0, 0.35, 0], ['k5', LP_E | 0xffc04d, 0.12, 0.25, 0.12, 0, 0.85, 0]],
  flower: (c = 0xff6fa8, c2 = 0xffd94d) => [['c5', 0x3f9a4f, 0.07, 1, 0.07, 0, 0.5, 0], ['s', c2, 0.3, 0.2, 0.3, 0, 1.05, 0],
    ...lpRing(6, (x, z) => ['s', c, 0.36, 0.1, 0.36, x * 0.3, 1.03, z * 0.3]), ['b', 0x3f9a4f, 0.4, 0.03, 0.16, 0.18, 0.4, 0, 0, 0, 25]],
  cactus: (g = 0x3f8f5a) => [['c6', g, 0.45, 2, 0.45, 0, 1, 0], ['b', g, 0.6, 0.22, 0.22, 0.45, 1.1, 0], ['c6', g, 0.26, 0.8, 0.26, 0.7, 1.45, 0], ['b', g, 0.5, 0.2, 0.2, -0.4, 0.8, 0],
    ['c6', g, 0.24, 0.6, 0.24, -0.62, 1.05, 0]],
  pyramid: () => [['k4', 0xd9b36b, 7, 4.5, 7, 0, 2.25, 0]],
  snowman: () => [['S', 0xffffff, 1, 1, 1, 0, 0.5, 0], ['S', 0xffffff, 0.75, 0.75, 0.75, 0, 1.25, 0], ['S', 0xffffff, 0.55, 0.55, 0.55, 0, 1.85, 0], ['k5', 0xff8a2a, 0.12, 0.4, 0.12, 0, 1.85, 0.4, 90]],
  coral: (c = 0xff7a8a) => [['c5', c, 0.25, 1.2, 0.25, 0, 0.6, 0], ['c5', c, 0.18, 0.8, 0.18, 0.3, 1, 0, 0, 0, -35], ['c5', c, 0.18, 0.9, 0.18, -0.3, 1.1, 0.1, 0, 0, 30],
    ['s', c, 0.3, 0.3, 0.3, 0, 1.3, 0]],
  weed: () => [['b', 0x2f9a6a, 0.12, 1.8, 0.05, 0, 0.9, 0], ['b', 0x2f9a6a, 0.1, 1.4, 0.05, 0.2, 0.7, 0.1]],
  fish: (c = 0xffb347) => [['s', c, 1, 0.5, 0.3, 0, 0, 0], ['k4', c, 0.4, 0.5, 0.1, -0.65, 0, 0, 0, 0, -90], ['s', 0x111111, 0.06, 0.06, 0.06, 0.35, 0.08, 0.14]],
  mushroom: (c = 0xff4de0) => [['c6', 0xd8d0e8, 0.3, 1.3, 0.3, 0, 0.65, 0], ['S', LP_E | c, 1.5, 0.7, 1.5, 0, 1.4, 0]],
  crystal: (c = 0x38e8ff) => [['k5', LP_E | c, 0.5, 1.4, 0.5, 0, 0.9, 0], ['k5', LP_E | c, 0.5, 0.4, 0.5, 0, 0.02, 0, 180], ['k5', LP_E | c, 0.3, 0.9, 0.3, 0.35, 0.5, 0.1, 0, 0, -25]],
  asteroid: () => [['s', 0x7a7480, 1.2, 1, 0.9, 0, 0, 0, 30, 20, 10], ['s', 0x625d68, 0.6, 0.5, 0.6, 0.5, 0.3, 0.2]],
  trex: (g = 0x4f8f3a, g2 = 0x3f7a2e) => [['b', g, 1.7, 1, 0.8, 0, 1.45, 0, 0, 0, 12], ['k4', g, 0.7, 1.9, 0.55, -1.55, 1.25, 0, 0, 0, 80], ['b', g, 0.55, 0.7, 0.55, 0.95, 2, 0, 0, 0, -20],
    ['b', g, 0.8, 0.6, 0.62, 1.35, 2.35, 0], ['b', g, 0.7, 0.32, 0.5, 1.85, 2.3, 0], ['b', g2, 0.65, 0.14, 0.46, 1.8, 2.02, 0, 0, 0, -8],
    ['b', g2, 0.38, 1.1, 0.36, 0.05, 0.6, 0.32], ['b', g2, 0.38, 1.1, 0.36, 0.05, 0.6, -0.32], ['b', g2, 0.6, 0.16, 0.4, 0.22, 0.08, 0.32], ['b', g2, 0.6, 0.16, 0.4, 0.22, 0.08, -0.32],
    ['b', g2, 0.12, 0.4, 0.12, 0.75, 1.35, 0.36, 0, 0, 35], ['b', g2, 0.12, 0.4, 0.12, 0.75, 1.35, -0.36, 0, 0, 35],
    ['s', LP_E | 0xffd21a, 0.12, 0.12, 0.12, 1.5, 2.5, 0.3], ['s', LP_E | 0xffd21a, 0.12, 0.12, 0.12, 1.5, 2.5, -0.3],
    ['k4', 0x2f5a22, 0.25, 0.35, 0.2, -0.5, 2.0, 0], ['k4', 0x2f5a22, 0.25, 0.35, 0.2, 0, 2.1, 0], ['k4', 0x2f5a22, 0.25, 0.35, 0.2, 0.45, 2.25, 0]],
  tank: () => [['b', 0x5a6b3a, 2.6, 0.55, 1.5, 0, 0.65, 0], ['b', 0x22251e, 2.9, 0.5, 0.4, 0, 0.3, 0.8], ['b', 0x22251e, 2.9, 0.5, 0.4, 0, 0.3, -0.8], ['c8', 0x4e5e33, 1.2, 0.45, 1.2, -0.15, 1.15, 0],
    ['c6', 0x3d4a28, 0.18, 1.9, 0.18, 1.2, 1.2, 0, 0, 0, -90], ['c6', 0x22251e, 0.26, 0.3, 0.26, 2.1, 1.2, 0, 0, 0, -90], ['c6', 0x3d4a28, 0.4, 0.12, 0.4, -0.3, 1.43, 0],
    ['s', LP_E | 0xfff2a0, 0.14, 0.14, 0.14, 1.3, 0.75, 0.5], ['s', LP_E | 0xfff2a0, 0.14, 0.14, 0.14, 1.3, 0.75, -0.5], ['c4', 0x22251e, 0.03, 1, 0.03, -0.6, 1.9, 0.4]],
  blaster: () => [['b', 0x3a3f5c, 1.6, 0.45, 0.35, 0, 1, 0], ['c8', 0x52597d, 0.22, 1, 0.22, 1.2, 1.05, 0, 0, 0, -90], ['b', 0x23263a, 0.3, 0.8, 0.3, -0.4, 0.5, 0, 0, 0, -15],
    ['c6', 0x23263a, 0.15, 0.7, 0.15, 0.1, 1.38, 0, 0, 0, -90], ['c8', LP_E | 0x38e8ff, 0.34, 0.08, 0.34, 0.95, 1.05, 0, 0, 0, -90], ['c8', LP_E | 0x38e8ff, 0.34, 0.08, 0.34, 1.25, 1.05, 0, 0, 0, -90],
    ['c8', LP_E | 0x38e8ff, 0.34, 0.08, 0.34, 1.55, 1.05, 0, 0, 0, -90], ['S', LP_E | 0x38e8ff, 0.24, 0.24, 0.24, 1.8, 1.05, 0], ['k4', 0x52597d, 0.3, 0.5, 0.08, -0.6, 1.35, 0, 0, 0, 30],
    ['b', LP_E | 0xff3df0, 0.5, 0.1, 0.37, -0.1, 1, 0]],
  cannon: () => [['c8', 0x30364f, 1.6, 0.4, 1.6, 0, 0.2, 0], ['c8', 0x3d4566, 0.7, 0.9, 0.7, 0, 0.85, 0], ['b', 0x4a5378, 1.3, 0.8, 1.1, 0, 1.6, 0],
    ...[-0.3, 0.3].flatMap(z => [['c6', 0x23263a, 0.2, 2, 0.2, 1.2, 1.75, z, 0, 0, -90], ...[1, 1.6, 2.1].map(x => ['c6', LP_E | 0xff3b6b, 0.3, 0.1, 0.3, x, 1.75, z, 0, 0, -90]),
      ['s', LP_E | 0xff3b6b, 0.26, 0.26, 0.26, 2.25, 1.75, z]]), ['k8', 0x6a7399, 0.7, 0.3, 0.7, -0.5, 2.2, 0, 0, 0, 40]],
  sword: () => [['k4', 0xdfe6f2, 0.3, 2.6, 0.07, 0, 2.1, 0], ['b', LP_E | 0x38e8ff, 0.05, 1.6, 0.09, 0, 1.7, 0], ['b', 0xe0b040, 1, 0.14, 0.2, 0, 0.78, 0], ['c6', 0x5a3320, 0.12, 0.62, 0.12, 0, 0.42, 0],
    ['s', 0xe0b040, 0.24, 0.24, 0.24, 0, 0.06, 0], ['s', LP_E | 0xff2a4a, 0.14, 0.14, 0.14, 0, 0.78, 0.1]],
  ufo: () => [['t24', 0xaab3cc, 3.4, 0.36, 3.4, 0, 0.1, 0], ['t24', 0x6a7392, 3.4, 0.4, 3.4, 0, -0.28, 0, 180], ['c24', 0x3d4566, 3.46, 0.07, 3.46, 0, -0.08, 0],
    ['t24', 0x8a93ad, 1.9, 0.22, 1.9, 0, 0.38, 0], ['S', LP_E | 0x6ff0ff, 1.25, 1.05, 1.25, 0, 0.6, 0], ['t16', 0x4a5378, 1.5, 0.3, 1.5, 0, -0.62, 0, 180],
    ...lpRing(12, (x, z) => ['s', LP_E | 0xffe04d, 0.17, 0.17, 0.17, x * 1.45, -0.1, z * 1.45]), ...lpRing(3, (x, z) => ['k6', 0x3d4566, 0.14, 0.7, 0.14, x * 0.9, -0.85, z * 0.9, 180]),
    ['c16', LP_E | 0x7dff9a, 0.85, 0.07, 0.85, 0, -0.78, 0]],
  alien: () => [['S', 0x7bdc6a, 1.1, 1.35, 1, 0, 2.1, 0], ['S', 0x0a0a12, 0.36, 0.5, 0.16, 0.27, 2.15, 0.42, 0, 0, -18], ['S', 0x0a0a12, 0.36, 0.5, 0.16, -0.27, 2.15, 0.42, 0, 0, 18],
    ['c6', 0x66c257, 0.2, 0.3, 0.2, 0, 1.4, 0], ['t6', 0x66c257, 0.7, 1, 0.5, 0, 0.85, 0, 180], ['b', 0x66c257, 0.12, 0.9, 0.12, 0.5, 0.9, 0, 0, 0, 12], ['b', 0x66c257, 0.12, 0.9, 0.12, -0.5, 0.9, 0, 0, 0, -12],
    ['b', 0x66c257, 0.16, 0.6, 0.16, 0.18, 0.3, 0], ['b', 0x66c257, 0.16, 0.6, 0.16, -0.18, 0.3, 0], ['c4', 0x66c257, 0.04, 0.5, 0.04, 0.25, 2.9, 0, 0, 0, -15], ['c4', 0x66c257, 0.04, 0.5, 0.04, -0.25, 2.9, 0, 0, 0, 15],
    ['s', LP_E | 0xff4de0, 0.12, 0.12, 0.12, 0.32, 3.15, 0], ['s', LP_E | 0xff4de0, 0.12, 0.12, 0.12, -0.32, 3.15, 0]],
  fighter: () => [['k6', 0xaab2c8, 0.5, 2.6, 0.5, 0.4, 0, 0, 0, 0, -90], ['b', 0x7d86a0, 0.9, 0.35, 0.6, -0.6, 0, 0], ['b', 0x5c6480, 1, 0.06, 2.8, -0.6, 0, 0],
    ['b', LP_E | 0xff3b4a, 0.5, 0.08, 0.1, -0.6, 0, 1.42], ['b', LP_E | 0xff3b4a, 0.5, 0.08, 0.1, -0.6, 0, -1.42], ['c6', 0x3d4566, 0.25, 0.6, 0.25, -1.2, 0, 0.4, 0, 0, -90],
    ['c6', 0x3d4566, 0.25, 0.6, 0.25, -1.2, 0, -0.4, 0, 0, -90], ['c6', LP_E | 0x38e8ff, 0.2, 0.1, 0.2, -1.55, 0, 0.4, 0, 0, -90], ['c6', LP_E | 0x38e8ff, 0.2, 0.1, 0.2, -1.55, 0, -0.4, 0, 0, -90],
    ['S', 0x1b2a55, 0.5, 0.25, 0.3, 0.1, 0.2, 0], ['k4', 0x5c6480, 0.5, 0.6, 0.06, -1, 0.35, 0, 0, 0, 20]],
  rocket: () => [['c8', 0xf2f4fa, 0.6, 1.8, 0.6, 0, 1.3, 0], ['k8', 0xff3b4a, 0.6, 0.8, 0.6, 0, 2.6, 0], ...lpRing(3, (x, z, d) => ['b', 0xff3b4a, 0.5, 0.7, 0.06, x * 0.45, 0.6, z * 0.45, 0, -d, 0]),
    ['s', LP_E | 0x38e8ff, 0.25, 0.25, 0.25, 0, 1.7, 0.27], ['k6', LP_E | 0xff9a2a, 0.45, 0.8, 0.45, 0, 0, 0, 180]],
  skull: () => [['S', 0xe9e2cf, 1.2, 1.2, 1.3, 0, 1.2, 0], ['b', 0xd9d0b8, 0.7, 0.4, 0.7, 0, 0.5, 0.15], ['S', LP_E | 0xff2a2a, 0.3, 0.34, 0.2, 0.27, 1.2, 0.56], ['S', LP_E | 0xff2a2a, 0.3, 0.34, 0.2, -0.27, 1.2, 0.56],
    ['k3', 0x1a1612, 0.16, 0.22, 0.1, 0, 0.9, 0.62], ...[-0.24, -0.08, 0.08, 0.24].map(x => ['b', 0xf7f2e4, 0.13, 0.16, 0.06, x, 0.36, 0.5])],
  diamond: () => [['k8', 0x7fe9ff, 1.6, 0.6, 1.6, 0, 0.95, 0], ['k8', 0x4fc8f0, 1.6, 1.3, 1.6, 0, 0, 0, 180]],
  robot: () => [['b', 0x9aa3b8, 0.8, 0.7, 0.7, 0, 2.5, 0], ['b', LP_E | 0x38e8ff, 0.18, 0.14, 0.05, 0.2, 2.55, 0.36], ['b', LP_E | 0x38e8ff, 0.18, 0.14, 0.05, -0.2, 2.55, 0.36],
    ['c4', 0x6f7890, 0.05, 0.4, 0.05, 0, 3.05, 0], ['s', LP_E | 0xff3b6b, 0.14, 0.14, 0.14, 0, 3.3, 0], ['b', 0x6f7890, 1.2, 1.2, 0.7, 0, 1.5, 0], ['b', LP_E | 0xff3b6b, 0.4, 0.3, 0.05, 0, 1.6, 0.36],
    ['b', 0x9aa3b8, 0.28, 1.1, 0.28, 0.8, 1.5, 0], ['b', 0x9aa3b8, 0.28, 1.1, 0.28, -0.8, 1.5, 0], ['s', 0x6f7890, 0.36, 0.36, 0.36, 0.8, 0.85, 0], ['s', 0x6f7890, 0.36, 0.36, 0.36, -0.8, 0.85, 0],
    ['b', 0x6f7890, 0.36, 0.9, 0.4, 0.3, 0.45, 0], ['b', 0x6f7890, 0.36, 0.9, 0.4, -0.3, 0.45, 0]],
};

// ---------- endless worlds ----------
// fx: what drifts through the air = [fall (+ up, - down, units a second), sideways sway, size, twinkles]
const LP_FX = { fly: [0, 0.6, 0.1, 1], petal: [-0.5, 1, 0.13, 0], ember: [0.9, 0.5, 0.09, 1], snow: [-0.8, 0.5, 0.09, 0], rain: [-9, 0, 0.05, 0], bubble: [0.7, 0.3, 0.13, 0], star: [0, 0, 0.12, 1] };
const LP_WORLD_PARAMS = [P('Speed', 0.35), P('Hue', 0.5), P('Colour wash', 0), P('Density', 0.8), P('Fog', 0.45), P('Music react', 0.6), P('Steer (hand / camera)', 0.5)];
// A theme: top = sky overhead, fog = the horizon and the haze, amb / key = the light, ground = [colour, colour, kind
// (0 tiles, 1 lava, 2 water, 3 neon grid), glow colour] or none, lane = [colour, half width] down the middle,
// props = [parts, how many, nearest |x|, furthest |x|, smallest, largest, sway, [lowest, highest] if it floats, bob],
// fx = [kind, colour, how many], sun = [colour, height on the sky 0..1, radius], stars, camY = flying height.
function lpWorld(T) {
  return function () {
    const mob = !!window.VJ_MOBILE, DEPTH = 96, R = Math.random, scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 260);
    const sh = lpShared({ uWrap: { value: 1 }, uCurve: { value: 0.0012 }, uAmb: { value: new THREE.Color(T.amb) }, uKey: { value: new THREE.Color(T.key) }, uFog: { value: new THREE.Color(T.fog) },
      uRim: { value: new THREE.Color(T.fog) }, uRimK: { value: 0.3 } });
    const mat = lpMat(sh);
    for (const [parts, count, x0, x1, s0, s1, sway = 0, yr, bob = 0] of T.props) {
      const n = mob ? Math.ceil(count / 2) : count, geo = lpPick(parts, 0, true), I = new Float32Array(n * 4), J = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        I[i * 4] = (R() < 0.5 ? -1 : 1) * (x0 + R() * (x1 - x0)); I[i * 4 + 1] = yr ? yr[0] + R() * (yr[1] - yr[0]) : 0; I[i * 4 + 2] = (i + R()) / n * DEPTH; I[i * 4 + 3] = R();
        J[i * 4] = s0 + R() * (s1 - s0); J[i * 4 + 1] = R() * 6.2832; J[i * 4 + 2] = sway; J[i * 4 + 3] = bob;
      }
      geo.setAttribute('aI', new THREE.InstancedBufferAttribute(I, 4)); geo.setAttribute('aJ', new THREE.InstancedBufferAttribute(J, 4));
      const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; scene.add(im);
    }
    if (T.ground) {
      const G = T.ground, lane = T.lane || [0, 0];
      const gm = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { ...sh, uGA: { value: new THREE.Color(G[0]) }, uGB: { value: new THREE.Color(G[1]) }, uGE: { value: new THREE.Color(G[3] || 0) }, uG: { value: G[2] || 0 },
        uLane: { value: new THREE.Color(lane[0]) }, uLaneW: { value: lane[1] } },
        vertexShader: `uniform float uCurve; varying vec2 vW; varying vec3 vP;
          void main() { float z = position.y - 44.0; vec4 mv = modelViewMatrix * vec4(position.x, -uCurve * z * z, z, 1.0); vW = vec2(position.x, z); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uT, uTravel, uKick, uFogD, uTintK, uG, uLaneW; uniform vec3 uGA, uGB, uGE, uLane, uFog, uTint; varying vec2 vW; varying vec3 vP;
          ${COL_GLSL}
          void main() {
            vec2 w = vec2(vW.x, vW.y - uTravel), cell = floor(w * 0.5), f = fract(w * 0.5);   // the ground moves with the props
            vec3 c = mix(uGA, uGB, hash2(cell + step(f.x + f.y, 1.0) * 17.0));   // tiles cut corner to corner: flat triangles
            if (uG > 0.5 && uG < 1.5) c = mix(c, uGE * (1.5 + uKick * 2.0), 1.0 - smoothstep(0.0, 0.07, abs(vnoise(w * 0.3) - 0.5)));   // lava in the cracks
            else if (uG > 1.5 && uG < 2.5) c = mix(uGA, uGB, 0.5 + 0.5 * sin(w.x * 1.3 + uT * 1.5) * sin(w.y * 0.9 - uT))
              + uGE * pow(max(0.0, sin(w.x * 3.0 + sin(w.y * 2.0 + uT) * 2.0) * sin(w.y * 3.0 - uT * 1.3)), 6.0) * 0.6;   // water, with light on it
            else if (uG > 2.5) { vec2 gw = fwidth(w * 0.5), gd = abs(fract(w * 0.5 - 0.5) - 0.5);
              c = uGA + uGE * (1.0 - smoothstep(0.0, 1.5, min(gd.x / gw.x, gd.y / gw.y))) * (1.0 + uKick * 2.0) * (1.0 - smoothstep(0.3, 0.9, max(gw.x, gw.y))); }
            c = mix(c, uLane, (1.0 - smoothstep(uLaneW, uLaneW + 0.4, abs(vW.x))) * step(0.01, uLaneW));
            ${LP_END}
            gl_FragColor = vec4(c, 1.0); }` });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(220, 128, 1, 40), gm); g.frustumCulled = false; scene.add(g);
    }
    const sun = T.sun || [0, 0.5, 0];
    const sky = new THREE.ShaderMaterial({ depthWrite: false, uniforms: { ...sh, uTop: { value: new THREE.Color(T.top) }, uSun: { value: new THREE.Color(sun[0]) }, uSunY: { value: sun[1] }, uSunR: { value: sun[2] * 1.4 },
      uStars: { value: T.stars ? 1 : 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uT, uKick, uTintK, uSunY, uSunR, uStars; uniform vec3 uTop, uSun, uFog, uTint; varying vec2 vUv;
        ${COL_GLSL}
        void main() {
          float yw = vUv.y * 400.0 - 170.0, h = smoothstep(-15.0, 85.0, yw), d = length(vec2((vUv.x - 0.5) * 2.5, (yw + 50.0) / 160.0 - uSunY));   // yw: height in the world
          vec3 c = mix(uFog, uTop, pow(h, 0.7));
          c = mix(c, uSun * (1.0 + uKick * 0.3), (1.0 - smoothstep(uSunR * 0.94, uSunR, d)) * step(0.001, uSunR)) + uSun * exp(-max(d - uSunR, 0.0) * 14.0) * 0.35 * step(0.001, uSunR);
          vec2 sc = floor(vUv * vec2(260.0, 260.0));
          c += vec3(step(0.985, hash2(sc)) * (0.5 + 0.5 * sin(uT * 2.0 + hash2(sc + 3.0) * 40.0)) * h * uStars);
          c = mix(c, c * uTint * 1.8, uTintK);
          gl_FragColor = vec4(c, 1.0); }` });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), sky); back.position.set(0, 30, -(DEPTH + 10)); back.renderOrder = -1; scene.add(back);
    let fx = null;
    if (T.fx) {
      const [kind, hex, count] = T.fx, K = LP_FX[kind], n = mob ? Math.ceil(count / 2) : count, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos[i * 3] = (R() - 0.5) * 34; pos[i * 3 + 1] = R() * 11; pos[i * 3 + 2] = R() * 60; seed[i] = R(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSeed', attr(seed, 1));
      fx = pointsMat({ uT: sh.uT, uTravel: sh.uTravel, uCol: { value: new THREE.Color(hex) }, uFall: { value: K[0] }, uSw: { value: K[1] }, uSz: { value: K[2] }, uTw: { value: K[3] }, uY0: { value: T.fxY || 0 } },
        `attribute float aSeed; uniform float uT, uTravel, uFall, uSw, uSz, uTw, uY0; uniform vec3 uCol;`,
        `p.y = mod(p.y + uFall * uT * (0.6 + aSeed * 0.8), 11.0) + uY0; p.z = mod(p.z + uTravel, 60.0) - 54.0;
        p.x += sin(uT * (0.5 + aSeed) + aSeed * 40.0) * uSw * 1.2; p.y += cos(uT * (0.4 + aSeed) + aSeed * 30.0) * uSw * 0.4;
        vCol = vec4(uCol, mix(0.8, 0.35 + 0.65 * sin(uT * 3.0 + aSeed * 60.0), uTw) * smoothstep(-54.0, -40.0, p.z));
        sz = uSz * (0.5 + aSeed);`);
      scene.add(ptMesh(geo, fx));
    }
    const camY = T.camY || 2.2;
    let travel = 0, t = 0, kick = 0, bass = 0, sx = 0, sy = 0;
    return { scene, camera, update(p, dt) {
      t += dt; travel += dt * (comp.bpm / 60) * (1 + p[0] * 10);
      kick = Math.max(kick * Math.exp(-dt * 5), audioFeat.kick * p[5]); bass += (audioFeat.bass * p[5] - bass) * 0.15;
      sh.uT.value = t; sh.uTravel.value = travel % (DEPTH * 64); sh.uDens.value = 0.12 + p[3] * 0.9; sh.uPulse.value = bass * 0.35 + kick * 0.1; sh.uKick.value = 0.25 * p[5] + kick;
      sh.uFogD.value = 0.006 + p[4] * 0.032; sh.uTint.value.setHSL(p[1], 0.9, 0.55); sh.uTintK.value = p[2] * 0.85;
      if (fx) ptFrame(fx, camera, 0);
      sx += (aimX() * 4 * p[6] + Math.sin(t * 0.19) * 0.5 - sx) * 0.05; sy += (aimY() * 3 * p[6] - sy) * 0.05;
      const y = Math.max(0.6, camY + sy + Math.sin(t * 0.27) * 0.25 + kick * 0.08);
      camera.position.set(sx, y, 8); camera.lookAt(sx * 0.5, y * 0.8 + 0.3, -30); camera.rotation.z = -sx * 0.03;
    } };
  };
}
const LP_WORLDS = {
  w_forest: { name: 'Endless Forest', top: 0x0d1a3a, fog: 0x3f7f8f, amb: 0x35506a, key: 0xfff0c8, ground: [0x1f4d2e, 0x2a6238, 0], lane: [0x4a3b2a, 1.4], sun: [0xfff2b0, 0.42, 0.035],
    props: [[LPM.pine(), 170, 2.6, 30, 0.8, 1.9, 0.03], [LPM.rock(), 30, 2, 22, 0.4, 1.1], [LPM.bush(), 70, 1.8, 24, 0.5, 1.1, 0.05]], fx: ['fly', 0xc8ff70, 500] },
  w_jungle: { name: 'Jungle Run', top: 0x0b3a2e, fog: 0x7fc79a, amb: 0x3f6a4a, key: 0xfff6d0, ground: [0x1d5a2a, 0x2f7a34, 0], lane: [0x6b5a34, 1.2], sun: [0xfffbe0, 0.5, 0.03],
    props: [[LPM.palm(), 120, 2.4, 28, 0.9, 1.8, 0.05], [LPM.bush(0x2f9a4a), 110, 1.6, 26, 0.7, 1.8, 0.06], [LPM.flower(0xff5a3a, 0xffd94d), 60, 1.6, 14, 0.8, 1.4, 0.08], [LPM.rock(0x5a6b5a), 25, 2, 20, 0.5, 1.4]],
    fx: ['fly', 0xfff27a, 350] },
  w_cyber: { name: 'Cyber City', top: 0x05030f, fog: 0x3a1466, amb: 0x2a2a55, key: 0x8fb0ff, ground: [0x070812, 0x0a0c1a, 3, 0x38e8ff], lane: [0x10132a, 2], stars: 1,
    props: [[LPM.tower(0x38e8ff), 70, 4.5, 30, 0.8, 2.2], [LPM.tower(0xff3df0), 60, 4.5, 34, 0.7, 2.6], [LPM.block(0xff3df0), 60, 3.4, 20, 0.7, 1.3], [['fighter2', 3, LPM.fighter()], 10, 1, 12, 0.5, 0.8, 0, [5, 12], 0.4]],
    fx: ['rain', 0x9fd0ff, 900], camY: 2.6 },
  w_doom: { name: 'Doom Lands', top: 0x0a0505, fog: 0x7a2410, amb: 0x4a2018, key: 0xff9a50, ground: [0x1a1212, 0x241616, 1, 0xff5a1a], sun: [0xff4a1a, 0.36, 0.06],
    props: [[LPM.spike(), 150, 2.4, 30, 0.7, 2.2], [LPM.volcano(), 9, 16, 44, 1, 2], [LPM.eyeTower(), 6, 9, 26, 0.9, 1.5], [LPM.rock(0x2a2020), 50, 2, 20, 0.5, 1.6]], fx: ['ember', 0xff8a2a, 900] },
  w_sky: { name: 'Sky Islands', top: 0x2a6fd6, fog: 0xbfe6ff, amb: 0x7f9fc8, key: 0xffffff, sun: [0xfffbe8, 0.62, 0.035], camY: 3,
    props: [[LPM.cloud(), 90, 3, 34, 0.6, 2.2, 0, [-7, 9], 0.25], [LPM.island(), 26, 4, 26, 0.6, 1.5, 0, [-5, 4], 0.35], [LPM.cloud(), 40, 0, 30, 1.5, 3, 0, [-16, -9], 0.2]] },
  w_wedding: { name: 'Wedding Aisle', top: 0xffb7d0, fog: 0xfff0e6, amb: 0x9a8590, key: 0xfff8f0, ground: [0x8fcf8a, 0x9bd896, 0], lane: [0xfff7f2, 1.3], sun: [0xffffff, 0.5, 0.04],
    props: [[LPM.arch(), 16, 0, 0, 1.25, 1.25], [LPM.flower(0xff8fb3, 0xfff2a0), 150, 1.6, 9, 0.7, 1.3, 0.06], [LPM.flower(0xffffff, 0xffd94d), 120, 1.6, 12, 0.7, 1.2, 0.06], [LPM.candle(), 60, 1.5, 1.7, 0.9, 1.1],
      [LPM.heart(LP_E | 0xff5a8f), 30, 2, 14, 0.4, 0.9, 0, [2.5, 8], 0.5], [LPM.bush(0x6fbf7a), 60, 6, 26, 0.8, 2]], fx: ['petal', 0xffc2d8, 900] },
  w_flowers: { name: 'Flower Field', top: 0x3f8fe0, fog: 0xd8f0ff, amb: 0x7a8fa8, key: 0xfffbe6, ground: [0x4fae4f, 0x62c05a, 0], sun: [0xfffbd0, 0.55, 0.035],
    props: [[LPM.flower(0xff5a8a), 190, 1.6, 22, 1, 2.2, 0.08], [LPM.flower(0xffd23a, 0x8a4a1a), 190, 1.6, 24, 1, 2.4, 0.08], [LPM.flower(0xb07aff, 0xfff2a0), 170, 1.6, 26, 0.9, 2, 0.08],
      [LPM.flower(0xffffff), 120, 0.8, 26, 0.6, 1.2, 0.08], [LPM.cloud(), 14, 6, 40, 1, 2.2, 0, [9, 16], 0.2]], fx: ['petal', 0xffffff, 400] },
  w_desert: { name: 'Desert Pyramids', top: 0x2a6ad0, fog: 0xf2d9a0, amb: 0x8a7a66, key: 0xfff4d8, ground: [0xd9b56a, 0xe3c27a, 0], lane: [0xc9a558, 1.6], sun: [0xffffff, 0.6, 0.03],
    props: [[LPM.cactus(), 80, 2.4, 26, 0.6, 1.5], [LPM.pyramid(), 9, 14, 44, 0.8, 2.2], [LPM.rock(0xb8935a), 60, 2, 24, 0.4, 1.6], [LPM.palm(), 14, 3, 16, 0.9, 1.4, 0.04]] },
  w_winter: { name: 'Winter Pines', top: 0x16284f, fog: 0xc9d9f2, amb: 0x7f8fb0, key: 0xffffff, ground: [0xe6eefc, 0xf4f8ff, 0], lane: [0xd5e0f5, 1.2], stars: 1, sun: [0xf2f6ff, 0.5, 0.03],
    props: [[LPM.pine(0xe9f2ff, 0x4a3526), 110, 2.4, 30, 0.8, 1.9, 0.02], [LPM.pine(0x2f6d5a), 70, 2.6, 30, 0.8, 1.9, 0.02], [LPM.snowman(), 14, 2, 8, 0.8, 1.2], [LPM.rock(0xd0d8ea), 30, 2, 20, 0.5, 1.2]],
    fx: ['snow', 0xffffff, 1400] },
  w_sea: { name: 'Deep Sea', top: 0x02142e, fog: 0x0f5a7a, amb: 0x1f5a7a, key: 0x9fe8ff, ground: [0x0a3a4a, 0x1a6a6a, 2, 0x7ffff0], camY: 2.4,
    props: [[LPM.coral(0xff7a8a), 90, 1.8, 26, 0.6, 1.8, 0.03], [LPM.coral(0xffb347), 70, 1.8, 26, 0.6, 1.6, 0.03], [LPM.weed(), 160, 1.4, 26, 0.7, 2, 0.16], [LPM.fish(0xffb347), 50, 0.5, 14, 0.4, 0.9, 0, [1, 8], 0.5],
      [LPM.fish(0x5ad0ff), 50, 0.5, 16, 0.3, 0.8, 0, [1, 9], 0.5], [LPM.rock(0x2f5a66), 30, 2, 22, 0.6, 1.8]], fx: ['bubble', 0xbff4ff, 500] },
  w_alien: { name: 'Alien Planet', top: 0x10052a, fog: 0x6a2a8f, amb: 0x4a3a7a, key: 0xb0ffe0, ground: [0x2a1a55, 0x3a2470, 0], stars: 1, sun: [0x7dffd0, 0.6, 0.07],
    props: [[LPM.mushroom(0xff4de0), 90, 2.2, 28, 0.6, 2.4, 0.03], [LPM.mushroom(0x38e8ff), 70, 2.2, 28, 0.5, 2, 0.03], [LPM.crystal(0x7dff9a), 80, 1.8, 24, 0.5, 1.6], [['alien', 2.2, LPM.alien()], 16, 2, 9, 0.7, 1.1],
      [['ufo', 3, LPM.ufo()], 10, 2, 18, 0.5, 1.1, 0, [5, 11], 0.6]], fx: ['fly', 0xff9af0, 500] },
  w_dino: { name: 'Dino Valley', top: 0x2a5ab0, fog: 0xf2c890, amb: 0x7a6a55, key: 0xfff0d0, ground: [0x4a7a34, 0x5f8f3f, 0], lane: [0x7a6a44, 1.4], sun: [0xffe6a0, 0.4, 0.05],
    props: [[['trex', 3.4, LPM.trex()], 22, 2.8, 16, 0.9, 1.8], [['trike', 3.2, LPM.trex(0x8f6a3a, 0x7a5a2e)], 14, 2.8, 20, 0.8, 1.4], [['raptor', 2.2, LPM.trex()], 16, 2.4, 14, 0.8, 1.2], [LPM.palm(), 80, 2.6, 28, 1, 2, 0.04], [LPM.volcano(), 6, 20, 46, 1, 1.8], [LPM.bush(0x3f8f3a), 80, 1.8, 24, 0.6, 1.6, 0.05],
      [LPM.rock(0x8a7a66), 40, 2, 22, 0.5, 1.8]], fx: ['ember', 0xffc070, 250] },
  w_space: { name: 'Asteroid Run', top: 0x02030a, fog: 0x0a0a22, amb: 0x2a2a44, key: 0xffffff, stars: 1, sun: [0x9fb8ff, 0.7, 0.02], camY: 0.6,
    props: [[LPM.asteroid(), 150, 1.6, 26, 0.3, 2.2, 0, [-9, 10], 0.3], [['fighter', 3, LPM.fighter()], 14, 1.5, 10, 0.5, 0.9, 0, [-3, 5], 0.5], [['ufo', 3, LPM.ufo()], 6, 4, 16, 0.6, 1, 0, [-2, 7], 0.6], [['rocket', 3, LPM.rocket()], 6, 3, 14, 0.5, 0.9, 0, [-4, 6], 0.4],
      [LPM.crystal(0xff3df0), 30, 3, 20, 0.5, 1.2, 0, [-8, 8], 0.4]], fx: ['star', 0xffffff, 900], fxY: -5 },
  w_war: { name: 'Battlefield', top: 0x1a1e22, fog: 0x8a7a66, amb: 0x5a5548, key: 0xffe0b0, ground: [0x4a4a3a, 0x56543f, 0], lane: [0x3f3d30, 1.6], sun: [0xff9a5a, 0.34, 0.045],
    props: [[['tank', 3.2, LPM.tank()], 40, 2.8, 20, 0.9, 1.5], [['cannon', 2.4, LPM.cannon()], 16, 3.4, 18, 0.9, 1.4], [LPM.rock(0x4a463a), 80, 2, 26, 0.5, 2], [LPM.spike(), 30, 6, 30, 0.4, 0.9], [['fighter', 3, LPM.fighter()], 12, 0, 16, 0.5, 0.9, 0, [5, 11], 0.5]],
    fx: ['ember', 0xffa040, 500] },
};
for (const k in LP_WORLDS) SCENES3D[k] = { name: LP_WORLDS[k].name, group: 'world', params: LP_WORLD_PARAMS, build: lpWorld(LP_WORLDS[k]) };

// ---------- stylized objects ----------
const LP_OBJECT_PARAMS = [P('Speed', 0.3), P('Hue', 0.55), P('Dissolve into particles', 0.2), P('Copies (1, 3, 5)', 0), P('Size', 0.5), P('Music react', 0.6), P('Turn (hand / camera)', 0.5)];
function lpObject(parts, tilt = 0.2) {   // parts: a model's parts, or [name in models3d.js, its size, stand-in parts]
  return function () {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100); camera.position.z = 8;
    const sh = lpShared({ uAmb: { value: new THREE.Color(0.66, 0.68, 0.84) }, uKey: { value: new THREE.Color(1.22, 1.17, 1.08) }, uRimK: { value: 0.7 }, uSpec: { value: 0.3 } });   // a bright studio: the models' own colours are dark
    const geo = lpPick(parts, 3.6), solid = new THREE.InstancedMesh(geo, lpMat(sh), 5); solid.frustumCulled = false;
    //                 the leader, then two and four more behind it in a V, smaller
    const SPOT = [[0, 0, 0, 1], [-2.4, -0.2, -1.6, 0.6], [2.4, -0.2, -1.6, 0.6], [-3.9, -0.4, -3.2, 0.45], [3.9, -0.4, -3.2, 0.45]], I = new Float32Array(20), J = new Float32Array(20);
    SPOT.forEach((s, i) => { I[i * 4] = s[0]; I[i * 4 + 1] = s[1]; I[i * 4 + 2] = s[2]; I[i * 4 + 3] = 0.5; J[i * 4] = s[3]; });
    geo.setAttribute('aI', new THREE.InstancedBufferAttribute(I, 4)); geo.setAttribute('aJ', new THREE.InstancedBufferAttribute(J, 4));
    // points scattered over the model's own surface (bigger faces get more), each with the way its face points
    const P3 = geo.attributes.position.array, N3 = geo.attributes.normal.array, faces = P3.length / 9, area = new Float32Array(faces);
    let total = 0;
    for (let f = 0; f < faces; f++) { const i = f * 9, ux = P3[i + 3] - P3[i], uy = P3[i + 4] - P3[i + 1], uz = P3[i + 5] - P3[i + 2], vx = P3[i + 6] - P3[i], vy = P3[i + 7] - P3[i + 1], vz = P3[i + 8] - P3[i + 2];
      total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); area[f] = total; }
    const n = window.VJ_MOBILE ? 6000 : 16000, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const r = Math.random() * total; let lo = 0, hi = faces - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (area[mid] < r) lo = mid + 1; else hi = mid; }
      let a = Math.random(), b = Math.random(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
      for (let j = 0, i = lo * 9; j < 3; j++) { pos[k * 3 + j] = P3[i + j] + (P3[i + 3 + j] - P3[i + j]) * a + (P3[i + 6 + j] - P3[i + j]) * b; nor[k * 3 + j] = N3[i + j]; }
      seed[k] = Math.random();
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', attr(pos, 3)); pg.setAttribute('aN', attr(nor, 3)); pg.setAttribute('aSeed', attr(seed, 1));
    const pm = pointsMat({ uT: sh.uT, uBurst: { value: 0 }, uDis: { value: 0 }, uHue: { value: 0.55 }, uSize: { value: 0.03 } },
      `attribute vec3 aN; attribute float aSeed; uniform float uT, uBurst, uDis, uHue, uSize;`,
      `float out_ = uBurst * (0.2 + aSeed * 1.5) + 0.02 + min(uDis, 1.0) * 0.12 * (0.5 + 0.5 * sin(uT * 2.0 + aSeed * 40.0));
      p += aN * out_ + flow(position * 1.5 + aSeed, uT) * 0.06 * (min(uDis, 1.0) + uBurst);
      vCol = vec4(hsl(uHue + aSeed * 0.1, 0.85, 0.6 + uBurst * 0.3), (0.12 + 0.88 * max(min(uDis, 1.0), uBurst)) * (0.6 + 0.4 * sin(uT * 4.0 + aSeed * 60.0)));
      sz = uSize * (0.5 + aSeed);`);
    const pts = ptMesh(pg, pm), g = new THREE.Group(); g.add(solid, pts); scene.add(g);
    let t = 0, spin = 0, kick = 0, bass = 0, tx = 0, ty = 0;
    return { scene, camera, update(p, dt) {
      t += dt; kick = Math.max(kick * Math.exp(-dt * 5), audioFeat.kick * p[5]); bass += (audioFeat.bass * p[5] - bass) * 0.15;
      spin += dt * (0.15 + p[0] * 2.2) * (1 + bass);
      sh.uT.value = t; sh.uKick.value = 0.25 * p[5] + kick; sh.uRim.value.setHSL(p[1], 0.95, 0.6); sh.uDis.value = p[2] > 0.97 ? 1.1 : Math.max(0, (p[2] - 0.3) / 0.7) * 0.9;   // the model stays whole for the first third: only the points grow
      const U = pm.uniforms; U.uDis.value = p[2]; U.uBurst.value = kick * 0.9 + 0.1 * Math.pow(1 - beatFrac(), 5) * p[5]; U.uHue.value = p[1]; U.uSize.value = 0.02 + p[2] * 0.03;
      solid.count = [1, 3, 5][Math.min(2, Math.floor(p[3] * 3))];
      ptFrame(pm, camera, 0);
      tx += (aimX() * 2.5 * p[6] - tx) * 0.08; ty += (aimY() * 1.5 * p[6] - ty) * 0.08;
      sh.uSpin.value = spin + tx; pts.rotation.y = spin + tx;   // every copy turns on its own spot: the formation itself stays put
      g.rotation.x = tilt + ty + Math.sin(t * 0.4) * 0.08; g.position.y = Math.sin(t * 0.9) * 0.12;
      g.scale.setScalar((0.6 + p[4] * 0.9) * (1 + kick * 0.08));
    } };
  };
}
// [name, model (its name in models3d.js, size, the built-in stand-in), tilt]. The object scenes are Pro (plan feature viz3d,
// since 2026-11-24): `pro: true` is what locks them on Free (smart3d.js viz3dLocked), their code stays here with the
// kit the worlds use. Weapons, the tank and the ships were taken out (SCENES3D_OLD in smart3d.js says what opens instead).
const LP_OBJECTS = { o_diamond: ['Diamond', ['diamond', 3, LPM.diamond()], 0.25], o_heart: ['Heart', ['heart', 3, LPM.heart()], 0.05], o_skull: ['Skull', ['skull', 3, LPM.skull()], 0.1],
  o_robot: ['Robot', ['robot', 3.4, LPM.robot()], 0.1], o_ufo: ['UFO', LPM.ufo(), 0.45], o_alien: ['Alien', ['alien', 3.4, LPM.alien()], 0.1],
  o_trex: ['T-Rex', ['trex', 3.8, LPM.trex()]], o_raptor: ['Velociraptor', ['raptor', 3.8, LPM.trex()]], o_trike: ['Triceratops', ['trike', 3.8, LPM.trex()]] };
for (const k in LP_OBJECTS) SCENES3D[k] = { name: LP_OBJECTS[k][0], group: 'object', pro: true, params: LP_OBJECT_PARAMS, build: lpObject(LP_OBJECTS[k][1], LP_OBJECTS[k][2]) };
