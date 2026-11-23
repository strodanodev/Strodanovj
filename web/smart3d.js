// Strodano VJ (web) - 3D "smart" generators built on three.js (web/vendor/three.min.js, a small subset). GPL-3.0 (three.js: MIT).
// three.js shares the engine's WebGL2 context: each 3D clip renders its scene into an off-screen target (4x MSAA, transparent
// background), which is then copied into the layer like any other source. GL state is reset before and after every three.js
// render, so neither side can leave state behind for the other. Every scene follows the beat (comp.beats), the music
// (audioFeat) and, when it is on, the camera input (camFeat); its sliders work with the ~ LFO / music / camera sources and MIDI.
'use strict';
let r3 = null, rt3 = null;
function three() {
  if (r3 || typeof THREE === 'undefined') return r3;
  THREE.ColorManagement.enabled = false;   // the rest of the app is not colour-managed either
  r3 = new THREE.WebGLRenderer({ canvas: glc, context: gl, antialias: false, alpha: true });
  r3.outputColorSpace = THREE.LinearSRGBColorSpace;
  return r3;
}
const beatFrac = () => ((comp.beats % 1) + 1) % 1;
const camOn = () => typeof camState !== 'undefined' && !!camState.track;
const handOn = () => typeof handFeat !== 'undefined' && handFeat.present > 0.5;

// Shared by the GPU point scenes below: soft round points whose size shrinks with distance, added on top of each other.
// `body` is GLSL that may change `p` (starts as `position`), `sz` (size in world units) and `vCol` (rgb + alpha; alpha 0
// hides the point); `decl` declares the scene's own attributes and uniforms. Every scene also gets the hand pull (uPull,
// a soft attractor in view space, set by ptFrame) and the helpers hash / hsl / flow. frag 'disc' = a lens-blur disc.
const PT_GLSL = `varying vec4 vCol;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  vec3 hsl(float h, float s, float l) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return l + (k - 0.5) * (1.0 - abs(2.0 * l - 1.0)) * s; }
  vec3 flow(vec3 p, float t) { return vec3(sin(p.y * 1.7 + t) + sin(p.z * 2.3 - t * 0.7), sin(p.z * 1.9 + t * 1.1) + sin(p.x * 2.1 + t * 0.5),
    sin(p.x * 1.5 - t * 0.9) + sin(p.y * 2.7 + t * 1.3)); }`;
function pointsMat(uniforms, decl, body, frag = 'soft') {
  uniforms.uScale = { value: 500 }; uniforms.uPull = { value: new THREE.Vector3() };
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms,
    vertexShader: `uniform float uScale; uniform vec3 uPull; ${decl}
      ${PT_GLSL}
      void main() {
        vec3 p = position; float sz = 0.03; vCol = vec4(1.0);
        ${body}
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec2 d = uPull.xy - mv.xy; mv.xy += d * uPull.z * exp(-dot(d, d) * 0.5);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = vCol.a > 0.002 ? clamp(sz * uScale / -mv.z, 1.0, 400.0) : 0.0;   // capped: a point right at the lens would fill the frame
      }`,
    fragmentShader: `varying vec4 vCol;
      void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vCol.a <= 0.002) discard;
        ${frag === 'disc' ? 'float a = smoothstep(0.5, 0.44, d) * (0.6 + 0.4 * smoothstep(0.3, 0.47, d));' : 'float a = smoothstep(0.5, 0.0, d);'}
        gl_FragColor = vec4(vCol.rgb * (0.85 + 1.3 * smoothstep(0.22, 0.0, d)), a * vCol.a); }` });   // a hot core in a soft glow
}
function ptMesh(geo, mat) { const m = new THREE.Points(geo, mat); m.frustumCulled = false; return m; }   // the shaders move points past the bounding sphere
// Once per frame: pixels per world unit at distance 1, and the hand pull (strength k, 0 = off; a pinch pulls harder).
function ptFrame(mat, camera, k) {
  const U = mat.uniforms, th = Math.tan(camera.fov * Math.PI / 360), halfH = th * camera.position.length(), halfW = halfH * camera.aspect;
  U.uScale.value = comp.h / (2 * th);
  if (handOn() && k > 0) U.uPull.value.set((handFeat.x - 0.5) * 2 * halfW, (handFeat.y - 0.5) * 2 * halfH, k * (0.35 + 0.5 * handFeat.pinch));
  else U.uPull.value.z = 0;
}
// The camera input, when on and no hand is tracked: where you are, -0.5..0.5 (0 otherwise).
const camX = () => camOn() && !handOn() ? camFeat.x - 0.5 : 0, camY = () => camOn() && !handOn() ? camFeat.y - 0.5 : 0;
const attr = (a, k) => new THREE.BufferAttribute(a, k);
// True while the deck driving the visuals is playing a track with analysed sections (score.js), so scenes can follow its
// structure instead of a bar cycle. (The live listener only reports drops, so it does not count.)
const songSections = () => typeof sectionNow === 'function' && typeof audio !== 'undefined' && !!audio.clockDeck && audio.clockDeck.playing && !!sectionNow(audio.clockDeck);

// Shared by the mesh and full-frame scenes: colour helpers for their own shaders (COL_GLSL), and a full-frame shader
// "scene": one quad over the whole picture whose fragment shader gets vUv, uAspect and uPx (the height of one pixel in
// its -1..1 frame, for lines that stay one pixel sharp at any size). glow(c) turns a light colour into colour + alpha,
// so a full-frame scene is see-through where it is dark and lies over the layers below like the particle scenes do.
const COL_GLSL = `float hash(float n) { return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hsl(float h, float s, float l) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return l + (k - 0.5) * (1.0 - abs(2.0 * l - 1.0)) * s; }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
  vec4 glow(vec3 c) { float a = clamp(max(c.r, max(c.g, c.b)) * 1.5, 0.0, 1.0); return vec4(c / max(a, 0.001), a); }`;
function fsMat(uniforms, frag) {
  uniforms.uAspect = { value: 16 / 9 }; uniforms.uPx = { value: 2 / 720 };
  return new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, uniforms,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uAspect, uPx;\n${COL_GLSL}\n${frag}` });
}
function fsMesh(mat) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; return m; }
function fsFrame(mat) { mat.uniforms.uAspect.value = comp.w / comp.h; mat.uniforms.uPx.value = 2 / comp.h; }
// Where the hand (or, with no hand, the person on the camera input) is: -0.5..0.5 each way, 0 with neither.
const aimX = () => (handOn() ? handFeat.x - 0.5 : camX()), aimY = () => (handOn() ? handFeat.y - 0.5 : camY());

const SCENES3D = {
  chrome: { name: 'Liquid Chrome', params: [P('Speed', 0.3), P('Hue', 0.86), P('Ripples', 0.4), P('Melt', 0.5), P('Iridescence', 0.5), P('Music react', 0.6),
    P('Turn (hand / camera)', 0.5)],
    // A ball of liquid metal. The surface is a sphere pushed in and out by a few moving waves in the vertex shader, which
    // also works out the new surface normal (from two neighbouring points); the fragment shader then mirrors a made-up
    // studio around it: a soft box overhead, two coloured ring lights in the hue and its opposite, and standing strips.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100); camera.position.z = 5.2;
      const mat = new THREE.ShaderMaterial({ transparent: true,
        uniforms: { uT: { value: 0 }, uAmp: { value: 0.2 }, uFreq: { value: 2 }, uKick: { value: 0 }, uHue: { value: 0.86 }, uIri: { value: 0.5 }, uLevel: { value: 0 } },
        vertexShader: `uniform float uT, uAmp, uFreq, uKick; varying vec3 vN, vV;
          float f(vec3 p) { return sin(p.x * uFreq + uT) * sin(p.y * uFreq * 1.3 + uT * 1.1) * sin(p.z * uFreq * 0.9 - uT * 0.8)
            + 0.45 * sin(p.x * uFreq * 2.1 - uT * 1.3 + p.y * 1.7) * sin(p.z * uFreq * 1.9 + uT * 0.7 + p.x); }
          vec3 disp(vec3 n) { return n * (1.0 + uAmp * f(n) + uKick * 0.05 * sin(n.y * 12.0 - uT * 6.0)); }
          void main() {
            vec3 n = normalize(position), t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(n, t1);
            vec3 p0 = disp(n), p1 = disp(normalize(n + t1 * 0.012)), p2 = disp(normalize(n + t2 * 0.012));
            vec4 mv = modelViewMatrix * vec4(p0 * 1.45, 1.0);
            vN = normalMatrix * normalize(cross(p1 - p0, p2 - p0)); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uT, uHue, uIri, uLevel, uKick; varying vec3 vN, vV;
          ${COL_GLSL}
          vec3 env(vec3 d) {   // the studio the metal mirrors
            float a = atan(d.z, d.x), y = d.y;
            vec3 c = mix(vec3(0.04, 0.04, 0.07), vec3(0.5, 0.55, 0.72), smoothstep(-0.4, 1.0, y));
            c += vec3(2.4) * smoothstep(0.8, 0.9, y);
            c += vec3(1.5) * (1.0 - smoothstep(0.0, 0.06, abs(y - 0.45))) * smoothstep(0.2, 0.6, sin(a * 2.0 + 1.0));
            c += hsl(uHue, 0.95, 0.55) * 2.2 * (1.0 - smoothstep(0.0, 0.16, abs(y - 0.08))) * (0.35 + 0.65 * smoothstep(-0.2, 0.8, sin(a * 3.0 + uT * 0.4)));
            c += hsl(uHue + 0.42, 0.95, 0.55) * 2.0 * (1.0 - smoothstep(0.0, 0.14, abs(y + 0.38))) * (0.35 + 0.65 * smoothstep(-0.2, 0.8, sin(a * 2.0 - uT * 0.3 + 2.0)));
            c += vec3(0.9) * pow(0.5 + 0.5 * sin(a * 9.0), 12.0) * smoothstep(-0.7, -0.1, y) * (1.0 - smoothstep(0.2, 0.75, y));
            return c; }
          void main() {
            vec3 N = normalize(vN), V = normalize(vV), R = reflect(-V, N);
            float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
            vec3 c = env(R) * (0.7 + 0.5 * fr) * (0.9 + uLevel * 0.5);
            c *= mix(vec3(1.0), 0.55 + 0.45 * cos(6.2832 * (fr * 1.2 + dot(N, vec3(0.3, 0.5, 0.2)) + vec3(0.0, 0.33, 0.67) + uHue)), uIri * 0.8);   // an oil-film sheen
            c += hsl(uHue, 0.9, 0.6) * (fr * 0.5 + uKick * 0.35);
            gl_FragColor = vec4(c, 1.0); }` });
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, window.VJ_MOBILE ? 24 : 48), mat); scene.add(ball);
      let t = 0, kick = 0, lv = 0, ry = 0, tx = 0, ty = 0;
      return { scene, camera, update(p, dt) {
        t += dt * (0.3 + p[0] * 2.5);
        kick = Math.max(kick * Math.exp(-dt * 7), audioFeat.kick * p[5]); lv += (audioFeat.level * p[5] - lv) * 0.1;
        const U = mat.uniforms; U.uT.value = t; U.uFreq.value = 1.2 + p[2] * 4;
        U.uAmp.value = 0.05 + p[3] * 0.3 + p[5] * (audioFeat.bass * 0.22 + audioFeat.mid * 0.1);
        U.uKick.value = kick; U.uHue.value = p[1]; U.uIri.value = p[4]; U.uLevel.value = lv;
        ry += dt * (0.1 + p[0] * 0.6); tx += (aimX() * 2.5 * p[6] - tx) * 0.08; ty += (aimY() * 1.5 * p[6] - ty) * 0.08;
        ball.rotation.set(ty + Math.sin(t * 0.13) * 0.2, ry + tx, 0);
        ball.scale.setScalar(1 + kick * 0.07 + 0.03 * Math.pow(1 - beatFrac(), 4) * p[5]);
      } };
    } },
  horizon: { name: 'Neon Horizon', params: [P('Speed', 0.35), P('Hue', 0.86), P('Mountains', 0.55), P('Sun', 0.6), P('Glow', 0.5), P('Music react', 0.6),
    P('Steer (hand / camera)', 0.5)],
    // A drive towards a striped sun over a glowing grid, mountains either side. The ground is one grid of squares that
    // only ever slides one square (uFrac) before the mountain heights move one row on (uRow), so it scrolls for ever;
    // the lines are worked out per pixel from the grid position, one pixel sharp near and far. The bass lifts the
    // mountains and every beat sends a band of light away down the road.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
      const sky = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
        uniforms: { uT: { value: 0 }, uHue: { value: 0.86 }, uSun: { value: 0.6 }, uKick: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uT, uHue, uSun, uKick; varying vec2 vUv;
          ${COL_GLSL}
          void main() {
            vec2 w = vec2((vUv.x - 0.5) * 200.0, vUv.y * 70.0 - 2.0);   // world units on the backdrop, y = 0 at the ground
            float R = 4.0 + uSun * 10.0, cy = R * 0.62, d = length(w - vec2(0.0, cy)), yy = (w.y - cy) / R;
            float disc = (1.0 - smoothstep(R - 0.25, R, d)) * step(0.02, uSun);
            float cut = clamp((0.2 - yy) * 0.6, 0.0, 0.75);   // the gaps open up towards the bottom
            float stripe = yy > 0.2 ? 1.0 : smoothstep(cut - 0.05, cut + 0.05, fract(w.y * 0.8 - uT * 0.2));
            vec3 sun = mix(hsl(uHue + 0.04, 1.0, 0.55), hsl(uHue + 0.3, 1.0, 0.6), smoothstep(-1.0, 0.9, yy)) * (1.0 + uKick * 0.3);
            float halo = exp(-max(d - R, 0.0) * 0.16) * 0.45 * step(0.02, uSun), haze = exp(-max(w.y, 0.0) * 0.2);
            vec3 c = sun * disc * stripe + hsl(uHue + 0.05, 0.9, 0.5) * halo * (1.0 - disc) + hsl(uHue - 0.12, 0.9, 0.45) * haze * 0.6;
            vec2 sc = floor(w * 1.3), sf = fract(w * 1.3) - 0.5;
            float st = step(0.975, hash2(sc)) * (0.5 + 0.5 * sin(uT * 2.0 + hash2(sc + 3.0) * 40.0)) * smoothstep(5.0, 18.0, w.y) * (1.0 - smoothstep(0.05, 0.3, length(sf)));
            gl_FragColor = glow(c + vec3(st) * (1.0 - disc)); }` });
      const back = new THREE.Mesh(new THREE.PlaneGeometry(200, 70), sky); back.position.set(0, 33, -73); scene.add(back);
      const W = 48, D = 72;
      const ter = new THREE.ShaderMaterial({
        uniforms: { uFrac: { value: 0 }, uRow: { value: 0 }, uH: { value: 2 }, uHue: { value: 0.86 }, uGlow: { value: 0.5 }, uKick: { value: 0 }, uBeat: { value: 0 } },
        vertexShader: `uniform float uFrac, uRow, uH; varying vec2 vG; varying float vH, vDist;
          float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          void main() {
            vec2 g = vec2(position.x, position.y + ${D / 2}.0);   // whole numbers at every corner: g.y = 0 at your feet
            float ax = abs(g.x), h = smoothstep(2.0, 9.0, ax) * uH * (0.2 + 1.5 * hash2(vec2(g.x, g.y + uRow)) * (0.5 + 0.5 * smoothstep(8.0, 20.0, ax)));
            vec4 mv = modelViewMatrix * vec4(g.x, h, 2.0 + uFrac - g.y, 1.0);
            vG = g; vH = h; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uHue, uGlow, uKick, uBeat; varying vec2 vG; varying float vH, vDist;
          ${COL_GLSL}
          void main() {
            vec2 gw = fwidth(vG), gd = abs(fract(vG - 0.5) - 0.5);   // how far this pixel is from the nearest grid line, each way
            float line = max(1.0 - smoothstep(0.0, gw.x * 1.5, gd.x), 1.0 - smoothstep(0.0, gw.y * 1.5, gd.y)) * (1.0 - smoothstep(0.3, 0.9, max(gw.x, gw.y)));
            float halo = exp(-min(gd.x, gd.y) * (16.0 - uGlow * 11.0)) * uGlow, fog = exp(-vDist * 0.04);
            float pulse = exp(-abs(vDist - uBeat) * 0.45) * uKick;
            vec3 c = hsl(uHue - 0.14, 0.7, 0.04 + vH * 0.012) * fog;
            c += hsl(uHue + vH * 0.025, 1.0, 0.6) * (line * 1.2 + halo * 0.6) * (1.0 + pulse * 2.5) * fog;
            c += hsl(uHue - 0.12, 0.9, 0.45) * (1.0 - fog) * 0.55;   // far off it melts into the sky's haze
            gl_FragColor = vec4(c, 1.0); }` });
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D, W, D), ter); ground.frustumCulled = false; scene.add(ground);
      let travel = 0, t = 0, kick = 0, bass = 0, sx = 0, sy = 0;
      return { scene, camera, update(p, dt) {
        t += dt; travel += dt * (comp.bpm / 60) * (0.5 + p[0] * 6);   // squares per second follow the tempo
        kick = Math.max(kick * Math.exp(-dt * 5), audioFeat.kick * p[5]); bass += (audioFeat.bass * p[5] - bass) * 0.15;
        const U = ter.uniforms; U.uFrac.value = travel % 1; U.uRow.value = Math.floor(travel) % 8192;
        U.uH.value = (0.3 + p[2] * 5) * (1 + bass * 1.2); U.uHue.value = p[1]; U.uGlow.value = p[4]; U.uKick.value = 0.35 * p[5] + kick; U.uBeat.value = beatFrac() * 50;
        const S = sky.uniforms; S.uT.value = t; S.uHue.value = p[1]; S.uSun.value = p[3]; S.uKick.value = kick;
        sx += (aimX() * 3 * p[6] - sx) * 0.06; sy += (aimY() * 1.5 * p[6] - sy) * 0.06;
        camera.position.set(sx, 1.3 + sy + bass * 0.15, 1.5); camera.lookAt(sx * 0.6, 2.1 + sy, -30); camera.rotation.z = -sx * 0.04;
      } };
    } },
  lasertunnel: { name: 'Laser Tunnel', params: [P('Speed', 0.4), P('Hue', 0.55), P('Sides (3, 4, 5, 6, 8, round)', 0.55), P('Twist', 0.25), P('Colour mix', 0.5),
    P('Music react', 0.6), P('Steer (hand / camera)', 0.5)],
    // A flight down an endless tunnel of light: glowing frames, lines running into the distance and wall panels that
    // light up with the highs. One full-frame shader: a pixel's angle and 1 / distance from the middle are its place
    // around and along the tunnel. The frames pass at the tempo and every beat a flash runs away down the tunnel.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 10);
      const mat = fsMat({ uT: { value: 0 }, uTravel: { value: 0 }, uHue: { value: 0.55 }, uSides: { value: 6 }, uTwist: { value: 0 }, uMix: { value: 0.5 },
        uKick: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 }, uSteer: { value: new THREE.Vector2() } },
        `uniform float uT, uTravel, uHue, uSides, uTwist, uMix, uKick, uHigh, uBeat; uniform vec2 uSteer;
        void main() {
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0 - uSteer;
          float r = length(q), pipe = step(9.5, uSides), n = mix(uSides, 12.0, pipe), seg = 6.2832 / n;
          float a = atan(q.y, q.x) + uT * 0.1 + uTwist / max(r, 0.06);
          float th = mod(a + seg * 0.5, seg) - seg * 0.5, face = floor((a + seg * 0.5) / seg);
          float rp = mix(r * cos(th) / cos(seg * 0.5), r, pipe);   // the distance to the wall: flat sides, or a pipe
          rp = max(rp, 0.02);
          float z = 0.7 / rp, zz = z + uTravel, wz = z / rp * uPx * 1.5;
          float fz = abs(fract(zz - 0.5) - 0.5), ring = 1.0 - smoothstep(0.018, 0.018 + max(wz, 0.008), fz), ringGlow = exp(-fz * 9.0) * 0.45;
          float v = th / seg + 0.5, arc = abs(fract(v * 3.0 - 0.5) - 0.5) / 3.0 * seg * r, wl = 0.006 * rp;
          float rail = 1.0 - smoothstep(wl, wl + uPx * 1.5, arc), railGlow = exp(-arc / rp * 28.0) * 0.3;
          float cell = hash2(vec2(floor(zz), face * 3.0 + floor(v * 3.0)));
          float panel = step(0.86 - uHigh * 0.3, cell) * (0.45 + 0.55 * sin(uT * 3.0 + cell * 40.0)) * (1.0 - smoothstep(0.3, 0.5, fz) * 0.6);
          float fade = smoothstep(0.03, 0.32, rp), pulse = exp(-abs(z - 0.7 - uBeat * 9.0) * 1.1) * uKick;
          float hr = uHue + (hash(floor(zz + 0.5)) - 0.5) * uMix * 0.5;
          vec3 c = hsl(hr, 0.95, 0.6) * (ring + ringGlow) + hsl(uHue + 0.08, 0.9, 0.62) * (rail + railGlow) + hsl(uHue + 0.5 * uMix + cell * 0.1, 0.9, 0.55) * panel * 0.7;
          c *= fade * (1.0 + pulse * 2.5);
          c += hsl(uHue + 0.5 * uMix, 0.8, 0.6) * exp(-r * r * 30.0) * (0.35 + uKick * 0.6);   // the light at the end
          gl_FragColor = glow(c); }`);
      scene.add(fsMesh(mat));
      const steer = mat.uniforms.uSteer.value;
      let t = 0, travel = 0, kick = 0, high = 0;
      return { scene, camera, update(p, dt) {
        t += dt * (0.4 + p[0] * 2); travel += dt * (comp.bpm / 60) * (0.5 + p[0] * 5);
        kick = Math.max(kick * Math.exp(-dt * 5), audioFeat.kick * p[5]); high += (audioFeat.high * p[5] - high) * 0.2;
        const U = mat.uniforms; U.uT.value = t; U.uTravel.value = travel % 4096; U.uHue.value = p[1];
        U.uSides.value = [3, 4, 5, 6, 8, 10][Math.min(5, Math.floor(p[2] * 6))]; U.uTwist.value = (p[3] - 0.25) * 0.6;
        U.uMix.value = p[4]; U.uKick.value = 0.3 * p[5] + kick; U.uHigh.value = high; U.uBeat.value = beatFrac();
        steer.x += (aimX() * 1.2 * p[6] + Math.sin(t * 0.21) * 0.08 - steer.x) * 0.06; steer.y += (aimY() * 0.8 * p[6] + Math.sin(t * 0.17) * 0.05 - steer.y) * 0.06;
        fsFrame(mat);
      } };
    } },
  aurora: { name: 'Aurora', params: [P('Speed', 0.3), P('Hue', 0.38), P('Height', 0.5), P('Colour spread', 0.6), P('Rays', 0.6), P('Music react', 0.6),
    P('Drift (hand / camera)', 0.5)],
    // Northern lights: five curtains of light, each a long strip that folds and sways in the vertex shader, bright along
    // its hem and fading upwards in fine rays, over a few faint stars. Calm: made for intros and breakdowns. The level
    // of the music brightens it and the bass makes the curtains grow.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
      const sh = { uT: { value: 0 }, uH: { value: 1 }, uHue: { value: 0.38 }, uSpread: { value: 0.6 }, uRays: { value: 0.6 }, uLight: { value: 0.4 } };
      const geo = new THREE.PlaneGeometry(1, 1, window.VJ_MOBILE ? 120 : 240, 1);
      for (let k = 0; k < 5; k++) {
        const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { ...sh, uK: { value: k } },
          vertexShader: `uniform float uT, uK, uH; varying vec2 vUv; varying float vX;
            void main() {
              float x = (uv.x - 0.5) * 24.0, ph = uK * 1.7;
              float z = -uK * 1.5 + sin(x * 0.32 + uT * 0.25 + ph) * 1.4 + sin(x * 0.85 - uT * 0.4 + ph * 2.3) * 0.5 + sin(x * 2.3 + uT * 0.7 + ph) * 0.15;
              float h = uH * (3.6 + 1.2 * sin(x * 0.45 + uT * 0.2 + ph * 3.1) + 0.5 * sin(x * 1.7 - uT * 0.33 + ph));
              float y = -1.5 + uK * 0.35 + sin(x * 0.2 + uT * 0.15 + ph) * 0.5 + uv.y * h;
              vUv = uv; vX = x; gl_Position = projectionMatrix * modelViewMatrix * vec4(x + sin(x * 1.3 + uT * 0.5 + ph) * 0.35, y, z, 1.0); }`,
          fragmentShader: `uniform float uT, uK, uHue, uSpread, uRays, uLight; varying vec2 vUv; varying float vX;
            ${COL_GLSL}
            void main() {
              float v = vUv.y, x = vX;
              float rays = (0.55 + 0.45 * sin(x * 9.0 + sin(x * 2.3 + uT * 0.6) * 3.0 + uK * 5.0)) * (0.6 + 0.4 * sin(x * 31.0 - uT * 1.2 + sin(x * 5.0) * 2.0));
              rays = mix(0.6, rays * 1.5, uRays);
              float prof = pow(1.0 - v, 1.4 + 2.5 * (1.0 - rays)) * smoothstep(0.0, 0.04, v);   // a bright hem; each ray reaches its own height
              float ends = smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));
              vec3 c = mix(hsl(uHue, 0.9, 0.55), hsl(uHue + uSpread * 0.4, 0.9, 0.55), smoothstep(0.0, 0.7, v)) * (1.0 + (1.0 - v) * 0.6);
              gl_FragColor = vec4(c, prof * ends * (0.4 + rays * 0.6) * uLight); }` }));
        m.frustumCulled = false; scene.add(m);
      }
      const n = 1500, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = -4 + Math.random() * 26; pos[i * 3 + 2] = -22; seed[i] = Math.random(); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', attr(pos, 3)); sg.setAttribute('aSeed', attr(seed, 1));
      const stars = pointsMat({ uT: sh.uT }, `attribute float aSeed; uniform float uT;`,
        `vCol = vec4(vec3(0.8, 0.9, 1.0), (0.25 + 0.75 * aSeed) * (0.6 + 0.4 * sin(uT * 2.0 + aSeed * 60.0)) * 0.7); sz = 0.05 + aSeed * 0.09;`);
      scene.add(ptMesh(sg, stars));
      let t = 0, kick = 0, lv = 0, bass = 0, cx = 0, cy = 0;
      return { scene, camera, update(p, dt) {
        t += dt * (0.2 + p[0] * 2.5);
        kick = Math.max(kick * Math.exp(-dt * 3), audioFeat.kick * p[5]); lv += (audioFeat.level * p[5] - lv) * 0.06; bass += (audioFeat.bass * p[5] - bass) * 0.08;
        sh.uT.value = t; sh.uH.value = (0.4 + p[2] * 1.3) * (1 + bass * 0.6); sh.uHue.value = p[1]; sh.uSpread.value = p[3]; sh.uRays.value = p[4];
        sh.uLight.value = 0.42 + lv * 0.5 + kick * 0.3;
        ptFrame(stars, camera, 0);
        cx += (aimX() * 5 * p[6] + Math.sin(t * 0.1) * 0.6 - cx) * 0.05; cy += (aimY() * 2 * p[6] - cy) * 0.05;
        camera.position.set(cx, 0.2 + cy, 7); camera.lookAt(cx * 0.3, 0.7, -3);
      } };
    } },
  lasers: { name: 'Laser Show', params: [P('Speed', 0.4), P('Hue', 0.5), P('Spread', 0.5), P('Colour mix', 0.5), P('Pattern (auto, fans, meet, cross, sky)', 0),
    P('Music react', 0.6), P('Aim (hand / camera)', 0.5)],
    // A club laser rig: seven heads along the floor, nine beams each, through haze. Every beam is a thin strip turned to
    // face the viewer in the vertex shader, which also aims it: a pattern is just six numbers (how wide the fans are, how
    // far they swing and lean, whether they meet in the middle or alternate), and the rig glides from one pattern to the
    // next every 16 beats. The swing keeps time with the beat and the kick flashes the beams.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 8;
      const HEADS = 7, BEAMS = 9, n = HEADS * BEAMS, pos = new Float32Array(n * 12), beam = new Float32Array(n * 8), idx = [];
      for (let h = 0, i = 0; h < HEADS; h++) for (let b = 0; b < BEAMS; b++, i++) {
        [[-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(([x, y], k) => { pos[i * 12 + k * 3] = x; pos[i * 12 + k * 3 + 1] = y; beam[i * 8 + k * 2] = h; beam[i * 8 + k * 2 + 1] = b / (BEAMS - 1) - 0.5; });
        idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aBeam', attr(beam, 2)); geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uT: { value: 0 }, uSm: { value: 0 }, uSpread: { value: 0.8 }, uTilt: { value: 0.5 }, uPhase: { value: 0.8 }, uConv: { value: 0 }, uLean: { value: 0.2 }, uAlt: { value: 0 },
          uAim: { value: 0 }, uHue: { value: 0.5 }, uMix: { value: 0.5 }, uLight: { value: 0.6 } },
        vertexShader: `attribute vec2 aBeam; uniform float uT, uSpread, uTilt, uPhase, uConv, uLean, uAlt, uAim; varying vec2 vQ; varying vec2 vB;
          void main() {
            float h = aBeam.x, hx = (h / ${HEADS - 1}.0 - 0.5) * 11.0, par = mod(h, 2.0) * 2.0 - 1.0;
            vec3 o = vec3(hx, -3.4, 0.0);
            float ang = uConv * atan(-hx, 5.0) + uTilt * sin(uT + h * uPhase) * mix(1.0, par, uAlt) + aBeam.y * uSpread + uAim;
            float lean = uLean * sin(uT * 0.7 + h * 0.9 + aBeam.y * 2.0);
            vec3 d = vec3(sin(ang), cos(ang) * cos(lean), cos(ang) * sin(lean));
            vec3 a = (modelViewMatrix * vec4(o, 1.0)).xyz, b = (modelViewMatrix * vec4(o + d * 15.0, 1.0)).xyz, c = mix(a, b, position.y);
            c += normalize(cross(b - a, c)) * position.x * (0.1 + position.y * 0.2);   // across the beam, facing the viewer; a beam spreads a little
            vQ = position.xy; vB = aBeam; gl_Position = projectionMatrix * vec4(c, 1.0); }`,
        fragmentShader: `uniform float uSm, uHue, uMix, uLight; varying vec2 vQ; varying vec2 vB;
          ${COL_GLSL}
          void main() {
            float x = abs(vQ.x), y = vQ.y, core = exp(-x * x * 40.0), halo = exp(-x * x * 4.0) * 0.3;
            float haze = 0.72 + 0.28 * sin(y * 23.0 - uSm * 3.0 + vB.x * 4.0 + vB.y * 20.0) * sin(y * 7.0 + uSm * 1.3 + vB.y * 9.0);   // drifting smoke
            float fade = ((1.0 - y) * (1.0 - y) * 0.85 + 0.15) * (1.0 - smoothstep(0.8, 1.0, y));
            vec3 col = hsl(uHue + mod(vB.x, 2.0) * uMix * 0.5 + vB.y * uMix * 0.12, 1.0, 0.55);
            gl_FragColor = vec4(mix(col, vec3(1.0), core * 0.5), (core + halo) * haze * fade * uLight); }` });
      const rig = new THREE.Mesh(geo, mat); rig.frustumCulled = false; scene.add(rig);
      const hp = new Float32Array(HEADS * 3); for (let h = 0; h < HEADS; h++) { hp[h * 3] = (h / (HEADS - 1) - 0.5) * 11; hp[h * 3 + 1] = -3.4; }
      const hg = new THREE.BufferGeometry(); hg.setAttribute('position', attr(hp, 3));
      const heads = pointsMat({ uHue: mat.uniforms.uHue, uLight: mat.uniforms.uLight }, `uniform float uHue, uLight;`, `vCol = vec4(hsl(uHue, 0.6, 0.8), uLight); sz = 0.5 + uLight * 0.4;`);
      scene.add(ptMesh(hg, heads));
      //             fan width, swing, phase step per head, meet in the middle, lean to the viewer, alternate heads
      const PATS = [[0.9, 0.5, 0.8, 0, 0.25, 0], [0.22, 0.12, 0.5, 1, 0.1, 0], [0.5, 0.7, 0, 0.3, 0.2, 1], [1.5, 0.2, 1.6, 0, 0.7, 0]];
      const cur = PATS[0].slice(), KEYS = ['uSpread', 'uTilt', 'uPhase', 'uConv', 'uLean', 'uAlt'];
      let t = 0, sm = 0, kick = 0, lv = 0, aim = 0;
      return { scene, camera, update(p, dt) {
        t += dt * (comp.bpm / 60) * Math.PI * (0.1 + p[0]); sm += dt;   // one swing every few beats
        const want = PATS[p[4] < 0.2 ? ((Math.floor(comp.beats / 16) % 4) + 4) % 4 : Math.min(3, Math.floor((p[4] - 0.2) / 0.2))];
        const U = mat.uniforms, k = Math.min(1, dt * 3);
        KEYS.forEach((key, i) => { cur[i] += (want[i] - cur[i]) * k; U[key].value = cur[i] * (i === 0 ? 0.3 + p[2] * 1.4 : 1); });
        kick = Math.max(kick * Math.exp(-dt * 6), audioFeat.kick * p[5]); lv += (audioFeat.level * p[5] - lv) * 0.1;
        aim += (aimX() * 1.6 * p[6] - aim) * 0.1;
        U.uT.value = t; U.uSm.value = sm; U.uAim.value = aim; U.uHue.value = p[1]; U.uMix.value = p[3];
        U.uLight.value = 0.85 + lv * 0.3 + kick * 0.6 + 0.15 * Math.pow(1 - beatFrac(), 4) * p[5];
        ptFrame(heads, camera, 0);
        camera.position.x += (camX() * 2 - camera.position.x) * 0.05; camera.lookAt(0, 0, 0);
      } };
    } },
  particles: { name: 'Particle Storm', params: [P('Speed', 0.3), P('Hue', 0.6), P('Size', 0.4), P('Bass push', 0.6), P('Camera follow', 0.5)],
    // A thick shell of points around the centre, turning and breathing with the bass. Round GPU points: each one also
    // drifts in a slow flow field and twinkles, and the kick sends a ripple outwards through the shell.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100); camera.position.z = 5;
      const n = window.VJ_MOBILE ? 15000 : 40000, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 1.6 + Math.pow(Math.random(), 3) * 2.2, q = Math.sqrt(1 - u * u);
        pos[i * 3] = Math.cos(a) * q * r; pos[i * 3 + 1] = u * r; pos[i * 3 + 2] = Math.sin(a) * q * r; seed[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSeed', attr(seed, 1));
      const mat = pointsMat({ uT: { value: 0 }, uHue: { value: 0.6 }, uSize: { value: 0.03 }, uWave: { value: 0 }, uWaveR: { value: 0 } },
        `attribute float aSeed; uniform float uT, uHue, uSize, uWave, uWaveR;`,
        `float r = length(p);
        p += flow(p * 0.7 + aSeed, uT * 0.6) * 0.06;
        p *= 1.0 + uWave * 0.25 * exp(-pow((r - uWaveR) * 2.5, 2.0));   // the kick ripple, a shell moving outwards
        float tw = 0.6 + 0.4 * sin(uT * 3.0 + aSeed * 40.0);
        vCol = vec4(hsl(uHue + aSeed * 0.08 - (r - 1.6) * 0.03, 0.8, 0.6 + uWave * 0.25 * exp(-pow((r - uWaveR) * 2.5, 2.0))), 0.95 * tw);
        sz = uSize * (0.5 + aSeed);`);
      const g = new THREE.Group(); g.add(ptMesh(geo, mat)); scene.add(g);
      let t = 0, wave = 0, waveR = 9, armed = true;
      return { scene, camera, update(p, dt) {
        t += dt * (0.4 + p[0] * 2);
        g.rotation.y += dt * (0.05 + p[0] * 1.2); g.rotation.x += dt * (0.02 + p[0] * 0.3);
        g.scale.setScalar(1 + audioFeat.bass * p[3] * 0.6 + audioFeat.kick * p[3] * 0.2);
        if (audioFeat.kick > 0.6 && armed) { armed = false; wave = p[3]; waveR = 1.2; }
        if (audioFeat.kick < 0.3) armed = true;
        waveR += dt * 4; wave *= Math.exp(-dt * 2.5);
        const U = mat.uniforms; U.uT.value = t; U.uHue.value = p[1] + audioFeat.high * 0.1; U.uSize.value = 0.012 + p[2] * 0.075;
        U.uWave.value = wave; U.uWaveR.value = waveR;
        ptFrame(mat, camera, 0);
        const tx = camOn() ? (camFeat.x - 0.5) * 4 * p[4] : 0, ty = camOn() ? (camFeat.y - 0.5) * 3 * p[4] : 0;
        camera.position.x += (tx - camera.position.x) * 0.1; camera.position.y += (ty - camera.position.y) * 0.1; camera.lookAt(0, 0, 0);
      } };
    } },
  stars: { name: 'Star Warp', trail: 0.15, params: [P('Speed', 0.4), P('Hue', 0.6), P('Star size', 0.4), P('Bass boost', 0.6), P('Steer (hand / camera)', 0.6)],
    // Flying through a star field at the tempo. The stars' flight is in the vertex shader (z = start + distance travelled,
    // wrapped), so there are many more of them; they fade in far away, brighten as they pass, and the near ones stretch
    // into short streaks of points along the line of flight when the speed is up.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
      const stars = window.VJ_MOBILE ? 8000 : 20000, tail = 4, n = stars * tail, pos = new Float32Array(n * 3), seed = new Float32Array(n), k = new Float32Array(n);
      for (let s = 0; s < stars; s++) {
        const x = (Math.random() - 0.5) * 60, y = (Math.random() - 0.5) * 40, z = -Math.random() * 120, r = Math.random();
        for (let j = 0; j < tail; j++) { const i = s * tail + j; pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; seed[i] = r; k[i] = j / tail; }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSeed', attr(seed, 1)); geo.setAttribute('aTail', attr(k, 1));
      const mat = pointsMat({ uTravel: { value: 0 }, uStreak: { value: 0 }, uHue: { value: 0.6 }, uSize: { value: 0.1 }, uFlash: { value: 0 } },
        `attribute float aSeed; attribute float aTail; uniform float uTravel, uStreak, uHue, uSize, uFlash;`,
        `float z = mod(p.z + uTravel + 120.0, 122.0) - 120.0;   // -120 .. 2, then round again
        p.z = z - aTail * uStreak;                              // the tail points trail behind the head
        float near = smoothstep(-120.0, -10.0, z) * (1.0 - smoothstep(-4.0, -0.5, z));   // fade in far away, out as it passes the lens
        vCol = vec4(hsl(uHue + (aSeed - 0.5) * 0.12, 0.6 - aSeed * 0.3, 0.75 + uFlash * 0.2), near * (1.0 - aTail * 0.8) * (aTail > 0.0 ? step(0.01, uStreak) : 1.0));
        sz = uSize * (0.6 + aSeed * 0.8) * (1.0 - aTail * 0.5);`);
      scene.add(ptMesh(geo, mat));
      let travel = 0, flash = 0;
      return { scene, camera, update(p, dt) {
        const v = (comp.bpm / 60) * (4 + p[0] * 40) * (1 + audioFeat.bass * p[3] * 2);   // units per second
        travel += dt * v; flash = Math.max(flash * Math.exp(-dt * 6), audioFeat.kick * p[3]);
        const U = mat.uniforms; U.uTravel.value = travel; U.uStreak.value = Math.min(5, v * 0.035); U.uHue.value = p[1];
        U.uSize.value = 0.06 + p[2] * 0.35; U.uFlash.value = flash;
        ptFrame(mat, camera, 0);
        const sx = handOn() ? handFeat.x - 0.5 : camOn() ? camFeat.x - 0.5 : 0, sy = handOn() ? handFeat.y - 0.5 : camOn() ? camFeat.y - 0.5 : 0;
        camera.rotation.y += (-sx * 0.8 * p[4] - camera.rotation.y) * 0.08; camera.rotation.x += (sy * 0.5 * p[4] - camera.rotation.x) * 0.08;
      } };
    } },
  comet: { name: 'Hand Comet', trail: 0.35, params: [P('Tail length', 0.5), P('Hue', 0.95), P('Size', 0.5), P('Sparkle', 0.5), P('Follow hand', 1)],
    // A comet whose head follows your hand (a figure eight when no hand is seen). Particles are born at the head with a
    // random velocity; only the newborn ones are written each frame (birth place, velocity, birth time), and their flight,
    // fade and colour (white-hot when young, then the hue) are worked out from their age in the vertex shader.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 8;
      const n = window.VJ_MOBILE ? 4000 : 8000, R = Math.random, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), born = new Float32Array(n).fill(-100), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) seed[i] = R();
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aVel', attr(vel, 3));
      geo.setAttribute('aBorn', attr(born, 1)); geo.setAttribute('aSeed', attr(seed, 1));
      const mat = pointsMat({ uT: { value: 0 }, uLife: { value: 1 }, uHue: { value: 0.95 }, uSize: { value: 0.1 }, uSparkle: { value: 0.5 } },
        `attribute vec3 aVel; attribute float aBorn; attribute float aSeed; uniform float uT, uLife, uHue, uSize, uSparkle;`,
        `float age = uT - aBorn, life = uLife * (0.6 + aSeed * 0.8), f = age / life;
        if (age < 0.0 || f >= 1.0) vCol = vec4(0.0);
        else {
          p += aVel * age + flow(p * 0.8 + aSeed, uT) * age * 0.15 * uSparkle;
          float tw = mix(1.0, step(0.35, hash(aSeed * 77.0 + floor(uT * 30.0))), uSparkle * f);   // older sparks twinkle
          vCol = vec4(hsl(uHue + f * 0.08, 0.9, 0.85 - f * 0.3), (1.0 - f * f) * tw);
          sz = uSize * (1.0 - f * 0.7);
        }`);
      scene.add(ptMesh(geo, mat));
      const head = new THREE.Vector3();
      let next = 0, t = 0, carry = 0;
      return { scene, camera, update(p, dt) {
        t += dt;
        // the head follows the hand (or drifts in a figure eight when no hand is seen); the camera picture is 10 x 5.6 units at z = 0
        const hx = handOn() && p[4] > 0 ? (handFeat.x - 0.5) * 10 : Math.sin(t * 0.7) * 3.5, hy = handOn() && p[4] > 0 ? (handFeat.y - 0.5) * 5.6 : Math.sin(t * 1.4) * 1.6;
        const ox = head.x, oy = head.y; head.x += (hx - head.x) * 0.25; head.y += (hy - head.y) * 0.25;
        carry += dt * 60 * (40 + audioFeat.level * 80); const spawn = Math.min(n >> 2, Math.floor(carry)); carry -= spawn;
        const sp = 0.3 + p[3] * 2 * (0.3 + audioFeat.kick);
        for (let s = 0; s < spawn; s++) {
          const i = next, k = (s + 1) / spawn; next = (next + 1) % n;   // spread the births along this frame's path, no gaps when the hand is fast
          pos[i * 3] = ox + (head.x - ox) * k; pos[i * 3 + 1] = oy + (head.y - oy) * k; pos[i * 3 + 2] = 0;
          vel[i * 3] = (R() - 0.5) * sp; vel[i * 3 + 1] = (R() - 0.5) * sp; vel[i * 3 + 2] = (R() - 0.5) * sp;
          born[i] = t - dt * (1 - k);
        }
        if (spawn) for (const a of ['position', 'aVel', 'aBorn']) geo.attributes[a].needsUpdate = true;
        const U = mat.uniforms; U.uT.value = t; U.uLife.value = 0.3 + p[0] * 2.5; U.uHue.value = p[1]; U.uSize.value = 0.03 + p[2] * 0.2; U.uSparkle.value = p[3];
        ptFrame(mat, camera, 0);
      } };
    } },
  morph: { name: 'Particle Morph', params: [P('Speed', 0.3), P('Hue', 0.62), P('Morph every (2-32 beats)', 0.5), P('Flow', 0.35),
    P('Music react', 0.6), P('Size', 0.4), P('Hand pull / camera follow', 0.6)],
    // One cloud of 100k points (40k on phones) that changes shape on the beat. Every shape is a vertex attribute built
    // once; a morph only swaps which two attributes are 'position' (from) and 'aTo', so nothing is re-uploaded and
    // all motion (the morph itself, the flow field, the kick burst, the hand pull) runs in the vertex shader.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 6;
      const n = window.VJ_MOBILE ? 40000 : 100000, TAU = Math.PI * 2, R = Math.random;
      const shape = (f, tilt = 0) => {   // tilt (radians about x) turns flat shapes towards the camera
        const a = new Float32Array(n * 3), v = [0, 0, 0], ct = Math.cos(tilt), st = Math.sin(tilt);
        for (let i = 0; i < n; i++) { f(i / n, i, v); a[i * 3] = v[0]; a[i * 3 + 1] = v[1] * ct - v[2] * st; a[i * 3 + 2] = v[1] * st + v[2] * ct; }
        return new THREE.BufferAttribute(a, 3);
      };
      // particle i sits at the same parameter u = i / n on every shape, so a morph flows instead of scrambling
      const shapes = [
        shape((u, i, v) => { const y = 1 - 2 * u, r = Math.sqrt(1 - y * y), a = i * 2.39996, s = 1.7 + (R() - 0.5) * 0.06; v[0] = Math.cos(a) * r * s; v[1] = y * s; v[2] = Math.sin(a) * r * s; }),   // sphere
        shape((u, i, v) => { const f = i % 6, a = R() * 2 - 1, b = R() * 2 - 1, s = 1.25, k = f & 1 ? s : -s;   // cube surface
          if (f < 2) { v[0] = k; v[1] = a * s; v[2] = b * s; } else if (f < 4) { v[0] = a * s; v[1] = k; v[2] = b * s; } else { v[0] = a * s; v[1] = b * s; v[2] = k; } }),
        shape((u, i, v) => { const t = u * TAU, p = 2, q = 3, r = 1.15 + 0.45 * Math.cos(q * t), a = R() * TAU, w = 0.16 * Math.sqrt(R());   // torus knot
          v[0] = r * Math.cos(p * t) + Math.cos(a) * w; v[1] = r * Math.sin(p * t) + Math.sin(a) * w; v[2] = 0.45 * Math.sin(q * t) * 1.6 + Math.cos(a + 1) * w; }),
        shape((u, i, v) => { const arm = i % 3, r = 0.1 + Math.pow(u, 0.6) * 2.4, a = arm * TAU / 3 + r * 2.2, sp = 0.25 * (1 - u * 0.5);   // spiral galaxy
          v[0] = Math.cos(a) * r + (R() - 0.5) * sp; v[1] = (R() - 0.5) * 0.18 * (1.2 - u); v[2] = Math.sin(a) * r + (R() - 0.5) * sp; }, 1.1),
        shape((u, i, v) => { const t = u * 5 * TAU, s = i & 1 ? Math.PI : 0, rung = i % 7 === 0, k = rung ? R() * 2 - 1 : 1;   // double helix with rungs
          v[0] = Math.cos(t + s) * 0.8 * k + (R() - 0.5) * 0.05; v[1] = (u - 0.5) * 4; v[2] = Math.sin(t + s) * 0.8 * k + (R() - 0.5) * 0.05; }),
        shape((u, i, v) => { const a = u * TAU, b = R() * TAU, r = 1.5, w = 0.5;   // torus
          v[0] = (r + w * Math.cos(b)) * Math.cos(a); v[1] = w * Math.sin(b); v[2] = (r + w * Math.cos(b)) * Math.sin(a); }),
        shape((u, i, v) => { const x = (R() - 0.5) * 5, z = (R() - 0.5) * 5, d = Math.hypot(x, z);   // ripple sheet
          v[0] = x; v[1] = Math.sin(d * 2.6) * 0.35 * Math.exp(-d * 0.25); v[2] = z; }, 0.8),
      ];
      const rnd = new Float32Array(n); for (let i = 0; i < n; i++) rnd[i] = R();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', shapes[0]); geo.setAttribute('aTo', shapes[0]); geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uT: { value: 0 }, uMix: { value: 1 }, uFlow: { value: 0.3 }, uKick: { value: 0 }, uSize: { value: 0.03 }, uScale: { value: 500 },
          uHue: { value: 0.6 }, uFlash: { value: 0 }, uAlpha: { value: 0.6 }, uPull: { value: new THREE.Vector3() } },
        vertexShader: `attribute vec3 aTo; attribute float aRand;
          uniform float uT, uMix, uFlow, uKick, uSize, uScale, uHue, uFlash; uniform vec3 uPull; varying vec3 vCol;
          vec3 flow(vec3 p, float t) { return vec3(sin(p.y * 1.7 + t) + sin(p.z * 2.3 - t * 0.7), sin(p.z * 1.9 + t * 1.1) + sin(p.x * 2.1 + t * 0.5),
            sin(p.x * 1.5 - t * 0.9) + sin(p.y * 2.7 + t * 1.3)); }
          vec3 hsl(float h, float s, float l) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return l + (k - 0.5) * (1.0 - abs(2.0 * l - 1.0)) * s; }
          void main() {
            float m = smoothstep(0.0, 1.0, clamp(uMix * 1.6 - aRand * 0.6, 0.0, 1.0));   // each particle leaves at its own moment
            float mid = sin(m * 3.14159);                                                 // 1 halfway through its trip
            vec3 p = mix(position, aTo, m);
            p += flow(p * 1.3 + aRand * 2.0, uT) * (uFlow * 0.12 + mid * 0.35);           // swirl, much more while in flight
            p *= 1.0 + uKick * (0.4 + aRand * 0.8);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vec2 d = uPull.xy - mv.xy; mv.xy += d * uPull.z * exp(-dot(d, d) * 0.5);      // hand: a soft attractor in view space
            gl_Position = projectionMatrix * mv;
            gl_PointSize = max(1.0, uSize * (0.5 + aRand) * uScale / -mv.z);
            vCol = hsl(uHue + aRand * 0.12 + p.y * 0.04 + mid * 0.15, 0.85, 0.5 + uFlash * 0.25 + mid * 0.15);
          }`,
        fragmentShader: `uniform float uAlpha; varying vec3 vCol;
          void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vCol * (0.6 + a), a * a * uAlpha); }` });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;   // the shader moves points outside the bounding sphere
      const g = new THREE.Group(); g.add(pts); scene.add(g);
      const S = shapes.length, pick = k => ((k * 3) % S + S) % S;   // step 3 of 7: visits every shape before repeating
      let t = 0, cur = 0, kick = 0;
      return { scene, camera, update(p, dt) {
        const per = [2, 4, 8, 16, 32][Math.min(4, Math.floor(p[2] * 5))], k = Math.floor(comp.beats / per);
        if (k !== cur) { cur = k; geo.setAttribute('position', shapes[pick(k - 1)]); geo.setAttribute('aTo', shapes[pick(k)]); }
        const into = comp.beats - k * per, U = mat.uniforms;   // morph over the first 2 beats of the period (half of it when shorter)
        U.uMix.value = Math.min(1, into / Math.min(2, per * 0.5));
        t += dt * (0.3 + p[0] * 2.5);
        g.rotation.y += dt * (0.05 + p[0] * 0.8); g.rotation.x = Math.sin(t * 0.15) * 0.35;
        kick = Math.max(kick * Math.exp(-dt * 8), audioFeat.kick);
        U.uT.value = t; U.uFlow.value = p[3] * (1 + audioFeat.bass * p[4] * 2);
        U.uKick.value = p[4] * (0.12 * kick + 0.05 * Math.pow(1 - beatFrac(), 6));
        U.uHue.value = p[1] + audioFeat.high * p[4] * 0.08; U.uFlash.value = p[4] * kick;
        U.uSize.value = 0.01 + p[5] * 0.06; U.uScale.value = comp.h / (2 * Math.tan(camera.fov * Math.PI / 360));
        U.uAlpha.value = window.VJ_MOBILE ? 0.8 : 0.55;
        // hand: pull the points towards it (harder on a pinch); camera input without a hand: the view follows you
        const halfH = Math.tan(camera.fov * Math.PI / 360) * camera.position.z, halfW = halfH * camera.aspect;
        if (handOn() && p[6] > 0) U.uPull.value.set((handFeat.x - 0.5) * 2 * halfW, (handFeat.y - 0.5) * 2 * halfH, p[6] * (0.35 + 0.5 * handFeat.pinch));
        else U.uPull.value.z = 0;
        const tx = camOn() && !handOn() ? (camFeat.x - 0.5) * 4 * p[6] : 0, ty = camOn() && !handOn() ? (camFeat.y - 0.5) * 3 * p[6] : 0;
        camera.position.x += (tx - camera.position.x) * 0.1; camera.position.y += (ty - camera.position.y) * 0.1; camera.lookAt(0, 0, 0);
      } };
    } },
  picture: { name: 'Picture Particles', sources: ['below', 'camera'], params: [P('Orbit', 0.3), P('Depth', 0.5), P('Music scatter', 0.5), P('Dark cut', 0.15),
    P('Size', 0.45), P('Hand pull / camera follow', 0.6)],
    // A grid of points that takes its colour from a picture: the layer below this one, or the camera input (c.src).
    // Brightness pushes a point towards the viewer, so any video, text or generator becomes a relief of particles.
    // The picture is the engine's own texture, read in the vertex shader (nothing is copied); with no picture yet
    // (thumbnails, nothing playing below) the points show a moving colour field instead.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 6;
      const gx = window.VJ_MOBILE ? 192 : 320, gy = Math.round(gx * 9 / 16), n = gx * gy, uv = new Float32Array(n * 3);
      for (let y = 0, i = 0; y < gy; y++) for (let x = 0; x < gx; x++, i++) { uv[i * 3] = (x + 0.5) / gx; uv[i * 3 + 1] = (y + 0.5) / gy; uv[i * 3 + 2] = Math.random(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(uv, 3));   // x, y = where to read the picture; z = a random seed
      // the engine's texture handed to three.js as it is: three binds an external texture's sourceTexture and never uploads it
      // (ExternalTexture is not in the vendored subset, and this is all of it that WebGLTextures reads)
      const ext = { isExternalTexture: true, sourceTexture: null, version: 0 };
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTex: { value: ext }, uHas: { value: 0 }, uT: { value: 0 }, uDepth: { value: 1 }, uScatter: { value: 0 }, uCut: { value: 0.15 },
          uSize: { value: 0.03 }, uScale: { value: 500 }, uAspect: { value: 16 / 9 }, uPull: { value: new THREE.Vector3() } },
        vertexShader: `uniform sampler2D uTex; uniform float uHas, uT, uDepth, uScatter, uCut, uSize, uScale, uAspect; uniform vec3 uPull; varying vec4 vCol;
          void main() {
            vec2 uv = position.xy; float r = position.z;
            vec3 c = uHas > 0.5 ? texture(uTex, uv).rgb
              : 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + uv.x * 0.8 + sin(uv.y * 4.0 + uT) * 0.3 + uT * 0.1)) * (1.0 - 0.6 * smoothstep(0.3, 0.9, length(uv - 0.5) * 1.6));
            float l = dot(c, vec3(0.299, 0.587, 0.114));
            float h = 4.5;   // the picture is 4.5 units high, as wide as the composition is
            vec3 p = vec3((uv - 0.5) * vec2(h * uAspect, h), (l - 0.35) * uDepth);
            vec3 dir = normalize(vec3(sin(r * 91.0), cos(r * 47.0), sin(r * 13.0) + 0.6));
            p += dir * uScatter * (0.3 + r) * (0.5 + l);   // the music throws the brightest points furthest
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vec2 d = uPull.xy - mv.xy; mv.xy += d * uPull.z * exp(-dot(d, d) * 0.5);
            gl_Position = projectionMatrix * mv;
            float on = smoothstep(uCut, uCut + 0.08, l);
            gl_PointSize = max(1.0, uSize * (0.6 + l * 0.8) * uScale / -mv.z) * step(0.001, on);
            vCol = vec4(c * (0.7 + l * 0.6), on);
          }`,
        fragmentShader: `varying vec4 vCol;
          void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vCol.a <= 0.0) discard;
            float a = smoothstep(0.5, 0.1, d); gl_FragColor = vec4(vCol.rgb, a * vCol.a * 0.85); }` });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
      let t = 0, orbit = 0, kick = 0;
      return { scene, camera, update(p, dt, L, c) {
        // the picture: the layer under this one (layers draw bottom first, so it is this frame's), else the camera
        let tex = null;
        const li = L ? comp.layers.indexOf(L) : -1;
        if ((!c || c.src !== 'camera') && li > 0) tex = comp.layers[li - 1].outTex;
        if (!tex && camOn() && camState.tex) tex = camState.tex;
        const U = mat.uniforms; ext.sourceTexture = tex; U.uHas.value = tex ? 1 : 0;
        t += dt; orbit += dt * p[0] * 0.6;
        kick = Math.max(kick * Math.exp(-dt * 6), audioFeat.kick);
        U.uT.value = t; U.uDepth.value = p[1] * 3 * (1 + audioFeat.bass * p[2]);
        U.uScatter.value = p[2] * (1.2 * kick + 0.3 * Math.pow(1 - beatFrac(), 6));
        U.uCut.value = p[3] * 0.6; U.uSize.value = 0.008 + p[4] * 0.05;
        U.uScale.value = comp.h / (2 * Math.tan(camera.fov * Math.PI / 360)); U.uAspect.value = comp.w / comp.h;
        const halfH = Math.tan(camera.fov * Math.PI / 360) * 6, halfW = halfH * camera.aspect;
        if (handOn() && p[5] > 0) U.uPull.value.set((handFeat.x - 0.5) * 2 * halfW, (handFeat.y - 0.5) * 2 * halfH, p[5] * (0.35 + 0.5 * handFeat.pinch));
        else U.uPull.value.z = 0;
        // the view swings around the relief (wider with Orbit), or follows you on the camera input
        const fx = camOn() && !handOn() ? (camFeat.x - 0.5) * 6 * p[5] : 0, fy = camOn() && !handOn() ? (camFeat.y - 0.5) * 3 * p[5] : 0;
        const ax = Math.sin(orbit) * 0.7 * Math.min(1, p[0] * 3) + fx * 0.15, ay = Math.sin(orbit * 0.6) * 0.25 * Math.min(1, p[0] * 3) + fy * 0.1;
        camera.position.set(Math.sin(ax) * 6, Math.sin(ay) * 6, Math.cos(ax) * Math.cos(ay) * 6); camera.lookAt(0, 0, 0);
      } };
    } },
  fireworks: { name: 'Beat Fireworks', trail: 0.25, params: [P('Bursts per beat', 0.45), P('Hue', 0.08), P('Colour mix', 0.6), P('Size', 0.4), P('Gravity', 0.5),
    P('Music react', 0.6), P('Hand launch (pinch)', 0.8)],
    // 16 bursts in turn, each a shell of points. A launch only writes the burst's origin, start time and hue into
    // uniforms; the flight (drag, gravity, fade, end sparkle) is a function of age in the vertex shader.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 8;
      const B = 16, per = window.VJ_MOBILE ? 1200 : 4000, n = B * per, R = Math.random;
      const dir = new Float32Array(n * 3), burst = new Float32Array(n), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = R() * 2 - 1, a = R() * Math.PI * 2, q = Math.sqrt(1 - u * u), s = (0.8 + R() * 0.2) * (i % 5 ? 1 : 0.45);   // a shell, plus a slower inner core
        dir[i * 3] = Math.cos(a) * q * s; dir[i * 3 + 1] = u * s; dir[i * 3 + 2] = Math.sin(a) * q * s; burst[i] = Math.floor(i / per); seed[i] = R();
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(dir, 3)); geo.setAttribute('aBurst', attr(burst, 1)); geo.setAttribute('aSeed', attr(seed, 1));
      const bursts = new Float32Array(B * 4).fill(-100), hues = new Float32Array(B);
      const mat = pointsMat({ uT: { value: 0 }, uBurst: { value: bursts }, uHueB: { value: hues }, uGrav: { value: 0.5 }, uSize: { value: 0.04 } },
        `attribute float aBurst; attribute float aSeed; uniform float uT, uGrav, uSize; uniform vec4 uBurst[16]; uniform float uHueB[16];`,
        `int b = int(aBurst + 0.5); vec4 o = uBurst[b]; float age = uT - o.w, life = 1.6 + aSeed * 0.9;
        if (age < 0.0 || age > life) vCol = vec4(0.0);
        else {
          float f = age / life, rad = 2.0 + hash(o.w) * 1.4;
          p = o.xyz + position * rad * (1.0 - exp(-age * 2.6)) - vec3(0.0, uGrav * age * age * 0.7, 0.0);
          float spark = f > 0.55 ? step(0.45, hash(aSeed * 91.0 + floor(uT * 24.0))) : 1.0;   // the tail end crackles
          vCol = vec4(hsl(uHueB[b] + aSeed * 0.04, 0.9, 0.55 + 0.3 * exp(-age * 7.0)), pow(1.0 - f, 1.5) * spark * smoothstep(0.0, 0.12, age));   // fade in: at age 0 every point is in one spot
          sz = uSize * (1.0 - f * 0.6);
        }`);
      scene.add(ptMesh(geo, mat));
      const R2 = (a, b) => a + R() * (b - a);
      let t = 0, slot = 0, lastB = null, armed = true, pinched = false, pv = [0.45, 0.08, 0.6];
      const launch = (x, y, z) => {
        const o = slot * 4; bursts[o] = x ?? R2(-3.8, 3.8); bursts[o + 1] = y ?? R2(-0.2, 2); bursts[o + 2] = z ?? R2(-2, 1.5); bursts[o + 3] = t;
        hues[slot] = pv[1] + (R() - 0.5) * pv[2]; slot = (slot + 1) % B;
      };
      for (let k = 0; k < 4; k++) { t = k * 0.35; launch(); }   // something to see straight away (and in the thumbnail)
      return { scene, camera, update(p, dt) {
        pv = p; t += dt;
        const U = mat.uniforms; U.uT.value = t; U.uGrav.value = p[4] * 1.6; U.uSize.value = 0.025 + p[3] * 0.1;
        const hand = handOn() && p[6] > 0, th = Math.tan(camera.fov * Math.PI / 360) * 8;
        const hx = hand ? (handFeat.x - 0.5) * 2 * th * camera.aspect : 0, hy = hand ? (handFeat.y - 0.5) * 2 * th : 0;
        const rate = [0.25, 0.5, 1, 2, 4][Math.min(4, Math.floor(p[0] * 5))], bi = Math.floor(comp.beats * rate);
        if (lastB === null) lastB = bi;
        if (bi !== lastB) { lastB = bi; if (hand) launch(hx + R2(-1, 1), hy + R2(-0.6, 0.6), 0); else launch(); }
        if (audioFeat.kick > 0.6 && armed && R() < p[5]) { armed = false; launch(); }   // extra bursts on the kicks
        if (audioFeat.kick < 0.3) armed = true;
        const pin = hand && handFeat.pinch > 0.7 * (1.2 - p[6] * 0.4);
        if (pin && !pinched) launch(hx, hy, 0);   // pinch = a burst right at your fingers
        pinched = pin;
        ptFrame(mat, camera, 0);
        camera.position.x += (camX() * 3 - camera.position.x) * 0.1; camera.position.y += (camY() * 2 - camera.position.y) * 0.1; camera.lookAt(0, 0.5, 0);
      } };
    } },
  vortex: { name: 'Vortex', trail: 0.2, params: [P('Speed', 0.3), P('Hue', 0.58), P('Tilt', 0.45), P('Jets', 0.5), P('Size', 0.4), P('Music react', 0.6),
    P('Hand pull / camera follow', 0.6)],
    // A spiral disc falling into its centre, polar jets above and below. Each point keeps its arm angle and falls inwards
    // at a fixed rate; its angle is a0 + 8 / sqrt(r), so it turns faster as it falls (about r^-1.5, like an orbit), and it
    // re-enters at the rim, faded out, when it reaches the middle. Stateless: only the time uniform moves.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 7;
      const n = window.VJ_MOBILE ? 30000 : 90000, R = Math.random, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = R() * 2.95; pos[i * 3 + 1] = (i % 2) * Math.PI + (R() - 0.5) * (R() < 0.3 ? 6.28 : 1.1); pos[i * 3 + 2] = (R() + R() + R() - 1.5) / 1.5; seed[i] = R();
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSeed', attr(seed, 1));
      const mat = pointsMat({ uT: { value: 0 }, uJets: { value: 0.5 }, uKick: { value: 0 }, uHue: { value: 0.58 }, uSize: { value: 0.03 } },
        `attribute float aSeed; uniform float uT, uJets, uKick, uHue, uSize;`,
        `float r0 = position.x, a0 = position.y, h0 = position.z;
        if (aSeed < 0.08) {   // jets: shoot out along the axis, widening and fading
          float s = fract(aSeed * 12.5 + uT * 0.3), side = aSeed < 0.04 ? 1.0 : -1.0, w = (0.03 + s * 0.3) * r0 * 0.35;
          p = vec3(cos(a0 * 7.0 + uT * 3.0) * w, side * s * 3.4, sin(a0 * 7.0 + uT * 3.0) * w);
          vCol = vec4(hsl(uHue + 0.45, 0.6, 0.65), (1.0 - s) * uJets * (0.5 + uKick)); sz = uSize * 0.8;
        } else {
          float r = 0.25 + mod(r0 - uT * 0.15, 2.95), ang = a0 + 8.0 * inversesqrt(r);
          p = vec3(cos(ang) * r, h0 * 0.12 * sqrt(r) * (1.0 + uKick * 2.0), sin(ang) * r);
          float heat = 1.0 - smoothstep(0.25, 2.4, r), edge = smoothstep(0.25, 0.5, r) * (1.0 - smoothstep(2.6, 3.2, r));
          vCol = vec4(hsl(uHue - heat * 0.12, 0.9 - heat * 0.4, 0.3 + heat * 0.45 + uKick * 0.2), edge * 0.6);
          sz = uSize * (0.6 + heat);
        }`);
      const g = new THREE.Group(); g.add(ptMesh(geo, mat)); scene.add(g);
      let t = 0, kick = 0;
      return { scene, camera, update(p, dt) {
        kick = Math.max(kick * Math.exp(-dt * 6), audioFeat.kick * p[5]);
        t += dt * (0.3 + p[0] * 3) * (1 + audioFeat.bass * p[5]);
        const U = mat.uniforms; U.uT.value = t; U.uJets.value = p[3]; U.uKick.value = kick; U.uHue.value = p[1]; U.uSize.value = 0.01 + p[4] * 0.05;
        g.rotation.x = 0.12 + p[2] * 1.3; g.rotation.z = Math.sin(t * 0.05) * 0.15;
        ptFrame(mat, camera, p[6]);
        camera.position.x += (camX() * 4 * p[6] - camera.position.x) * 0.1; camera.position.y += (camY() * 3 * p[6] - camera.position.y) * 0.1; camera.lookAt(0, 0, 0);
      } };
    } },
  embers: { name: 'Embers', params: [P('Speed', 0.35), P('Hue', 0.05), P('Amount', 0.7), P('Turbulence', 0.5), P('Size', 0.4), P('Music react', 0.6),
    P('Hand pull / camera follow', 0.6)],
    // Sparks rising across the whole frame through a swirling draught, flickering and cooling as they climb.
    // Stateless: height = start + rise (wrapped), so the kick can gust them up by speeding up the rise uniform.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 7;
      const n = window.VJ_MOBILE ? 25000 : 70000, R = Math.random, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos[i * 3] = (R() + R()) - 1; pos[i * 3 + 1] = R(); pos[i * 3 + 2] = R() * 2 - 1; seed[i] = R(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSeed', attr(seed, 1));
      const mat = pointsMat({ uT: { value: 0 }, uRise: { value: 0 }, uTurb: { value: 0.5 }, uAmt: { value: 0.7 }, uHue: { value: 0.05 }, uSize: { value: 0.03 }, uKick: { value: 0 } },
        `attribute float aSeed; uniform float uT, uRise, uTurb, uAmt, uHue, uSize, uKick;`,
        `if (aSeed > uAmt) vCol = vec4(0.0);
        else {
          const float H = 3.6, W = 6.4;
          float y = mod(position.y * 2.0 * H + uRise * (0.5 + fract(aSeed * 7.31)), 2.0 * H) - H, f = (y + H) / (2.0 * H);
          p = vec3(position.x * W, y, position.z * 3.0);
          p += flow(p * 0.6 + aSeed * 3.0, uT) * uTurb * (0.15 + f * 0.6);
          float fl = 0.55 + 0.45 * sin(uT * 9.0 + aSeed * 50.0);
          vCol = vec4(hsl(uHue + f * 0.05 - fract(aSeed * 3.7) * 0.04, 1.0, 0.6 - f * 0.3 + uKick * 0.2), (1.0 - f) * smoothstep(0.0, 0.06, f) * fl);
          sz = uSize * (1.0 - f * 0.5) * (0.4 + fract(aSeed * 13.7));
        }`);
      scene.add(ptMesh(geo, mat));
      let t = 0, rise = 0, kick = 0;
      return { scene, camera, update(p, dt) {
        kick = Math.max(kick * Math.exp(-dt * 5), audioFeat.kick * p[5]);
        t += dt * (0.3 + p[0] * 1.5); rise += dt * (0.3 + p[0] * 2.2) * (1 + kick * 3);
        const U = mat.uniforms; U.uT.value = t; U.uRise.value = rise; U.uTurb.value = p[3] * 1.5; U.uAmt.value = 0.05 + p[2] * 0.95;
        U.uHue.value = p[1]; U.uSize.value = 0.015 + p[4] * 0.08; U.uKick.value = kick;
        ptFrame(mat, camera, p[6]);
        camera.position.x += (camX() * 3 * p[6] - camera.position.x) * 0.1; camera.position.y += (camY() * 2 * p[6] - camera.position.y) * 0.1; camera.lookAt(0, 0, 0);
      } };
    } },
  bokeh: { name: 'Bokeh Lights', params: [P('Drift', 0.25), P('Hue', 0.1), P('Colour mix', 0.4), P('Focus', 0.5), P('Size', 0.5), P('Music react', 0.5),
    P('Parallax (hand / camera)', 0.6)],
    // Out-of-focus lights: a few hundred big discs at different depths. The further a light is from the focus plane, the
    // bigger and fainter its disc, as through a real lens. Calm: made for intros and breakdowns.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 8;
      const n = window.VJ_MOBILE ? 400 : 700, R = Math.random, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos[i * 3] = (R() - 0.5) * 16; pos[i * 3 + 1] = (R() - 0.5) * 9; pos[i * 3 + 2] = -10 + R() * 13; seed[i] = R(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSeed', attr(seed, 1));
      const mat = pointsMat({ uT: { value: 0 }, uHue: { value: 0.1 }, uMix: { value: 0.4 }, uFocus: { value: 0 }, uSize: { value: 0.5 }, uKick: { value: 0 }, uLevel: { value: 0 } },
        `attribute float aSeed; uniform float uT, uHue, uMix, uFocus, uSize, uKick, uLevel;`,
        `p.x += sin(uT * (0.2 + aSeed * 0.3) + aSeed * 20.0) * 0.8;
        p.y = mod(p.y + 4.5 + uT * 0.12 * (0.4 + aSeed), 9.0) - 4.5;
        float blur = abs(p.z - uFocus), hit = step(0.65, aSeed);   // a third of the lights flash on the kick
        sz = uSize * (0.12 + blur * 0.09) * (1.0 + uKick * 0.25 * hit);
        float a = (0.9 / (1.0 + blur * blur * 0.12)) * (0.3 + uLevel * 0.3 + uKick * 0.6 * hit) * smoothstep(4.5, 3.5, abs(p.y));
        vCol = vec4(hsl(uHue + (aSeed - 0.5) * uMix * 0.7, 0.75, 0.55), a);`, 'disc');
      scene.add(ptMesh(geo, mat));
      let t = 0, kick = 0, lv = 0;
      return { scene, camera, update(p, dt) {
        kick = Math.max(kick * Math.exp(-dt * 4), audioFeat.kick * p[5]); lv += (audioFeat.level * p[5] - lv) * 0.05;
        t += dt * (0.1 + p[0] * 2.5);
        const U = mat.uniforms; U.uT.value = t; U.uHue.value = p[1]; U.uMix.value = p[2]; U.uFocus.value = 3 - p[3] * 12; U.uSize.value = 0.2 + p[4] * 1.6;
        U.uKick.value = kick; U.uLevel.value = lv;
        ptFrame(mat, camera, 0);
        const hx = handOn() ? handFeat.x - 0.5 : camX(), hy = handOn() ? handFeat.y - 0.5 : camY();
        camera.position.x += (hx * 4 * p[6] + Math.sin(t * 0.13) * 0.4 - camera.position.x) * 0.06;
        camera.position.y += (hy * 2.5 * p[6] - camera.position.y) * 0.06; camera.lookAt(0, 0, -4);
      } };
    } },
  attractor: { name: 'Strange Attractor', trail: 0.3, params: [P('Speed', 0.4), P('Hue', 0.55), P('Shape (Lorenz / Aizawa / Thomas / Halvorsen / every 16 beats)', 0.1),
    P('Size', 0.35), P('Music react', 0.6), P('Spin', 0.3), P('Hand pull / camera follow', 0.6)],
    // Points flowing along a chaotic attractor, integrated on the CPU (cheap at this count) and coloured by how fast they move.
    // Each attractor lives at its own scale, so the cloud is re-centred and re-scaled smoothly from its own spread every frame;
    // a point that runs off (a shape change, or numeric blow-up) is put back near the start region.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 6;
      const A = [
        { dt: 0.004, lim: 90, o: [0, 0, 25], sp: 30, f: (x, y, z, d) => { d[0] = 10 * (y - x); d[1] = x * (28 - z) - y; d[2] = x * y - 8 / 3 * z; } },   // Lorenz
        { dt: 0.01, lim: 6, o: [0, 0, 0.5], sp: 2.4, f: (x, y, z, d) => { d[0] = (z - 0.7) * x - 3.5 * y; d[1] = 3.5 * x + (z - 0.7) * y;   // Aizawa
          d[2] = 0.6 + 0.95 * z - z * z * z / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x; } },
        { dt: 0.06, lim: 12, o: [0, 0, 0], sp: 8, f: (x, y, z, d) => { const b = 0.208186; d[0] = Math.sin(y) - b * x; d[1] = Math.sin(z) - b * y; d[2] = Math.sin(x) - b * z; } },   // Thomas
        { dt: 0.004, lim: 25, o: [-2, -2, -2], sp: 8, f: (x, y, z, d) => { const a = 1.89; d[0] = -a * x - 4 * y - 4 * z - y * y; d[1] = -a * y - 4 * z - 4 * x - z * z; d[2] = -a * z - 4 * x - 4 * y - x * x; } },   // Halvorsen
      ];
      const n = window.VJ_MOBILE ? 12000 : 40000, R = Math.random, pos = new Float32Array(n * 3), heat = new Float32Array(n), d = [0, 0, 0];
      const spawn = (i, a) => { pos[i * 3] = a.o[0] + (R() - 0.5) * a.sp; pos[i * 3 + 1] = a.o[1] + (R() - 0.5) * a.sp; pos[i * 3 + 2] = a.o[2] + (R() - 0.5) * a.sp; };
      let cur = 0, cx = 0, cy = 0, cz = 0, sc = 0.1, meanV = 1;
      // one move of every point; returns nothing, keeps the centre, spread and mean speed for the framing
      const step = (h, steps) => {
        const a = A[cur]; let sx = 0, sy = 0, sz = 0, ss = 0, sv = 0;
        for (let i = 0; i < n; i++) {
          let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          for (let k = 0; k < steps; k++) { a.f(x, y, z, d); x += d[0] * h; y += d[1] * h; z += d[2] * h; }
          if (!(Math.abs(x) < a.lim && Math.abs(y) < a.lim && Math.abs(z - a.o[2]) < a.lim)) { spawn(i, a); x = pos[i * 3]; y = pos[i * 3 + 1]; z = pos[i * 3 + 2]; a.f(x, y, z, d); }
          pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
          const v = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]); heat[i] = v / meanV; sv += v;
          sx += x; sy += y; sz += z; ss += x * x + y * y + z * z;
        }
        sv /= n; meanV += (sv - meanV) * 0.1; sx /= n; sy /= n; sz /= n;
        const rms = Math.sqrt(Math.max(1e-6, ss / n - sx * sx - sy * sy - sz * sz));
        return [sx, sy, sz, 1.5 / rms];
      };
      for (let i = 0; i < n; i++) spawn(i, A[0]);
      for (let k = 0; k < 60; k++) step(A[0].dt, 3);   // settle onto the attractor before the first frame
      [cx, cy, cz, sc] = step(A[0].dt, 1);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aHeat', attr(heat, 1));
      const mat = pointsMat({ uHue: { value: 0.55 }, uSize: { value: 0.02 }, uKick: { value: 0 } },
        `attribute float aHeat; uniform float uHue, uSize, uKick;`,
        `float h = clamp(aHeat * 0.6, 0.0, 1.6);
        vCol = vec4(hsl(uHue + h * 0.16, 0.85, 0.3 + h * 0.25 + uKick * 0.25), 0.7);
        sz = uSize * (0.7 + h * 0.4);`);
      const pts = ptMesh(geo, mat), g = new THREE.Group(); g.add(pts); scene.add(g);
      let t = 0, kick = 0;
      return { scene, camera, update(p, dt) {
        const want = p[2] >= 0.8 ? Math.floor(comp.beats / 16) % 4 : Math.min(3, Math.floor(p[2] * 5));
        if (want !== cur && want >= 0) { cur = want; for (let i = 0; i < n; i++) spawn(i, A[cur]); }   // a new shape condenses out of a cloud
        kick = Math.max(kick * Math.exp(-dt * 6), audioFeat.kick * p[4]);
        const a = A[cur], total = a.dt * (0.3 + p[0] * 2.5) * (1 + audioFeat.bass * p[4] * 1.5) * Math.min(6, dt * 60);
        const steps = Math.max(1, Math.min(6, Math.ceil(total / a.dt)));
        const [mx, my, mz, s] = step(total / steps, steps);
        cx += (mx - cx) * 0.08; cy += (my - cy) * 0.08; cz += (mz - cz) * 0.08; sc += (s - sc) * 0.08;
        geo.attributes.position.needsUpdate = true; geo.attributes.aHeat.needsUpdate = true;
        pts.scale.setScalar(sc * (1 + kick * 0.12)); pts.position.set(-cx * sc, -cy * sc, -cz * sc);
        t += dt; g.rotation.y += dt * (0.05 + p[5] * 0.8); g.rotation.x = Math.sin(t * 0.1) * 0.3;
        const U = mat.uniforms; U.uHue.value = p[1]; U.uSize.value = 0.008 + p[3] * 0.05; U.uKick.value = kick;
        ptFrame(mat, camera, p[6]);
        camera.position.x += (camX() * 4 * p[6] - camera.position.x) * 0.1; camera.position.y += (camY() * 3 * p[6] - camera.position.y) * 0.1; camera.lookAt(0, 0, 0);
      } };
    } },
  supernova: { name: 'Drop Supernova', params: [P('Speed', 0.3), P('Hue', 0.7), P('Cycle without song structure (4, 8, 16, 32 bars)', 0.35), P('Blast', 0.55),
    P('Size', 0.4), P('Music react', 0.6), P('Hand (fist gathers, open hand explodes)', 0.7)],
    // A nebula that gathers into a white-hot core through a build-up and explodes on the drop, then drifts back into a cloud.
    // The charge follows the song structure when there is one (musicFeat.build, the bang when musicFeat.drop starts), else a
    // cycle of N bars that bangs on its first beat, or your hand (close it to gather, open it to explode). The shader only
    // gets the charge, the charge at the bang and the time since it, so the whole flight is a function of those three.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 7;
      const n = window.VJ_MOBILE ? 20000 : 60000, R = Math.random, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = R() * 2 - 1, a = R() * Math.PI * 2, q = Math.sqrt(1 - u * u), r = 0.6 + Math.pow(R(), 0.7) * 2.6;
        pos[i * 3] = Math.cos(a) * q * r; pos[i * 3 + 1] = u * r * 0.55; pos[i * 3 + 2] = Math.sin(a) * q * r; seed[i] = R();
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSeed', attr(seed, 1));
      const mat = pointsMat({ uT: { value: 0 }, uSpin: { value: 0 }, uCharge: { value: 0 }, uBangC: { value: 0 }, uAge: { value: 99 }, uBlast: { value: 4 },
        uKick: { value: 0 }, uHue: { value: 0.7 }, uSize: { value: 0.03 } },
        `attribute float aSeed; uniform float uT, uSpin, uCharge, uBangC, uAge, uBlast, uKick, uHue, uSize;
        vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c); }
        vec3 gather(vec3 q, float r, float c) { float c2 = c * c; return rotY(q * (1.0 - 0.95 * c2), c2 * 5.0 / (0.3 + r)); }   // in and spinning up`,
        `vec3 h = position; float r = length(h);
        vec3 p0 = rotY(h, uSpin * (0.3 + 0.7 / (0.4 + r))) + flow(h * 0.5 + aSeed * 3.0, uT * 0.5) * 0.12;   // the nebula, inner parts turning faster
        bool ring = aSeed > 0.9;   // one in ten: a flat shock ring that only shows in the blast
        vec3 dir = ring ? normalize(vec3(h.x, 0.0, h.z) + 0.0001) * 2.4 : normalize(h + 0.0001) * (0.4 + aSeed * aSeed * 1.8);
        vec3 blast = gather(p0, r, uBangC) + dir * uBlast * (1.0 - exp(-uAge * 2.2));
        float settle = smoothstep(2.0, 9.0, uAge);
        p = mix(blast, gather(p0, r, uCharge), settle);
        p += normalize(h + 0.0001) * uKick * uCharge * 0.1 * sin(aSeed * 80.0 + uT * 40.0);   // the charged core trembles on the kicks
        float flash = exp(-uAge * 3.0) * (1.0 - settle), heat = clamp(uCharge * uCharge + flash, 0.0, 1.0);
        float dense = 1.0 - 0.95 * mix(uBangC, uCharge, settle) * mix(uBangC, uCharge, settle);   // the same light spread over a smaller ball: dim each point
        float a = ring ? (1.0 - settle) * exp(-uAge * 0.8) : (0.5 + flash * 0.4) * mix(0.12, 1.0, min(1.0, dense * dense * 4.0 + uAge * 0.6));
        vCol = vec4(hsl(uHue + aSeed * 0.1 - heat * 0.1 + (ring ? 0.5 : 0.0), 0.85 - heat * 0.5, 0.42 + heat * 0.45), a);
        sz = uSize * (0.5 + aSeed) * (1.0 + flash);`);
      const g = new THREE.Group(); g.rotation.x = 0.45; g.add(ptMesh(geo, mat)); scene.add(g);   // tilted, so the shock ring reads as a ring
      let t = 0, spin = 0, age = 99, bangC = 0, charge = 0, prevDrop = 0, lastCycle = null, kick = 0;
      return { scene, camera, update(p, dt) {
        t += dt; age += dt; spin += dt * (0.1 + p[0] * 1.2) * (1 + charge * 3);
        const mf = typeof musicFeat !== 'undefined' ? musicFeat : null, bang = () => { bangC = charge; age = 0; };
        let c;
        if (handOn() && p[6] > 0) {
          c = Math.min(1, (1 - handFeat.open) * 1.25) * p[6];
          if (charge > 0.5 && c < 0.2) bang();   // the hand opened while charged
        } else if (mf && (mf.build > 0 || mf.drop > 0 || songSections())) {
          c = mf.build;   // a track with sections: rest as a nebula until a build-up (no bar cycle, so no bang mid-breakdown)
          if (mf.drop > 0 && prevDrop === 0) bang();
        } else {
          const len = [4, 8, 16, 32][Math.min(3, Math.floor(p[2] * 4))] * 4, k = Math.floor(comp.beats / len);
          c = Math.pow((comp.beats - k * len) / len, 1.6);
          if (lastCycle !== null && k !== lastCycle) bang();
          lastCycle = k;
        }
        prevDrop = mf ? mf.drop : 0;
        charge = age < 0.05 ? c : charge + (c - charge) * Math.min(1, dt * 8);
        kick = Math.max(kick * Math.exp(-dt * 8), audioFeat.kick * p[5]);
        const U = mat.uniforms; U.uT.value = t; U.uSpin.value = spin; U.uCharge.value = charge; U.uBangC.value = bangC; U.uAge.value = age;
        U.uBlast.value = 0.8 + p[3] * 3.2; U.uKick.value = kick; U.uHue.value = p[1]; U.uSize.value = 0.012 + p[4] * 0.06;
        ptFrame(mat, camera, 0);
        const shake = kick * charge * 0.06;
        camera.position.set(camX() * 3 + (Math.random() - 0.5) * shake, camY() * 2 + (Math.random() - 0.5) * shake, 7 - charge * 1.5); camera.lookAt(0, 0, 0);
      } };
    } },
  terrain: { name: 'Audio History Terrain', params: [P('Speed (2, 4, 8, 16 rows per beat)', 0.45), P('Hue', 0.78), P('Height', 0.5), P('Ridges', 0.4),
    P('Size', 0.4), P('Camera height', 0.35), P('Steer (hand / camera)', 0.5)],
    // The last few beats of the music as a landscape you fly over: every row of points is one moment (bass in the middle,
    // mids either side, highs at the edges), the newest at the front, and a kick lights its whole row. The rows are a
    // vec4 uHist[96] uniform (bass, mid, high, kick) shifted by one at the row rate; uFrac slides them between shifts.
    // With no sound it rolls gentle hills, so it never sits flat.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
      const ROWS = 96, cols = window.VJ_MOBILE ? 120 : 220, n = ROWS * cols, pos = new Float32Array(n * 3), hist = new Float32Array(ROWS * 4);
      for (let r = 0, i = 0; r < ROWS; r++) for (let k = 0; k < cols; k++, i++) { pos[i * 3] = k / (cols - 1) * 2 - 1; pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = r; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3));
      const mat = pointsMat({ uHist: { value: hist }, uFrac: { value: 0 }, uHue: { value: 0.78 }, uHeight: { value: 1 }, uRidge: { value: 0.4 }, uSize: { value: 0.03 } },
        `uniform vec4 uHist[96]; uniform float uFrac, uHue, uHeight, uRidge, uSize;`,
        `int r = int(position.z + 0.5); vec4 h = uHist[r];
        float x = position.x, ax = abs(x), far = float(r) / 95.0;
        float lvl = h.x * exp(-ax * ax * 12.0) * 1.3 + h.y * exp(-pow((ax - 0.45) * 5.0, 2.0)) + h.z * exp(-pow((ax - 0.85) * 5.0, 2.0)) * 0.9;
        float ridge = 0.5 + 0.5 * sin(x * 37.0 + sin(x * 13.0) * 2.0);   // ridges along the flight, like lines on an old plot
        float y = uHeight * lvl * (1.0 - uRidge + uRidge * ridge * 1.6);
        p = vec3(x * 6.5, y * 2.5, -(float(r) + uFrac) * 0.16);
        vCol = vec4(hsl(uHue + y * 0.15 - far * 0.12, 0.85, 0.3 + y * 0.35 + h.w * 0.3), (1.0 - smoothstep(0.55, 1.0, far)) * smoothstep(0.0, 0.03, far + uFrac / 95.0) * (0.4 + y * 0.5 + h.w * 0.4));
        sz = uSize * (0.7 + y);`);
      scene.add(ptMesh(geo, mat));
      let acc = 0, t = 0, kpk = 0, sx = 0, sy = 0;
      return { scene, camera, update(p, dt) {
        t += dt;
        // the newest row follows the music live; with no sound, gentle made-up hills
        const quiet = Math.max(0, 1 - audioFeat.level * 20);
        const live = [audioFeat.bass, audioFeat.mid, audioFeat.high];
        const idle = [0.35 + 0.25 * Math.sin(t * 1.3), 0.3 + 0.2 * Math.sin(t * 2.1 + 1), 0.25 + 0.15 * Math.sin(t * 3.7 + 2)];
        for (let k = 0; k < 3; k++) hist[k] += (live[k] * (1 - quiet) + idle[k] * quiet - hist[k]) * 0.5;
        kpk = Math.max(kpk, audioFeat.kick); hist[3] = kpk;
        acc += dt * (comp.bpm / 60) * [2, 4, 8, 16][Math.min(3, Math.floor(p[0] * 4))];
        if (acc >= 1) { const s = Math.min(ROWS - 1, Math.floor(acc)); hist.copyWithin(s * 4, 0, (ROWS - s) * 4); acc -= s; kpk = 0; }
        const U = mat.uniforms; U.uFrac.value = acc; U.uHue.value = p[1]; U.uHeight.value = 0.2 + p[2] * 1.6; U.uRidge.value = p[3]; U.uSize.value = 0.012 + p[4] * 0.06;
        ptFrame(mat, camera, 0);
        const hx = handOn() ? handFeat.x - 0.5 : camX(), hy = handOn() ? handFeat.y - 0.5 : camY();
        sx += (hx * 6 * p[6] - sx) * 0.08; sy += (hy * 2 * p[6] - sy) * 0.08;
        camera.position.set(sx, 0.6 + p[5] * 3 + sy, 2.6); camera.lookAt(sx * 0.4, 0, -9);
      } };
    } },
  shatter: { name: 'Text Shatter', sources: ['below', 'camera', 'text'], ownText: true,
    params: [P('Shatter every (off, 1, 2, 4, 8, 16 beats)', 0.6), P('Force', 0.5), P('Reassemble (beats)', 0.4), P('Shard size', 0.5), P('Size', 0.5),
      P('Music react (kicks shatter)', 0.5), P('Hand (pinch shatters there)', 0.7)],
    // A picture made of points that breaks into tumbling shards and pulls itself back together. The picture is the layer
    // below (a text clip, a logo, a video...), the camera, or the clip's own text when nothing plays below. At rest it lines
    // up with the frame exactly; each shard (a cell of the grid) flies off along its own direction and spins on its own axis.
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 6;
      const gx = window.VJ_MOBILE ? 256 : 400, gy = Math.round(gx * 9 / 16), n = gx * gy, uv = new Float32Array(n * 3), FH = 2 * Math.tan(25 * Math.PI / 180) * 6;
      for (let y = 0, i = 0; y < gy; y++) for (let x = 0; x < gx; x++, i++) { uv[i * 3] = (x + 0.5) / gx; uv[i * 3 + 1] = (y + 0.5) / gy; uv[i * 3 + 2] = Math.random(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(uv, 3));
      const ext = { isExternalTexture: true, sourceTexture: null, version: 0 };   // an engine texture handed to three.js as it is (see Picture Particles)
      const mat = pointsMat({ uTex: { value: ext }, uAspect: { value: 16 / 9 }, uH: { value: FH }, uAmt: { value: 0 }, uForce: { value: 3 }, uCells: { value: 12 },
        uT: { value: 0 }, uSize: { value: 0.03 }, uOrigin: { value: new THREE.Vector2(0.5, 0.5) } },
        `uniform sampler2D uTex; uniform float uAspect, uH, uAmt, uForce, uCells, uT, uSize; uniform vec2 uOrigin;`,
        `vec2 uv = position.xy; vec4 tx = texture(uTex, uv); float l = max(tx.r, max(tx.g, tx.b));
        if (l < 0.08) vCol = vec4(0.0);
        else {
          vec2 cells = vec2(floor(uCells * uAspect), uCells), cell = floor(uv * cells), cc = (cell + 0.5) / cells;
          float s = hash(cell.x * 17.0 + cell.y * 131.0 + 0.5);
          vec2 sc = vec2(uH * uAspect, uH);
          vec3 base = vec3((uv - 0.5) * sc, 0.0), ctr = vec3((cc - 0.5) * sc, 0.0);
          vec3 dir = normalize(vec3((cc - uOrigin) * vec2(uAspect, 1.0) * 2.0 + (vec2(hash(s * 7.1), hash(s * 3.3)) - 0.5) * 0.8, 0.4 + hash(s * 5.7) * 1.2));
          vec3 k = normalize(vec3(hash(s * 1.3), hash(s * 2.9), hash(s * 4.1)) - 0.5 + 0.001);
          float ang = (s - 0.5) * 8.0 * uAmt, ca = cos(ang), sa = sin(ang);
          vec3 lp = base - ctr; lp = lp * ca + cross(k, lp) * sa + k * dot(k, lp) * (1.0 - ca);   // the shard turns about its own axis
          p = ctr + lp + dir * uForce * uAmt * (0.4 + s) + flow(base + s, uT) * 0.08 * uAmt;
          vCol = vec4(tx.rgb * (0.9 + uAmt * 0.6), 1.0);
          sz = uSize;
        }`);
      scene.add(ptMesh(geo, mat));
      // the clip's own text, drawn into a texture of its own (redrawn only when the text changes)
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
      let own = null, ownKey = null;
      const ownTex = text => {
        if (own && text === ownKey) return own;
        const x = cv.getContext('2d'), lines = String(text || ' ').split(/\n|\|/).slice(0, 6);
        x.clearRect(0, 0, 1280, 720);
        let s = 260; x.font = `900 ${s}px Inter, Arial, sans-serif`;
        const w = Math.max(1, ...lines.map(l => x.measureText(l).width));
        s = Math.max(20, Math.min(s * 1100 / w, 560 / lines.length)); x.font = `900 ${s}px Inter, Arial, sans-serif`;
        const g = x.createLinearGradient(100, 0, 1180, 0); g.addColorStop(0, '#2ee6ff'); g.addColorStop(1, '#ff3df0');
        x.fillStyle = g; x.textAlign = 'center'; x.textBaseline = 'middle';
        lines.forEach((l, i) => x.fillText(l, 640, 360 + (i - (lines.length - 1) / 2) * s * 1.05));
        if (!own) own = mkTex(0, 0);
        gl.bindTexture(gl.TEXTURE_2D, own); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        ownKey = text; return own;
      };
      let t = 0, hitT = -99, amt0 = 0, amt = 0, lastB = null, armed = true, pinched = false;
      const origin = mat.uniforms.uOrigin.value;
      const hit = (ox = 0.5, oy = 0.5) => { amt0 = amt; hitT = t; origin.set(ox, oy); };
      return { scene, camera, dispose() { if (own) gl.deleteTexture(own); own = null; }, update(p, dt, L, c) {
        t += dt;
        const mode = (c && c.src) || 'below', li = L ? comp.layers.indexOf(L) : -1;
        let tex = mode === 'below' && li > 0 ? comp.layers[li - 1].outTex : null;
        if (!tex && mode === 'camera' && camOn() && camState.tex) tex = camState.tex;
        if (!tex) tex = ownTex(c && typeof c.text === 'string' ? c.text : 'STRODANO VJ');
        mat.uniforms.uTex.value.sourceTexture = tex;
        const every = [0, 1, 2, 4, 8, 16][Math.min(5, Math.floor(p[0] * 6))];
        if (every) { const bi = Math.floor(comp.beats / every); if (lastB !== null && bi !== lastB) hit(0.3 + Math.random() * 0.4, 0.3 + Math.random() * 0.4); lastB = bi; }
        if (audioFeat.kick > 0.6 && armed && Math.random() < p[5]) { armed = false; hit(0.5, 0.5); }
        if (audioFeat.kick < 0.3) armed = true;
        const pin = handOn() && p[6] > 0 && handFeat.pinch > 0.75;
        if (pin && !pinched) hit(handFeat.x, handFeat.y);   // break it where your fingers meet
        pinched = pin;
        // out fast (from wherever it was), then back over the Reassemble time, eased
        const age = t - hitT, ret = (0.5 + p[2] * 3.5) * 60 / comp.bpm, back = Math.min(1, Math.max(0, (age - 0.15) / ret));
        amt = (amt0 + (1 - amt0) * (1 - Math.exp(-age * 12))) * (1 - back * back * (3 - 2 * back));
        const U = mat.uniforms; U.uAmt.value = amt; U.uT.value = t; U.uForce.value = 1 + p[1] * 5; U.uCells.value = Math.round(4 + (1 - p[3]) * 28);
        U.uAspect.value = comp.w / comp.h; U.uSize.value = (FH / gy) * (0.8 + p[4] * 1.6);
        ptFrame(mat, camera, 0);
      } };
    } },
  harmono: { name: 'Harmonograph', trail: 0.3, params: [P('Speed', 0.3), P('Hue', 0.5), P('Change every (1, 2, 4, 8 bars)', 0.35), P('Damping', 0.35),
    P('Pen (draw on each bar)', 0.3), P('Size', 0.35), P('Music react', 0.6), P('Turn (hand / camera)', 0.5)],
    // A 3D harmonograph: one long curve, sin(a u + pa), sin(b u + pb), sin(c u + pc), dying away along u (Damping). The
    // frequency ratios change on the bar (a morph between the old and the new set over a beat and a half), the phases drift
    // (Speed) so the figure keeps turning over, and a bright pen runs along it once per bar (Pen: only what it has drawn shows).
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 7;
      const n = window.VJ_MOBILE ? 25000 : 60000, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = i / n; pos[i * 3 + 1] = Math.random(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', attr(pos, 3));
      const SETS = [[1, 2, 3], [2, 3, 4], [3, 4, 5], [3, 2, 5], [1, 3, 5], [4, 5, 6], [2, 5, 3], [5, 4, 3], [1, 4, 3], [3, 5, 7]];
      const pick = k => SETS[((k * 7) % SETS.length + SETS.length) % SETS.length];   // step 7 of 10: every set before a repeat
      const mat = pointsMat({ uFA: { value: new THREE.Vector3(1, 2, 3) }, uFB: { value: new THREE.Vector3(1, 2, 3) }, uPh: { value: new THREE.Vector3(0, 1, 2) },
        uMorph: { value: 1 }, uDamp: { value: 0.02 }, uPen: { value: 0 }, uPenAmt: { value: 0 }, uHue: { value: 0.5 }, uSize: { value: 0.02 }, uKick: { value: 0 }, uLen: { value: 50 } },
        `uniform vec3 uFA, uFB, uPh; uniform float uMorph, uDamp, uPen, uPenAmt, uHue, uSize, uKick, uLen;
        vec3 curve(vec3 f, float u) { return vec3(sin(f.x * u + uPh.x), sin(f.y * u + uPh.y), sin(f.z * u + uPh.z)) * exp(-uDamp * u); }`,
        `float un = position.x, u = un * uLen, m = smoothstep(0.0, 1.0, uMorph);
        p = mix(curve(uFA, u), curve(uFB, u), m) * vec3(2.7, 2.1, 1.6) * (1.0 + uKick * 0.15 * sin(u * 3.0 + position.y * 6.0));
        p += (vec3(hash(position.y * 9.1), hash(position.y * 4.7), hash(position.y * 2.3)) - 0.5) * 0.02;   // a little thickness
        float head = exp(-pow((un - uPen) * 120.0, 2.0)), vis = mix(1.0, step(un, uPen), uPenAmt);
        vCol = vec4(hsl(uHue + un * 0.35, 0.8, 0.5 + head * 0.4 + uKick * 0.15), (0.35 + head) * vis * (0.45 + 0.55 * exp(-uDamp * u * 0.5)));
        sz = uSize * (1.0 + head * 2.0);`);
      const g = new THREE.Group(); g.add(ptMesh(geo, mat)); scene.add(g);
      let cur = null, kick = 0, t = 0;
      const ph = mat.uniforms.uPh.value;
      return { scene, camera, update(p, dt) {
        t += dt;
        const per = [1, 2, 4, 8][Math.min(3, Math.floor(p[2] * 4))] * 4, k = Math.floor(comp.beats / per);
        if (k !== cur) { cur = k; mat.uniforms.uFA.value.fromArray(pick(k - 1)); mat.uniforms.uFB.value.fromArray(pick(k)); }
        const sp = dt * (0.05 + p[0] * 0.6); ph.x += sp; ph.y += sp * 1.31; ph.z += sp * 0.73;
        kick = Math.max(kick * Math.exp(-dt * 7), audioFeat.kick * p[6]);
        const U = mat.uniforms; U.uMorph.value = Math.min(1, (comp.beats - k * per) / 1.5); U.uDamp.value = p[3] * 0.06;
        U.uPen.value = (((comp.beats / 4) % 1) + 1) % 1 * 1.02; U.uPenAmt.value = p[4]; U.uHue.value = p[1]; U.uSize.value = 0.008 + p[5] * 0.05; U.uKick.value = kick;
        ptFrame(mat, camera, 0);
        const hx = handOn() ? handFeat.x - 0.5 : camX(), hy = handOn() ? handFeat.y - 0.5 : camY();
        g.rotation.y += ((hx * 3 * p[7] + t * 0.05) - g.rotation.y) * 0.08; g.rotation.x += (hy * 2 * p[7] - g.rotation.x) * 0.08;
      } };
    } },
};
// The Pro visualizers (Pro and Festival): their code is in the Pro bundle (pro/pro.js sets PRO_SCENES3D, same shape as
// SCENES3D) and joins the table here when the bundle is in the page. This list is only their keys and names, so the
// library can show them with a lock to everyone else, and a project that uses one keeps its clip (see clip3d).
const SCENES3D_PRO = { glass: 'Glass Prism', city: 'Neon City', swarm: 'Murmuration', ledcube: 'LED Cube', blackhole: 'Event Horizon' };
if (typeof PRO_SCENES3D !== 'undefined') for (const k in PRO_SCENES3D) if (SCENES3D_PRO[k]) SCENES3D[k] = Object.assign(PRO_SCENES3D[k], { pro: true });
// The scenes a new project or a picker may offer right now: every Free one, and the Pro ones on a paid plan.
const scenes3dOpen = () => Object.keys(SCENES3D).filter(k => !SCENES3D[k].pro || entCan('viz3d'));
// Scenes that were taken out (2026-11-23): a saved clip that used one opens as the scene named here. Only its Speed
// and Hue carry over (sliders 0 and 1 in every scene, old and new); the other sliders meant something else.
const SCENES3D_OLD = { wire: ['chrome', 'Wire Sphere'], knot: ['chrome', 'Neon Knot'], blob: ['chrome', 'Audio Blob'], tunnel: ['lasertunnel', 'Cube Tunnel'],
  waves: ['horizon', 'Wave Grid'], rings: ['lasers', 'Orbit Rings'], crystals: ['aurora', 'Crystal Field'] };

function texThumb(tex) {
  present(tex, 160, 90);
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
  grab(cv.getContext('2d'), 160, 90);
  return cv.toDataURL('image/jpeg', 0.7);
}
// Trails (c.trail 0..1): each frame is laid over a fading copy of the clip's previous frames, kept per clip in its own
// pair of targets (made on first use, freed when Trails goes back to 0). max() rather than a sum, so long trails cannot
// pile up into white; a small subtraction makes the faint end really reach black (an 8-bit fade alone gets stuck at 1-2/255).
// The fade is per second, so the trail length does not depend on the frame rate. A clip that was not drawn for a moment
// (re-triggered) starts clean.
const trailProg = mkProg(HEAD + `uniform sampler2D prev; uniform sampler2D cur; uniform float fade; in vec2 uv; out vec4 o;
void main(){ vec4 p = max(texture(prev, uv) * fade - 1.5 / 255.0, 0.0); o = max(p, texture(cur, uv)); }`);
function trail3d(c, tex, fresh, dt) {
  const k = c.trail || 0;
  if (k <= 0.001) { if (c.tr3) { freeRT(c.tr3); c.tr3 = null; } return tex; }
  if (!c.tr3 || c.tr3.f[0].w !== comp.w || c.tr3.f[0].h !== comp.h) { freeRT(c.tr3); c.tr3 = mkRT(comp.w, comp.h); fresh = true; }
  if (fresh) clearFbo(rtSrc(c.tr3));
  const tau = 0.04 + k * k * 3;   // seconds for the trail to fade to about a third: 0.07 s at 0.1, 0.8 s at 0.5, 3 s at 1
  bindFbo(rtDst(c.tr3));
  gl.disable(gl.BLEND);
  gl.useProgram(trailProg.p);
  bindTex(0, rtSrc(c.tr3).tex); bindTex(1, tex);
  gl.uniform1i(trailProg.loc('prev'), 0); gl.uniform1i(trailProg.loc('cur'), 1); gl.uniform1f(trailProg.loc('fade'), dt > 0 ? Math.exp(-dt / tau) : 1);
  tri(); rtSwap(c.tr3);
  return rtSrc(c.tr3).tex;
}
function draw3d(f, L) {
  const c = this, R = three();
  if (!R) return false;
  if (!c.inst) c.inst = SCENES3D[c.scene].build();
  if (!rt3 || rt3.width !== comp.w || rt3.height !== comp.h) { if (rt3) rt3.dispose(); rt3 = new THREE.WebGLRenderTarget(comp.w, comp.h, { samples: window.VJ_MOBILE ? 2 : 4 }); }   // phones: 2x MSAA (the resolve costs bandwidth they do not have)
  const gap = comp.time - (c.lastT ?? -1), dt = Math.min(0.1, Math.max(0, comp.time - (c.lastT ?? comp.time))); c.lastT = comp.time;   // a gap = (re)triggered
  const cam = c.inst.camera;
  if (cam.aspect !== comp.w / comp.h) { cam.aspect = comp.w / comp.h; cam.updateProjectionMatrix(); }
  c.inst.update(modParams(c.params, c.mod), dt, L, c);
  R.resetState();
  R.setRenderTarget(rt3); R.setClearColor(0x000000, 0); R.clear(); R.render(c.inst.scene, cam); R.setRenderTarget(null);
  R.resetState();
  let out = R.properties.get(rt3.texture).__webglTexture;
  out = trail3d(c, out, gap > 0.25, dt);
  bindFbo(f);
  gl.useProgram(srcProg.p);
  bindTex(0, out);
  gl.uniform1i(srcProg.loc('tex'), 0); gl.uniform2f(srcProg.loc('scl'), 1, 1); gl.uniform2f(srcProg.loc('off'), 0, 0);
  tri();
  if (c.wantThumb && comp.time - c.bornAt > 0.5) { c.wantThumb = false; c.thumb = texThumb(f.tex); ui.gridDirty = true; }
  return true;
}
// A 3D clip's grid thumbnail before it is ever played: one frame, half a second into the scene, rendered into a
// spare target (the front end calls it from its frame tick for clips that have none, one per frame).
let thumbFbo3 = null;
function thumb3d(c) {
  c.wantThumb = false;
  if (!three() || !SCENES3D[c.scene]) return;
  if (!thumbFbo3 || thumbFbo3.w !== comp.w || thumbFbo3.h !== comp.h) { if (thumbFbo3) freeFbo(thumbFbo3); thumbFbo3 = mkFbo(comp.w, comp.h); thumbFbo3.w = comp.w; thumbFbo3.h = comp.h; }
  if (!c.inst) c.inst = SCENES3D[c.scene].build();
  for (let k = 0; k < 5; k++) c.inst.update(modParams(c.params, c.mod), 0.1, null, c);
  c.lastT = comp.time;
  if (draw3d.call(c, thumbFbo3)) { c.thumb = texThumb(thumbFbo3.tex); ui.gridDirty = true; }
}
function clip3d(scene, o = {}) {
  const old = SCENES3D_OLD[scene];
  if (old) {
    scene = old[0];
    o = { ...o, name: o.name === old[1] ? undefined : o.name, params: Array.isArray(o.params) ? o.params.slice(0, 2) : undefined, trail: undefined, uid: undefined, moved: true };
  }
  const d = SCENES3D[scene];
  // A Pro scene in a project opened without the Pro bundle: the clip stays in its slot, shows nothing and is saved
  // back exactly as it came, so the project is whole again on a paid plan.
  if (!d && SCENES3D_PRO[scene]) return { uid: newUid(), type: '3d', name: typeof o.name === 'string' && o.name ? o.name : SCENES3D_PRO[scene], scene, params: Array.isArray(o.params) ? o.params.slice() : [],
    src: o.src, text: o.text, trail: o.trail, speed: 1, thumb: null, wantThumb: false, bornAt: comp.time, locked3d: true, draw: () => false };
  if (!d) return null;
  const c = { uid: newUid(), type: '3d', name: d.name, scene, params: d.params.map(x => x.def), speed: 1, thumb: null, wantThumb: true, bornAt: comp.time };
  if (typeof o.name === 'string' && o.name) c.name = o.name;
  if (d.sources && o.src !== 'below' && d.sources.includes(o.src)) c.src = o.src;   // picture scenes: the layer below (default), the camera, own text
  if (d.ownText) c.text = typeof o.text === 'string' ? o.text.slice(0, 200) : 'STRODANO VJ';
  c.trail = typeof o.trail === 'number' && isFinite(o.trail) ? Math.min(1, Math.max(0, o.trail)) : o.uid ? 0 : d.trail || 0;   // Trails
  if (Array.isArray(o.params)) o.params.forEach((v, i) => { if (i < c.params.length && typeof v === 'number' && isFinite(v)) c.params[i] = Math.min(1, Math.max(0, v)); });
  c.draw = draw3d;
  warm3d(c);
  return c;
}
// Build the scene and compile its shaders in the background as soon as the clip exists (dropped in the grid or loaded),
// so the first trigger during a show does not stall on shader compilation (hundreds of ms on some GPUs / drivers).
function warm3d(c) {
  const R = three();
  if (!R || c.inst) return;
  c.inst = SCENES3D[c.scene].build();
  try { R.resetState(); const p = R.compileAsync(c.inst.scene, c.inst.camera); R.resetState(); if (p) p.catch(() => {}); } catch (e) { R.resetState(); }
}
const SRC3D_LABELS = { below: 'Layer below', camera: 'Camera input', text: 'Own text' };
CLIP_TYPES['3d'] = {
  toJSON: c => ({ type: '3d', uid: c.uid, name: c.name, scene: c.scene, params: c.params, mod: c.mod, src: c.src, text: c.text, trail: c.trail || undefined }),
  fromJSON: j => { if (SCENES3D_OLD[j.scene] && j.mod) for (const k in j.mod) if (+k > 1) delete j.mod[k]; return clip3d(j.scene, j); },
  free: c => { if (c.tr3) { freeRT(c.tr3); c.tr3 = null; } if (c.inst && c.inst.dispose) c.inst.dispose(); if (c.inst) c.inst.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); c.inst = null; },
  props: (c, p) => {
    p.append(el('div', { className: 'hint', textContent: '3D generator (three.js). Follows the beat and the music; camera sliders work once the camera input is on (Sources tab).' }));
    const d = SCENES3D[c.scene];
    if (!d) { p.append(el('div', { className: 'hint', textContent: c.name + ' is a Pro visualizer. It plays again, with the settings saved here, once this app is on Pro or Festival.' }),
      el('button', { textContent: 'See Pro', onclick: () => proGate('viz3d') })); return; }
    if (d.sources) p.append(el('label', { className: 'row', textContent: 'Picture ' },
      el('select', { onchange: e => { if (e.target.value === 'below') delete c.src; else c.src = e.target.value; } },
        ...d.sources.map(v => el('option', { value: v, textContent: SRC3D_LABELS[v], selected: (c.src || 'below') === v })))),
      el('div', { className: 'hint', textContent: 'Tip: put the picture on the layer below and set that layer to 0 opacity to see only the particles.' }));
    if (d.ownText) p.append(el('label', { className: 'row', textContent: 'Own text ' },
      el('input', { type: 'text', value: c.text, maxLength: 200, title: 'Shown when nothing plays on the layer below. | starts a new line.', oninput: e => { c.text = e.target.value; } })));
    d.params.forEach((pd, k) => {
      const f = fld(pd.name, 0, 1, 0.001, () => c.params[k], v => { c.params[k] = v; });
      f.slider.dataset.midi = 'gen:' + c.uid + ':' + k;
      p.append(...lfoControls(c, k, f));
    });
    const tf = fld('Trails', 0, 1, 0.001, () => c.trail || 0, v => { c.trail = v; });
    tf.slider.dataset.midi = 'gen:' + c.uid + ':trail';
    tf.title = 'Light trails: each frame stays behind and fades (0 = off, 1 = about 3 seconds)';
    p.append(tf);
  },
};
SOURCE_PANELS.push(() => {
  const list = el('div', { className: 'list' });
  if (typeof THREE === 'undefined') { list.append(el('div', { className: 'hint', textContent: 'three.js did not load (web/vendor/three.min.js).' })); return [el('h4', { textContent: '3D visualizers' }), list]; }
  const add = key => { if (SCENES3D[key].pro && !proGate('viz3d')) return null; return clip3d(key); };
  const row = (key, name, locked) => {
    const item = el('div', { className: 'src-item' + (locked ? ' locked' : ''), textContent: name,
      title: locked ? 'A Pro visualizer: double-click to see Pro' : 'Drag onto a clip slot, or double-click to fill the selected slot',
      ondblclick: () => {
        if (locked) { proGate('viz3d'); return; }
        const ci = sel.c >= 0 ? sel.c : comp.layers[sel.l].clips.findIndex(x => !x), c = ci >= 0 ? add(key) : null;
        if (c) setClip(sel.l, ci, c);
      } });
    if (locked || SCENES3D[key].pro) item.append(el('span', { className: 'pro-tag', textContent: 'PRO' }));
    if (!locked) draggable(item, { kind: 'make', make: () => add(key) });
    return item;
  };
  for (const key in SCENES3D) if (!SCENES3D[key].pro) list.append(row(key, SCENES3D[key].name));
  for (const key in SCENES3D_PRO) list.append(SCENES3D[key] ? row(key, SCENES3D[key].name, !entCan('viz3d')) : row(key, SCENES3D_PRO[key], true));
  return [el('h4', { textContent: '3D visualizers' }), list];
});
