// Strodano VJ mobile - the STRODANO starter pack. GPL-3.0 (the media in starter/ is STRODANO's own, not GPL: see starter/README).
// A new phone project opens as a ready show built from STRODANO's own footage, photos and logos, plus Smart 3D and
// shader visuals. The media files are not in the repository: tools/build-mobile.mjs copies them into the deployed site's
// starter/ folder (from the website's compressed media). On first use they are downloaded once (~9 MB) and copied into
// the phone's library (medialib.js), so the project relinks them by name and works offline from then on. If they cannot
// be fetched (offline, or a local checkout without starter/), the project still runs: those slots show "missing" and the
// 3D / shader / text clips play.
'use strict';
const STARTER_BASE = 'starter/';
const STARTER_FILES = [
  ['strodano-hero.mp4', 'STRODANO live'], ['strodano-stage.mp4', 'Club set'],
  ['strodano-live-1.webp', 'LED wall'], ['strodano-live-2.webp', 'Lasers'],
  ['strodano-artists.webp', 'STRO + Sedano'], ['strodano-duo.webp', 'Duo'],
  ['strodano-logo.webp', 'STRODANO logo'], ['strodano-neon.webp', 'Neon logo'],
];
const starterKind = f => (/\.mp4$/.test(f) ? 'video' : 'image');
// The project: 4 layers x 6 scenes, columns tagged for the Agent (calm -> drop from left to right)
function starterProject() {
  const m = (file, extra) => ({ type: starterKind(file), fileName: file, name: (STARTER_FILES.find(x => x[0] === file) || [0, file])[1], speed: 1, ...extra });
  const d3 = scene => ({ type: '3d', scene });
  const gen = g => ({ type: 'gen', gen: g, name: g });
  const txt = (text, anim) => ({ type: 'text', text, anim });
  return {
    app: 'Strodano VJ', version: 2, w: 1280, h: 720, columns: 6, master: 1, crossfade: 0.5, bpm: 126,
    agentTags: { 0: 'Calm', 1: 'Groove', 2: 'Groove', 3: 'Peak', 4: 'Peak', 5: 'Drop' },
    layers: [
      { name: 'Footage', opacity: 1, blend: 0, fit: 0, trans: 1, transType: 0,
        clips: [m('strodano-hero.mp4'), m('strodano-stage.mp4'), d3('stars'), m('strodano-live-1.webp'), m('strodano-live-2.webp'), d3('tunnel')] },
      { name: 'Smart 3D', opacity: 0.7, blend: 1, fit: 0, trans: 1, transType: 5,
        clips: [d3('bokeh'), d3('waves'), gen('Tunnel'), d3('blob'), d3('vortex'), gen('Beat Flash')] },
      { name: 'Artists', opacity: 1, blend: 0, fit: 1, scale: 0.9, y: -0.08, trans: 1, transType: 0,
        clips: [null, m('strodano-artists.webp'), m('strodano-duo.webp'), null, m('strodano-artists.webp'), m('strodano-duo.webp')] },
      { name: 'Logo', opacity: 1, blend: 0, fit: 1, scale: 0.5, trans: 0.5, transType: 0,
        clips: [m('strodano-logo.webp'), m('strodano-neon.webp'), txt('STRODANO', 1), m('strodano-logo.webp'), m('strodano-neon.webp'), txt('STRODANO\nVJ', 1)] },
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
function starterPlay() { [[0, 0], [1, 0], [3, 0]].forEach(([li, ci]) => { const L = comp.layers[li]; if (L && L.active < 0 && L.pendingCol < 0) trigger(li, ci); }); }
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
