// Strodano VJ (web) - the remote control screen (remote.html): a phone plays the show running in the desktop app. GPL-3.0.
// Commands go up, state comes down (../../remote-control-spec.md): this page runs no engine and stores nothing of the show.
//   up:   hello, set (a slider), fire (a button), hold, step (tempo), view (page hidden), ping, bye. Ids are midi.js
//         target ids ('clip:L:C', 'layer:L:opacity', 'fx:<uid>:<k>'...); every message carries a counter n.
//   down: welcome / refuse / wait, state (the structure: layers, clips, effects), patch (live values that changed, flat
//         keys: m master, x crossfade, k blackout, bpm, bt beats, o<i> y<i> s<i> a<i> p<i> v<i> = layer i's level, bypass,
//         solo, playing column, waiting column, video progress; the fx: / gen: ids themselves; ag ah av = Agent),
//         thumb (one clip picture, kept in memory only), pong, status, bye.
// A slider sends at most one move per animation frame on the link's second channel (may be dropped, never queued) and its
// resting value once more on the main one; while a finger is on it, patches for it are ignored.
// Phase 2: the host's small live picture (a video track in the same session; `view` says which quality this phone
// wants and whether its page is hidden), hold-to-apply effect pads (`fx`), and remembered computers.
// Kept on this device, and nothing of the show: localStorage RM_HOSTS = the last 5 computers this phone was allowed on
// ({room, secret, key, host, at}), so it connects again without a code or a question, and RM_PREFS (preview quality).
// Phase 3: a wide layout (900 px and up: the ROG Ally's screen, a tablet) with the clip grid, the host's selection and
// eight knobs that follow what the host has in focus; a gamepad on this device plays the host (`pad`: its buttons and
// sticks, read there through the host's own gamepad mappings); holding View shows the host's cheat-sheet (`overlay`).
// In the desktop app's Remote mode (window.strodanoDesktop.remoteMode) this page IS the window, with a way back.
// All names here start with rm / RM (core.js is loaded for $ and el).
'use strict';
const RM_HOSTS = 'strodano-vj-remote-hosts', RM_PREFS = 'strodano-vj-remote-prefs';
const RM_PREVIEW = { mid: 'Preview: high', low: 'Preview: low', off: 'Preview: off' };
const RM_TABS = [['clips', 'Clips'], ['mix', 'Mix'], ['fx', 'Effects'], ['agent', 'Agent']];
const RM_TABS_WIDE = [['show', 'Show'], ['fx', 'Effects'], ['agent', 'Agent']];
const RM_WIDE = window.matchMedia ? window.matchMedia('(min-width: 900px)') : { matches: false, addEventListener() {} };
const RM_DESK = window.strodanoDesktop && window.strodanoDesktop.remoteMode;   // the desktop app in Remote mode
const RM_REFUSED = {
  plan: 'That computer is not on the Festival plan. Remote control is part of Festival.',
  busy: 'The computer is busy with another device. Try again in a moment.',
  denied: 'The computer refused this device.',
  version: 'This page and the app on the computer are different versions. Update the app, then reload this page.',
  code: 'That code or link no longer works. Open Remote control on the computer for a new one.',
};
const RM_BYE = { off: 'Remote control was turned off on the computer.', replaced: 'Another device took over the show.', host: 'This phone was disconnected on the computer.', forgot: 'The computer no longer remembers this phone. Scan its QR code again.' };
const rm = {
  link: null, local: new URLSearchParams(location.search).get('local') === '1', room: '', secret: '', key: '', intro: false,
  phase: 'enter',        // enter | busy | live | away
  n: 0, host: '', s: null, v: {}, ack: 0, thumbs: new Map(), tab: 'clips', sigs: {}, binds: new Map(), tiles: [], scenes: [],
  busy: new Map(), pend: new Map(), raf: 0, rtt: 0, relayed: false, lastRx: 0, lastPath: 0, tries: 0, retryT: 0, slowT: 0,
  touch: false, wantBuild: false, btAt: 0, wake: null, toastT: 0,
  pv: false, prefs: { preview: 'mid' }, latch: false, pads: new Set(),
  padSt: { b: [], a: [0, 0, 0, 0], at: 0, seen: false }, deskName: '', lnames: [],
};
const rmLS = { get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
{ const p = rmLS.get(RM_PREFS); if (p && RM_PREVIEW[p.preview]) rm.prefs.preview = p.preview; }
// the computers this phone was allowed on, newest first
function rmHosts() { const a = rmLS.get(RM_HOSTS); return (Array.isArray(a) ? a : []).filter(h => h && rlParseLink(h.room + '.' + h.secret) && typeof h.key === 'string' && h.key.length === 32); }
const rmKeyFor = room => (rmHosts().find(h => h.room === room) || {}).key || '';
function rmRemember() { rmLS.set(RM_HOSTS, [{ room: rm.room, secret: rm.secret, key: rm.key, host: rm.host, at: Date.now() }, ...rmHosts().filter(h => h.room !== rm.room)].slice(0, 5)); }
const rmNow = () => performance.now();
function rmName() {
  if (rm.deskName) return rm.deskName;   // the desktop app: this computer's own name
  const u = navigator.userAgent;
  return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? (/Mobile/.test(u) ? 'Android phone' : 'Android tablet') : /Windows/.test(u) ? 'Windows PC' : /Mac/.test(u) ? 'Mac' : 'A device';
}
function rmToast(text, bad) {
  const t = $('toast');
  t.textContent = text; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(rm.toastT); rm.toastT = setTimeout(() => { t.className = ''; }, 2600);
}
function setStatus(s) { rmToast(s); }   // core.js armThen reports through it

// ---------- the cover: connect, wait, refused ----------
function rmCover(mode, text, err, btn, onBtn) {
  const c = $('cover');
  c.hidden = mode === 'none';
  if (mode === 'none') return;
  $('coverText').textContent = text; $('coverText').className = err ? 'err' : '';
  $('codeForm').hidden = mode !== 'enter'; $('backLink').hidden = mode !== 'enter'; $('spin').hidden = mode !== 'busy';
  const b = $('coverBtn');
  b.hidden = !btn; b.textContent = btn || ''; b.onclick = onBtn || null;
  // remembered computers: one tap, no code
  const saved = $('saved'), hosts = mode === 'enter' ? rmHosts() : [];
  saved.hidden = !hosts.length;
  saved.replaceChildren(...hosts.map(h => el('div', { className: 'row' },
    el('button', { className: 'pri', textContent: 'Connect to ' + (h.host || 'computer'), onclick: () => { rm.room = h.room; rm.secret = h.secret; rm.key = h.key; try { history.replaceState(null, '', '#' + h.room + '.' + h.secret); } catch (e) {} rmConnect(h.room, h.secret); } }),
    el('button', { className: 'ghost shrink', textContent: 'Forget', onclick: () => { rmForget(h.room); rmCover(mode, text, err, btn, onBtn); } }))));
}
function rmEnter(text, err) {
  rmDrop(); rm.phase = 'enter'; rm.s = null; rm.v = {}; rm.thumbs.clear(); rm.tries = 0; rm.pads.clear();
  document.body.classList.remove('live', 'away'); rmMon(); rmOverlay(null);
  rmCover('enter', text || 'On the computer, open Broadcast > Remote control. Scan its QR code with this phone, or type the code shown there.', err);
  rmHeader();
}
function rmDrop() {
  clearTimeout(rm.retryT); clearTimeout(rm.slowT);
  if (rm.link) { rm.link.stop(); rm.link = null; }
}
function rmForget(room = rm.room) { rmLS.set(RM_HOSTS, rmHosts().filter(h => h.room !== room)); if (room === rm.room) rm.key = ''; }

// ---------- the link ----------
function rmSend(m, lossy) {
  if (!rm.link) return 0;
  m.n = ++rm.n;
  return rm.link.send(m, lossy) ? m.n : 0;
}
const rmFire = id => { if (rm.phase === 'live') rmSend({ t: 'fire', id }); };
// intro = the short code's room: the host answers there with the real room and secret (move)
function rmConnect(room, secret, intro) {
  rmDrop();
  rm.intro = !!intro;
  if (rm.phase !== 'away') { rm.phase = 'busy'; rmCover('busy', 'Looking for the computer...', false, 'Cancel', () => rmEnter()); }
  const link = rm.link = rlJoin({ room, secret, local: rm.local, video: !intro, onTrack: t => { if (rm.link === link) rmTrack(t); },
    onState: (s, text) => { if (rm.link === link && s === 'error') { if (rm.phase === 'away') rmRetry(); else rmEnter(text, true); } },
    onOpen: () => {
      if (rm.link !== link) return;
      const n = ++rm.n;
      link.send({ t: 'hello', v: RL_V, name: rmName(), kind: RM_DESK ? 'pad' : 'phone', key: !intro && rm.key ? rm.key : undefined, n, proof: rlProof(secret, room, n) });
    },
    onMsg: m => { if (rm.link === link) rmMsg(m); },
    onClose: () => { if (rm.link === link) rmLost(); } });
  // nobody answered: say so, and keep looking (the host may be starting, or remotes are off there)
  rm.slowT = setTimeout(() => {
    if (rm.link !== link || rm.phase !== 'busy') return;
    if (intro) rmEnter('No computer answered that code. Check it (a code works for 5 minutes, once) and that Remote control is turned on.', true);
    else rmCover('busy', 'Still looking. Is Remote control turned on, on the computer? Is this phone online?', false, 'Cancel', () => rmEnter());
  }, 20000);
}
function rmMsg(m) {
  rm.lastRx = rmNow();
  if (rm.intro) {
    if (m.t === 'move') {
      const ids = rlParseLink(m.room + '.' + m.secret);
      if (!ids) return rmEnter(RM_REFUSED.code, true);
      rm.room = ids.room; rm.secret = ids.secret; rm.key = rmKeyFor(ids.room);
      try { history.replaceState(null, '', '#' + ids.room + '.' + ids.secret); } catch (e) {}   // a reload reconnects
      rmConnect(ids.room, ids.secret);
    } else if (m.t === 'refuse') rmEnter(RM_REFUSED[m.why] || RM_REFUSED.code, true);
    return;
  }
  if (m.t === 'wait') { if (rm.phase !== 'away') { clearTimeout(rm.slowT); rmCover('busy', 'Now press Allow on the computer.', false, 'Cancel', () => rmEnter()); } }
  else if (m.t === 'refuse') { if (m.why === 'denied') rmForget(); rmEnter(RM_REFUSED[m.why] || 'The computer refused the connection.', true); }
  else if (m.t === 'welcome') {
    rm.key = String(m.key || ''); rm.host = String(m.host || 'Computer').slice(0, 40);
    rmRemember();
    rm.pv = !!m.pv; rm.pads.clear(); rmPadReset();   // a pad held through a reconnect is sent again
    clearTimeout(rm.slowT);
    rm.phase = 'live'; rm.tries = 0; rm.v = {}; rm.ack = 0; rm.busy.clear(); rm.pend.clear(); rm.sigs = {};
    document.body.classList.add('live'); document.body.classList.remove('away');
    rmCover('none');
    rm.link.openLossy();
    rmView(); rmMon();
    rmHeader(); rmWake();
  }
  else if (m.t === 'state' && m.s && typeof m.s === 'object') { rm.s = m.s; if (m.s.w > 0 && m.s.h > 0) $('mon').style.setProperty('--ar', m.s.w + ' / ' + m.s.h); rmTabs(); rmBuildIfChanged(); }
  else if (m.t === 'patch' && m.p && typeof m.p === 'object') rmPatch(m.p, m.ack);
  else if (m.t === 'thumb' && typeof m.k === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(m.d || '')) {
    rm.thumbs.set(m.k, m.d);
    document.querySelectorAll('[data-k="' + m.k.replace(/[^a-z0-9]/g, '') + '"]').forEach(e => { e.style.backgroundImage = 'url("' + m.d + '")'; });
  }
  else if (m.t === 'pong') { const d = rmNow() - m.at; if (d >= 0 && d < 60000) rm.rtt = rm.rtt ? rm.rtt * 0.7 + d * 0.3 : d; }
  else if (m.t === 'released') { rm.pads.clear(); rm.busy.clear(); rmPadReset(); if (rm.tab === 'fx' && !rm.touch) rmBuild(); }
  else if (m.t === 'overlay') rmOverlay(m.rows, m.shift);   // the host lost us for a moment and let go of what we held
  else if (m.t === 'status') rmToast(String(m.text || '').slice(0, 200), !!m.bad);
  else if (m.t === 'bye') { if (m.why === 'forgot') rmForget(); rmEnter(RM_BYE[m.why] || 'The computer ended the connection.', true); }
}
// The link closed or went quiet: keep the last state on screen, marked as old, and try again (2 s, then every 5 s).
function rmLost() {
  if (rm.phase === 'enter') return;
  if (rm.intro) return rmEnter('The connection dropped. Try the code again.', true);
  if (rm.phase === 'live') { rm.phase = 'away'; document.body.classList.remove('live'); document.body.classList.add('away'); rm.busy.clear(); rm.pend.clear(); rm.pads.clear(); rm.sigs = {}; }   // the host let go of every held effect
  rmOverlay(null); rmHeader(); rmRetry();
}
function rmRetry() {
  rmDrop();
  rm.retryT = setTimeout(() => { if (rm.phase !== 'enter') rmConnect(rm.room, rm.secret); }, rm.tries++ < 2 ? 2000 : 5000);
}
setInterval(() => {
  const now = rmNow();
  if (rm.phase === 'live' && !document.hidden) {
    rmSend({ t: 'ping', at: now, rtt: Math.round(rm.rtt), rel: rm.relayed ? 1 : 0 }, true);
    if (now - rm.lastRx > 3500) rmLost();
    if (now - rm.lastPath > 5000 && rm.link) { rm.lastPath = now; rm.link.path().then(q => { if (q) rm.relayed = !!q.relayed; }); }
  }
  rmHeader();
}, 500);
function rmHeader() {
  $('hostName').textContent = rm.phase === 'live' || rm.phase === 'away' ? rm.host : 'Remote';
  const t = $('linkText'), slow = rm.phase === 'live' && rm.rtt > 250;
  t.textContent = rm.phase === 'live' ? (rm.rtt ? Math.round(rm.rtt) + ' ms' : 'Connected') + (rm.relayed ? ', relayed' : '') + (slow ? ': launches will feel late' : '') : rm.phase === 'away' ? 'Reconnecting...' : 'Not connected';
  t.className = slow ? 'slow' : '';
}
document.addEventListener('visibilitychange', () => {
  if (rm.phase !== 'live') return;
  rm.lastRx = rmNow();   // timers stood still while the page was hidden: give the link a moment before calling it lost
  rmView();
  if (!document.hidden) rmWake();
});
window.addEventListener('pagehide', () => { if (rm.phase === 'live') rmSend({ t: 'bye' }); });
// keep the screen on while the remote is in use
async function rmWake() {
  if (!navigator.wakeLock || rm.wake || document.hidden) return;
  try { rm.wake = await navigator.wakeLock.request('screen'); rm.wake.addEventListener('release', () => { rm.wake = null; }); } catch (e) {}
}
window.addEventListener('pointerdown', rmWake, true);

// ---------- the monitor: the host's live picture ----------
// What this phone wants from the host: the preview quality, and nothing at all while the page is hidden.
function rmView() { rmSend({ t: 'view', hidden: document.hidden, preview: rm.pv ? rm.prefs.preview : 'off' }); }
function rmTrack(t) {
  const v = $('pv');
  v.srcObject = new MediaStream([t]);
  v.play().catch(() => {});
}
function rmMon() {
  const m = $('mon'), on = rm.pv && (rm.phase === 'live' || rm.phase === 'away');
  m.hidden = !on;
  m.classList.toggle('off', rm.prefs.preview === 'off');
  $('pvBtn').textContent = RM_PREVIEW[rm.prefs.preview];
}

// ---------- live values ----------
function rmBind(key, fn) {
  let a = rm.binds.get(key);
  if (!a) rm.binds.set(key, a = []);
  a.push(fn);
  if (key in rm.v) fn(rm.v[key]);
}
function rmPatch(p, ack) {
  if (Number.isInteger(ack)) rm.ack = ack;
  if ('bt' in p) rm.btAt = rmNow();
  let scenes = false;
  for (const k in p) {
    rm.v[k] = p[k];
    const a = rm.binds.get(k);
    if (a) for (const fn of a) fn(p[k]);
    if (k[0] === 'a' && k !== 'ag' && k !== 'ah' && k !== 'av') scenes = true;
  }
  if (scenes) rmScenesOn();
  if ('k' in p) { const b = $('black'); b.classList.toggle('on', !!p.k); b.textContent = p.k ? 'BLACK: TAP' : 'BLACKOUT'; }
}
const rmPct = i => i.style.setProperty('--p', (100 * i.value).toFixed(1) + '%');
function rmFlush() {
  rm.raf = 0;
  for (const [id, x] of rm.pend) rmSend({ t: 'set', id, x }, true);
  rm.pend.clear();
}
// A slider for target `id`, showing live value `key`.
function rmSlider(id, key) {
  const i = el('input', { type: 'range', min: 0, max: 1, step: 0.001, value: rm.v[key] ?? 0, ariaLabel: id });
  i.addEventListener('input', () => {
    rmPct(i);
    rm.busy.set(id, Infinity); rm.pend.set(id, +i.value);
    if (!rm.raf) rm.raf = requestAnimationFrame(rmFlush);
  });
  const done = () => {   // the finger lifted: the resting value goes once more on the channel that never drops
    if (rm.busy.get(id) !== Infinity) return;
    rm.pend.delete(id);
    const n = rmSend({ t: 'set', id, x: +i.value });
    rm.busy.set(id, n);
    setTimeout(() => { if (rm.busy.get(id) === n) rm.busy.delete(id); }, 1200);
  };
  for (const ev of ['change', 'pointerup', 'pointercancel']) i.addEventListener(ev, done);
  rmBind(key, v => {
    const b = rm.busy.get(id);
    if (b !== undefined) { if (b === Infinity || rm.ack < b) return; rm.busy.delete(id); }   // not while it is held, nor before the host has our last move
    i.value = v; rmPct(i);
  });
  rmPct(i);
  return i;
}
const rmBtn = (text, onclick, cls = '') => el('button', { textContent: text, className: cls, onclick });
// A button that lights while live value `key` is truthy (or falsy with `inv`).
function rmToggle(text, id, key, cls, inv) {
  const b = rmBtn(text, () => rmFire(id), cls);
  rmBind(key, v => b.classList.toggle('on', inv ? !v : !!v));
  return b;
}
const rmH3 = t => el('h3', { textContent: t });
const rmHint = t => el('div', { className: 'hint', textContent: t });
const rmThumb = k => (k && rm.thumbs.has(k) ? 'url("' + rm.thumbs.get(k) + '")' : '');

// ---------- tabs ----------
function rmTabs() {
  const has = rm.s && rm.s.has && rm.s.has.agent, list = (RM_WIDE.matches ? RM_TABS_WIDE : RM_TABS).filter(([id]) => id !== 'agent' || has);
  if (!list.some(([id]) => id === rm.tab)) rm.tab = list[0][0];
  $('tabs').replaceChildren(...list.map(([id, name]) => rmBtn(name, () => { rm.tab = id; rmTabs(); rmBuild(); }, id === rm.tab ? 'on' : '')));
}
// What a tab is built from: it is rebuilt only when that changes, so launching a clip never resets a scrolled row.
function rmSig(tab) {
  const s = rm.s;
  if (!s) return '';
  return JSON.stringify(tab === 'clips' ? [s.layers, s.cols, s.tags] : tab === 'show' ? [s.layers, s.cols, s.tags, s.snaps] : tab === 'mix' ? [s.snaps] : tab === 'fx' ? [s.fx, s.gens, s.pads, rm.latch] : [s.has]);
}
function rmBuildIfChanged() {
  if (rmSig(rm.tab) === rm.sigs[rm.tab]) return;
  if (rm.touch) { rm.wantBuild = true; return; }   // never under a finger
  rmBuild();
}
['pointerdown', 'pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, e => {
  rm.touch = t === 'pointerdown' && !!(e.target.closest && e.target.closest('#view'));
  if (!rm.touch && rm.wantBuild) { rm.wantBuild = false; setTimeout(rmBuildIfChanged, 50); }
}, true));
function rmBuild() {
  const v = $('view'), top = v.scrollTop, strips = [...v.querySelectorAll('.strip')].map(x => [x.dataset.l, x.scrollLeft]);
  rm.binds.clear(); rm.tiles = []; rm.scenes = []; rm.lnames = [];
  rm.sigs[rm.tab] = rmSig(rm.tab);
  const root = document.createDocumentFragment();
  if (rm.s) ({ clips: rmClipsTab, show: rmShowTab, mix: rmMixTab, fx: rmFxTab, agent: rmAgentTab })[rm.tab](root);
  v.replaceChildren(root);
  v.scrollTop = top;
  for (const [l, x] of strips) { const e = v.querySelector('.strip[data-l="' + l + '"]'); if (e) e.scrollLeft = x; }
  rmScenesOn();
}

// The pieces both layouts share: a scene button, a clip tile, a layer's tiles following what plays.
function rmSceneBtn(c) {
  const s = rm.s, tag = String((s.tags && s.tags[c]) || ''), top = [...s.layers].reverse().map(L => L.clips[c]).find(x => x && x.k);
  const b = el('button', { className: 'scene ' + tag.toLowerCase().replace(/[^a-z]/g, ''), ariaLabel: 'Scene ' + (c + 1), onclick: () => rmFire('column:' + c) },
    el('b', { textContent: String(c + 1) }), el('small', { textContent: tag }));
  if (top) { b.dataset.k = top.k; b.style.backgroundImage = rmThumb(top.k); }
  rm.scenes.push(b);
  return b;
}
function rmTile(i, ci, c) {
  const t = el('button', { className: 'tile' + (c.x ? ' off' : ''), ariaLabel: c.n, onclick: () => rmFire('clip:' + i + ':' + ci) },
    el('i', { className: 'num', textContent: String(ci + 1) }), el('span', { textContent: c.n }), el('i', { className: 'bar' }));
  if (c.x) t.append(el('i', { className: 'tag', textContent: c.x === 'pro' ? 'PRO' : 'missing' }));
  if (c.k) { t.dataset.k = c.k; t.style.backgroundImage = rmThumb(c.k); }
  (rm.tiles[i] || (rm.tiles[i] = []))[ci] = t;
  return t;
}
function rmLayerLive(i) {
  const mark = () => (rm.tiles[i] || []).forEach((t, ci) => { if (!t) return; const a = rm.v['a' + i] === ci; t.classList.toggle('active', a); t.classList.toggle('pending', rm.v['p' + i] === ci); if (!a) t.querySelector('.bar').style.width = '0'; });
  rmBind('a' + i, mark); rmBind('p' + i, mark);
  rmBind('v' + i, x => { const t = (rm.tiles[i] || [])[rm.v['a' + i]]; if (t) t.querySelector('.bar').style.width = x >= 0 ? (100 * x).toFixed(1) + '%' : '0'; });
}
// Clips: scenes (columns) on top, then a card per layer, top layer first as on the computer.
function rmClipsTab(root) {
  const s = rm.s, n = s.layers.length;
  const sc = el('div', { className: 'scenes' });
  for (let c = 0; c < s.cols; c++) sc.append(rmSceneBtn(c));
  root.append(rmH3('Scenes'), sc, rmH3('Layers'));
  for (let i = n - 1; i >= 0; i--) {
    const L = s.layers[i], strip = el('div', { className: 'strip', dataset: { l: i } });
    L.clips.forEach((c, ci) => { if (c) strip.append(rmTile(i, ci, c)); });
    rmLayerLive(i);
    root.append(el('div', { className: 'card' },
      el('div', { className: 'row' }, el('div', { className: 'name' }, L.name, el('small', { textContent: (L.blend || '') + (L.lock ? ' · locked' : '') })),
        rmToggle('B', 'layer:' + i + ':bypass', 'y' + i, 'sq shrink'), rmToggle('S', 'layer:' + i + ':solo', 's' + i, 'sq shrink'), rmBtn('Stop', () => rmFire('layer:' + i + ':eject'), 'shrink')),
      rmSlider('layer:' + i + ':opacity', 'o' + i),
      strip.childElementCount ? strip : rmHint('No clips on this layer.')));
  }
}
// A scene is lit when every layer that has a clip in that column is playing it.
function rmScenesOn() {
  const s = rm.s;
  if (!s || !rm.scenes.length) return;
  rm.scenes.forEach((b, c) => {
    let have = 0, on = 0;
    s.layers.forEach((L, i) => { if (L.clips[c]) { have++; if (rm.v['a' + i] === c) on++; } });
    b.classList.toggle('on', have > 0 && on === have);
  });
}
function rmOutputCard() {
  return el('div', { className: 'card' },
    el('div', { className: 'lab' }, el('span', { textContent: 'Master' })), rmSlider('master', 'm'),
    el('div', { className: 'lab' }, el('span', { textContent: 'Crossfade A' }), el('span', { textContent: 'B' })), rmSlider('crossfade', 'x'));
}
function rmTempoCard() {
  const bpm = el('div', { className: 'bpm' }), dots = el('div', { className: 'dots', id: 'beatDots' }, el('i'), el('i'), el('i'), el('i'));
  rmBind('bpm', v => { bpm.textContent = Number(v).toFixed(1); });
  return el('div', { className: 'card' },
    el('div', { className: 'row' }, bpm, el('div', { className: 'shrink' }, dots)),
    el('div', { className: 'row', style: { marginTop: '10px' } },
      rmBtn('-1', () => rmSend({ t: 'step', id: 'bpm', d: -10 })), rmBtn('+1', () => rmSend({ t: 'step', id: 'bpm', d: 10 })), rmBtn('Tap', () => rmFire('tap'), 'pri'), rmBtn('Resync', () => rmFire('resync'))));
}
function rmSnaps() {
  const sn = el('div', { className: 'snaps' });
  (rm.s.snaps || []).forEach((x, i) => sn.append(rmBtn(typeof x === 'string' ? x : String(i + 1), () => { if (x) rmFire('snap:' + i); else rmToast('Snapshot ' + (i + 1) + ' is empty. Store it on the computer (Shift+F' + (i + 1) + ').'); }, x ? 'has' : '')));
  return sn;
}
function rmStopAll() { const stop = rmBtn('Stop all clips', () => armThen(stop, 'stop every clip', () => rmFire('stopall')), 'big'); return stop; }
function rmMixTab(root) {
  root.append(rmH3('Output'), rmOutputCard(), rmH3('Tempo'), rmTempoCard(), rmH3('Snapshots'), rmSnaps(), rmH3('All layers'), rmStopAll());
}
// Eight knobs that follow what the computer has in focus (its properties panel: the selected effect or clip), the
// same focus:0-7 targets a hardware controller's knobs drive. The pad's D-pad moves that selection.
function rmKnobs() {
  const name = el('span'), sub = el('small'), ks = [], grid = el('div', { className: 'knobs' }), none = rmHint('');
  for (let k = 0; k < 8; k++) { const lab = el('span'), box = el('div', { className: 'k' }, el('div', { className: 'lab' }, lab), rmSlider('focus:' + k, 'f' + k)); ks.push({ box, lab }); grid.append(box); }
  const pageRow = el('div', { className: 'row', style: { marginTop: '6px' } }, rmBtn('Fewer', () => rmFire('focus:page-')), rmBtn('More', () => rmFire('focus:page+')));
  rmBind('fo', v => {
    let f = {};
    try { f = JSON.parse(v) || {}; } catch (e) {}
    const l = Array.isArray(f.l) ? f.l : [];
    name.textContent = f.n || 'Nothing in focus';
    sub.textContent = f.pp > 1 ? 'Parameters, page ' + f.p + ' of ' + f.pp : '';
    ks.forEach((x, k) => { x.box.hidden = !l[k]; x.lab.textContent = String(l[k] || '').slice(0, 40); });
    pageRow.hidden = !(f.pp > 1);
    none.textContent = l.length ? '' : 'Select an effect or a clip on the computer, or move the selection with the D-pad.';
  });
  return el('div', { className: 'card' },
    el('div', { className: 'row' }, el('div', { className: 'name' }, name, sub), rmBtn('<', () => rmFire('focus:prev'), 'sq shrink'), rmBtn('>', () => rmFire('focus:next'), 'sq shrink')),
    grid, pageRow, none);
}
// The wide layout's main tab: the clip grid as on the computer (layers as rows, columns as scenes), with the host's
// selection marked, and beside it output, knobs, tempo and snapshots.
function rmSelMark() {
  const l = rm.v.sl, c = rm.v.sc;
  rm.tiles.forEach((row, i) => (row || []).forEach((t, ci) => { if (t) t.classList.toggle('sel', i === l && ci === c); }));
  rm.lnames.forEach((e, i) => { if (e) e.classList.toggle('sel', i === l); });
}
function rmShowTab(root) {
  const s = rm.s, n = s.layers.length, grid = el('div', { className: 'grid' });
  grid.style.setProperty('--cols', s.cols);
  grid.append(el('div', { className: 'corner', textContent: 'Scenes' }));
  for (let c = 0; c < s.cols; c++) grid.append(rmSceneBtn(c));
  for (let i = n - 1; i >= 0; i--) {
    const L = s.layers[i], name = el('div', { className: 'lname' },
      el('div', { className: 'row' }, el('div', { className: 'name', textContent: L.name, title: L.name }), rmToggle('B', 'layer:' + i + ':bypass', 'y' + i, 'sq shrink')),
      rmSlider('layer:' + i + ':opacity', 'o' + i));
    rm.lnames[i] = name;
    grid.append(name);
    for (let c = 0; c < s.cols; c++) { const clip = L.clips[c]; grid.append(clip ? rmTile(i, c, clip) : el('div', { className: 'cell-empty' })); }
    rmLayerLive(i);
  }
  rmBind('sl', rmSelMark); rmBind('sc', rmSelMark);
  const side = el('div', { className: 'side' }, rmH3('Output'), rmOutputCard(), rmH3('Knobs'), rmKnobs(), rmH3('Tempo'), rmTempoCard(), rmH3('Snapshots'), rmSnaps(), el('div', { style: { height: '10px' } }), rmStopAll());
  root.append(el('div', { className: 'show' }, side, el('div', { className: 'main' }, grid)));
}
// the beat dots run on this phone's clock between patches
setInterval(() => {
  const d = document.getElementById('beatDots');
  if (!d || rm.phase !== 'live') return;
  const b = (rm.v.bt || 0) + (rmNow() - rm.btAt) / 60000 * (rm.v.bpm || 120), at = ((Math.floor(b) % 4) + 4) % 4;
  [...d.children].forEach((x, i) => x.classList.toggle('on', i === at));
}, 40);
// A hold-to-apply effect: on while a finger is down (or tapped on and off with Latch). The host lets go of all of
// them when this phone goes quiet.
function rmPad(name, on) {
  if (on === rm.pads.has(name)) return;
  if (on) rm.pads.add(name); else rm.pads.delete(name);
  rmSend({ t: 'fx', name, on });
}
function rmPads(root) {
  const names = rm.s.pads || [];
  if (!names.length) return;
  const pads = el('div', { className: 'pads' });
  for (const name of names) {
    const b = el('button', { textContent: name, className: rm.pads.has(name) ? 'held' : '' });
    b.addEventListener('pointerdown', e => {
      if (rm.latch) rmPad(name, !rm.pads.has(name)); else { rmPad(name, true); try { b.setPointerCapture(e.pointerId); } catch (err) {} }
      b.classList.toggle('held', rm.pads.has(name));
    });
    const up = () => { if (!rm.latch) { rmPad(name, false); b.classList.remove('held'); } };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
    pads.append(b);
  }
  const latch = rmBtn('Latch', () => { rm.latch = !rm.latch; if (!rm.latch) [...rm.pads].forEach(n => rmPad(n, false)); rmBuild(); }, 'shrink' + (rm.latch ? ' on' : ''));
  root.append(el('div', { className: 'row', style: { margin: '20px 2px 8px' } }, el('h3', { textContent: 'Hold effects', style: { margin: '0' } }), latch),
    pads, rmHint(rm.latch ? 'Tap an effect to turn it on or off.' : 'Hold an effect: it is on while your finger is down.'));
}
function rmFxTab(root) {
  const s = rm.s, card = (title, sub, ...kids) => el('div', { className: 'card' }, el('div', { className: 'row' }, el('div', { className: 'name' }, title, el('small', { textContent: sub })), kids.shift()), ...kids);
  const lab = (name, input) => [el('div', { className: 'lab' }, el('span', { textContent: name })), input];
  for (const g of s.gens || []) {
    const pre = 'gen:' + g.u + ':';
    root.append(card(g.n, 'Playing on ' + g.o, null, ...g.p.flatMap((name, k) => lab(name, rmSlider(pre + k, pre + k))), ...(g.trail ? lab('Trails', rmSlider(pre + 'trail', pre + 'trail')) : [])));
  }
  for (const e of s.fx || []) {
    const pre = 'fx:' + e.u + ':';
    root.append(card(e.d, e.o, rmToggle('On', pre + 'bypass', pre + 'bypass', 'shrink', true), ...e.p.flatMap((name, k) => lab(name, rmSlider(pre + k, pre + k))), ...(e.mix ? lab('Mix', rmSlider(pre + 'mix', pre + 'mix')) : [])));
  }
  if (root.childElementCount) root.prepend(rmH3('Playing visuals and effects'));
  const sliders = root.childElementCount > 0, top = document.createDocumentFragment();
  rmPads(top);
  root.prepend(top);
  if (!sliders) root.append(rmHint('No effect sliders in this show yet. Add effects on the computer and they appear here.'));
}
function rmAgentTab(root) {
  const go = rmBtn('Start the Agent', () => rmFire('agent:on'), 'big pri'), vibe = rmHint('');
  rmBind('ag', v => { go.textContent = v ? 'Stop the Agent' : 'Start the Agent'; go.classList.toggle('pri', !v); go.classList.toggle('on', !!v); });
  rmBind('av', v => { vibe.textContent = v ? 'Vibe: ' + v + '. The vibe and the playlist are set on the computer.' : ''; });
  root.append(rmH3('Agent'), go, el('div', { className: 'row', style: { marginTop: '10px' } },
    rmBtn('Next look', () => rmFire('agent:next')), rmToggle('Hold', 'agent:hold', 'ah'), rmBtn('Drop!', () => rmFire('agent:drop'))), vibe);
}

// ---------- a gamepad on this device plays the computer ----------
// Every standard pad here counts as one (as on the computer). Buttons go on the channel that never drops. Sticks go on
// the one that may drop, as all four axes at once, at most 30 times a second and again every 100 ms while one is pushed,
// so a lost message is replaced at once; a stick back at rest goes on the reliable channel. Raw values: the computer
// applies its own dead zone, stick modes and mappings.
// Read on a timer, not on animation frames: a window that is covered gets no frames, and a pad pushed just then would
// stay pushed on the computer. While this page is hidden or not focused the pad counts as let go (browsers stop
// reporting it then), and that is sent at once.
function rmPadReset() { rm.padSt.b = []; rm.padSt.a = [0, 0, 0, 0]; rm.padSt.at = 0; }
const rmPadIdle = () => document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus() && window.top === window);
function rmPadPoll() {
  if (rm.phase !== 'live' || !navigator.getGamepads) return;
  let list = [];
  if (!rmPadIdle()) { try { list = [...(navigator.getGamepads() || [])]; } catch (e) { return; } }
  const pads = list.filter(g => g && g.connected && g.mapping === 'standard'), P = rm.padSt;
  if (!pads.length && !P.seen) return;
  if (pads.length && !P.seen) { P.seen = true; rmToast('Controller found: it plays the show on ' + rm.host + '. Hold View for what each button does.'); }
  const b = [];
  for (let n = 0; n < 17; n++) {
    let v = 0;
    for (const g of pads) { const x = g.buttons[n]; if (x) v = Math.max(v, x.value || (x.pressed ? 1 : 0)); }
    v = Math.round(v * 20) / 20;
    if (v !== (P.b[n] || 0)) { P.b[n] = v; b.push([n, v]); }
  }
  if (b.length) rmSend({ t: 'pad', b });
  const a = [0, 1, 2, 3].map(n => { let raw = 0; for (const g of pads) { const x = g.axes[n] || 0; if (Math.abs(x) > Math.abs(raw)) raw = x; } return Math.abs(raw) < 0.05 ? 0 : Math.round(raw * 100) / 100; });
  const changed = a.some((v, n) => v !== P.a[n]), held = a.some(v => v !== 0), now = rmNow();
  if ((changed && now - P.at >= 33) || (held && now - P.at >= 100)) {
    P.a = a; P.at = now;
    rmSend({ t: 'pad', a: a.map((v, n) => [n, v]) }, held);   // at rest: the reliable channel
  }
}
// The computer's cheat-sheet for its gamepad mappings, while View is held on this device's pad.
function rmOverlay(rows, shift) {
  const o = $('ovl');
  if (!Array.isArray(rows)) { o.hidden = true; return; }
  o.replaceChildren(el('h3', { textContent: 'Controller on ' + (rm.host || 'the computer') + (shift ? ': Shift held' : '') }),
    el('div', { className: 'rows' }, ...rows.slice(0, 40).flatMap(r => [el('b', { textContent: String((r && r[0]) || '').slice(0, 60) }), el('span', { textContent: String((r && r[1]) || '').slice(0, 120) })])));
  o.hidden = false;
}
// The desktop app's Remote mode: back to this computer's own show.
function rmLeaveDesk() { if (rm.phase === 'live') rmSend({ t: 'bye' }); setTimeout(() => RM_DESK.set(false), 150); }

// ---------- start ----------
$('black').addEventListener('click', () => rmFire('blackout'));
$('pvBtn').addEventListener('click', () => {
  rm.prefs.preview = { mid: 'low', low: 'off', off: 'mid' }[rm.prefs.preview];
  rmLS.set(RM_PREFS, rm.prefs);
  rmMon(); if (rm.phase === 'live') rmView();
});
$('code').addEventListener('input', e => { const c = e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase(); e.target.value = c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c; });
$('codeForm').addEventListener('submit', e => {
  e.preventDefault();
  const typed = $('code').value, ids = rlParseLink(typed), code = rlCleanCode(typed);
  if (ids) { rm.room = ids.room; rm.secret = ids.secret; rm.key = rmKeyFor(ids.room); rmConnect(ids.room, ids.secret); return; }   // a pasted link works too
  if (!code) { rmCover('enter', 'A code is 8 letters and digits, like ABCD-EFGH. It never has 0, 1, O or L.', true); return; }
  const c = rlCodeIds(code);
  rmConnect(c.room, c.secret, true);
});
document.body.classList.toggle('wide', RM_WIDE.matches);
RM_WIDE.addEventListener('change', () => { document.body.classList.toggle('wide', RM_WIDE.matches); rmTabs(); if (rm.s) rmBuild(); });
if (RM_DESK) {
  const b = $('backLink'), x = $('exitBtn');
  b.textContent = 'Back to the show on this computer'; b.href = '#'; b.onclick = e => { e.preventDefault(); rmLeaveDesk(); };
  x.hidden = false; x.onclick = () => armThen(x, 'leave Remote mode', rmLeaveDesk);
}
setInterval(rmPadPoll, 16);
for (const ev of ['blur', 'visibilitychange']) window.addEventListener(ev, () => rmPadPoll());   // let go at once
(async function rmStart() {
  if (RM_DESK) { try { const r = await RM_DESK.get(); if (r && r.name) rm.deskName = String(r.name).slice(0, 40); } catch (e) {} }
  rmTabs();
  const ids = rlParseLink(location.hash);
  if (!ids) return rmEnter();
  rm.room = ids.room; rm.secret = ids.secret; rm.key = rmKeyFor(ids.room);
  rmConnect(ids.room, ids.secret);
})();
window.addEventListener('hashchange', () => { const ids = rlParseLink(location.hash); if (ids && ids.room !== rm.room) location.reload(); });
