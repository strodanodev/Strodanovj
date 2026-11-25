// Strodano VJ (web) - live layer previews and hover playback. GPL-3.0.
// Layer previews: each layer row starts with a small monitor showing that layer's own output (L.outTex, after its
// effects, before blending), copied the same way as the Preview monitor but at 160 px and every other frame.
// Hover playback: hovering a video clip in the grid, or a file in the media browser, plays it muted. One shared
// <video> does it, never the engine's own clip video, so hovering never moves a clip's playhead or what is on the output.
'use strict';
const LMON_W = 160;
const layerMons = [];   // index = layer index; rebuilt with the grid
let lmonTick = 0;

// Called by renderGrid for each layer row.
function layerMon(li) {
  const cv = document.createElement('canvas');
  cv.width = LMON_W; cv.height = 90;
  const box = document.createElement('div');
  box.className = 'lmon'; box.title = 'Layer ' + (li + 1) + ' output';
  // nudge over the layer's picture: hold to push whatever video plays on this layer ahead or hold it back (clipopts.js).
  // data-midi makes each one mappable: Map mode, click it, press a pad (layer:L:nudge- / nudge+, held while the pad is down).
  const nb = (text, sign, k, tip) => nudgeButton(text, li, -1, sign, { className: 'nudge-btn', title: tip + ' (hold). Map mode: click it, then press a pad', ariaLabel: tip, dataset: { midi: 'layer:' + li + ':' + k } });
  box.append(cv, el('div', { className: 'lnudge' }, nb('◀', -1, 'nudge-', 'Nudge slower'), nb('▶', 1, 'nudge+', 'Nudge faster')));
  layerMons[li] = { box, cv, ctx: cv.getContext('2d', { alpha: false }) };
  return box;
}
// Called from the main loop while the window is visible.
function drawLayerMons() {
  // the grid or browser was rebuilt under the pointer: the hovered element is gone, so stop its video
  if (hov.host && !hov.host.isConnected) stopHover();
  if (++lmonTick & 1) return;   // 30 Hz is plenty for a thumbnail
  const ph = Math.max(1, Math.round(LMON_W * comp.h / comp.w));
  layerMons.length = comp.layers.length;
  comp.layers.forEach((L, li) => {
    const m = layerMons[li];
    if (!m || !m.cv.isConnected) return;
    if (m.cv.height !== ph) m.cv.height = ph;
    const live = !!L.outTex;
    if (m.box.classList.contains('live') !== live) m.box.classList.toggle('live', live);
    const nu = typeof nudgeAmt === 'function' ? nudgeAmt(li) : 0, dir = nu > 0 ? 'up' : nu < 0 ? 'down' : '';   // lit while any input pushes (button, pad, key, stick)
    if ((m.nudged || '') !== dir) { m.nudged = dir; m.box.classList.toggle('nudge-up', dir === 'up'); m.box.classList.toggle('nudge-down', dir === 'down'); }
    if (!live) { if (m.drawn) { m.ctx.fillStyle = '#000'; m.ctx.fillRect(0, 0, LMON_W, ph); m.drawn = false; } return; }
    present(L.outTex, LMON_W, ph); grab(m.ctx, LMON_W, ph);
    m.drawn = true;
  });
}

// ---------- hover playback ----------
const HOVER_DELAY = 120;   // ms; sweeping the pointer across the grid should not start a decoder per cell
const hov = { vid: null, timer: 0, host: null, pop: null };
function hoverVideo() {
  if (!hov.vid) {
    hov.vid = document.createElement('video');
    Object.assign(hov.vid, { muted: true, loop: true, playsInline: true, preload: 'auto' });
    hov.vid.className = 'hovvid';
    hov.vid.addEventListener('error', stopHover);
  }
  return hov.vid;
}
function stopHover() {
  clearTimeout(hov.timer); hov.timer = 0;
  const v = hov.vid;
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }   // free the decoder
  if (hov.host) hov.host.classList.remove('hovering');
  if (hov.pop) hov.pop.hidden = true;
  hov.host = null;
}
function playIn(host, url) {
  const v = hoverVideo();
  host.append(v); host.classList.add('hovering');
  if (v.getAttribute('src') !== url) v.src = url;
  v.currentTime = 0;
  v.play().catch(() => {});
}
function hoverLater(host, start) {
  if (hov.host === host) return;
  stopHover();
  hov.host = host;
  hov.timer = setTimeout(() => { hov.timer = 0; if (hov.host === host) start(); }, HOVER_DELAY);
}

// grid cells carry data-midi="clip:L:C"
function clipOfCell(cell) {
  const m = /^clip:(\d+):(\d+)$/.exec(cell.dataset.midi || ''), L = m && comp.layers[+m[1]];
  return L ? L.clips[+m[2]] : null;
}
function onGridOver(e) {
  const cell = e.target.closest && e.target.closest('.cell');
  if (!cell) { stopHover(); return; }
  const c = clipOfCell(cell), url = c && c.video && !c.missing && !c.error && (c.video.currentSrc || c.video.src);
  if (!url) { stopHover(); return; }
  hoverLater(cell, () => playIn(cell, url));
}

// media browser: a floating preview beside the hovered file
function mediaPop() {
  if (!hov.pop) {
    hov.pop = document.createElement('div');
    hov.pop.id = 'hoverPop'; hov.pop.hidden = true;
    hov.pop.append(document.createElement('div'), document.createElement('span'));
    document.getElementById('app').append(hov.pop);
  }
  return hov.pop;
}
function onBrowserOver(e) {
  const item = e.target.closest && e.target.closest('#browser .list > div');
  const m = item && !item.classList.contains('miss') && !item.classList.contains('hint') && media.find(x => x.name === item.title);
  if (!m) { stopHover(); return; }
  hoverLater(item, () => {
    const pop = mediaPop(), frame = pop.firstChild, r = item.getBoundingClientRect();
    frame.textContent = '';
    pop.lastChild.textContent = m.name;
    pop.hidden = false;
    // to the left of the browser panel, level with the item, kept on screen
    pop.style.left = Math.max(8, r.left - pop.offsetWidth - 12) + 'px';
    pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, Math.max(8, r.top + r.height / 2 - pop.offsetHeight / 2)) + 'px';
    if (m.kind === 'video') playIn(frame, m.url);
    else { const img = new Image(); img.src = m.url; img.draggable = false; frame.append(img); }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('grid'), br = document.getElementById('browser');
  grid.addEventListener('pointerover', onGridOver);
  grid.addEventListener('pointerleave', stopHover);
  br.addEventListener('pointerover', onBrowserOver);
  br.addEventListener('pointerleave', stopHover);
  // a click triggers the clip; a drag moves it: either way the hover preview should get out of the way
  grid.addEventListener('pointerdown', stopHover, true);
  br.addEventListener('pointerdown', stopHover, true);
});
