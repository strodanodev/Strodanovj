// Strodano VJ (web) - video clip settings: in / out points, loop mode, and beat-sync. GPL-3.0.
// c.inP / c.outP: in and out points as fractions of the video (0..1). c.loopMode: 'loop' | 'hold' (play once, stay on the
// last frame) | 'eject' (play once, then the layer goes empty). c.syncBeats: 0 = off, or the number of beats one pass
// from in to out lasts: the playback speed follows the tempo (comp.bpm, which follows the music while a DJ deck, MIDI clock
// or the live listener runs), and small drifts are pulled back by nudging the speed, so cuts in the footage land on the beat.
// Saved with the composition (engine.js compToJSON / loadComp, and kept when a missing clip is relinked).
'use strict';
const LOOP_MODES = [['loop', 'Loop'], ['hold', 'Play once, hold last frame'], ['eject', 'Play once, then clear']];
const SYNC_LENGTHS = [[0, 'Off'], [1, '1 beat'], [2, '2 beats'], [4, '1 bar'], [8, '2 bars'], [16, '4 bars'], [32, '8 bars']];
const clipDur = c => (c.video && isFinite(c.video.duration) ? c.video.duration : 0);
function clipStart(c) { return clipDur(c) * (c.inP || 0); }
function clipEnd(c) { return clipDur(c) * (c.outP ?? 1); }
const clipCustom = c => (c.inP || 0) > 0 || (c.outP ?? 1) < 1 || (c.loopMode && c.loopMode !== 'loop') || c.syncBeats > 0;
function clipTriggered(c) { c.sync0 = comp.beats; c.done = false; }

function clipOptsJSON(c) {
  const o = {};
  if (c.inP) o.inP = c.inP;
  if (c.outP !== undefined && c.outP < 1) o.outP = c.outP;
  if (c.loopMode && c.loopMode !== 'loop') o.loopMode = c.loopMode;
  if (c.syncBeats) o.syncBeats = c.syncBeats;
  return o;
}
function clipOptsFrom(c, j) {
  const f = v => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
  const i = f(j.inP), o = f(j.outP);
  if (i !== undefined) c.inP = i;
  if (o !== undefined && o > (c.inP || 0) + 0.001) c.outP = o;
  if (LOOP_MODES.some(m => m[0] === j.loopMode)) c.loopMode = j.loopMode;
  if (SYNC_LENGTHS.some(s => s[0] === j.syncBeats)) c.syncBeats = j.syncBeats;
}
function clipOptsCopy(from, to) { clipOptsFrom(to, clipOptsJSON(from)); if (from.tr) to.tr = from.tr; if (from.fx) to.fx = from.fx; }

// ---------- size, position, crop and effects of one clip (drawn by engine.js drawClip) ----------
// c.tr = { s: size, w / h: width and height on top of it, x / y: position (-1..1 of the frame, y up), cl / cr / ct / cb:
// crop from the left, right, top and bottom (fractions of the picture) }. No c.tr = untouched. c.fx = the clip's effects,
// the same objects as a layer's (uid, def, params, mix, bypass, mod), so sliders take inputs and MIDI the same way.
const TR_ID = { s: 1, w: 1, h: 1, x: 0, y: 0, cl: 0, cr: 0, ct: 0, cb: 0 };
const clipTr = c => c.tr || (c.tr = { ...TR_ID });
// drop c.tr again when everything is back at its default, so an untouched clip costs nothing
function clipTrTidy(c) { if (c.tr && Object.keys(TR_ID).every(k => Math.abs(c.tr[k] - TR_ID[k]) < 1e-4)) delete c.tr; }
function clipLookJSON(c, fxJ) {
  const o = {};
  clipTrTidy(c);
  if (c.tr) o.tr = { ...c.tr };
  if (c.fx && c.fx.length) o.fx = fxJ(c.fx);
  return o;
}
function clipLookFrom(c, j, fxL) {
  if (j.tr && typeof j.tr === 'object') {
    const n = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d), t = j.tr;
    c.tr = { s: n(t.s, 1, 0.05, 4), w: n(t.w, 1, 0.05, 4), h: n(t.h, 1, 0.05, 4), x: n(t.x, 0, -2, 2), y: n(t.y, 0, -2, 2),
      cl: n(t.cl, 0, 0, 0.98), cr: n(t.cr, 0, 0, 0.98), ct: n(t.ct, 0, 0, 0.98), cb: n(t.cb, 0, 0, 0.98) };
    if (c.tr.cl + c.tr.cr > 0.98) c.tr.cr = 0.98 - c.tr.cl;
    if (c.tr.ct + c.tr.cb > 0.98) c.tr.cb = 0.98 - c.tr.ct;
    clipTrTidy(c);
  }
  if (Array.isArray(j.fx) && j.fx.length) c.fx = fxL(j.fx);
}
// Every clip's effect chain, for the places that look effects up (MIDI, shader renames).
function clipChains() {
  const out = [];
  comp.layers.forEach(L => L.clips.forEach(c => { if (c && c.fx && c.fx.length) out.push([L.name + ' > ' + c.name, c.fx]); }));
  return out;
}
// The fields, shared by the desktop Clip tab and the phone's clip sheet: [label, min, max, step, get, set, format] rows.
function clipTrFields(c) {
  const g = k => () => (c.tr ? c.tr[k] : TR_ID[k]), pct = v => Math.round(v * 100) + '%', pos = v => v.toFixed(2);
  const set = k => v => { clipTr(c)[k] = v; };
  // opposite crops never meet: at least 2 % of the picture stays
  const crop = (k, other) => v => { const t = clipTr(c); t[k] = Math.min(v, 0.98 - t[other]); };
  return [
    ['Size', 0.05, 4, 0.01, g('s'), set('s'), pct], ['Width', 0.05, 4, 0.01, g('w'), set('w'), pct], ['Height', 0.05, 4, 0.01, g('h'), set('h'), pct],
    ['Position X', -1, 1, 0.001, g('x'), set('x'), pos], ['Position Y', -1, 1, 0.001, g('y'), set('y'), pos],
    ['Crop left', 0, 0.98, 0.001, g('cl'), crop('cl', 'cr'), pct], ['Crop right', 0, 0.98, 0.001, g('cr'), crop('cr', 'cl'), pct],
    ['Crop top', 0, 0.98, 0.001, g('ct'), crop('ct', 'cb'), pct], ['Crop bottom', 0, 0.98, 0.001, g('cb'), crop('cb', 'ct'), pct]];
}
// Clip tab (ui.js renderProps, every kind of clip)
function clipLookUI(c) {
  const box = el('div', null, el('h4', { textContent: 'Size, position and crop' }));
  clipTrFields(c).forEach(r => box.append(fld(...r)));
  box.append(el('div', { className: 'fld' },
    el('button', { textContent: 'Reset', title: 'Full size, centred, nothing cropped', onclick: () => { delete c.tr; ui.propsDirty = true; } }),
    el('button', { textContent: 'Fit to crop', title: 'Enlarge and centre what is left after cropping so it fills the frame again', onclick: () => { clipFillCrop(c); ui.propsDirty = true; } })));
  return box;
}
// Zoom into the cropped part: it fills the frame (as far as its shape allows) and sits in the middle.
function clipFillCrop(c) {
  const t = c.tr;
  if (!t) return;
  const kw = 1 - t.cl - t.cr, kh = 1 - t.ct - t.cb;
  t.s = Math.min(4, 1 / Math.max(kw, kh)); t.w = t.h = 1;
  t.x = (t.cr - t.cl) / 2 * t.s; t.y = (t.ct - t.cb) / 2 * t.s;
}

// Called every frame (vjTick): keeps the playing video clips inside their in / out points, and in time when beat-synced.
function clipOptsTick() {
  comp.layers.forEach((L, li) => {
    const c = L.clips[L.active], v = c && c.video;
    if (!v || c.type !== 'video' || !c.ready) return;
    const custom = clipCustom(c);
    v.loop = !custom;   // the browser's own loop is the smoothest when nothing is set
    if (!custom || !clipDur(c)) return;
    const a = clipStart(c), b = Math.max(a + 0.05, clipEnd(c)), len = b - a, t = v.currentTime;
    const mode = c.loopMode || 'loop';
    if (t < a - 0.1) { v.currentTime = a; return; }
    if (t >= b - 0.02 || v.ended) {
      if (mode === 'loop') { v.currentTime = a; if (v.paused && c.speed > 0) v.play().catch(() => {}); }
      else if (mode === 'hold') { if (!v.paused) v.pause(); c.done = true; }
      else if (mode === 'eject' && !c.done) { c.done = true; eject(li); ui.gridDirty = true; }
      return;
    }
    if (c.syncBeats > 0 && !c.done && comp.bpm > 0) {
      const loopSec = c.syncBeats * 60 / comp.bpm, rate = len / loopSec;
      let cyc = (comp.beats - (c.sync0 ?? comp.beats)) / c.syncBeats;
      if (mode !== 'loop' && cyc >= 1) cyc = 0.999;
      const want = a + (cyc - Math.floor(cyc)) * len;
      let err = want - t;
      if (mode === 'loop') err -= Math.round(err / len) * len;   // the shorter way round the loop
      if (Math.abs(err) > Math.max(0.25, len * 0.15)) { v.currentTime = Math.min(b - 0.03, Math.max(a, want)); return; }
      const r = Math.min(16, Math.max(0.0625, rate * (1 + Math.max(-0.15, Math.min(0.15, err * 0.8)))));
      if (Math.abs(v.playbackRate - r) > r * 0.004) v.playbackRate = r;
      if (v.paused) v.play().catch(() => {});
    }
  });
}

// ---------- Clip tab (ui.js renderProps, video clips) ----------
function videoClipOpts(c, L) {
  const v = c.video, d = () => clipDur(c), sec = f => (f * (d() || 0)).toFixed(2) + 's';
  const box = el('div', null, el('h4', { textContent: 'Clip playback' }));
  const inF = fld('In', 0, 1, 0.001, () => c.inP || 0, f => { c.inP = Math.min(f, (c.outP ?? 1) - 0.01); }, sec);
  const outF = fld('Out', 0, 1, 0.001, () => c.outP ?? 1, f => { c.outP = Math.max(f, (c.inP || 0) + 0.01); }, sec);
  const here = () => (d() ? v.currentTime / d() : 0);
  box.append(inF, outF,
    el('div', { className: 'fld' },
      el('button', { textContent: 'In = here', title: 'Set the in point to the current position', onclick: () => { c.inP = Math.min(here(), (c.outP ?? 1) - 0.01); ui.propsDirty = true; } }),
      el('button', { textContent: 'Out = here', title: 'Set the out point to the current position', onclick: () => { c.outP = Math.max(here(), (c.inP || 0) + 0.01); ui.propsDirty = true; } }),
      el('button', { textContent: 'Reset', title: 'Whole clip, loop, no beat-sync', onclick: () => { delete c.inP; delete c.outP; delete c.loopMode; delete c.syncBeats; v.playbackRate = Math.max(0.0625, c.speed || 1); ui.propsDirty = true; } })),
    el('div', { className: 'fld' }, el('label', { textContent: 'When it ends' }),
      el('select', { onchange: e => { c.loopMode = e.target.value; c.done = false; } }, ...LOOP_MODES.map(([k, n]) => el('option', { value: k, textContent: n, selected: k === (c.loopMode || 'loop') })))),
    el('div', { className: 'fld' }, el('label', { textContent: 'Beat sync', title: 'Stretch the clip (in to out) to last exactly this long at the current tempo' }),
      el('select', { onchange: e => { c.syncBeats = +e.target.value; c.sync0 = comp.beats; if (!c.syncBeats) v.playbackRate = Math.max(0.0625, c.speed || 1); ui.propsDirty = true; } },
        ...SYNC_LENGTHS.map(([k, n]) => el('option', { value: k, textContent: n, selected: k === (c.syncBeats || 0) })))));
  if (c.syncBeats) {
    const len = (clipEnd(c) - clipStart(c)) || 0, rate = len / (c.syncBeats * 60 / comp.bpm);
    box.append(el('div', { className: 'hint', textContent: `${len.toFixed(2)} s of video per ${SYNC_LENGTHS.find(s => s[0] === c.syncBeats)[1]} at ${comp.bpm.toFixed(1)} BPM: plays at ${rate.toFixed(2)}x and follows the tempo. Speed is ignored while beat sync is on.` }));
  }
  return [box];
}
