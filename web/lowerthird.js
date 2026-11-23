// Strodano VJ (web) - lower thirds: title templates that can name the playing track and show its cover. GPL-3.0.
// A lower third is a clip like text: put it on a layer above the visuals. What it says comes from the track that is
// playing (title, artist and cover read from the file's own tags; the file name when it has none) or from your own lines.
// A title is drawn once into a canvas as four pictures stacked in one texture (plate, artwork, title, second line); the
// GPU moves, fades and wipes each of them every frame, so the animations, a change of title and the sliders cost nothing
// to redraw. Two titles are on the GPU while one hands over to the next.
'use strict';

// ---------- a track's own tags: title, artist, cover ----------
const L3_ID3 = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album' };
const l3U32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const l3L32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const l3Syn = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
const l3Asc = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const l3Bytes = async (f, a, b) => new Uint8Array(await f.slice(a, Math.min(b, f.size)).arrayBuffer());
function l3Str(b, enc) {
  if (enc === 1 && b[0] === 0xFE && b[1] === 0xFF) enc = 2;
  try { return new TextDecoder(['latin1', 'utf-16le', 'utf-16be', 'utf-8'][enc] || 'latin1').decode(b).split('\0')[0].trim(); } catch (e) { return ''; }
}
function l3Unsync(b) {
  const o = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) { o[n++] = b[i]; if (b[i] === 0xFF && b[i + 1] === 0) i++; }
  return o.subarray(0, n);
}
// ID3v2.2 / 2.3 / 2.4 (MP3, and the ID3 chunk of WAV and AIFF). b starts at the "ID3" header.
function l3Id3(b, out) {
  const ver = b[3], hl = ver === 2 ? 6 : 10;
  let d = b.subarray(10, Math.min(b.length, 10 + l3Syn(b, 6))), o = 0;
  if (ver < 4 && b[5] & 0x80) d = l3Unsync(d);
  if (ver > 2 && b[5] & 0x40) o = ver === 4 ? l3Syn(d, 0) : 4 + l3U32(d, 0);
  const idOk = p => p + hl > d.length || !d[p] || /^[A-Z0-9]{3,4}$/.test(l3Asc(d, p, hl === 6 ? 3 : 4));
  while (o + hl <= d.length && d[o]) {
    const id = l3Asc(d, o, ver === 2 ? 3 : 4);
    let n = ver === 2 ? (d[o + 3] << 16) | (d[o + 4] << 8) | d[o + 5] : l3U32(d, o + 4);
    // 2.4 sizes are 7 bits a byte, but some writers (old iTunes) wrote plain ones: take the reading the next frame agrees with
    if (ver === 4) { const s = l3Syn(d, o + 4); if (idOk(o + hl + s) || !idOk(o + hl + n)) n = s; }
    const fl = ver === 4 ? d[o + 9] : 0;
    o += hl;
    if (n <= 0 || o + n > d.length) break;
    let v = d.subarray(o, o + n);
    o += n;
    if (fl & 1) v = v.subarray(4);
    if (fl & 2) v = l3Unsync(v);
    const key = L3_ID3[id];
    if (key) { if (!out[key]) out[key] = l3Str(v.subarray(1), v[0]); continue; }
    if (id !== 'APIC' && id !== 'PIC') continue;
    let p = 1;
    if (id === 'PIC') p = 4; else { while (p < v.length && v[p]) p++; p++; }
    const front = v[p++] === 3;
    if (v[0] === 1 || v[0] === 2) { while (p + 1 < v.length && (v[p] || v[p + 1])) p += 2; p += 2; } else { while (p < v.length && v[p]) p++; p++; }
    if (p < v.length && (!out.pic || (front && !out.front))) { out.pic = new Blob([v.subarray(p)]); out.front = front; }
  }
}
// MP4 / M4A: moov > udta > meta > ilst. The moov box can sit after the audio, so the top level is walked box by box.
async function l3Mp4(f, out) {
  let o = 0, m = null;
  while (o + 8 <= f.size) {
    const h = await l3Bytes(f, o, o + 16);
    let n = l3U32(h, 0), hl = 8;
    if (n === 1) { n = l3U32(h, 8) * 4294967296 + l3U32(h, 12); hl = 16; } else if (n === 0) n = f.size - o;
    if (n < hl) return;
    if (l3Asc(h, 4, 4) === 'moov') { if (n < 48e6) m = await l3Bytes(f, o + hl, o + n); break; }
    o += n;
  }
  if (!m) return;
  const find = (a, e, name) => { for (let p = a; p + 8 <= e;) { const n = l3U32(m, p); if (n < 8) break; if (l3Asc(m, p + 4, 4) === name) return [p + 8, Math.min(e, p + n)]; p += n; } return null; };
  let r = find(0, m.length, 'udta');
  r = r && find(r[0], r[1], 'meta');
  r = r && find(r[0] + 4, r[1], 'ilst');
  if (!r) return;
  for (let p = r[0]; p + 8 <= r[1];) {
    const n = l3U32(m, p), id = l3Asc(m, p + 4, 4);
    if (n < 8) break;
    const dt = find(p + 8, p + n, 'data');
    if (dt) {
      const v = m.subarray(dt[0] + 8, dt[1]), key = { '\xA9nam': 'title', '\xA9ART': 'artist', '\xA9alb': 'album' }[id];
      if (key) out[key] = l3Str(v, 3); else if (id === 'covr' && !out.pic) out.pic = new Blob([v]);
    }
    p += n;
  }
}
// FLAC: the Vorbis comment block and the first picture block. o = where "fLaC" starts.
async function l3Flac(f, out, o) {
  o += 4;
  for (let last = false; !last && o + 4 <= f.size;) {
    const h = await l3Bytes(f, o, o + 4), n = (h[1] << 16) | (h[2] << 8) | h[3], type = h[0] & 127;
    last = !!(h[0] & 128);
    o += 4;
    if (type === 4) {
      const b = await l3Bytes(f, o, o + n);
      let p = 4 + l3L32(b, 0);
      const cnt = l3L32(b, p);
      p += 4;
      for (let i = 0; i < cnt && p + 4 <= b.length; i++) {
        const l = l3L32(b, p), s = l3Str(b.subarray(p + 4, p + 4 + l), 3), q = s.indexOf('='), key = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album' }[s.slice(0, q).toUpperCase()];
        if (key && !out[key]) out[key] = s.slice(q + 1).trim();
        p += 4 + l;
      }
    } else if (type === 6 && !out.pic) {
      const b = await l3Bytes(f, o, o + n);
      let p = 8 + l3U32(b, 4);
      p += 4 + l3U32(b, p) + 16;
      out.pic = new Blob([b.subarray(p + 4, p + 4 + l3U32(b, p))]);
    }
    o += n;
  }
}
// WAV (RIFF, little-endian sizes) and AIFF (FORM, big-endian): an ID3 chunk, or WAV's own LIST INFO names.
async function l3Riff(f, out, big) {
  for (let o = 12; o + 8 <= f.size;) {
    const h = await l3Bytes(f, o, o + 8), n = big ? l3U32(h, 4) : l3L32(h, 4), id = l3Asc(h, 0, 4);
    if (id.toLowerCase() === 'id3 ') { l3Id3(await l3Bytes(f, o + 8, o + 8 + n), out); return; }
    if (id === 'LIST' && !big) {
      const b = await l3Bytes(f, o + 8, o + 8 + Math.min(n, 65536));
      if (l3Asc(b, 0, 4) === 'INFO') for (let p = 4; p + 8 <= b.length;) {
        const l = l3L32(b, p + 4), key = { INAM: 'title', IART: 'artist', IPRD: 'album' }[l3Asc(b, p, 4)];
        if (key && !out[key]) out[key] = l3Str(b.subarray(p + 8, p + 8 + l), 3);
        p += 8 + l + (l & 1);
      }
    }
    o += 8 + n + (n & 1);
  }
}
// {title, artist, album, pic: Blob} - whatever the file carries; empty for a file with no tags or a format not read here.
async function l3Tags(f) {
  const out = {};
  try {
    const h = await l3Bytes(f, 0, 12), sig = l3Asc(h, 0, 4);
    if (sig.startsWith('ID3')) {
      const n = 10 + l3Syn(h, 6);
      if (n < 48e6) l3Id3(await l3Bytes(f, 0, n), out);
      if (l3Asc(await l3Bytes(f, n, n + 4), 0, 4) === 'fLaC') await l3Flac(f, out, n);
    } else if (sig === 'fLaC') await l3Flac(f, out, 0);
    else if (sig === 'RIFF' || sig === 'FORM') await l3Riff(f, out, sig === 'FORM');
    else if (l3Asc(h, 4, 4) === 'ftyp') await l3Mp4(f, out);
  } catch (e) {}
  return out;
}
// "03 - Artist - Title (Official Video).mp3" -> artist and title, for files without tags.
function l3NameParts(name) {
  const s = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').replace(/\s*[\[(](official|free|lyrics?|audio|video|hq|hd|visuali[sz]er)[^\])]*[\])]/ig, '')
    .replace(/^\d{1,3}\s*[.\-]\s+/, '').replace(/\s+/g, ' ').trim();
  const i = s.indexOf(' - ');
  return i > 0 ? { artist: s.slice(0, i).trim(), title: s.slice(i + 3).trim() } : { artist: '', title: s };
}
// A picture as a square canvas: a cover fills it, your own picture (a logo) is fitted inside it.
let l3ArtSeq = 0;
async function l3Square(src, n = 512, inside = false) {
  const img = new Image(), url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight, cv = document.createElement('canvas'), x = cv.getContext('2d');
    if (!w || !h) throw new Error('empty picture');
    cv.width = cv.height = n;
    x.imageSmoothingQuality = 'high';
    if (inside) { const s = n / Math.max(w, h); x.drawImage(img, (n - w * s) / 2, (n - h * s) / 2, w * s, h * s); }
    else { const s = Math.min(w, h); x.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, n, n); }
    cv.aid = ++l3ArtSeq;
    return cv;
  } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
}
// What is known about a track, kept for the last 24: the file name's guess at once, the tags and cover when they are read.
const l3Known = new Map();
const l3FileKey = f => f.name + '|' + f.size + '|' + f.lastModified;
function l3MetaOf(tr) {
  const k = l3FileKey(tr.file);
  let m = l3Known.get(k);
  if (m) return m;
  m = Object.assign({ art: null, done: false, at: performance.now() }, l3NameParts(tr.name || tr.file.name));
  l3Known.set(k, m);
  if (l3Known.size > 24) l3Known.delete(l3Known.keys().next().value);
  (async () => {
    const tags = await l3Tags(tr.file);
    let pic = tags.pic;
    // the track list may know more (a rekordbox import), and STRODANO's Audius songs have their cover on Audius
    const ct = typeof crate !== 'undefined' && crate.tracks ? crate.tracks.find(t => t.file && (t.file === tr.file || l3FileKey(t.file) === k)) : null;
    if (ct && ct.rb) { tags.title = tags.title || ct.rb.title; tags.artist = tags.artist || ct.rb.artist; }
    if (!pic && typeof audiusMeta === 'function') {
      const a = await audiusMeta(tr.file).catch(() => null);
      if (a) { pic = a.art; tags.title = tags.title || a.title; tags.artist = tags.artist || a.artist; }
    }
    if (tags.title) m.title = tags.title;
    if (tags.artist) m.artist = tags.artist;
    if (pic) try { m.art = await l3Square(pic); } catch (e) {}
    m.done = true;
  })().catch(() => { m.done = true; });
  return m;
}
// The track the audience hears: the deck the visuals follow, else the louder playing deck, a track recognised from the
// line-in, or the music file the listener plays.
function l3Track() {
  if (typeof audio === 'undefined' || !audio.ctx) return null;
  let d = audio.clockDeck && audio.clockDeck.playing ? audio.clockDeck : null;
  if (!d) { const g = x => x.volume * xfGain(x); d = audio.decks.filter(x => x.playing && x.file).sort((a, b) => g(b) - g(a))[0] || null; }
  if (!d && typeof extDeck === 'function') d = extDeck();
  if (d && d.file) return { file: d.file, name: d.name };
  if (typeof live !== 'undefined' && live.src === 'file' && live.file && live.el && !live.el.paused) return { file: live.file, name: live.fileName };
  return null;
}

// ---------- templates ----------
// Sizes are in design units: the frame is 1080 units high. h = the plate's height, ts / ss / ls = title, second line and
// label sizes, inset = room round the artwork, lead = what sits before it, gap = artwork to text, pad = edge to text
// when there is no artwork, padR = room after the text.
const L3_THEMES = {
  bar: { name: 'Clean bar', acc: [1, 0.2, 0.45], h: 128, lead: 8, inset: 0, gap: 26, pad: 30, padR: 40, ts: 44, ss: 26, ls: 15, tw: 800, sw: 500 },
  glass: { name: 'Glass', acc: [0.3, 0.58, 1], h: 148, inset: 16, gap: 22, pad: 36, padR: 42, ts: 42, ss: 25, ls: 15, tw: 700, sw: 500, ar: 18 },
  neon: { name: 'Neon', acc: [0.1, 1, 0.82], h: 140, inset: 16, gap: 24, pad: 32, padR: 38, ts: 42, ss: 25, ls: 15, tw: 800, sw: 600, ar: 4 },
  block: { name: 'Broadcast', acc: [1, 0.78, 0.1], h: 150, inset: 0, gap: 14, pad: 0, padR: 50, tin: 44, ts: 40, ss: 24, ls: 15, tw: 900, sw: 700, font: 'Arial Black', lh: [30, 74, 46] },
  minimal: { name: 'Minimal', acc: [1, 1, 1], h: 120, inset: 10, gap: 32, pad: 26, padR: 80, ts: 46, ss: 26, ls: 15, tw: 800, sw: 400, ar: 10 },
  vinyl: { name: 'Vinyl', acc: [1, 0.45, 0.12], h: 148, inset: 8, gap: 22, pad: 46, padR: 58, ts: 42, ss: 25, ls: 15, tw: 800, sw: 500, disc: true },
  strip: { name: 'Wide strip', acc: [0.16, 0.42, 1], h: 88, inset: 0, gap: 24, pad: 28, padR: 60, ts: 38, ss: 28, ls: 16, tw: 800, sw: 400, wide: true },
  cover: { name: 'Big cover', acc: [0.72, 0.4, 1], h: 230, inset: 0, gap: 34, pad: 44, padR: 52, ts: 52, ss: 30, ls: 17, tw: 800, sw: 500, ar: 14 },
};
const L3_VARIANTS = ['Dark', 'Light', 'Colour'];
const L3_POS = ['Bottom left', 'Bottom centre', 'Bottom right', 'Top left', 'Top centre', 'Top right'];
const L3_ANIMS = ['Slide', 'Wipe', 'Rise', 'Fade', 'Pop', 'Typewriter'];
const L3_IDLE = ['Still', 'Pulse on the beat', 'Shine', 'Float'];
const L3_CHANGE = ['Roll the text', 'Crossfade', 'Out, then in'];
const L3_HOLD = [[0, 'Until the clip stops'], [6, '6 seconds'], [10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds']];
const L3_ART = ['The track\'s cover, else my picture', 'My picture', 'No artwork'];
const L3_PARAMS = [P('Size', 0.5), P('X', 0.5), P('Y', 0.5), P('Hue', 0), P('Opacity', 1), P('Speed', 0.5)];
const L3_MARGIN = 28;   // room round a plate inside its picture, for glows, shadows and slanted edges

const l3Css = (c, a = 1) => `rgba(${c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')},${a})`;
const l3Lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const l3Mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// The cover's own colour: the strongest hue in it, made bright enough to read on a dark plate. null for a grey cover.
function l3Accent(art) {
  if (art.acc !== undefined) return art.acc;
  const cv = document.createElement('canvas'), n = 24;
  cv.width = cv.height = n;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(art, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data, bins = Array.from({ length: 12 }, () => [0, 0, 0]);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), c = mx - Math.min(r, g, b);
    if (c < 0.12 || mx < 0.2 || d[i + 3] < 128) continue;
    const h = (mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4) / 6, w = c * c * mx, bin = bins[Math.floor(h * 12) % 12];
    bin[0] += w; bin[1] += h * w; bin[2] += (c / mx) * w;
  }
  const best = bins.reduce((a, b) => (b[0] > a[0] ? b : a));
  return (art.acc = best[0] < 3 ? null : hsv(best[1] / best[0], Math.min(0.9, Math.max(0.55, best[2] / best[0])), 1));
}
// The colours of a template in one of its three styles. A = the accent: the cover's colour, or the template's own.
function l3Palette(c, T, art) {
  const A = (c.colours === 0 && art && l3Accent(art)) || T.acc, W = [1, 1, 1], K = [0.05, 0.05, 0.07], on = l3Lum(A) > 0.55 ? K : W;
  if (c.variant === 1) {
    const B = [0.96, 0.96, 0.97];
    return { A, B, H: A, bg: l3Css(B, 0.94), fg: l3Css(K), sub: l3Css(K, 0.68), acc: l3Css(l3Lum(A) > 0.4 ? l3Mix(A, K, 0.5) : A), hl: l3Css(A), onHl: l3Css(on), line: l3Css(K, 0.16), veil: l3Css(B, 0.74), shade: W };
  }
  if (c.variant === 2) return { A, B: A, H: on, bg: l3Css(A, 0.95), fg: l3Css(on), sub: l3Css(on, 0.78), acc: l3Css(on), hl: l3Css(on), onHl: l3Css(A), line: l3Css(on, 0.28), veil: l3Css(A, 0.72), shade: A };
  return { A, B: K, H: A, bg: l3Css(K, 0.86), fg: '#fff', sub: l3Css(W, 0.74), acc: l3Css(A), hl: l3Css(A), onHl: l3Css(on), line: l3Css(W, 0.22), veil: l3Css([0.03, 0.03, 0.05], 0.6), shade: [0, 0, 0] };
}
function l3RR(x, px, py, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  x.beginPath();
  if (x.roundRect) { x.roundRect(px, py, w, h, r); return; }
  x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
}
const l3Space = (x, px) => { if ('letterSpacing' in x) x.letterSpacing = px + 'px'; };
function l3Fit(x, s, max) {
  if (!s || x.measureText(s).width <= max) return s;
  let n = s.length;
  while (n > 1 && x.measureText(s.slice(0, n).trimEnd() + '…').width > max) n--;
  return s.slice(0, n).trimEnd() + '…';
}
// The cover as a soft field of its colours, for a plate's background (no canvas filter: Safari has none).
const l3Scratch = [];
function l3Blur(x, art, px, py, w, h) {
  const mk = (i, n) => l3Scratch[i] || (l3Scratch[i] = Object.assign(document.createElement('canvas'), { width: n, height: n }));
  const a = mk(0, 12), b = mk(1, 96), ga = a.getContext('2d'), gb = b.getContext('2d');
  ga.imageSmoothingQuality = gb.imageSmoothingQuality = 'high';
  ga.clearRect(0, 0, 12, 12); ga.drawImage(art, 0, 0, 12, 12);
  gb.clearRect(0, 0, 96, 96); gb.drawImage(a, 0, 0, 96, 96);
  const sw = Math.min(84, 84 * w / h), sh = Math.min(84, 84 * h / w);
  x.drawImage(b, 48 - sw / 2, 48 - sh / 2, sw, sh, px, py, w, h);
}
// A stand-in cover for thumbnails.
let l3Demo = null;
function l3DemoArt() {
  if (l3Demo) return l3Demo;
  const cv = l3Demo = document.createElement('canvas'), x = cv.getContext('2d');
  cv.width = cv.height = 96;
  const g = x.createLinearGradient(0, 0, 96, 96);
  g.addColorStop(0, '#ff3d7f'); g.addColorStop(0.55, '#7a3dff'); g.addColorStop(1, '#22c8ff');
  x.fillStyle = g; x.fillRect(0, 0, 96, 96);
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 5; x.beginPath(); x.arc(48, 48, 24, 0, 7); x.stroke();
  cv.aid = -1;
  return cv;
}
// Draw one title: w = {title, sub, label, art}, k = pixels per design unit. Returns the canvas (four pictures of cw x ch,
// top to bottom: plate, artwork, label + title, second line) and where things are, for the animation.
let l3Meas = null;
function l3Raster(c, w, k, thumb) {
  const T = L3_THEMES[c.theme], id = c.theme, P = l3Palette(c, T, w.art), mir = c.pos % 3 === 2, M = L3_MARGIN, h = T.h;
  const DW = 1080 * comp.w / comp.h, wide = !!T.wide && !thumb, maxW = thumb ? 760 : wide ? DW : DW * (DW < 1300 ? 0.9 : 0.62);
  const fam = c.font || T.font || 'Inter', F = (wt, px) => `${wt} ${px}px "${fam}", system-ui, sans-serif`;
  const up = s => (c.upper ? String(s).toUpperCase() : String(s));
  const g = l3Meas || (l3Meas = document.createElement('canvas').getContext('2d'));
  const art = c.art !== 2 && (w.art || T.disc);   // the vinyl keeps its record without a cover: a plain label
  const as = art ? h - 2 * T.inset : 0, ax = (T.lead || 0) + T.inset;
  const tx = art ? ax + as + T.gap : (T.lead || 0) + T.pad;   // where the text starts, before mirroring
  const avail = Math.max(160, maxW - tx - T.padR - (T.tin || 0));
  let title = up(w.title || ''), sub = up(w.sub || ''), label = String(w.label || '').toUpperCase(), ts = T.ts;
  g.font = F(700, T.ls); l3Space(g, T.ls * 0.16);
  label = l3Fit(g, label, avail);
  const lWid = label ? g.measureText(label).width : 0;
  l3Space(g, 0);
  // one row: label tag, title, then the second line after a dot
  const tagW = id === 'strip' && label ? lWid + 32 : 0, xT0 = tx + (tagW ? tagW + 24 : 0), room = id === 'strip' ? Math.max(200, (wide ? DW * 0.7 : maxW) - xT0) : avail;
  g.font = F(T.tw, ts);
  let tWid = g.measureText(title).width;
  const tMax = id === 'strip' && sub ? room * 0.68 : room;
  if (tWid > tMax) { ts = Math.max(T.ts * 0.7, T.ts * tMax / tWid); g.font = F(T.tw, ts); title = l3Fit(g, title, tMax); tWid = g.measureText(title).width; }
  g.font = F(T.sw, T.ss);
  sub = l3Fit(g, sub, id === 'strip' ? Math.max(80, room - tWid - 44) : room);
  const sWid = sub ? g.measureText(sub).width : 0;
  const lh = T.lh || [T.ls * 1.75, ts * 1.16, T.ss * 1.4], rows = [label ? lh[0] : 0, lh[1], sub ? lh[2] : 0], tot = rows[0] + rows[1] + rows[2], y0 = (h - tot) / 2;
  let yL = y0 + rows[0] / 2, yT = y0 + rows[0] + rows[1] / 2, yS = y0 + rows[0] + rows[1] + rows[2] / 2, xL = tx, xT = tx, xS = tx;
  let W = Math.max(T.minW || h * 1.6, tx + Math.max(tWid, sWid, lWid) + T.padR);
  const slant = y => (y0 + tot - y) * 0.2;   // Broadcast: every block leans on the same line
  if (id === 'strip') { xL = tx + 16; xT = xT0; xS = xT + tWid + 44; yL = yT = yS = h / 2; W = wide ? DW : xT + tWid + (sub ? 44 + sWid : 0) + T.padR; }
  if (id === 'block') {
    const bx = art ? as + T.gap : 0;
    xL = bx + slant(yL) + 16; xT = bx + slant(yT) + 26; xS = bx + slant(yS) + 22;
    W = Math.max(xT + tWid + 40, sub ? xS + sWid + 34 : 0, label ? xL + lWid + 28 : 0) + 4;
  }
  W = Math.min(wide ? DW : maxW, Math.ceil(W));
  k = Math.min(k, 4096 / (W + 2 * M));
  const cw = Math.ceil((W + 2 * M) * k), ch = Math.ceil((h + 2 * M) * k), cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch * 4;
  const x = cv.getContext('2d'), X = (px, pw = 0) => (mir ? W - px - pw : px);
  const layer = (i, fn) => {
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.beginPath(); x.rect(2, i * ch + 2, cw - 4, ch - 4); x.clip();
    x.setTransform(k, 0, 0, k, M * k, i * ch + M * k); fn(); x.restore();
  };
  const glow = (col, blur, dy = 0) => { x.shadowColor = col; x.shadowBlur = blur * k; x.shadowOffsetY = dy * k; };   // shadows ignore the canvas scale
  const txt = (s, px, py, font, fill, sp = 0) => { if (!s) return; x.font = font; l3Space(x, sp); x.fillStyle = fill; x.textAlign = mir ? 'right' : 'left'; x.textBaseline = 'middle'; x.fillText(s, X(px), py); l3Space(x, 0); };
  const fadeX = (stops, a0, a1) => { const gr = x.createLinearGradient(X(a0), 0, X(a1), 0); stops.forEach(([t, col]) => gr.addColorStop(t, col)); return gr; };
  const para = (px, py, pw, ph, fill) => { x.beginPath(); x.moveTo(X(px + slant(py)), py); x.lineTo(X(px + pw + slant(py)), py); x.lineTo(X(px + pw + slant(py + ph)), py + ph); x.lineTo(X(px + slant(py + ph)), py + ph); x.closePath(); x.fillStyle = fill; x.fill(); };
  const soft = () => { if (w.art) { l3Blur(x, w.art, 0, 0, W, h); x.fillStyle = P.veil; } else x.fillStyle = P.bg; x.fillRect(0, 0, W, h); if (!w.art) { x.fillStyle = fadeX([[0, l3Css(P.H, 0.3)], [0.75, l3Css(P.H, 0)]], 0, W); x.fillRect(0, 0, W, h); } };

  layer(0, () => {   // the plate
    if (id === 'bar') { x.fillStyle = P.bg; x.fillRect(0, 0, W, h); x.fillStyle = P.hl; x.fillRect(X(0, T.lead), 0, T.lead, h); }
    else if (id === 'glass') {
      x.save(); l3RR(x, 0, 0, W, h, 30); x.clip(); soft(); x.restore();
      l3RR(x, 0.75, 0.75, W - 1.5, h - 1.5, 30); x.strokeStyle = P.line; x.lineWidth = 1.5; x.stroke();
    } else if (id === 'neon') {
      l3RR(x, 0, 0, W, h, 6); x.globalAlpha = 0.7; x.fillStyle = P.bg; x.fill(); x.globalAlpha = 1;
      glow(P.hl, 20); x.strokeStyle = P.hl; x.lineWidth = 3; l3RR(x, 1.5, 1.5, W - 3, h - 3, 6); x.stroke(); x.stroke();
    } else if (id === 'block') {
      const bx = art ? as + T.gap : 0;
      if (label) para(bx, y0, lWid + 44, rows[0], P.bg);
      para(bx, y0 + rows[0], tWid + 62, rows[1], P.hl);
      if (sub) para(bx, y0 + rows[0] + rows[1], sWid + 54, rows[2], P.bg);
    } else if (id === 'minimal') {
      x.fillStyle = fadeX([[0, l3Css(P.shade, 0)], [0.1, l3Css(P.shade, 0.62)], [0.5, l3Css(P.shade, 0.4)], [1, l3Css(P.shade, 0)]], -M, W + M);
      x.fillRect(-M, -M, W + 2 * M, h + 2 * M);
      const gv = x.createLinearGradient(0, -M, 0, h + M);
      gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(0.3, '#000'); gv.addColorStop(0.7, '#000'); gv.addColorStop(1, 'rgba(0,0,0,0)');
      x.globalCompositeOperation = 'destination-in'; x.fillStyle = gv; x.fillRect(-M, -M, W + 2 * M, h + 2 * M); x.globalCompositeOperation = 'source-over';
      x.fillStyle = P.hl; x.fillRect(X(tx - (art ? T.gap / 2 + 2 : 14), 4), h * 0.16, 4, h * 0.68);
    } else if (id === 'vinyl') {
      l3RR(x, 0, 0, W, h, h / 2); x.fillStyle = P.bg; x.fill();
      l3RR(x, 0.75, 0.75, W - 1.5, h - 1.5, h / 2); x.strokeStyle = P.line; x.lineWidth = 1.5; x.stroke();
    } else if (id === 'strip') {
      x.fillStyle = wide ? fadeX([[0, P.bg], [0.62, P.bg], [1, l3Css(P.B, 0)]], 0, W) : P.bg; x.fillRect(0, 0, W, h);
      x.fillStyle = wide ? fadeX([[0, P.hl], [0.5, P.hl], [0.95, l3Css(P.H, 0)]], 0, W) : P.hl; x.fillRect(0, 0, W, 3);
      if (tagW) { l3RR(x, X(tx, tagW), 20, tagW, h - 40, 5); x.fillStyle = P.hl; x.fill(); }
    } else {   // cover: a plate that starts behind the cover
      const px = art ? as * 0.5 : 0, py = 30, ph = h - 60;
      x.save(); l3RR(x, X(px, W - px), py, W - px, ph, 16); x.clip(); soft(); x.restore();
      l3RR(x, X(px, W - px) + 0.75, py + 0.75, W - px - 1.5, ph - 1.5, 16); x.strokeStyle = P.line; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = P.hl; x.fillRect(X(tx, 64), py + ph - 10, 64, 4);
    }
  });
  let piv = [0.5, 0.5];
  if (art) layer(1, () => {
    const px = X(ax, as), py = T.inset, cx = px + as / 2, cy = py + as / 2, R = as / 2;
    piv = [(M + cx) / (W + 2 * M), 1 - (M + cy) / (h + 2 * M)];
    if (T.disc) {
      x.fillStyle = '#0a0a0c'; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1;
      for (let r = R * 0.64; r < R - 2; r += 3.2) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke(); }
      x.fillStyle = 'rgba(255,255,255,.08)';   // two highlights that turn with the record
      for (const a of [0.5, 0.5 + Math.PI]) { x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R - 1, a - 0.2, a + 0.2); x.closePath(); x.fill(); }
      x.save(); x.beginPath(); x.arc(cx, cy, R * 0.58, 0, 7); x.clip();
      if (w.art) x.drawImage(w.art, cx - R * 0.58, cy - R * 0.58, R * 1.16, R * 1.16);
      else { x.fillStyle = l3Css(P.A); x.fillRect(cx - R, cy - R, 2 * R, 2 * R); x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, R * 0.36, 0, 7); x.stroke(); }
      x.restore();
      x.fillStyle = '#0a0a0c'; x.beginPath(); x.arc(cx, cy, R * 0.07, 0, 7); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.3)'; x.lineWidth = 1; x.beginPath(); x.arc(cx, cy, R - 0.5, 0, 7); x.stroke();
      return;
    }
    const r = T.ar || 0;
    if (id === 'cover') { glow('rgba(0,0,0,.55)', 26, 8); l3RR(x, px, py, as, as, r); x.fillStyle = '#000'; x.fill(); glow('transparent', 0); }
    x.save(); l3RR(x, px, py, as, as, r); x.clip(); x.drawImage(w.art, px, py, as, as); x.restore();
    if (id === 'neon') { glow(P.hl, 14); l3RR(x, px, py, as, as, r); x.strokeStyle = P.hl; x.lineWidth = 2.5; x.stroke(); }
    else if (id === 'block') { x.strokeStyle = P.hl; x.lineWidth = 5; x.strokeRect(px + 2.5, py + 2.5, as - 5, as - 5); }
    else if (r) { l3RR(x, px + 0.5, py + 0.5, as - 1, as - 1, r); x.strokeStyle = 'rgba(255,255,255,.2)'; x.lineWidth = 1; x.stroke(); }
  });
  const bare = id === 'minimal' && c.variant !== 1;   // no plate under the words: a shadow keeps them readable
  layer(2, () => {
    if (bare) glow('rgba(0,0,0,.7)', 12, 2);
    txt(label, xL, yL, F(700, T.ls), id === 'strip' ? P.onHl : id === 'block' ? P.fg : id === 'neon' ? P.sub : P.acc, T.ls * 0.16);
    if (id === 'neon') glow(P.hl, 16);
    txt(title, xT, yT, F(T.tw, ts), id === 'block' ? P.onHl : P.fg);
  });
  if (sub) layer(3, () => {
    if (bare) glow('rgba(0,0,0,.7)', 10, 2);
    if (id === 'strip') { x.fillStyle = P.hl; x.beginPath(); x.arc(X(xS - 22), yS, 4, 0, 7); x.fill(); }
    txt(sub, xS, yS, F(T.sw, T.ss), id === 'neon' ? P.acc : id === 'block' ? P.fg : P.sub);
  });
  const u = px => (M + px) / (W + 2 * M);   // the reach of each picture's content along the plate, for wipes
  return { cv, cw, ch, W, h, M, mir, wide, piv, spin: !!T.disc && !!art, span: [[u(0), u(W)], [u(0), u(W)], [u(Math.min(xL, xT)), u(xT + Math.max(tWid, 1))], [u(xS), u(xS + Math.max(sWid, 1))]] };
}

// ---------- on the GPU ----------
const l3Prog = mkProg(HEAD + `uniform sampler2D tA; uniform sampler2D tB; uniform vec4 rc[2]; uniform vec4 la[8]; uniform vec4 lb[8]; uniform vec4 pv[2];
uniform vec4 fxv; uniform float alpha; uniform vec2 vis; in vec2 uv; out vec4 o;
vec3 hueRot(vec3 c) { const vec3 k = vec3(0.57735); return c * fxv.x + cross(k, c) * fxv.y + k * dot(k, c) * (1.0 - fxv.x); }
// picture i of title k: la = move x, move y, opacity, how far it is wiped in; lb = size, turn, where its content starts and ends
vec4 lay(sampler2D t, int k, int i) {
  vec4 R = rc[k], A = la[k * 4 + i], B = lb[k * 4 + i], P = pv[k];
  if (vis[k] < 0.5 || A.z <= 0.0) return vec4(0.0);
  vec2 q = (uv - R.xy) / R.zw, c0 = i == 1 ? P.xy : vec2(0.5), d = q - A.xy - c0;
  float cs = cos(B.y), sn = sin(B.y);
  d.x *= P.z; d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) / B.x; d.x /= P.z;
  vec2 p = d + c0;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0) return vec4(0.0);
  vec4 c = textureLod(t, vec2(p.x, (p.y + float(3 - i)) * 0.25), 0.0);
  float px = P.w > 0.0 ? p.x : 1.0 - p.x, rx = (px - B.z) / max(B.w - B.z, 1e-4);
  c *= A.z * (1.0 - smoothstep(A.w - 0.06, A.w, rx));
  if (i != 1) c.rgb = hueRot(c.rgb);
  if (i == 0) c.rgb = min(vec3(c.a), c.rgb + c.a * fxv.w * smoothstep(0.1, 0.0, abs(px + (p.y - 0.5) * 0.15 - fxv.z)));
  return c;
}
void main() {
  vec4 acc = vec4(0.0);
  // the two titles' pictures are added before they go over what is below, so a crossfade never dips or doubles
  for (int i = 0; i < 4; i++) { vec4 c = lay(tA, 0, i) + lay(tB, 1, i); c /= max(1.0, c.a); acc = acc * (1.0 - c.a) + c; }
  acc *= alpha;
  o = vec4(acc.rgb / max(acc.a, 1e-4), acc.a);
}`);
const l3LA = new Float32Array(32), l3LB = new Float32Array(32), l3RC = new Float32Array(8), l3PV = new Float32Array(8);

const l3Clamp = x => Math.min(1, Math.max(0, x)), l3Ease = x => 1 - Math.pow(1 - l3Clamp(x), 3), l3Smooth = x => { x = l3Clamp(x); return x * x * (3 - 2 * x); };
const L3_LAG = [0, 0.12, 0.26, 0.38], L3_FULL = 2;   // each picture starts a little after the one before; wipe value of "all of it"
// Where each picture is at t (0 = not there yet, 1 = in place): [move x, move y, opacity, wipe, size]. Played backwards to leave.
function l3Pose(style, t) {
  return L3_LAG.map((lag, i) => {
    const x = l3Clamp((t - lag) / 0.62), e = l3Ease(x);
    if (x <= 0) return [0, 0, 0, L3_FULL, 1];
    if (x >= 1) return [0, 0, 1, L3_FULL, 1];
    if (style === 0) return [-(1 - e) * [0.2, 0.12, 0.07, 0.07][i], 0, Math.min(1, x * 2.5), i ? L3_FULL : e * 1.25, 1];
    if (style === 1) return [0, 0, 1, e * 1.25, 1];
    if (style === 2) return [0, -(1 - e) * [0.4, 0.4, 0.28, 0.28][i], Math.min(1, x * 2), L3_FULL, 1];
    if (style === 4) { const u = x - 1; return [0, 0, Math.min(1, x * 3), L3_FULL, 0.82 + 0.18 * (1 + 2.70158 * u * u * u + 1.70158 * u * u)]; }
    if (style === 5) return i < 2 ? [0, 0, e, L3_FULL, 1] : [0, 0, 1, x * 1.25, 1];
    return [0, 0, l3Smooth(x), L3_FULL, 1];
  });
}
// One title handing over to the next, t 0..1: [the old one's pictures, the new one's].
function l3Handover(mode, t, style, dOut, dIn) {
  if (mode === 2) { const s = t * (dOut + dIn); return [l3Pose(style, 1 - s / dOut), l3Pose(style, (s - dOut) / dIn)]; }
  const s = l3Smooth((t - 0.1) / 0.8), old = [[0, 0, 1 - s, L3_FULL, 1], [0, 0, 1 - s, L3_FULL, 1]], neu = [[0, 0, s, L3_FULL, 1], [0, 0, s, L3_FULL, 1]];
  for (let i = 0; i < 2; i++) {
    const d = i * 0.08;
    if (mode === 0) {   // the old words roll up and away, the new ones come up from below
      const a = l3Clamp((t - d) / 0.5), b = l3Clamp((t - 0.3 - d) / 0.6);
      old.push([0, l3Ease(a) * 0.2, 1 - l3Smooth(a * 1.25), L3_FULL, 1]); neu.push([0, -(1 - l3Ease(b)) * 0.2, l3Smooth(b * 1.4), L3_FULL, 1]);
    } else { old.push([0, 0, 1 - s, L3_FULL, 1]); neu.push([0, 0, s, L3_FULL, 1]); }
  }
  return [old, neu];
}
function l3Free(card) { if (card && card.tex) { gl.deleteTexture(card.tex); card.tex = null; } }
function l3Card(c, w, key) {
  const r = l3Raster(c, w, comp.h / 1080 * (window.VJ_MOBILE ? 1 : 1.5)), tex = mkTex(0, 0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, r.cv);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  r.cv.width = r.cv.height = 0; r.cv = null;
  return { key, skey: l3StyleKey(c), want: w, tex, r };
}
const l3StyleKey = c => [c.theme, c.variant, c.colours, c.pos % 3 === 2, c.font, c.upper, comp.w, comp.h].join('|');
const l3Lines = c => String(c.text || '').split('\n').map(s => s.trim()).filter(Boolean);
const l3Split = s => { const i = s.indexOf('|'); return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; };
// What the clip should say now, or null for nothing. pending: a new track whose tags are still being read.
function l3Want(c) {
  const mine = c.art === 2 ? null : c.picImg || null;
  if (c.src === 'auto') {
    const tr = l3Track();
    if (tr) { const m = l3MetaOf(tr); return { title: m.title, sub: m.artist, label: c.label, art: c.art === 0 && m.art ? m.art : mine, track: true, pending: !m.done && performance.now() - m.at < 1500 }; }
  }
  const lines = l3Lines(c), n = lines.length;
  if (!n) return null;
  const i = c.src === 'auto' ? 0 : c.advance > 0 ? ((Math.floor(comp.beats / c.advance) % n) + n) % n : ((c.line % n) + n) % n, [title, sub] = l3Split(lines[i]);
  return { title, sub, label: c.src === 'auto' ? '' : c.label, art: mine, idx: i };
}
function l3Reset(c) {
  const st = c.st;
  l3Free(st.cur); l3Free(st.prev);
  Object.assign(st, { phase: 'hidden', cur: null, prev: null, t0: 0, onAt: 0, done: null, wantKey: null, wantAt: 0 });
}
// The clip's little state machine: hidden -> in -> on -> (change -> on)* -> out -> hidden.
function l3Step(c, w, now, dIn, dOut) {
  const st = c.st, key = w ? [w.title, w.sub, w.label, w.art ? w.art.aid : 0].join('\x01') : '';
  if (key !== st.wantKey) { st.wantKey = key; st.wantAt = now; }
  // a title must hold still for a moment before it is acted on (a deck fading past another, tags arriving)
  const settled = !(w && w.pending) && now - st.wantAt >= (st.cur ? 0.25 : 0), show = !!w && !(c.hold > 0 && st.done === key);
  if (st.cur && st.cur.skey !== l3StyleKey(c)) {   // another template, colours or frame size: draw the same words again
    const old = st.cur;
    st.cur = l3Card(c, old.want, old.key); l3Free(old);
    if (st.prev) { l3Free(st.prev); st.prev = null; if (st.phase === 'change') { st.phase = 'on'; st.onAt = now; } }
  }
  if (st.phase === 'in' && now - st.t0 >= dIn) { st.phase = 'on'; st.onAt = now; }
  if (st.phase === 'change' && now - st.t0 >= st.dur) { l3Free(st.prev); st.prev = null; st.phase = 'on'; st.onAt = now; }
  if (st.phase === 'out' && now - st.t0 >= dOut) { l3Free(st.cur); st.cur = null; st.phase = 'hidden'; }
  if (st.phase === 'on' && c.hold > 0 && now - st.onAt >= c.hold) { st.done = st.cur.key; st.phase = 'out'; st.t0 = now; }
  if (!settled) return;
  if (st.phase === 'hidden' && show) { st.cur = l3Card(c, w, key); st.phase = 'in'; st.t0 = now; }
  else if (st.phase === 'on' && st.cur.key !== key) {
    if (!show) { st.phase = 'out'; st.t0 = now; return; }
    const o = st.cur.want, same = o.title === w.title && o.sub === w.sub && o.label === w.label;   // only the cover arrived or changed
    st.prev = st.cur; st.cur = l3Card(c, w, key);
    st.mode = same ? 1 : c.change; st.phase = 'change'; st.t0 = now; st.dur = st.mode === 2 ? dOut + dIn : 0.9 * dIn;
  }
}
function l3Draw(f) {
  const c = this, st = c.st, p = modParams(c.params, c.mod), now = comp.time;
  if (now - st.last > 0.3 || now < st.last) l3Reset(c);   // not drawn for a moment = triggered again: the title comes in afresh
  st.last = now;
  const w = l3Want(c), sf = 0.45 + p[5] * 1.3, dIn = 1.1 / sf, dOut = 0.7 / sf;
  l3Step(c, w, now, dIn, dOut);
  if (c.stat && c.stat.isConnected) {
    const s = w && w.track ? 'Playing: ' + (w.sub ? w.sub + ' - ' : '') + w.title + (w.pending || c.art !== 0 || (w.art && w.art !== c.picImg) ? '' : '  (no cover in this file)') : 'No track is playing' + (w ? ': your own text is shown' : '');
    if (c.stat.textContent !== s) c.stat.textContent = s;
  }
  clearFbo(f);
  if (!st.cur) return true;
  const t = now - st.t0;
  let poses;
  if (st.phase === 'in') poses = [null, l3Pose(c.anim, t / dIn)];
  else if (st.phase === 'out') poses = [null, l3Pose(c.anim, 1 - t / dOut)];
  else if (st.phase === 'change') poses = l3Handover(st.mode, l3Clamp(t / st.dur), c.anim, dOut, dIn);
  else poses = [null, l3Pose(c.anim, 1)];
  const beat = comp.beats - Math.floor(comp.beats), DW = 1080 * comp.w / comp.h, size = 0.4 + p[0] * 1.2;
  let fx = 0, fy = 0, shineAt = -1, shine = 0;
  if (c.idle === 1) { const pu = Math.pow(1 - beat, 3); poses[1][1][4] *= 1 + 0.07 * pu; poses[1][2][4] *= 1 + 0.02 * pu; }
  else if (c.idle === 2) { const u = ((comp.beats / 8) % 1 + 1) % 1; shineAt = -0.2 + Math.min(1, u * 2.5) * 1.5; shine = 0.3; }
  else if (c.idle === 3) { fx = Math.cos(now * 0.9) * 0.003; fy = Math.sin(now * 1.3) * 0.008; }
  [st.prev, st.cur].forEach((card, k) => {
    const pose = poses[k];
    if (!card || !pose) return;
    const r = card.r, sw = size / DW, sh = size / 1080, Wc = r.W * sw, Hc = r.h * sh, col = c.pos % 3;
    const x0 = (r.wide || col === 1 ? (1 - Wc) / 2 : col === 0 ? 0.045 : 0.955 - Wc) + p[1] - 0.5 + fx, y0 = (c.pos >= 3 ? 0.925 - Hc : 0.075) + p[2] - 0.5 + fy;
    l3RC.set([x0 - r.M * sw, y0 - r.M * sh, (r.W + 2 * r.M) * sw, (r.h + 2 * r.M) * sh], k * 4);
    l3PV.set([r.piv[0], r.piv[1], r.cw / r.ch, r.mir ? -1 : 1], k * 4);
    for (let i = 0; i < 4; i++) {
      const q = pose[i], o = (k * 4 + i) * 4;
      l3LA[o] = q[0] * (r.mir ? -1 : 1); l3LA[o + 1] = q[1]; l3LA[o + 2] = q[2]; l3LA[o + 3] = q[3];
      l3LB[o] = q[4]; l3LB[o + 1] = i === 1 && r.spin ? now * 1.8 : 0; l3LB[o + 2] = r.span[i][0]; l3LB[o + 3] = r.span[i][1];
    }
  });
  const U = l3Prog.loc, hue = p[3] * Math.PI * 2;
  gl.useProgram(l3Prog.p);
  bindTex(0, (st.prev || st.cur).tex); bindTex(1, st.cur.tex);
  gl.uniform1i(U('tA'), 0); gl.uniform1i(U('tB'), 1);
  gl.uniform4fv(U('rc'), l3RC); gl.uniform4fv(U('la'), l3LA); gl.uniform4fv(U('lb'), l3LB); gl.uniform4fv(U('pv'), l3PV);
  gl.uniform4f(U('fxv'), Math.cos(hue), Math.sin(hue), shineAt, shine);
  gl.uniform1f(U('alpha'), p[4]); gl.uniform2f(U('vis'), st.prev && poses[0] ? 1 : 0, 1);
  tri();
  return true;
}

// ---------- the clip ----------
function l3Thumb(c) {
  const cv = document.createElement('canvas'), x = cv.getContext('2d'), lines = l3Lines(c);
  cv.width = 160; cv.height = 90;
  x.fillStyle = '#16161c'; x.fillRect(0, 0, 160, 90);
  const [title, sub] = c.src === 'auto' || !lines.length ? ['Track title', 'Artist'] : l3Split(lines[0]);
  const r = l3Raster(c, { title, sub, label: c.label, art: c.art === 2 ? null : c.picImg || l3DemoArt() }, 0.3, true);
  const s = Math.min(156 / r.cw, 86 / r.ch), dw = r.cw * s, dh = r.ch * s;
  for (let i = 0; i < 4; i++) x.drawImage(r.cv, 0, i * r.ch, r.cw, r.ch, (160 - dw) / 2, (90 - dh) / 2, dw, dh);
  c.thumb = cv.toDataURL('image/jpeg', 0.75);
  ui.gridDirty = true;
}
function lower3Clip(o = {}) {
  const c = { uid: newUid(), type: 'lower3', name: 'Lower third', src: 'auto', text: 'STRODANO VJ | Live visuals', label: 'NOW PLAYING', theme: 'glass', variant: 0, colours: 0, pos: 0,
    anim: 0, idle: 0, change: 0, hold: 0, art: 0, pic: '', picImg: null, font: '', upper: false, advance: 0, line: 0, params: L3_PARAMS.map(x => x.def), speed: 1, thumb: null,
    st: { phase: 'hidden', cur: null, prev: null, last: -1 } };
  const int = (v, n) => Math.min(n - 1, Math.max(0, v | 0));
  if (o.src === 'text' || o.src === 'auto') c.src = o.src;
  if (typeof o.text === 'string') c.text = o.text.slice(0, 20000);
  if (typeof o.label === 'string') c.label = o.label.slice(0, 60);
  if (L3_THEMES[o.theme]) c.theme = o.theme;
  if (o.variant !== undefined) c.variant = int(o.variant, L3_VARIANTS.length);
  if (o.colours !== undefined) c.colours = int(o.colours, 2);
  if (o.pos !== undefined) c.pos = int(o.pos, L3_POS.length);
  if (o.anim !== undefined) c.anim = int(o.anim, L3_ANIMS.length);
  if (o.idle !== undefined) c.idle = int(o.idle, L3_IDLE.length);
  if (o.change !== undefined) c.change = int(o.change, L3_CHANGE.length);
  if (L3_HOLD.some(h => h[0] === o.hold)) c.hold = o.hold;
  if (o.art !== undefined) c.art = int(o.art, L3_ART.length);
  if (TEXT_FONTS.includes(o.font)) c.font = o.font;
  if (typeof o.upper === 'boolean') c.upper = o.upper;
  if (TEXT_ADVANCE.some(a => a[0] === o.advance)) c.advance = o.advance;
  if (Array.isArray(o.params)) o.params.forEach((v, i) => { if (i < c.params.length && typeof v === 'number' && isFinite(v)) c.params[i] = Math.min(1, Math.max(0, v)); });
  if (typeof o.name === 'string' && o.name) c.name = o.name;
  if (typeof o.pic === 'string' && o.pic.startsWith('data:image/') && o.pic.length < 700000) { c.pic = o.pic; l3Square(c.pic, 384, true).then(cv => { c.picImg = cv; l3Thumb(c); }).catch(() => { c.pic = ''; }); }
  l3Reset(c);
  c.draw = l3Draw;
  c.onTrigger = () => l3Reset(c);   // triggered while it is already up: the title comes in again
  l3Thumb(c);
  return c;
}
// N key and the Prev / Next buttons, for a clip showing your own lines.
function l3Next(c, d = 1) { if (c && c.type === 'lower3' && c.src !== 'auto') { c.line += d; c.advance = 0; ui.propsDirty = true; } }
function l3PickPic(c, then) {
  const i = el('input', { type: 'file', accept: 'image/*' });
  i.onchange = async () => {
    const f = i.files[0];
    if (!f) return;
    try { const cv = await l3Square(f, 384, true); c.pic = cv.toDataURL('image/webp', 0.9); c.picImg = cv; then(); } catch (e) { setStatus('That picture could not be read'); }
  };
  i.click();
}

CLIP_TYPES.lower3 = {
  toJSON: c => ({ type: 'lower3', uid: c.uid, name: c.name, src: c.src, text: c.text, label: c.label, theme: c.theme, variant: c.variant, colours: c.colours, pos: c.pos, anim: c.anim, idle: c.idle,
    change: c.change, hold: c.hold, art: c.art, pic: c.pic || undefined, font: c.font, upper: c.upper, advance: c.advance, params: c.params, mod: c.mod }),
  fromJSON: j => lower3Clip(j),
  free: c => { l3Reset(c); c.stat = null; },
  props: (c, p) => {
    const redo = () => { l3Thumb(c); ui.propsDirty = true; if (typeof refreshSheet === 'function') refreshSheet(); };
    const pick = (label, opts, cur, set, title) => el('div', { className: 'fld' }, el('label', { textContent: label, title: title || label }),
      el('select', { title: title || '', onchange: e => { set(e.target.value); redo(); } }, ...opts.map(([v, n]) => el('option', { value: v, textContent: n, selected: v === cur }))));
    const list = names => names.map((n, i) => [i, n]), auto = c.src === 'auto';
    const lines = l3Lines(c), n = lines.length;
    p.append(pick('Title from', [['auto', 'The playing track (automatic)'], ['text', 'My own text']], c.src, v => { c.src = v; if (v === 'text' && c.label === 'NOW PLAYING') c.label = ''; }));
    if (auto) p.append(c.stat = el('div', { className: 'hint', textContent: '' }));
    p.append(el('textarea', { className: 'text-edit', value: c.text, rows: auto ? 2 : 4, spellcheck: false,
      placeholder: auto ? 'Shown while no track plays (leave empty for nothing).  Title | Second line' : 'One title per line.  Title | Second line',
      title: auto ? 'Shown while no track plays. Put | between the title and a second line' : 'One title per line. Put | between the title and a second line',
      oninput: e => { c.text = e.target.value; }, onchange: () => l3Thumb(c) }));
    if (!auto) p.append(
      el('div', { className: 'fld' }, el('button', { textContent: '< Prev', onclick: () => l3Next(c, -1) }), el('button', { textContent: 'Next title >', title: 'N key', onclick: () => l3Next(c, 1) }),
        el('span', { className: 'hint', textContent: n ? `Title ${(((c.line % n) + n) % n) + 1} of ${n}` : 'No titles yet' })),
      pick('Titles advance', TEXT_ADVANCE, c.advance, v => { c.advance = +v; }));
    p.append(
      el('div', { className: 'fld' }, el('label', { textContent: 'Label', title: 'The small line above the title' }),
        el('input', { type: 'text', value: c.label, maxLength: 60, placeholder: 'e.g. NOW PLAYING', title: 'The small line above the title. Empty = none', onchange: e => { c.label = e.target.value.trim(); l3Thumb(c); } })),
      pick('Template', Object.keys(L3_THEMES).map(k => [k, L3_THEMES[k].name]), c.theme, v => { c.theme = v; }),
      pick('Style', list(L3_VARIANTS), c.variant, v => { c.variant = +v; }),
      pick('Colours', [[0, 'From the artwork'], [1, 'The template\'s own']], c.colours, v => { c.colours = +v; }, 'From the artwork: the plate takes the cover\'s strongest colour. The Hue slider turns either'),
      pick('Position', list(L3_POS), c.pos, v => { c.pos = +v; }),
      pick('Animation', list(L3_ANIMS), c.anim, v => { c.anim = +v; l3Reset(c); }, 'How the title comes in and leaves'),
      pick('While shown', list(L3_IDLE), c.idle, v => { c.idle = +v; }),
      pick('New title', list(L3_CHANGE), c.change, v => { c.change = +v; }, 'How one title hands over to the next'),
      pick('Shown for', L3_HOLD, c.hold, v => { c.hold = +v; l3Reset(c); }, 'After this long the title leaves, and comes back for the next track or title'),
      pick('Artwork', list(L3_ART), c.art, v => { c.art = +v; }),
      el('div', { className: 'fld' }, el('label', { textContent: 'My picture', title: 'A logo or photo of your own: shown when the track has no cover, and with your own text' }),
        el('button', { textContent: c.pic ? 'Change...' : 'Choose a picture...', onclick: () => l3PickPic(c, redo) }),
        c.pic ? el('button', { textContent: 'Remove', onclick: () => { c.pic = ''; c.picImg = null; redo(); } }) : null),
      el('div', { className: 'fld' }, el('label', { textContent: 'Font' }),
        el('select', { onchange: e => { c.font = e.target.value; redo(); } }, el('option', { value: '', textContent: 'The template\'s own', selected: !c.font }), ...TEXT_FONTS.map(f => el('option', { value: f, textContent: f, selected: f === c.font }))),
        el('label', { className: 'chk' }, el('input', { type: 'checkbox', checked: c.upper, onchange: e => { c.upper = e.target.checked; redo(); } }), ' CAPITALS')),
      el('div', { className: 'fld' }, el('button', { textContent: 'Show it again', title: 'Plays the title\'s entrance again (so does triggering the clip)', onclick: () => l3Reset(c) })));
    L3_PARAMS.forEach((pd, k) => {
      const f = fld(pd.name, 0, 1, 0.001, () => c.params[k], v => { c.params[k] = v; });
      f.slider.dataset.midi = 'gen:' + c.uid + ':' + k;
      p.append(...lfoControls(c, k, f));
    });
  },
};
SOURCE_PANELS.push(() => {
  const items = Object.keys(L3_THEMES).map(k => {
    const make = () => lower3Clip({ theme: k, upper: k === 'block' });
    const item = el('div', { className: 'src-item', textContent: L3_THEMES[k].name, title: 'A title that names the playing track and shows its cover, or your own words. Drag onto a clip slot of a layer above your visuals, or double-click to fill the selected slot',
      ondblclick: () => { const ci = sel.c >= 0 ? sel.c : comp.layers[sel.l].clips.findIndex(x => !x); if (ci >= 0) setClip(sel.l, ci, make()); } });
    draggable(item, { kind: 'make', make });
    return item;
  });
  return [el('h4', { textContent: 'Lower thirds' }), el('div', { className: 'list' }, ...items)];
});
