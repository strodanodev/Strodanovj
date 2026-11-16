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
  res.rms = eF;   // per-frame level, the same measure the live listener uses (track recognition, follow.js)

  // ---- loudness and energy ----
  // Loudness of the loud part (frames above -40 dB), used to bring every track to the same level.
  let ls = 0, ln = 0, fl = 0;
  for (let i = 0; i < n; i++) if (eF[i] > 0.01) { ls += eF[i] * eF[i]; ln++; fl += on[i]; }
  res.loudDb = ln ? 10 * Math.log10(ls / ln) : -60;
  res.flux = ln ? fl / ln * fps : 0;   // onset strength per second: busier tracks score higher

  // ---- bars: where the beat starts and ends, where the body of the track ends ----
  if (res.ok) {
    const barLen = 4 * beatLen, nb = Math.floor((res.duration - grid0) / barLen);
    const bRms = new Float32Array(Math.max(0, nb)), bOn = new Float32Array(Math.max(0, nb));
    for (let b = 0; b < nb; b++) {
      const a = Math.max(0, Math.round((grid0 + b * barLen) * fps)), e = Math.min(n, Math.round((grid0 + (b + 1) * barLen) * fps));
      let s = 0, o = 0;
      for (let i = a; i < e; i++) { s += eF[i] * eF[i]; o += onL[i]; }
      bRms[b] = Math.sqrt(s / Math.max(1, e - a)); bOn[b] = o / Math.max(1, e - a);
    }
    const med = arr => { const s = Array.from(arr).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };
    const loud = bOn.filter((v, b) => bRms[b] > 0.01), onMed = med(loud);
    const beaty = b => bOn[b] >= 0.35 * onMed && bRms[b] > 0.01;
    let first = 0, last = nb - 1;
    while (first < nb && !beaty(first)) first++;
    while (last > first && !beaty(last)) last--;
    if (first < nb && last - first >= 8) {
      // body end: the last bar still near full level (scanning back from the end), so a quieter outro is left for the mix
      const rmsMed = med(bRms.slice(first, last + 1)), beatEnd = last + 1;
      let body = last;
      while (body > first && bRms[body] < 0.85 * rmsMed) body--;
      body++;
      // mixes start on a phrase (8 bars) counted from the first beat, and need 8 bars of beat after them
      let out = first + 8 * Math.round((body - first) / 8);
      if (out + 8 > beatEnd) out = first + 8 * Math.floor((beatEnd - 8 - first) / 8);
      if (out < first + 8) out = Math.max(first, beatEnd - 8);
      res.mixIn = grid0 + first * barLen;
      res.mixOut = grid0 + out * barLen;
      res.beatEnd = grid0 + beatEnd * barLen;

      // ---- sections ----
      // Per bar: kick = the bass jump on each beat above the bar's own average (sustained bass does not count), and
      // floor = the level between hits (bassline, pads). A drop has both, over a whole 4-bar block (counted from the
      // first beat). Before the first drop is the intro, after the last one the outro, between drops a breakdown; the
      // rising stretch that leads into a drop is the build.
      const kick = new Float32Array(nb), floor = new Float32Array(nb);
      for (let b = 0; b < nb; b++) {
        const a = Math.max(0, Math.round((grid0 + b * barLen) * fps)), e = Math.min(n, Math.round((grid0 + (b + 1) * barLen) * fps));
        if (e - a < 8) continue;
        let mean = 0;
        for (let i = a; i < e; i++) mean += onL[i];
        mean /= e - a;
        let k = 0;
        for (let q = 0; q < 4; q++) {
          const c = Math.round((grid0 + (4 * b + q) * beatLen) * fps) + 1;
          let m = 0;
          for (let i = Math.max(0, c - 2); i <= Math.min(n - 1, c + 3); i++) if (onL[i] > m) m = onL[i];
          k += m;
        }
        kick[b] = Math.max(0, k / 4 - mean);
        floor[b] = Array.from(eF.subarray(a, e)).sort((p, q) => p - q)[Math.floor((e - a) * 0.2)];
      }
      const kMed = med(kick.slice(first, last + 1)) || 1, fMed = med(floor.slice(first, last + 1)) || 1;
      const lab = new Array(nb).fill('');
      const blocks = [];
      for (let b0 = first; b0 < beatEnd; b0 += 4) {
        const e = Math.min(b0 + 4, beatEnd);
        let k = 0, f = 0;
        for (let b = b0; b < e; b++) { k += kick[b]; f += floor[b]; }
        k /= (e - b0) * kMed; f /= (e - b0) * fMed;
        blocks.push({ a: b0, e, drop: k >= 0.5 && f >= 0.6 });
      }
      const drops = blocks.filter(x => x.drop);
      if (!drops.length) {   // no clear drop (ambient, live recording...): the body between the mix points is the main part
        for (let b = 0; b < nb; b++) lab[b] = b < first ? 'intro' : b >= out ? 'outro' : 'drop';
      } else {
        const d0 = drops[0].a, d1 = drops[drops.length - 1].e;
        for (let b = 0; b < nb; b++) lab[b] = b < d0 ? 'intro' : b >= d1 ? 'outro' : 'breakdown';
        for (const x of drops) for (let b = x.a; b < x.e; b++) lab[b] = 'drop';
        // build: before each drop, the bars with little kick whose level keeps rising into it (at most 16, else the last 4)
        for (const x of drops) {
          const j = x.a - 1;
          if (j < 0 || lab[j] === 'drop' || kick[j] >= 0.5 * kMed) continue;
          let s = j;
          while (s > 0 && j - s < 15 && lab[s - 1] !== 'drop' && kick[s - 1] < 0.5 * kMed && bRms[s - 1] <= bRms[s] * 1.02) s--;
          if (j - s < 1) s = Math.max(j - 3, 0);
          while (s <= j && lab[s] === 'drop') s++;
          for (let b = s; b <= j; b++) lab[b] = 'build';
        }
      }
      res.barLen = barLen;
      res.sections = [];
      for (let b = 0; b < nb; b++) {
        const cur = res.sections[res.sections.length - 1];
        if (cur && cur.type === lab[b]) { cur.bars++; continue; }
        res.sections.push({ type: lab[b], bar: b, bars: 1 });
      }
      for (const s of res.sections) { s.t = grid0 + s.bar * barLen; s.end = s.t + s.bars * barLen; }
    }
  }
  if (res.mixIn === undefined) { res.mixIn = res.ok ? Math.max(0, grid0) : 0; res.mixOut = Math.max(0, res.duration - 20); res.beatEnd = res.duration; }

  // ---- key ----
  // Chroma from 8192-point spectra of the signal at about 11 kHz, compared with the Krumhansl key profiles.
  const dsf = Math.max(1, Math.round(sr / 11025)), fs2 = sr / dsf, N = 8192, half = N >> 1;
  const m2 = Math.floor(x.length / dsf);
  if (m2 >= N * 4) {
    const re = new Float64Array(N), im = new Float64Array(N), win = new Float64Array(N), chroma = new Float64Array(12);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const bitrev = new Uint32Array(N);
    for (let i = 0, j = 0; i < N; i++) { bitrev[i] = j; let bit = half; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit; }
    const binPc = new Int8Array(half), lo = Math.ceil(65 / fs2 * N), hi = Math.min(half - 1, Math.floor(2100 / fs2 * N));
    for (let k = 0; k < half; k++) binPc[k] = k >= lo && k <= hi ? ((Math.round(12 * Math.log2(k * fs2 / N / 440)) + 69) % 12 + 12) % 12 : -1;
    const frames = Math.floor(m2 / N), stride = Math.max(1, Math.floor(frames / 400));   // at most ~400 spectra
    const fc = new Float64Array(12);
    for (let fr = 0; fr < frames; fr += stride) {
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let j = (fr * N + i) * dsf, e = j + dsf; j < e; j++) s += x[j];
        const r = bitrev[i]; re[r] = s / dsf * win[i]; im[r] = 0;
      }
      for (let size = 2; size <= N; size <<= 1) {
        const h = size >> 1, ang = -2 * Math.PI / size, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let st = 0; st < N; st += size) {
          let cr = 1, ci = 0;
          for (let k = 0; k < h; k++) {
            const a = st + k, b = a + h, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
            const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
      fc.fill(0);
      let mx = 0;
      for (let k = lo; k <= hi; k++) { const pc = binPc[k]; if (pc >= 0) fc[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]); }
      for (let p = 0; p < 12; p++) if (fc[p] > mx) mx = fc[p];
      if (mx > 1e-3) for (let p = 0; p < 12; p++) chroma[p] += fc[p] / mx;   // every spectrum counts the same, loud or quiet
    }
    const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const corr = (prof, root) => {
      let ma = 0, mb = 0;
      for (let p = 0; p < 12; p++) { ma += chroma[p]; mb += prof[p]; }
      ma /= 12; mb /= 12;
      let sab = 0, saa = 0, sbb = 0;
      for (let p = 0; p < 12; p++) { const a = chroma[(p + root) % 12] - ma, b = prof[p] - mb; sab += a * b; saa += a * a; sbb += b * b; }
      return sab / Math.sqrt(saa * sbb + 1e-12);
    };
    let best = -2, second = -2, bk = 0, bm = false;
    for (let r = 0; r < 12; r++) for (const minor of [false, true]) {
      const c = corr(minor ? MIN : MAJ, r);
      if (c > best) { second = best; best = c; bk = r; bm = minor; } else if (c > second) second = c;
    }
    { const mx = Math.max(...chroma) || 1; res.chroma = Array.from(chroma, v => +(v / mx).toFixed(4)); }   // harmonic fingerprint (follow.js)
    if (best > 0.5) {
      const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
      res.key = NAMES[bk] + (bm ? 'm' : '');
      res.camelot = ((bk * 7) % 12 + (bm ? 4 : 7)) % 12 + 1 + (bm ? 'A' : 'B');
      res.keyConf = best - second;
    }
  }
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
        '\nonmessage = e => { const r = analyseTrack(e.data.x, e.data.sr); postMessage(r, [r.peaks.buffer, r.lows.buffer].concat(r.rms ? [r.rms.buffer] : [])); };'], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (e) { local(); return; }
    w.onmessage = e => { done(); resolve(e.data); };
    w.onerror = () => { done(); local(); };
    w.postMessage({ x: mono, sr });   // copied, not transferred: the fallback above still needs it
  });
}
