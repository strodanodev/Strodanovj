// Web link output: a screen sent over the internet with the VDO.Ninja SDK, watched by opening a link. GPL-3.0.
// The SDK (vendor/vdoninja-sdk.min.js, MPL-2.0, v1.6.2 from npm @vdoninja/sdk) is loaded on the first Start, as a
// classic script, so it works from file://. Media goes peer to peer (WebRTC); vdo.ninja's servers only introduce the
// two ends (and relay through TURN when a direct path fails). Each viewer is its own copy of the stream from this
// computer, so upload bandwidth limits the audience: ~bitrate x viewers.
// Per frame (ui.js frame loop, after the output windows): renderScreen (slices, warps and masks as for a window) into
// the GL canvas' back buffer, drawImage into a 2D canvas whose captureStream is published, as record.js does.
// Screen fields (saved): vdoId (stream ID), vdoPw (password: the link works as the key), vdoRes 'WxH' | 'comp',
// vdoFps, vdoKbps, vdoAudio (send the final mix). Live state (not saved): s.vdoSend.
// salt 'vdo.ninja' is passed always: the SDK otherwise derives it from the page's host name, which is empty on file://.
'use strict';
const vdo = { loading: null };
const VDO_SIZES = [['1280x720', '1280 x 720'], ['960x540', '960 x 540 (slow upload)'], ['1920x1080', '1920 x 1080 (fast upload)'], ['comp', 'Composition size']];
const VDO_FPS = [25, 30, 60];
const VDO_KBPS = [[1500, '1.5 Mbps'], [2500, '2.5 Mbps'], [4000, '4 Mbps'], [6000, '6 Mbps'], [10000, '10 Mbps']];
const VDO_VIEWER = 'https://vdo.ninja/';
// The link people get is our own branded viewer (watch.html, served at <site>/live/<name>#<password>): the phone edition's
// own site when the page runs from one (https, not localhost), else vj.strodano.live. The password rides in the #fragment,
// so it never reaches a server log. The same stream also plays at vdo.ninja (vdoNinjaLink), e.g. for vdo.ninja's own tools.
const VDO_SITE = typeof location !== 'undefined' && location.protocol === 'https:' && !/^(localhost|127\.|\[::1\])/.test(location.hostname) ? location.origin : 'https://vj.strodano.live';
// a link name typed by a person: lower-case letters, digits and _ only (spaces and dashes become _), 4..40 long
const vdoCleanName = t => String(t || '').trim().replace(/[\s-]+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40).toLowerCase();
const vdoRand = n => { const a = crypto.getRandomValues(new Uint8Array(n)), c = 'abcdefghijkmnpqrstuvwxyz23456789'; return Array.from(a, b => c[b % c.length]).join(''); };
// IDs and passwords are letters and digits only: nothing to escape in the link, nothing the SDK rewrites
function vdoEnsureIds(s) {
  if (!/^[A-Za-z0-9_]{4,64}$/.test(s.vdoId || '')) s.vdoId = 'svj_' + vdoRand(10);
  if (!/^[A-Za-z0-9]{6,64}$/.test(s.vdoPw || '')) s.vdoPw = vdoRand(12);
}
function vdoLink(s) { vdoEnsureIds(s); return VDO_SITE + '/live/' + s.vdoId + '#' + s.vdoPw; }
function vdoNinjaLink(s) { vdoEnsureIds(s); return VDO_VIEWER + '?view=' + s.vdoId + '&password=' + s.vdoPw; }
// Rename the link (keeps the password). Returns an error message, or '' when done; a live link restarts under the new name.
function vdoRename(i, text) {
  const s = screens[i], n = vdoCleanName(text);
  if (!s) return 'No screen';
  if (n.length < 4) return 'A link name needs at least 4 letters or digits';
  if (n === s.vdoId) return '';
  s.vdoId = n; vdoEnsureIds(s); vdoRestart(i);
  return '';
}
function vdoSize(s) {
  const r = s.vdoRes || '1280x720';
  let w, h;
  if (r === 'comp') { w = comp.w; h = comp.h; } else { [w, h] = r.split('x').map(Number); if (!(w > 0 && h > 0)) { w = 1280; h = 720; } }
  return [Math.min(3840, w) & ~1, Math.min(2160, h) & ~1];   // encoders want even sizes
}
const vdoLive = () => screens.filter(s => s.vdoSend);

function vdoLoad() {
  if (window.VDONinjaSDK) return Promise.resolve(true);
  if (!vdo.loading) vdo.loading = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'vendor/vdoninja-sdk.min.js';
    sc.onload = () => res(!!window.VDONinjaSDK);
    sc.onerror = () => { vdo.loading = null; res(false); };
    document.head.append(sc);
  });
  return vdo.loading;
}

async function vdoStart(i) {
  const s = screens[i];
  if (!s || s.vdoSend) return !!s;
  vdoEnsureIds(s);
  const [w, h] = vdoSize(s), fps = s.vdoFps || 30;
  const n = { sdk: null, canvas: null, cx: null, stream: null, dest: null, viewers: new Set(), relayed: 0, state: 'connecting', error: '', next: 0, sent: 0, n0: 0, t0: performance.now(), fpsOut: 0, w, h, qTimer: 0 };
  s.vdoSend = n;
  syncOutBtn(); refreshOutPanels();
  const fail = msg => { if (s.vdoSend === n) { vdoFree(n); s.vdoSend = null; } setStatus('Web link: ' + msg); syncOutBtn(); refreshOutPanels(); return false; };
  if (!window.RTCPeerConnection) return fail('this browser has no WebRTC.');
  if (!(await vdoLoad())) return fail('could not load vendor/vdoninja-sdk.min.js.');
  if (s.vdoSend !== n) return false;   // stopped meanwhile
  n.canvas = document.createElement('canvas'); n.canvas.width = w; n.canvas.height = h;
  n.cx = n.canvas.getContext('2d', { alpha: false });
  n.cx.fillStyle = '#000'; n.cx.fillRect(0, 0, w, h);
  const tracks = n.canvas.captureStream(fps).getVideoTracks();
  if (s.vdoAudio) {
    try {
      audioCtx();
      n.dest = audio.ctx.createMediaStreamDestination();
      audio.out.connect(n.dest);
      if (live.micNode) live.micNode.connect(n.dest);
      tracks.push(...n.dest.stream.getAudioTracks());
    } catch (e) { n.dest = null; }
  }
  n.stream = new MediaStream(tracks);
  try {
    const sdk = n.sdk = new VDONinjaSDK({ salt: 'vdo.ninja', password: s.vdoPw });
    const upd = () => { if (s.vdoSend === n) refreshOutPanels(); };
    sdk.addEventListener('peerConnected', e => { n.viewers.add(e.detail.uuid); upd(); });
    sdk.addEventListener('peerDisconnected', e => { n.viewers.delete(e.detail.uuid); upd(); });
    sdk.addEventListener('reconnecting', () => { n.state = 'reconnecting'; });
    sdk.addEventListener('reconnected', () => { n.state = 'live'; });
    sdk.addEventListener('reconnectFailed', () => { n.state = 'error'; n.error = 'lost the connection to the server'; upd(); });
    sdk.addEventListener('error', e => { n.error = String((e.detail && (e.detail.message || e.detail.error)) || 'error'); });
    await sdk.connect();
    if (s.vdoSend !== n) { sdk.disconnect().catch(() => {}); return false; }
    // bitrates in kbps (the SDK reads a number under 10000 as kbps)
    await sdk.publish(n.stream, { streamID: s.vdoId, label: String(s.name || 'Strodano VJ').slice(0, 60),
      media: { video: { maxBitrate: s.vdoKbps || 2500, frameRate: fps }, audio: { maxBitrate: 160 } } });
  } catch (e) { return fail(e && e.message ? e.message : String(e)); }
  if (s.vdoSend !== n) return false;
  n.state = 'live'; n.error = '';
  n.qTimer = setInterval(() => vdoQuality(n), 2000);
  setStatus('Web link live: ' + vdoLink(s));
  syncOutBtn(); refreshOutPanels();
  return true;
}
async function vdoQuality(n) {
  if (!n.sdk || !n.sdk.getPeerQuality) return;
  let r = 0;
  for (const u of n.viewers) { try { const q = await n.sdk.getPeerQuality(u); if (q && q.relayed) r++; } catch (e) {} }
  n.relayed = r;
}
function vdoStop(s) {
  const n = s && s.vdoSend;
  if (!n) return;
  s.vdoSend = null;
  vdoFree(n);
}
function vdoFree(n) {
  clearInterval(n.qTimer);
  if (n.sdk) { const sdk = n.sdk; n.sdk = null; try { sdk.stopPublishing(); } catch (e) {} sdk.disconnect().catch(() => {}); }
  if (n.dest) { try { audio.out.disconnect(n.dest); } catch (e) {} try { if (live.micNode) live.micNode.disconnect(n.dest); } catch (e) {} n.dest = null; }
  if (n.stream) n.stream.getTracks().forEach(t => t.stop());
  n.stream = null; n.canvas = null; n.cx = null; n.viewers.clear();
}
// restart a running link after a setting changed (same ID and password: viewers reconnect by themselves)
function vdoRestart(i) { const s = screens[i]; if (s && s.vdoSend) { vdoStop(s); vdoStart(i); } }

// called from the frame loop (ui.js) after the output windows are drawn
function vdoTick(now) {
  for (const s of screens) {
    const n = s.vdoSend;
    if (!n || !n.cx) continue;
    const per = 1000 / (s.vdoFps || 30);
    if (now < n.next) continue;
    n.next = now - n.next > per * 3 ? now + per : n.next + per;
    const w = n.w, h = n.h;
    renderScreen(s, w, h);
    n.cx.drawImage(glc, 0, glc.height - h, w, h, 0, 0, w, h);
    n.sent++;
    if (now - n.t0 >= 1000) { n.fpsOut = (n.sent - n.n0) * 1000 / (now - n.t0); n.n0 = n.sent; n.t0 = now; }
  }
}

// Advanced Output: Web link settings of the selected screen (shown when its device is 'vdo')
function vdoPanel(scr, i) {
  vdoEnsureIds(scr);
  const n = scr.vdoSend, link = vdoLink(scr), out = [];
  const sel = (opts, v, set) => { const e = el('select', { onchange: ev => { set(ev.target.value); vdoRestart(i); refreshOutPanels(); } }); for (const [k, t] of opts) e.append(el('option', { value: k, textContent: t })); e.value = String(v); return e; };
  const linkBox = el('input', { type: 'text', value: link, readOnly: true, onfocus: e => e.target.select() });
  out.push(el('div', { className: 'fld' }, el('label', { textContent: 'Link' }), linkBox),
    el('div', { className: 'fld' },
      el('button', { textContent: 'Copy link', onclick: () => { (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => setStatus('Link copied: anyone with it can watch'), () => { linkBox.focus(); linkBox.select(); setStatus('Press Ctrl+C to copy the link'); }); } }),
      el('button', { textContent: 'Watch', title: 'Open the link in the browser', onclick: () => window.open(link, '_blank', 'noopener') }),
      el('button', { textContent: 'New link', title: 'New ID and password: the old link stops working', onclick: () => { scr.vdoId = ''; scr.vdoPw = ''; vdoEnsureIds(scr); vdoRestart(i); refreshOutPanels(); } })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Link name' }), el('input', { type: 'text', value: scr.vdoId, spellcheck: false, title: 'Letters, digits and _ (4 to 40). Pick something only you would use: the old link stops working.',
      onchange: e => { const err = vdoRename(i, e.target.value); setStatus(err || 'Link renamed: ' + vdoLink(scr)); refreshOutPanels(); } })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Size' }), sel(VDO_SIZES, scr.vdoRes || '1280x720', v => { scr.vdoRes = v; })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Frame rate' }), sel(VDO_FPS.map(v => [v, v + ' fps']), scr.vdoFps || 30, v => { scr.vdoFps = +v; })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Bitrate' }), sel(VDO_KBPS, scr.vdoKbps || 2500, v => { scr.vdoKbps = +v; })),
    el('div', { className: 'fld' }, el('label', { textContent: 'Sound' }), el('label', { style: { flex: '1', color: 'var(--dim)' } },
      el('input', { type: 'checkbox', checked: !!scr.vdoAudio, onchange: e => { scr.vdoAudio = e.target.checked; vdoRestart(i); } }), ' Send the music mix')));
  if (n) out.push(el('div', { className: 'hint vdo-meter', textContent: vdoLine(scr) }));
  else out.push(el('div', { className: 'hint', textContent: 'Each viewer takes about ' + ((scr.vdoKbps || 2500) / 1000) + ' Mbps of this computer\'s upload. Anyone with the link can watch.' }));
  return out;
}
function vdoLine(s) {
  const n = s.vdoSend;
  if (!n) return '';
  if (n.error && n.state !== 'live') return 'Web link error: ' + n.error;
  if (n.state === 'connecting') return 'Connecting...';
  if (n.state === 'reconnecting') return 'Connection lost, reconnecting...';
  const v = n.viewers.size;
  return `Live ${n.w} x ${n.h} at ${n.fpsOut.toFixed(0)} fps, ${v} viewer${v === 1 ? '' : 's'}` + (n.relayed ? ` (${n.relayed} relayed)` : '') + (v ? '' : ' (none yet: open the link)');
}
function tickVdoUI() {
  const m = document.querySelector('#outProps .vdo-meter');
  if (m) { const s = screens[outUI.screen], t = vdoLine(s); if (m.textContent !== t) m.textContent = t; }
}
setInterval(tickVdoUI, 500);
