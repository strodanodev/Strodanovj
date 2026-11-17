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

const SCENES3D = {
  wire: { name: 'Wire Sphere', params: [P('Speed', 0.3), P('Hue', 0.55), P('Kick pulse', 0.6), P('Size', 0.5), P('Camera spin', 0.5)],
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 4.2;
      const outer = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.2, 2)), new THREE.LineBasicMaterial({ transparent: true }));
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.45 }));
      scene.add(outer, inner);
      let rx = 0, ry = 0;
      return { scene, camera, update(p, dt) {
        ry += dt * (0.15 + p[0] * 2.5) + (camOn() ? camFeat.motion * p[4] * dt * 6 : 0); rx += dt * (0.08 + p[0]);
        outer.rotation.set(rx, ry, 0); inner.rotation.set(-rx * 1.4, -ry * 0.6, 0);
        const s = (0.5 + p[3]) * (1 + p[2] * (0.35 * audioFeat.kick + 0.18 * Math.pow(1 - beatFrac(), 4)));
        outer.scale.setScalar(s); inner.scale.setScalar(s * (1 + audioFeat.bass * 0.3));
        outer.material.color.setHSL(p[1], 0.85, 0.6); inner.material.color.setHSL((p[1] + 0.5) % 1, 0.85, 0.6);
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
  tunnel: { name: 'Cube Tunnel', params: [P('Speed', 0.4), P('Hue', 0.85), P('Twist', 0.3), P('Kick flash', 0.6), P('Camera steer', 0.5)],
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 60);
      scene.fog = new THREE.Fog(0x000000, 6, 26);
      const rings = 24, per = 14, mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.9), new THREE.MeshBasicMaterial({ wireframe: true }), rings * per);
      scene.add(mesh);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      let travel = 0;
      return { scene, camera, update(p, dt) {
        travel += dt * (comp.bpm / 60) * (0.5 + p[0] * 3);   // rings per second follow the tempo
        for (let r = 0; r < rings; r++) {
          const z = -((r - travel) % rings + rings) % rings * 1.1, tw = (r + Math.floor(travel)) * p[2] * 0.4;
          for (let k = 0; k < per; k++) {
            const a = (k / per) * Math.PI * 2 + tw;
            v.set(Math.cos(a) * 2.2, Math.sin(a) * 2.2, z); e.set(0, 0, a); q.setFromEuler(e);
            m.compose(v, q, one); mesh.setMatrixAt(r * per + k, m);
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.material.color.setHSL(p[1], 0.9, 0.45 + p[3] * 0.4 * audioFeat.kick + 0.1 * Math.pow(1 - beatFrac(), 6));
        const sx = camOn() ? (camFeat.x - 0.5) * 2.4 * p[4] : 0, sy = camOn() ? (camFeat.y - 0.5) * 1.6 * p[4] : 0;
        camera.position.set(sx, sy, 2); camera.lookAt(sx * 0.3, sy * 0.3, -10);
      } };
    } },
  waves: { name: 'Wave Grid', params: [P('Speed', 0.3), P('Hue', 0.5), P('Height', 0.5), P('Bass waves', 0.6), P('Camera tilt', 0.5)],
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
      const mat = new THREE.ShaderMaterial({ wireframe: true, transparent: true,
        uniforms: { t: { value: 0 }, amp: { value: 0.5 }, bass: { value: 0 }, col: { value: new THREE.Color() } },
        vertexShader: `uniform float t; uniform float amp; uniform float bass; varying float vz;
          void main(){ vec3 p = position; float d = length(p.xy);
            p.z = amp * (sin(p.x * 0.8 + t) * 0.5 + cos(p.y * 0.6 - t * 0.7) * 0.5 + sin(d * 1.5 - t * 2.0) * bass);
            vz = p.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
        fragmentShader: `uniform vec3 col; varying float vz; void main(){ gl_FragColor = vec4(col * (0.55 + vz * 0.6), 0.9); }` });
      const grid = new THREE.Mesh(new THREE.PlaneGeometry(24, 24, 70, 70), mat);
      grid.rotation.x = -Math.PI / 2.4; scene.add(grid);
      let t = 0;
      return { scene, camera, update(p, dt) {
        t += dt * (0.3 + p[0] * 3);
        const U = mat.uniforms; U.t.value = t; U.amp.value = 0.2 + p[2] * 1.6; U.bass.value = audioFeat.bass * p[3] * 2 + audioFeat.kick * p[3];
        U.col.value.setHSL(p[1], 0.8, 0.55);
        const tilt = camOn() ? (camFeat.y - 0.5) * p[4] : 0;
        camera.position.set(0, 2.2 + tilt * 3, 7); camera.lookAt(0, 0, -2);
      } };
    } },
  knot: { name: 'Neon Knot', params: [P('Speed', 0.3), P('Hue', 0.08), P('Glow', 0.5), P('Kick pulse', 0.5), P('Camera spin', 0.5)],
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 6;
      const mat = new THREE.MeshStandardMaterial({ metalness: 0.4, roughness: 0.3 });
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.3, 0.38, 220, 28), mat);
      const key = new THREE.PointLight(0xffffff, 60), fill = new THREE.AmbientLight(0xffffff, 0.25);
      key.position.set(3, 3, 5); scene.add(knot, key, fill);
      return { scene, camera, update(p, dt) {
        knot.rotation.x += dt * (0.1 + p[0] * 1.5); knot.rotation.y += dt * (0.15 + p[0] * 2) + (camOn() ? camFeat.motion * p[4] * dt * 6 : 0);
        mat.color.setHSL(p[1], 0.8, 0.5); mat.emissive.setHSL(p[1], 0.9, Math.min(0.6, p[2] * (0.15 + audioFeat.level * 0.5)));
        knot.scale.setScalar(1 + p[3] * (0.25 * audioFeat.kick + 0.1 * Math.pow(1 - beatFrac(), 4)));
      } };
    } },
  stars: { name: 'Star Warp', params: [P('Speed', 0.4), P('Hue', 0.6), P('Star size', 0.4), P('Bass boost', 0.6), P('Steer (hand / camera)', 0.6)],
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
  crystals: { name: 'Crystal Field', params: [P('Speed', 0.3), P('Hue', 0.75), P('Spin', 0.4), P('Kick pulse', 0.6), P('Hand zoom (pinch)', 0.6)],
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
      scene.fog = new THREE.FogExp2(0x000000, 0.06);
      const n = 160, mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.25, flatShading: true }), n);
      const seeds = Array.from({ length: n }, () => ({ p: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, -Math.random() * 16), r: Math.random() * 6.28, s: 0.5 + Math.random() }));
      scene.add(mesh, new THREE.AmbientLight(0xffffff, 0.35));
      const key = new THREE.PointLight(0xffffff, 80); key.position.set(0, 3, 4); scene.add(key);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
      let t = 0, z = 6;
      return { scene, camera, update(p, dt) {
        t += dt * (0.2 + p[0] * 2);
        const pulse = 1 + p[3] * (0.5 * audioFeat.kick + 0.2 * Math.pow(1 - beatFrac(), 5));
        seeds.forEach((s, i) => { e.set(t * p[2] * 2 + s.r, t * 0.7 + s.r, 0); q.setFromEuler(e); sc.setScalar(s.s * pulse); m.compose(s.p, q, sc); mesh.setMatrixAt(i, m); });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.material.color.setHSL(p[1], 0.7, 0.55); mesh.material.emissive.setHSL(p[1], 0.9, 0.08 + audioFeat.level * 0.25);
        const target = handOn() ? 7 - handFeat.pinch * 6 * p[4] : 6;
        z += (target - z) * 0.1; camera.position.set(Math.sin(t * 0.2) * 1.5, 0, z); camera.lookAt(0, 0, -6);
      } };
    } },
  rings: { name: 'Orbit Rings', params: [P('Speed', 0.3), P('Hue', 0.1), P('Tilt', 0.5), P('Kick pulse', 0.6), P('Camera spin', 0.5)],
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 9;
      const rings = [];
      for (let i = 0; i < 7; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(1 + i * 0.55, 0.035 + i * 0.006, 8, 160), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        rings.push(r); scene.add(r);
      }
      let t = 0;
      return { scene, camera, update(p, dt) {
        t += dt * (0.2 + p[0] * 2.5) + (camOn() ? camFeat.motion * p[4] * dt * 5 : 0);
        rings.forEach((r, i) => {
          r.rotation.set(t * (0.3 + i * 0.13) + p[2] * i * 0.4, t * (0.5 - i * 0.07), 0);
          const hit = Math.pow(1 - (((comp.beats - i * 0.125) % 1) + 1) % 1, 6);   // a pulse rolls outwards on every beat
          r.scale.setScalar(1 + p[3] * (0.12 * hit + 0.2 * audioFeat.kick));
          r.material.color.setHSL((p[1] + i * 0.04) % 1, 0.9, 0.35 + 0.35 * hit * p[3]);
        });
      } };
    } },
  blob: { name: 'Audio Blob', params: [P('Speed', 0.3), P('Hue', 0.45), P('Spikes', 0.4), P('Music react', 0.7), P('Hand shape (open hand)', 0.6)],
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100); camera.position.z = 5;
      const mat = new THREE.ShaderMaterial({ transparent: true,
        uniforms: { t: { value: 0 }, amp: { value: 0.2 }, freq: { value: 2 }, col: { value: new THREE.Color() }, glow: { value: 0 } },
        vertexShader: `uniform float t; uniform float amp; uniform float freq; varying vec3 vn; varying float vd;
          void main(){ vec3 p = position; float d = sin(p.x * freq + t) * sin(p.y * freq * 1.3 + t * 1.1) * sin(p.z * freq * 0.9 - t * 0.8);
            p += normal * d * amp; vd = d; vn = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
        fragmentShader: `uniform vec3 col; uniform float glow; varying vec3 vn; varying float vd;
          void main(){ float rim = pow(1.0 - abs(vn.z), 2.0); gl_FragColor = vec4(col * (0.35 + rim * 1.2 + vd * 0.6 + glow), 0.95); }` });
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 24), mat);
      scene.add(blob);
      let t = 0;
      return { scene, camera, update(p, dt) {
        t += dt * (0.4 + p[0] * 3);
        const music = p[3] * (audioFeat.bass * 0.6 + audioFeat.mid * 0.3 + audioFeat.kick * 0.5);
        const hand = handOn() ? handFeat.open * p[4] : 0;
        const U = mat.uniforms; U.t.value = t; U.amp.value = 0.08 + p[2] * 0.3 + music * 0.4 + hand * 0.5; U.freq.value = 1.5 + p[2] * 5 + hand * 4;
        U.col.value.setHSL(p[1] + audioFeat.high * 0.08, 0.8, 0.5); U.glow.value = audioFeat.kick * p[3] * 0.4;
        blob.rotation.y += dt * (0.1 + p[0]); blob.rotation.x += dt * 0.05;
      } };
    } },
  comet: { name: 'Hand Comet', params: [P('Tail length', 0.5), P('Hue', 0.95), P('Size', 0.5), P('Sparkle', 0.5), P('Follow hand', 1)],
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
  picture: { name: 'Picture Particles', sources: true, params: [P('Orbit', 0.3), P('Depth', 0.5), P('Music scatter', 0.5), P('Dark cut', 0.15),
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
  fireworks: { name: 'Beat Fireworks', params: [P('Bursts per beat', 0.45), P('Hue', 0.08), P('Colour mix', 0.6), P('Size', 0.4), P('Gravity', 0.5),
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
  vortex: { name: 'Vortex', params: [P('Speed', 0.3), P('Hue', 0.58), P('Tilt', 0.45), P('Jets', 0.5), P('Size', 0.4), P('Music react', 0.6),
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
  attractor: { name: 'Strange Attractor', params: [P('Speed', 0.4), P('Hue', 0.55), P('Shape (Lorenz / Aizawa / Thomas / Halvorsen / every 16 beats)', 0.1),
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
};

function texThumb(tex) {
  present(tex, 160, 90);
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
  grab(cv.getContext('2d'), 160, 90);
  return cv.toDataURL('image/jpeg', 0.7);
}
function draw3d(f, L) {
  const c = this, R = three();
  if (!R) return false;
  if (!c.inst) c.inst = SCENES3D[c.scene].build();
  if (!rt3 || rt3.width !== comp.w || rt3.height !== comp.h) { if (rt3) rt3.dispose(); rt3 = new THREE.WebGLRenderTarget(comp.w, comp.h, { samples: window.VJ_MOBILE ? 2 : 4 }); }   // phones: 2x MSAA (the resolve costs bandwidth they do not have)
  const dt = Math.min(0.1, Math.max(0, comp.time - (c.lastT ?? comp.time))); c.lastT = comp.time;
  const cam = c.inst.camera;
  if (cam.aspect !== comp.w / comp.h) { cam.aspect = comp.w / comp.h; cam.updateProjectionMatrix(); }
  c.inst.update(modParams(c.params, c.mod), dt, L, c);
  R.resetState();
  R.setRenderTarget(rt3); R.setClearColor(0x000000, 0); R.clear(); R.render(c.inst.scene, cam); R.setRenderTarget(null);
  R.resetState();
  bindFbo(f);
  gl.useProgram(srcProg.p);
  bindTex(0, R.properties.get(rt3.texture).__webglTexture);
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
  const d = SCENES3D[scene];
  if (!d) return null;
  const c = { uid: newUid(), type: '3d', name: d.name, scene, params: d.params.map(x => x.def), speed: 1, thumb: null, wantThumb: true, bornAt: comp.time };
  if (typeof o.name === 'string' && o.name) c.name = o.name;
  if (d.sources && o.src === 'camera') c.src = 'camera';   // picture scenes: the layer below (default) or the camera input
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
CLIP_TYPES['3d'] = {
  toJSON: c => ({ type: '3d', uid: c.uid, name: c.name, scene: c.scene, params: c.params, mod: c.mod, src: c.src }),
  fromJSON: j => clip3d(j.scene, j),
  free: c => { if (c.inst) c.inst.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); c.inst = null; },
  props: (c, p) => {
    p.append(el('div', { className: 'hint', textContent: '3D generator (three.js). Follows the beat and the music; camera sliders work once the camera input is on (Sources tab).' }));
    if (SCENES3D[c.scene].sources) p.append(el('label', { className: 'row', textContent: 'Picture ' },
      el('select', { onchange: e => { if (e.target.value === 'camera') c.src = 'camera'; else delete c.src; } },
        el('option', { value: 'below', textContent: 'Layer below (else the camera)', selected: c.src !== 'camera' }),
        el('option', { value: 'camera', textContent: 'Camera input', selected: c.src === 'camera' }))),
      el('div', { className: 'hint', textContent: 'Tip: put the picture on the layer below and set that layer to 0 opacity to see only the particles.' }));
    SCENES3D[c.scene].params.forEach((pd, k) => {
      const f = fld(pd.name, 0, 1, 0.001, () => c.params[k], v => { c.params[k] = v; });
      f.slider.dataset.midi = 'gen:' + c.uid + ':' + k;
      p.append(...lfoControls(c, k, f));
    });
  },
};
SOURCE_PANELS.push(() => {
  const list = el('div', { className: 'list' });
  if (typeof THREE === 'undefined') list.append(el('div', { className: 'hint', textContent: 'three.js did not load (web/vendor/three.min.js).' }));
  else for (const key in SCENES3D) {
    const item = el('div', { className: 'src-item', textContent: SCENES3D[key].name, title: 'Drag onto a clip slot, or double-click to fill the selected slot',
      ondblclick: () => { const ci = sel.c >= 0 ? sel.c : comp.layers[sel.l].clips.findIndex(x => !x); if (ci >= 0) setClip(sel.l, ci, clip3d(key)); } });
    draggable(item, { kind: 'make', make: () => clip3d(key) });
    list.append(item);
  }
  return [el('h4', { textContent: '3D (three.js)' }), list];
});
