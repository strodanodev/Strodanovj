// Strodano VJ (web) - the STRODANO stock show: the default composition for Agent / Auto mode. GPL-3.0.
// Built from the stock pack (tools/build-stock.py): the logos and the duo cut-out (stock-images.js, data URLs, so they
// load into WebGL even from file://), the two stock videos (web/stock/, served next to the page; skipped from file://,
// where a video from disk cannot be drawn by WebGL) and the three.js scenes of smart3d.js.
// Every column is tagged with the part of a song it is for (agent.js COL_TAGS), so the Agent and the playlist plans map
// the music onto it: Calm for intros, outros and breakdowns, Groove for builds, Peak and Drop for the drops (the Beat
// Flash strobe only lives in the Drop columns, and agent.js only lets it run at the start of a drop).
// The STRODANO logo layer is locked: it stays up through the whole performance and the Agent never touches it, until
// you unlock it, replace its clips or load another composition.
'use strict';
const STOCK_VIDEOS = [['strodano-top.mp4', 'STRODANO Top'], ['strodano-mid.mov', 'STRODANO Mid']];
const STOCK_NAMES = { 'strodano-logo.webp': 'STRODANO logo', 'strodano-logo-glow.webp': 'STRODANO logo (glow)', 'strodano-duo.webp': 'STRODANO duo', 'audius-logo.webp': 'Audius' };
const stockVideosOK = () => location.protocol === 'http:' || location.protocol === 'https:';
const isStockName = n => !!STOCK_NAMES[n] || STOCK_VIDEOS.some(v => v[0] === n);

// The stock files as media pool entries (once). Saved clips that use them relink like any added file.
function stockMedia() {
  const add = (name, url, kind) => { if (!media.some(m => m.name === name)) media.push({ id: mediaSeq++, name, url, kind, stock: true }); };
  if (typeof STOCK_IMAGES !== 'undefined') for (const n in STOCK_IMAGES) add(n, STOCK_IMAGES[n], 'image');
  if (stockVideosOK()) for (const [n] of STOCK_VIDEOS) add(n, 'stock/' + n, 'video');
  ui.browserDirty = true;
}
function stockRelink() {
  stockMedia();
  comp.layers.forEach(L => L.clips.forEach((c, ci) => {
    if (!c || !c.missing || !isStockName(c.fileName)) return;
    const m = media.find(x => x.name === c.fileName);
    if (!m) return;
    const n = mediaClip(m); n.speed = c.speed; n.name = c.name;
    if (typeof clipOptsCopy === 'function') clipOptsCopy(c, n);
    L.clips[ci] = n;
  }));
  ui.gridDirty = true;
}
function stockClip(file, name) {
  const m = media.find(x => x.name === file);
  if (!m) return null;
  const c = mediaClip(m);
  c.name = name || STOCK_NAMES[file] || (STOCK_VIDEOS.find(v => v[0] === file) || [])[1] || c.name;
  return c;
}
// A 3D scene in STRODANO colours: hue (0..1) and speed set on the scene's own sliders.
function stock3d(scene, hue, speed) {
  if (typeof SCENES3D === 'undefined' || typeof THREE === 'undefined' || !SCENES3D[scene]) return null;
  const c = clip3d(scene);
  c.params[1] = hue;
  if (speed !== undefined) c.params[0] = speed;
  return c;
}
const HUE = { magenta: 0.86, cyan: 0.5, yellow: 0.15, violet: 0.75, blue: 0.62 };

// The show. Columns: 1-2 Calm, 3-4 Groove, 5-6 Peak, 7-8 Drop.
//   STRODANO video  picture   the mid-section video for the calmer parts, the top-section video for the peaks
//   3D FX           picture   three.js scenes added on top (Add blend), calm ones first, the busiest on the drops
//   Strobe          effect    Beat Flash, Drop columns only
//   Artist          overlay   the duo and the Audius logo, in the calm parts
//   STRODANO logo   overlay   locked, always up
function stockComp() {
  resetComp(5, 8);
  if (typeof scoreFromJSON === 'function') scoreFromJSON(null);
  if (typeof snapsFromJSON === 'function') snapsFromJSON(null);
  stockMedia();
  const [V, D, S, A, LG] = comp.layers;
  Object.assign(V, { name: 'STRODANO video', agentRole: 'main', trans: 2, transType: 0 });
  Object.assign(D, { name: '3D FX', agentRole: 'main', blend: 1, opacity: 0.9, trans: 2 });
  Object.assign(S, { name: 'Strobe', agentRole: 'fx', blend: 1, opacity: 0.6 });
  Object.assign(A, { name: 'Artist', agentRole: 'overlay', fit: 1, scale: 0.62, y: -0.06, opacity: 0.95, trans: 4 });
  Object.assign(LG, { name: 'STRODANO logo', agentRole: 'overlay', fit: 1, scale: 0.34, y: -0.3, trans: 4 });
  const mid = 'strodano-mid.mov', top = 'strodano-top.mp4';
  const put = (L, ci, c) => { if (c) L.clips[ci] = c; };
  [mid, null, mid, top, top, mid, top, top].forEach((f, ci) => f && put(V, ci, stockClip(f)));
  [['waves', HUE.cyan, 0.2], ['stars', HUE.violet, 0.25], ['knot', HUE.magenta, 0.35], ['wire', HUE.cyan, 0.4],
    ['tunnel', HUE.magenta, 0.55], ['rings', HUE.yellow, 0.5], ['particles', HUE.magenta, 0.7], ['crystals', HUE.cyan, 0.65]]
    .forEach(([k, h, s], ci) => put(D, ci, stock3d(k, h, s)));
  put(S, 6, genClip('Beat Flash')); put(S, 7, genClip('Beat Flash'));
  put(A, 0, stockClip('strodano-duo.webp')); put(A, 1, stockClip('audius-logo.webp')); put(A, 2, stockClip('strodano-duo.webp'));
  put(LG, 0, stockClip('strodano-logo.webp')); put(LG, 1, stockClip('strodano-logo-glow.webp'));
  comp.agentTags = { 0: 'Calm', 1: 'Calm', 2: 'Groove', 3: 'Groove', 4: 'Peak', 5: 'Peak', 6: 'Drop', 7: 'Drop' };
  // what shows before the music starts: the calm column, with the logo
  if (V.clips[0]) trigger(0, 0); else if (D.clips[0]) trigger(1, 0);
  if (D.clips[0]) trigger(1, 0);
  trigger(4, 0);
  LG.locked = true;
  if (typeof plDirty === 'function') plDirty();
  ui.gridDirty = ui.propsDirty = ui.browserDirty = true;
}
