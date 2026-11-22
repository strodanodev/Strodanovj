// Strodano VJ mobile - the STRODANO starter pack. GPL-3.0 (the media in starter/ is STRODANO's own, not GPL: see starter/README).
// A new phone project opens as a ready show built from STRODANO's own footage, photos and logos, plus Smart 3D and
// shader visuals. The media files are not in the repository: tools/build-mobile.mjs copies them into the deployed site's
// starter/ folder (from the website's compressed media). On first use they are downloaded once (~9 MB) and copied into
// the phone's library (medialib.js), so the project relinks them by name and works offline from then on. If they cannot
// be fetched (offline, or a local checkout without starter/), the project still runs: those slots show "missing" and the
// 3D / shader / text clips play.
'use strict';
const STARTER_BASE = 'starter/';
// Four files: two STRODANO videos, the duo cut-out and the chrome logo. The 3D scenes do the rest.
const STARTER_FILES = [
  ['strodano-hero.mp4', 'Visors'], ['strodano-stage.mp4', 'Club set'], ['strodano-duo.webp', 'STRO + Sedano'], ['strodano-logo.webp', 'STRODANO logo'],
];
const starterKind = f => (/\.mp4$/.test(f) ? 'video' : 'image');
// Clip helpers shared by the starter and the premium show. Placement (c.tr): x / y = offset in frames (0.3 = 30% of
// the frame), y up; s = size. Brand pictures sit in the lower third or the centre, never over the faces in the footage.
const LOWER = { tr: { s: 0.32, y: -0.29 } }, CENTRE = { tr: { s: 0.62 } }, DUO = { tr: { s: 0.92, y: -0.1 } };
const packClip = (list, file, extra) => ({ type: starterKind(file), fileName: file, name: (list.find(x => x[0] === file) || [0, file])[1], speed: 1, ...extra });
const d3 = (scene, extra) => ({ type: '3d', scene, ...extra });
// Effects for the template: packFx(name, params, mod) = one entry of a clip's own effect chain (saved as clip.fx);
// mod = { paramIndex: { src: 'kick' | 'bass' | ..., depth } } pushes a parameter up with the music (motion.js).
const packFx = (def, params, mod) => ({ def, params, mix: 1, ...(mod && { mod }) });
const onKick = depth => ({ shape: 0, rate: 4, depth, src: 'kick' });
// The first-start template: 4 scenes (Intro, Groove, Peak, Drop; the column tags drive Auto) on 3 layers.
// Visuals at the back (STRODANO footage or a 3D world), a 3D glow screened over it, ONE brand element on top, placed
// off the faces. A few clip effects follow the kick, so it moves with the music from the first tap.
function starterProject() {
  const m = (file, extra) => packClip(STARTER_FILES, file, extra);
  return {
    app: 'Strodano VJ', version: 2, w: 1280, h: 720, columns: 4, master: 1, crossfade: 0.5, bpm: 126,
    agentTags: { 0: 'Calm', 1: 'Groove', 2: 'Peak', 3: 'Drop' },
    layers: [
      // the bold, music-driven 3D scenes (checked with a real track: Bokeh, Star Warp, Embers and Fireworks read too faint)
      { name: 'Visuals', opacity: 1, blend: 0, fit: 0, trans: 1, transType: 0,
        clips: [m('strodano-hero.mp4', { fx: [packFx('Vignette', [0.45, 0.6])] }), d3('waves', { fx: [packFx('Hue Rotate', [0, 0.15])] }),
          m('strodano-stage.mp4', { fx: [packFx('Audio Pulse', [0.2, 0.15, 0])] }), d3('tunnel')] },
      { name: '3D', opacity: 0.85, blend: 4, fit: 0, trans: 1, transType: 0,
        clips: [d3('vortex'), null, d3('wire'), d3('rings', { fx: [packFx('Kaleidoscope', [0.3, 0, 0.15])] })] },
      { name: 'Brand', opacity: 1, blend: 0, fit: 1, trans: 1, transType: 0,
        clips: [m('strodano-logo.webp', LOWER), m('strodano-duo.webp', DUO),
          m('strodano-logo.webp', { ...CENTRE, fx: [packFx('RGB Shift', [0.03, 0], { 0: onKick(0.5) })] }),
          m('strodano-duo.webp', { ...DUO, fx: [packFx('RGB Shift', [0.01, 0.25], { 0: onKick(0.08) })] })] },
    ],
    screens: [{ name: 'Web link', device: 'vdo', slices: [] }],
  };
}
// Load the starter project (layout first; media arrives through starterFetch)
function loadStarter() {
  const j = starterProject();
  j.layers.forEach(l => { l.clips = l.clips.map(c => (c && c.type === '3d' && typeof SCENES3D !== 'undefined' && !SCENES3D[c.scene] ? null : c)); });
  if (!loadComp(j)) return false;
  if (!screens[0].slices.length) screens[0].slices.push(newSlice('Slice 1'));
  starterPlay();
  return true;
}
function starterPlay() { [[0, 0], [1, 0], [2, 0]].forEach(([li, ci]) => { const L = comp.layers[li]; if (L && L.active < 0 && L.pendingCol < 0) trigger(li, ci); }); }
const starterState = { busy: false, done: 0, total: 0 };
// Download the pack files the project needs and the library does not have yet; then copy them in (relinks the clips)
async function starterFetch() {
  if (starterState.busy || !/^https?:$/.test(location.protocol)) return;
  const want = new Set();
  comp.layers.forEach(L => L.clips.forEach(c => { if (c && c.missing && STARTER_FILES.some(x => x[0] === c.fileName)) want.add(c.fileName); }));
  const need = [...want].filter(n => !mlib.items.some(x => x.name === n));
  if (!need.length) return;
  starterState.busy = true; starterState.done = 0; starterState.total = need.length;
  setStatus('Getting the STRODANO starter pack...');
  const files = [];
  for (const n of need) {
    try {
      const r = await fetch(STARTER_BASE + encodeURIComponent(n));
      if (!r.ok) throw new Error(r.status);
      const b = await r.blob();
      files.push(new File([b], n, { type: b.type || (starterKind(n) === 'video' ? 'video/mp4' : 'image/webp') }));
    } catch (e) { /* offline or not deployed with starter/: the slot stays "missing" */ }
    starterState.done++;
    if (typeof M !== 'undefined') M.dirty = true;
  }
  if (files.length) await mlibImport(files);
  starterState.busy = false;
  starterPlay();
  setStatus(files.length === need.length ? 'STRODANO starter pack ready: it is in your Library, offline too' : files.length ? 'Part of the starter pack could not be downloaded' : 'The starter pack needs an internet connection the first time');
}

// ---------- the STRODANO premium pack (Pro and Festival) ----------
// The STRODANO 3D show for paying plans: its HD footage and lockup. The files are on the phone site under premium/ (built by
// tools/build-mobile.mjs, never in the repository) behind a check at the edge (middleware.js) that only lets a request
// through with a fresh signature. The website gives that signature (GET /api/app/pack) only to an app signed in to a
// Pro or Festival account, so the pack cannot be had by editing this code: the lock is on the server.
// Once downloaded, the files live in the phone's library like any import and stay there offline.
const PREMIUM_BASE = 'premium/';
const PREMIUM_FILES = [['strodano-pro-visors-hd.mp4', 'Visors HD'], ['strodano-pro-club-hd.mp4', 'Club set HD'], ['strodano-pro-lockup.webp', 'STRODANO lockup']];
const premiumState = { busy: false, done: 0, total: 0, note: '' };
const premiumMissing = () => PREMIUM_FILES.map(f => f[0]).filter(n => !mlib.items.some(x => x.name === n));
const premiumHave = () => mlib.ready && !premiumMissing().length;
const premiumNote = t => { premiumState.note = t; setStatus(t); if (typeof M !== 'undefined') M.dirty = true; };
async function premiumGet() {
  if (premiumState.busy) return;
  if (!entGate('pack')) return;
  if (!ent.token) { premiumNote('Sign in to your Strodano account to download the premium pack'); entAccount(); return; }
  const need = premiumMissing();
  if (!need.length) return;
  premiumState.busy = true; premiumState.done = 0; premiumState.total = need.length; premiumNote('Checking your plan...');
  try {
    let r = null;
    try { r = await entFetch('/api/app/pack', null, ent.token); } catch (e) {}
    if (!r) return premiumNote('The premium pack needs an internet connection to download');
    if (r.status === 401) { entRefresh(); return premiumNote('This app was signed out: sign in again to download the pack'); }
    if (r.status === 403) {   // the website says this account has no paid plan (any more): believe it, then offer the upgrade
      entDowngrade();
      premiumNote('The premium pack comes with Pro and Festival'); entPrompt('pack'); return;
    }
    if (!r.ok || !r.json.sig) return premiumNote('The premium pack is not available right now. Try again later.');
    const q = '?e=' + encodeURIComponent(r.json.exp) + '&s=' + encodeURIComponent(r.json.sig), files = [];
    premiumNote('Downloading the premium pack...');
    for (const n of need) {
      try {
        const f = await fetch(PREMIUM_BASE + encodeURIComponent(n) + q, { cache: 'no-store' });
        if (!f.ok) throw new Error(f.status);
        const b = await f.blob();
        files.push(new File([b], n, { type: b.type || (starterKind(n) === 'video' ? 'video/mp4' : 'image/webp') }));
      } catch (e) { /* counted below */ }
      premiumState.done++; if (typeof M !== 'undefined') M.dirty = true;
    }
    if (files.length) await mlibImport(files);
    if (files.length < need.length) return premiumNote(files.length ? 'Part of the premium pack could not be downloaded: tap again for the rest' : 'The premium pack could not be downloaded. Try again in a moment.');
    premiumNote('Premium pack ready: tap Open the 3D show. The HD clips are in your Library, offline too.');
  } finally { premiumState.busy = false; if (typeof M !== 'undefined') M.dirty = true; }
}
// The premium 3D show: the advanced three.js visualizers (Picture Particles fed by the HD footage, Audio History Terrain,
// Harmonograph, Particle Morph, Strange Attractor, Crystal Field, Drop Supernova, Text Shatter) with the HD clips.
function premiumProject() {
  const m = (file, extra) => packClip(PREMIUM_FILES, file, extra);
  return {
    app: 'Strodano VJ', version: 2, w: 1280, h: 720, columns: 6, master: 1, crossfade: 0.5, bpm: 126,
    agentTags: { 0: 'Calm', 1: 'Groove', 2: 'Groove', 3: 'Peak', 4: 'Peak', 5: 'Drop' },
    layers: [
      { name: 'World', opacity: 1, blend: 0, fit: 0, trans: 1, transType: 0,
        clips: [m('strodano-pro-visors-hd.mp4'), d3('terrain'), m('strodano-pro-club-hd.mp4'), d3('attractor'), m('strodano-pro-visors-hd.mp4'), d3('supernova')] },
      { name: '3D', opacity: 0.9, blend: 4, fit: 0, trans: 1, transType: 0,
        clips: [d3('picture'), d3('harmono'), d3('morph'), null, d3('crystals'), d3('shatter', { src: 'text', text: 'STRODANO' })] },
      { name: 'Brand', opacity: 1, blend: 0, fit: 1, trans: 1, transType: 0,
        clips: [null, m('strodano-pro-lockup.webp', LOWER), null, m('strodano-pro-lockup.webp', CENTRE), null, null] },
    ],
    screens: [{ name: 'Web link', device: 'vdo', slices: [] }],
  };
}
// Replaces the current project (the library stays; the Library card asks for a second tap first); the HD clips relink
// by name from the library
function premiumOpenShow() {
  const j = premiumProject();
  j.layers.forEach(l => { l.clips = l.clips.map(c => (c && c.type === '3d' && typeof SCENES3D !== 'undefined' && !SCENES3D[c.scene] ? null : c)); });
  if (!loadComp(j)) return;
  if (!screens[0].slices.length) screens[0].slices.push(newSlice('Slice 1'));
  [0, 1].forEach(li => trigger(li, 0));
  setStatus('STRODANO 3D: tap the scenes on Perform, or let Auto play them');
}
