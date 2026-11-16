// Strodano VJ (web) - track analysis: tempo, beat grid, first bar and waveform data. GPL-3.0.
// analyseTrack() is self-contained on purpose: its source is also handed to a Worker built from a Blob URL,
// which is the only kind of worker that loads when the page runs from file://.
'use strict';
// x: mono samples, sr: sample rate. Returns { ok, bpm, beatLen, grid0, conf, fps, duration, peaks, lows }.
//   grid0    time (s) of a first-beat-of-the-bar; every beat is grid0 + k * beatLen
//   peaks    peak level per frame (fps frames per second), lows: share of that frame's energy below ~150 Hz
//   ok       false when no steady beat was found (bpm and grid0 are then not to be trusted)
function analyseTrack(x, sr) {
  const hop = Math.max(1, Math.round(sr / 200)), fps = sr / hop, n = Math.floor(x.length / hop);
  const peaks = new Float32Array(n), lows = new Float32Array(n), eF = new Float32Array(n), eL = new Float32Array(n);
  const res = { ok: false, bpm: 120, beatLen: 0.5, grid0: 0, conf: 0, fps, duration: x.length / sr, peaks, lows };
  const k = 1 - Math.exp(-2 * Math.PI * 150 / sr);
  let l1 = 0, l2 = 0;
  for (let i = 0; i < n; i++) {
    let ef = 0, el = 0, pk = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) {
      const s = x[j], a = s < 0 ? -s : s;
      l1 += k * (s - l1); l2 += k * (l1 - l2);
      ef += s * s; el += l2 * l2;
      if (a > pk) pk = a;
    }
    eF[i] = Math.sqrt(ef / hop); eL[i] = Math.sqrt(el / hop);
    peaks[i] = pk; lows[i] = Math.min(1, eL[i] / (eF[i] + 1e-6));
  }
  if (n < fps * 8) return res;

  // Onset strength: how much the (smoothed, log) energy rose, bass counted double.
  const on = new Float32Array(n), onL = new Float32Array(n);
  const sm = (e, i) => (e[i] + e[i - 1] + e[i - 2] + e[i - 3]) * 0.25;
  for (let i = 5; i < n; i++) {
    const dl = Math.log(1 + 80 * sm(eL, i)) - Math.log(1 + 80 * sm(eL, i - 2));
    const df = Math.log(1 + 80 * sm(eF, i)) - Math.log(1 + 80 * sm(eF, i - 2));
    onL[i] = dl > 0 ? dl : 0;
    on[i] = onL[i] + 0.5 * (df > 0 ? df : 0);
  }
  // The busiest stretch of the track: tempo is first estimated there, away from beatless intros.
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + on[i];
  const win = (secs) => {
    const len = Math.min(n, Math.round(secs * fps)), step = Math.max(1, Math.round(2 * fps));
    let best = -1, a = 0;
    for (let s = 0; s + len <= n; s += step) { const v = pre[s + len] - pre[s]; if (v > best) { best = v; a = s; } }
    return [a, len];
  };

  // Coarse tempo from the autocorrelation of 60 s, preferring tempos near 125 BPM to settle half / double.
  const [a0, len0] = win(60);
  const mean = (pre[a0 + len0] - pre[a0]) / len0;
  const minLag = Math.round(fps * 60 / 200), maxLag = Math.round(fps * 60 / 60);
  const ac = new Float32Array(2 * maxLag + 2);
  for (let lag = minLag; lag <= 2 * maxLag && lag < len0; lag++) {
    let s = 0;
    for (let i = a0, e = a0 + len0 - lag; i < e; i++) s += (on[i] - mean) * (on[i + lag] - mean);
    ac[lag] = s / (len0 - lag);
  }
  let T = 0, bestSc = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const o = Math.log2(60 * fps / lag / 125) / 0.6, sc = (ac[lag] + 0.5 * ac[2 * lag]) * Math.exp(-0.5 * o * o);
    if (sc > bestSc) { bestSc = sc; T = lag; }
  }
  if (!(bestSc > 0)) return res;

  // Fold the onsets onto one beat of length T frames: a sharp peak means T is right, and its place is the beat phase.
  function fold(T, a, len, B) {
    const acc = new Float64Array(B), inv = 1 / T;
    for (let i = a, e = a + len; i < e; i++) { const ph = i * inv; acc[((ph - Math.floor(ph)) * B) | 0] += on[i]; }
    let sum = 0, best = -1, bi = 0;
    const sv = b => acc[b] + 0.5 * (acc[(b + 1) % B] + acc[(b + B - 1) % B]);
    for (let b = 0; b < B; b++) { sum += acc[b]; const v = sv(b); if (v > best) { best = v; bi = b; } }
    const l = sv((bi + B - 1) % B), r = sv((bi + 1) % B), den = l - 2 * best + r;
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (l - r) / den)) : 0;
    return { score: best / (2 * sum / B + 1e-12), phase: ((bi + 0.5 + d) / B + 1) % 1 };
  }
  // Refine T on longer and longer stretches: each stage's peak is narrower than the last one's step.
  function refine(T, span, steps, a, len, B) {
    let bT = T, bs = -1;
    for (let i = -steps; i <= steps; i++) { const t = T * (1 + span * i / steps), s = fold(t, a, len, B).score; if (s > bs) { bs = s; bT = t; } }
    return bT;
  }
  const [a1, len1] = win(30), [a2, len2] = win(120), [a3, len3] = win(480);
  T = refine(T, 0.012, 24, a1, len1, 16);
  T = refine(T, 0.0008, 16, a2, len2, 16);
  T = refine(T, 0.00012, 12, a3, len3, 32);
  let f = fold(T, a3, len3, 64), bpm = 60 * fps / T;
  // Produced music is nearly always at a whole-number tempo: take it when it fits as well.
  const whole = Math.round(bpm);
  if (Math.abs(bpm - whole) < 0.08) { const Tw = 60 * fps / whole, fw = fold(Tw, a3, len3, 64); if (fw.score >= 0.97 * f.score) { T = Tw; f = fw; bpm = whole; } }

  // First beat of the bar: of the four possible beats, the one that carries the most bass onsets.
  const f0 = f.phase * T, grp = [0, 0, 0, 0];
  for (let b = 0; ; b++) {
    const c = Math.round(f0 + b * T);
    if (c + 3 >= n) break;
    let v = 0;
    for (let i = Math.max(0, c - 2); i <= c + 2; i++) if (onL[i] > v) v = onL[i];
    grp[b & 3] += v;
  }
  let d = 0;
  for (let i = 1; i < 4; i++) if (grp[i] > grp[d]) d = i;
  if (grp[d] < 1.08 * (grp[0] + grp[1] + grp[2] + grp[3]) / 4) d = 0;
  const beatLen = T / fps;
  // An onset is seen a little under one frame after the attack that caused it (energy smoothing above).
  let grid0 = (f0 - 0.7) / fps + d * beatLen;
  while (grid0 < -0.05) grid0 += 4 * beatLen;   // a track that starts right on the beat may land a few ms below zero
  res.ok = f.score > 1.6; res.conf = f.score; res.bpm = bpm; res.beatLen = beatLen; res.grid0 = grid0;
  return res;
}

// Run analyseTrack off the main thread; falls back to running it here if the worker cannot start.
function analyseAsync(mono, sr) {
  return new Promise(resolve => {
    const local = () => setTimeout(() => resolve(analyseTrack(mono, sr)), 0);
    let w, url;
    const done = () => { try { w.terminate(); } catch (e) {} URL.revokeObjectURL(url); };
    try {
      url = URL.createObjectURL(new Blob([analyseTrack.toString(),
        '\nonmessage = e => { const r = analyseTrack(e.data.x, e.data.sr); postMessage(r, [r.peaks.buffer, r.lows.buffer]); };'], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (e) { local(); return; }
    w.onmessage = e => { done(); resolve(e.data); };
    w.onerror = () => { done(); local(); };
    w.postMessage({ x: mono, sr });   // copied, not transferred: the fallback above still needs it
  });
}
