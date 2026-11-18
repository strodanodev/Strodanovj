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

// ---------- the STRODANO premium pack (Pro and Festival) ----------
// More STRODANO footage and photos for paying plans. The files are on the phone site under premium/ (built by
// tools/build-mobile.mjs, never in the repository) behind a check at the edge (middleware.js) that only lets a request
// through with a fresh signature. The website gives that signature (GET /api/app/pack) only to an app signed in to a
// Pro or Festival account, so the pack cannot be had by editing this code: the lock is on the server.
// Once downloaded, the files live in the phone's library like any import and stay there offline.
const PREMIUM_BASE = 'premium/';
const PREMIUM_FILES = [
  ['strodano-pro-crowd.mp4', 'Crowd'], ['strodano-pro-stage.mp4', 'Main stage'],
  ['strodano-pro-booth-1.webp', 'Booth'], ['strodano-pro-booth-2.webp', 'Booth 2'],
  ['strodano-pro-press-1.webp', 'Press 1'], ['strodano-pro-press-2.webp', 'Press 2'], ['strodano-pro-press-3.webp', 'Press 3'], ['strodano-pro-press-4.webp', 'Press 4'],
  ['strodano-pro-uwu.webp', 'UwU'], ['strodano-pro-avatar.webp', 'Avatar logo'], ['strodano-pro-mark.webp', 'Supporting logo'],
];
const premiumState = { busy: false, done: 0, total: 0, note: '' };
const premiumMissing = () => PREMIUM_FILES.map(f => f[0]).filter(n => !mlib.items.some(x => x.name === n));
const premiumHave = () => mlib.ready && !premiumMissing().length;
const premiumNote = t => { premiumState.note = t; setStatus(t); if (typeof M !== 'undefined') M.dirty = true; };
async function premiumGet() {
  if (premiumState.busy) return;
  if (!entGate('pack')) return;
  if (!ent.token) { premiumNote('Sign in to your Strodano account to download the premium pack'); entAccount(); return; }
  const need = premiumMissing();
  if (!need.length) { premiumToLayer(); return; }
  premiumState.busy = true; premiumState.done = 0; premiumState.total = need.length; premiumNote('Checking your plan...');
  try {
    let r = null;
    try { r = await entFetch('/api/app/pack', null, ent.token); } catch (e) {}
    if (!r) return premiumNote('The premium pack needs an internet connection to download');
    if (r.status === 401) { entRefresh(); return premiumNote('This app was signed out: sign in again to download the pack'); }
    if (r.status === 403) {   // the website says this account has no paid plan (any more): believe it, then offer the upgrade
      ent.plan = r.json.plan in ENT_RANK ? r.json.plan : 'free'; ent.at = Date.now(); entSave(); entShow();
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
    premiumToLayer();
    premiumNote('Premium pack ready: it is in your Library and on a new layer "Premium"');
  } finally { premiumState.busy = false; if (typeof M !== 'undefined') M.dirty = true; }
}
// A new top layer "Premium" with the pack's clips across the scenes (only once; the files stay in the Library either way)
function premiumToLayer() {
  if (comp.layers.some(L => L.name === 'Premium')) { setStatus('The premium clips are on the layer "Premium" and in your Library'); return; }
  const clips = PREMIUM_FILES.map(([n, title]) => { const m = media.find(x => x.name === n); if (!m) return null; const c = mediaClip(m); c.name = title; return c; }).filter(Boolean);
  if (!clips.length) return;
  addLayer();
  const li = comp.layers.length - 1, L = comp.layers[li];
  L.name = 'Premium'; L.opacity = 0.85;
  for (let ci = 0; ci < comp.columns && ci < clips.length; ci++) setClip(li, ci, clips[ci]);
}
