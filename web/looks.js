// Strodano VJ (web) - looks: the state of the visuals, captured and recalled with a glide. GPL-3.0.
// Snapshots (snapshots.js, F1-F8) store looks; Strodano VJ Pro's section and segment looks use the same format.
// A look: which clip each layer plays, layer opacity and bypass, and every effect's parameters, mix and on/off
// (matched by the effect's uid, so it survives reordering). Numbers glide in over lookGlide.morph beats (0, 1, 4 or 8).
'use strict';
const lookGlide = { morph: 4, tweens: [], t0: 0 };
function captureLook() {
  const fx = ch => ch.map(e => ({ uid: e.uid, params: e.params.slice(), mix: e.mix, bypass: e.bypass }));
  return { layers: comp.layers.map(L => ({ active: L.active, opacity: L.opacity, bypass: L.bypass, fx: fx(L.fx) })), fx: fx(comp.fx) };
}
// Apply a look. Clips switch through trigger() (so clip transitions and the beat quantise apply); numbers glide over
// lookGlide.morph beats.
function recallLook(look) {
  if (!look) return;
  lookGlide.tweens = [];
  const glide = (obj, key, to) => { if (typeof to === 'number' && obj[key] !== to) lookGlide.tweens.push({ obj, key, from: obj[key], to }); };
  const fx = (chain, saved) => (saved || []).forEach(sv => {
    const e = chain.find(x => x.uid === sv.uid);
    if (!e) return;
    e.bypass = !!sv.bypass;
    glide(e, 'mix', sv.mix);
    sv.params.forEach((v, k) => { if (k < e.params.length) glide(e.params, k, v); });
  });
  look.layers.forEach((sv, li) => {
    const L = comp.layers[li];
    if (!L || L.locked) return;   // locked layers keep what you set (agent.js layerLocked)
    if (sv.active !== L.active) { if (sv.active < 0 || !L.clips[sv.active]) eject(li); else trigger(li, sv.active); }
    L.bypass = !!sv.bypass;
    glide(L, 'opacity', sv.opacity);
    fx(L.fx, sv.fx);
  });
  fx(comp.fx, look.fx);
  lookGlide.t0 = comp.beats;
  if (!lookGlide.morph) tickTweens();
  ui.gridDirty = ui.propsDirty = true;
}
function tickTweens() {
  if (!lookGlide.tweens.length) return;
  const p = lookGlide.morph ? Math.min(1, Math.max(0, (comp.beats - lookGlide.t0) / lookGlide.morph)) : 1;
  for (const t of lookGlide.tweens) t.obj[t.key] = t.from + (t.to - t.from) * p;
  if (p >= 1) { lookGlide.tweens = []; ui.propsDirty = true; }
}
// A saved look, checked field by field (it can come from a shared .svj file). null if it is not a look.
function lookFromJSON(l) {
  if (!l || !Array.isArray(l.layers)) return null;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const fx = a => (Array.isArray(a) ? a : []).filter(e => e && typeof e.uid === 'string').map(e => ({ uid: e.uid, params: (Array.isArray(e.params) ? e.params : []).slice(0, 8).map(v => num(v, 0)), mix: num(e.mix, 1), bypass: !!e.bypass }));
  return { layers: l.layers.map(x => ({ active: num(x && x.active, -1) | 0, opacity: num(x && x.opacity, 1), bypass: !!(x && x.bypass), fx: fx(x && x.fx) })), fx: fx(l.fx) };
}
