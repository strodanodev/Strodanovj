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
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100); camera.position.z = 5;
      const n = 8000, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 1.6 + Math.pow(Math.random(), 3) * 2.2, q = Math.sqrt(1 - u * u);
        pos[i * 3] = Math.cos(a) * q * r; pos[i * 3 + 1] = u * r; pos[i * 3 + 2] = Math.sin(a) * q * r;
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.03, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const g = new THREE.Group(); g.add(pts); scene.add(g);
      return { scene, camera, update(p, dt) {
        g.rotation.y += dt * (0.05 + p[0] * 1.2); g.rotation.x += dt * (0.02 + p[0] * 0.3);
        g.scale.setScalar(1 + audioFeat.bass * p[3] * 0.6 + audioFeat.kick * p[3] * 0.2);
        pts.material.size = 0.01 + p[2] * 0.08; pts.material.color.setHSL(p[1] + audioFeat.high * 0.1, 0.8, 0.6);
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
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
      const n = 6000, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = (Math.random() - 0.5) * 40; pos[i * 3 + 2] = -Math.random() * 120; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.15, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(pts);
      return { scene, camera, update(p, dt) {
        const v = dt * (comp.bpm / 60) * (4 + p[0] * 40) * (1 + audioFeat.bass * p[3] * 2), a = geo.attributes.position.array;
        for (let i = 2; i < a.length; i += 3) { a[i] += v; if (a[i] > 2) a[i] -= 122; }
        geo.attributes.position.needsUpdate = true;
        pts.material.size = 0.05 + p[2] * 0.4; pts.material.color.setHSL(p[1], 0.6, 0.75);
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
    build() {
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100); camera.position.z = 8;
      const n = 2400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3), life = new Float32Array(n);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(pts);
      const head = new THREE.Vector3(), c = new THREE.Color();
      let next = 0, t = 0;
      return { scene, camera, update(p, dt) {
        t += dt;
        // the head follows the hand (or drifts in a figure eight when no hand is seen); the camera picture is 10 x 5.6 units at z = 0
        const hx = handOn() && p[4] > 0 ? (handFeat.x - 0.5) * 10 : Math.sin(t * 0.7) * 3.5, hy = handOn() && p[4] > 0 ? (handFeat.y - 0.5) * 5.6 : Math.sin(t * 1.4) * 1.6;
        head.x += (hx - head.x) * 0.25; head.y += (hy - head.y) * 0.25;
        const spawn = Math.ceil(dt * 60 * (20 + audioFeat.level * 40));
        for (let s = 0; s < spawn; s++) {
          const i = next; next = (next + 1) % n;
          pos[i * 3] = head.x; pos[i * 3 + 1] = head.y; pos[i * 3 + 2] = 0;
          const sp = 0.3 + p[3] * 2 * (0.3 + audioFeat.kick);
          vel[i * 3] = (Math.random() - 0.5) * sp; vel[i * 3 + 1] = (Math.random() - 0.5) * sp; vel[i * 3 + 2] = (Math.random() - 0.5) * sp;
          life[i] = 1;
        }
        const fade = dt / (0.3 + p[0] * 2.5);
        c.setHSL(p[1], 0.85, 0.6);
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
          life[i] -= fade; const l = Math.max(0, life[i]);
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          col[i * 3] = c.r * l; col[i * 3 + 1] = c.g * l; col[i * 3 + 2] = c.b * l;
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
        pts.material.size = 0.04 + p[2] * 0.3;
      } };
    } },
};

function texThumb(tex) {
  present(tex, 160, 90);
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
  grab(cv.getContext('2d'), 160, 90);
  return cv.toDataURL('image/jpeg', 0.7);
}
function draw3d(f) {
  const c = this, R = three();
  if (!R) return false;
  if (!c.inst) c.inst = SCENES3D[c.scene].build();
  if (!rt3 || rt3.width !== comp.w || rt3.height !== comp.h) { if (rt3) rt3.dispose(); rt3 = new THREE.WebGLRenderTarget(comp.w, comp.h, { samples: 4 }); }
  const dt = Math.min(0.1, Math.max(0, comp.time - (c.lastT ?? comp.time))); c.lastT = comp.time;
  const cam = c.inst.camera;
  if (cam.aspect !== comp.w / comp.h) { cam.aspect = comp.w / comp.h; cam.updateProjectionMatrix(); }
  c.inst.update(modParams(c.params, c.mod), dt);
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
function clip3d(scene, o = {}) {
  const d = SCENES3D[scene];
  if (!d) return null;
  const c = { uid: newUid(), type: '3d', name: d.name, scene, params: d.params.map(x => x.def), speed: 1, thumb: null, wantThumb: true, bornAt: comp.time };
  if (typeof o.name === 'string' && o.name) c.name = o.name;
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
  toJSON: c => ({ type: '3d', uid: c.uid, name: c.name, scene: c.scene, params: c.params, mod: c.mod }),
  fromJSON: j => clip3d(j.scene, j),
  free: c => { if (c.inst) c.inst.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); c.inst = null; },
  props: (c, p) => {
    p.append(el('div', { className: 'hint', textContent: '3D generator (three.js). Follows the beat and the music; camera sliders work once the camera input is on (Sources tab).' }));
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
