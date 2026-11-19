// NDI network output (desktop app only). GPL-3.0.
// A screen whose `device` is 'ndi' is not a window: it is sent over the network (wired or Wi-Fi) as an NDI source that
// Resolume, OBS, vMix, NDI Studio Monitor, a second Strodano VJ... on the same network can pick up. NDI(R) is a
// registered trademark of Vizrt NDI AB; the NDI Runtime is the user's own install (desktop/ndi-worker.js finds it).
// Per frame, on the render thread: renderScreen (slices, warps and masks as for a window) at the screen's NDI size into
// a texture, pack it to UYVY 4:2:2 (BT.709, NDI's own format: half the bytes of RGBA, no conversion in NDI) and
// flip it top-row-first in one shader pass, readPixels into a pixel buffer with a fence (no GPU stall). A frame or two
// later, once the fence has passed: getBufferSubData (the only real cost here, ~2 ms at 720p, ~4 ms at 1080p) into a
// pooled ArrayBuffer, which is transferred (not copied) to a Web Worker that POSTs it to the desktop app's loopback
// frame endpoint (desktop/ndi-worker.js). Measured on an RTX 3080 Ti laptop: 720p30 steady (1.8 ms of render thread,
// 0 dropped); 1080p 18-21 fps (Chromium's loopback upload, ~70 ms per 4 MB frame, is the limit). Tried first and
// dropped: RGBA through Electron IPC (~25 ms of render thread per 1080p frame), MessagePortMain (stalls the main
// process), an offscreen window (Electron does not paint offscreen pop-ups), a WebSocket (no faster than POST).
// At most NDI_INFLIGHT (3) frames on their way; past that frames are dropped, never queued, so the receiver never lags
// behind. Measured 2026-11-19 (same laptop, 165 Hz display, NDI receiver timing every frame): 720p30 30.0 fps, 1 ms
// spread, 0 dropped; 720p60 ~41 fps and 1080p30 ~21 fps (the loopback upload, ~90 MB/s, is the cap).
// Screen fields (saved): ndiName, ndiRes 'WxH' | 'comp', ndiFps. Live state (not saved): s.ndiSend.
'use strict';
const ndi = {
  api: window.strodanoDesktop && window.strodanoDesktop.ndi,
  status: null,   // {ok, error, version, port, token} from the desktop app
  worker: null,   // the Web Worker that POSTs frames
  pool: [],       // ArrayBuffers coming back from the worker, by size
  prog: null,     // RGBA -> UYVY packing shader
};
// 720p30 is the steady one (Wi-Fi: ~60-90 Mbit/s); 1080p reaches ~20 fps (the page's loopback upload is the limit)
const NDI_SIZES = [['1280x720', '1280 x 720 (best for Wi-Fi)'], ['960x540', '960 x 540 (weak Wi-Fi)'], ['1920x1080', '1920 x 1080 (about 20 fps)'], ['comp', 'Composition size']];
const NDI_FPS = [25, 30, 50, 60];
// frames on their way to the sender at once: the loopback round trip is ~30 ms at 720p and ~80 ms at 1080p, so 2 capped
// 720p60 at ~35 fps and 1080p30 at ~17
const NDI_INFLIGHT = 3;
const ndiName = s => (s.ndiName || 'Strodano VJ ' + s.name).trim().slice(0, 100);
function ndiSize(s) {
  const r = s.ndiRes || '1280x720';
  let w, h;
  if (r === 'comp') { w = comp.w; h = comp.h; } else { [w, h] = r.split('x').map(Number); if (!(w > 0 && h > 0)) { w = 1280; h = 720; } }
  return [Math.min(7680, w) & ~1, Math.min(4320, h)];   // UYVY packs two pixels per texel: even width
}
const ndiLive = () => screens.filter(s => s.ndiSend);

async function ndiStatus() {
  if (!ndi.api) return { ok: false, error: 'NDI output needs the desktop app.' };
  if (!ndi.status || !ndi.status.ok) { try { ndi.status = await ndi.api.status(); } catch (e) { ndi.status = { ok: false, error: String(e.message || e) }; } }
  return ndi.status;
}
async function ndiStart(i) {
  const s = screens[i];
  if (!s || s.ndiSend) return !!s;
  const st = await ndiStatus();
  if (!st.ok) { setStatus(st.error); ui.propsDirty = true; refreshOutPanels(); return false; }
  if (s.ndiSend) return true;   // started twice while the status was coming
  const name = ndiName(s), n = { id: name, name, fbo: null, pack: null, pbos: [], pending: [], k: 0, next: 0, inflight: 0, conns: 0, sent: 0, dropped: 0, dropGpu: 0, dropNet: 0, rttMax: 0, fpsOut: 0, n0: 0, t0: performance.now(), w: 0, h: 0, error: '' };
  s.ndiSend = n;
  try {
    const r = await ndi.api.start(name, name);
    if (r && r.ok === false) throw new Error(r.error);
  } catch (e) { ndiFree(n); if (s.ndiSend === n) s.ndiSend = null; setStatus('NDI: ' + (e.message || e)); refreshOutPanels(); return false; }
  if (s.ndiSend !== n) return false;   // stopped meanwhile
  setStatus('NDI: sending "' + name + '" on the network');
  syncOutBtn(); refreshOutPanels();
  ndiWarnFirewall();
  return true;
}
function ndiStop(s) {
  const n = s && s.ndiSend;
  if (!n) return;
  s.ndiSend = null;
  ndiFree(n);
  if (ndi.api) ndi.api.stop(n.id).catch(() => {});
}
function ndiFree(n) {
  for (const p of n.pending) gl.deleteSync(p.fence);
  for (const b of n.pbos) gl.deleteBuffer(b);
  freeFbo(n.fbo); freeFbo(n.pack);
  n.pending = []; n.pbos = []; n.fbo = n.pack = null;
}
const refreshOutPanels = () => { if (typeof renderOutPanels === 'function' && !$('outModal').hidden) renderOutPanels(); };

// RGBA -> UYVY (BT.709, video range), two pixels per output texel (U, Y0, V, Y1), rows flipped so the top row is read first
function ndiPackProg() {
  if (!ndi.prog) ndi.prog = mkProg(HEAD + `uniform sampler2D tex; uniform int h; out vec4 o;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int y = h - 1 - q.y;
  vec3 a = texelFetch(tex, ivec2(q.x * 2, y), 0).rgb, b = texelFetch(tex, ivec2(q.x * 2 + 1, y), 0).rgb;
  const vec3 K = vec3(0.2126, 0.7152, 0.0722);
  float ya = dot(a, K), yb = dot(b, K);
  vec3 m = (a + b) * 0.5; float ym = dot(m, K);
  float u = (m.b - ym) / 1.8556, v = (m.r - ym) / 1.5748;
  o = vec4((128.0 + 224.0 * u) / 255.0, (16.0 + 219.0 * ya) / 255.0, (128.0 + 224.0 * v) / 255.0, (16.0 + 219.0 * yb) / 255.0);
}`);
  return ndi.prog;
}
// the Web Worker that sends frames (Blob URL: works from file:// too)
function ndiWorker() {
  if (ndi.worker) return ndi.worker;
  ndi.worker = new Worker(URL.createObjectURL(new Blob([`'use strict';
onmessage = async e => {
  const { url, buf, key } = e.data;
  let r;
  try { const res = await fetch(url, { method: 'POST', body: buf, cache: 'no-store' }); r = await res.json(); }
  catch (x) { r = { ok: false, error: 'the desktop app did not take the frame (' + (x.message || x) + ')' }; }
  postMessage({ key, r, buf }, [buf]);   // the buffer comes back for the next frame
};`], { type: 'text/javascript' })));
  ndi.worker.onmessage = e => {
    const { key, r, buf } = e.data;
    if (buf && buf.byteLength) { ndi.pool.push(buf); if (ndi.pool.length > 6) ndi.pool.shift(); }
    const n = ndi.byKey.get(key.n);
    ndi.byKey.delete(key.n);
    if (!n) return;
    n.inflight--;
    if (!screens.some(x => x.ndiSend === n)) return;   // stopped meanwhile
    if (!r || r.ok === false) { n.error = (r && r.error) || 'NDI error'; return; }
    n.error = ''; n.sent++; n.conns = r.conns | 0; n.ms = r.ms; n.rtt = performance.now() - key.at; if (n.rtt > n.rttMax) n.rttMax = n.rtt;
  };
  return ndi.worker;
}
ndi.byKey = new Map(); ndi.seq = 0;

// called from the frame loop (ui.js) after the output windows are drawn
function ndiTick(now) {
  // the display's frame interval (smoothed): a send is due on the display frame NEAREST its time, not the first one at or
  // after it, or display frames landing right on the boundary flip between early and late (16 / 50 ms gaps at 30 on 60 Hz)
  const tick = ndi.lastNow ? now - ndi.lastNow : 0;
  ndi.lastNow = now;
  if (tick > 0 && tick < 100) ndi.tickDt = ndi.tickDt ? ndi.tickDt * 0.95 + tick * 0.05 : tick;
  for (const s of screens) {
    const n = s.ndiSend;
    if (!n) continue;
    ndiCollect(n, s);
    const per = 1000 / (s.ndiFps || 30);
    if (now < n.next - Math.min(per, ndi.tickDt || 0) / 2) continue;
    n.next = now - n.next > per * 3 ? now + per : n.next + per;   // steady pacing; after a stall, start again from now
    if (n.pending.length >= 2) { n.dropped++; n.dropGpu++; continue; }   // the GPU has not caught up with the last two reads
    const [w, h] = ndiSize(s), size = w * h * 2;
    if (n.w !== w || n.h !== h) { ndiFree(n); n.w = w; n.h = h; }
    if (!n.fbo) { n.fbo = mkFbo(w, h); n.pack = mkFbo(w / 2, h); }
    if (!n.pbos.length) for (let k = 0; k < 3; k++) { const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ); n.pbos.push(b); }
    renderScreen(s, w, h, n.fbo);   // straight into a texture (the canvas has no alpha, so it cannot be copied into RGBA)
    bindFbo(n.pack);
    const P = ndiPackProg();
    gl.useProgram(P.p); bindTex(0, n.fbo.tex); gl.uniform1i(P.loc('tex'), 0); gl.uniform1i(P.loc('h'), h);
    tri();
    const pbo = n.pbos[n.k++ % n.pbos.length];
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.readPixels(0, 0, w / 2, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    n.pending.push({ pbo, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), w, h });
    gl.flush();
  }
}
function ndiCollect(n, s) {
  while (n.pending.length) {
    const p = n.pending[0], st = gl.clientWaitSync(p.fence, 0, 0);
    if (st === gl.TIMEOUT_EXPIRED) return;
    n.pending.shift(); gl.deleteSync(p.fence);
    if (st === gl.WAIT_FAILED || p.w !== n.w || p.h !== n.h) continue;
    if (n.inflight >= NDI_INFLIGHT) { n.dropped++; n.dropNet++; continue; }   // the network side is still busy: skip, never queue
    const size = p.w * p.h * 2, i = ndi.pool.findIndex(b => b.byteLength === size);
    const buf = i >= 0 ? ndi.pool.splice(i, 1)[0] : new ArrayBuffer(size);
    const r0 = performance.now();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, new Uint8Array(buf));
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    n.readMs = performance.now() - r0;   // render-thread cost of a frame (for the self-test)
    n.inflight++;
    const st2 = ndi.status, key = { id: n.id, n: ++ndi.seq, at: performance.now() };
    ndi.byKey.set(key.n, n);
    const url = `http://127.0.0.1:${st2.port}/frame?t=${encodeURIComponent(st2.token)}&id=${encodeURIComponent(n.id)}&w=${p.w}&h=${p.h}&fps=${s.ndiFps || 30}`;
    ndiWorker().postMessage({ url, buf, key }, [buf]);
  }
}
// sent frames per second and receivers, for the panel and the status line
function ndiMeter() {
  const now = performance.now();
  for (const s of screens) {
    const n = s.ndiSend;
    if (!n || now - n.t0 < 1000) continue;
    n.fpsOut = (n.sent - n.n0) * 1000 / (now - n.t0); n.n0 = n.sent; n.t0 = now;
  }
}
setInterval(ndiMeter, 1000);

// Advanced Output: NDI settings of the selected screen (shown when its device is NDI)
function ndiPanel(scr, i) {
  const n = scr.ndiSend, out = [];
  if (!ndi.api) return [el('div', { className: 'hint', textContent: 'NDI output works in the Strodano VJ desktop app.' })];
  const restart = () => { if (scr.ndiSend) { ndiStop(scr); ndiStart(i); } else refreshOutPanels(); };
  const name = el('input', { type: 'text', value: ndiName(scr), maxLength: 100, onchange: e => { scr.ndiName = e.target.value.trim() || ''; restart(); } });
  const size = el('select', { onchange: e => { scr.ndiRes = e.target.value; refreshOutPanels(); } });
  for (const [v, t] of NDI_SIZES) size.append(el('option', { value: v, textContent: t }));
  size.value = scr.ndiRes || '1280x720';
  const fps = el('select', { onchange: e => { scr.ndiFps = +e.target.value; refreshOutPanels(); } });
  for (const v of NDI_FPS) fps.append(el('option', { value: v, textContent: v + ' fps' }));
  fps.value = String(scr.ndiFps || 30);
  out.push(el('div', { className: 'fld' }, el('label', { textContent: 'NDI name' }), name),
    el('div', { className: 'fld' }, el('label', { textContent: 'Size' }), size),
    el('div', { className: 'fld' }, el('label', { textContent: 'Frame rate' }), fps));
  const st = ndi.status;
  if (st && !st.ok) out.push(el('div', { className: 'hint', style: { color: 'var(--bad)' }, textContent: st.error }),
    el('a', { href: 'https://ndi.video/tools/', target: '_blank', rel: 'noopener', textContent: 'Get NDI Tools (free)' }));
  else if (n) out.push(el('div', { className: 'hint ndi-meter', textContent: ndiLine(scr) }));
  else out.push(el('div', { className: 'hint', textContent: 'Receivers on the same network (Wi-Fi or cable) see it as "' + ndiName(scr) + '" under this computer\'s name.' }));
  return out;
}
// the Network section, under the Start NDI button (ui.js renderOutPanels)
function ndiNetSection() {
  const st = ndi.status;
  if (!ndi.api || (st && !st.ok)) return [];
  const box = el('div', { className: 'ndi-net' });
  ndiNetPanel(box);
  return [el('h4', { textContent: 'Network' }), box];
}

// --- Network: why another computer may not see the source, and what to do (desktop/ndinet.js, desktop/ndi.js) ---
// 1. this computer's firewall (checked; Windows: fixed with one admin prompt), 2. the venue network (not fixable from
// here: the addresses to type into NDI Access Manager on the receiving computer), 3. a Discovery Server and the
// network adapter NDI uses (app settings; changing them restarts the sender and the running NDI screens).
ndi.net = null; ndi.netAt = 0; ndi.netBusy = null; ndi.settings = null;
async function ndiNetCheck(force) {
  if (!ndi.api || !ndi.api.netcheck) return null;
  if (ndi.netBusy) return ndi.netBusy;   // one check at a time; callers share it
  return ndi.netBusy = (async () => {
    try { ndi.net = await ndi.api.netcheck(!!force); ndi.netAt = Date.now(); }
    catch (e) { ndi.net = { firewall: { state: 'unknown', error: String(e.message || e) }, addresses: [] }; }
    finally { ndi.netBusy = null; }
    return ndi.net;
  })();
}
const ndiFwBad = net => !!net && net.firewall && (net.firewall.state === 'missing' || net.firewall.state === 'blocked');
function ndiNetPanel(box) {
  if (!ndi.api.netcheck) { box.append(el('div', { className: 'hint', textContent: 'Update the desktop app for the network check.' })); return; }
  const fill = () => box.replaceChildren(...ndiNetBody());   // a later fill into a panel rebuilt meanwhile is harmless
  fill();
  if (!ndi.net || Date.now() - ndi.netAt > 15000) ndiNetCheck(false).then(fill);
  if (!ndi.settings) ndi.api.settings().then(s => { ndi.settings = s; fill(); }).catch(() => {});
}
function ndiNetBody() {
  const net = ndi.net, out = [];
  if (!net) return [el('div', { className: 'hint', textContent: 'Checking the network...' })];
  const fw = net.firewall || {}, nets = (fw.networks || []).map(n => n.name + ' (' + n.category + ' network)').join(', ');
  const recheck = el('button', { textContent: 'Check again', onclick: async () => { recheck.disabled = true; await ndiNetCheck(true); refreshOutPanels(); } });
  // 1. firewall
  if (fw.state === 'ok') out.push(el('div', { className: 'hint', style: { color: 'var(--ok)' }, textContent: 'Firewall: other computers can connect' + (nets ? ' on ' + nets : '') + '.' }));
  else if (ndiFwBad(net)) {
    const fix = el('button', { textContent: 'Allow through the firewall', title: 'Windows asks for admin permission once', onclick: async () => {
      fix.disabled = true; setStatus('NDI: confirm the Windows prompt to allow Strodano VJ through the firewall');
      const r = await ndi.api.fixFirewall().catch(e => ({ ok: false, error: String(e.message || e) }));
      setStatus(r && r.ok ? 'NDI: Strodano VJ is allowed through the firewall' : r && r.cancelled ? 'NDI: the firewall was not changed (the Windows prompt was declined)' : 'NDI: could not change the firewall (' + ((r && r.error) || 'error') + ')');
      await ndiNetCheck(true); refreshOutPanels();
    } });
    out.push(el('div', { className: 'hint', style: { color: 'var(--bad)' }, textContent: (fw.state === 'blocked' ? 'Windows Firewall is set to block Strodano VJ' : 'Windows Firewall has no rule for Strodano VJ') + (nets ? ' on ' + nets : '') + ': other computers cannot see the NDI source (this one still can).' }),
      el('div', { className: 'fld' }, fix, recheck));
  } else if (fw.state === 'ask') out.push(el('div', { className: 'hint', textContent: 'macOS firewall is on: when it asks, click Allow. If you clicked Deny: System Settings > Network > Firewall > Options.' }));
  else if (fw.state === 'offline') out.push(el('div', { className: 'hint', style: { color: 'var(--warn)' }, textContent: 'This computer is not on a network.' }));
  else out.push(el('div', { className: 'hint', textContent: 'Could not read the firewall. If other computers do not see the source, allow Strodano VJ through it' + (fw.error ? ' (' + fw.error + ')' : '') + '.' }));
  // 2. addresses, for a receiver that does not find the source by itself
  const addrs = net.addresses || [], real = addrs.filter(a => !a.virtual && !a.linkLocal);
  if (addrs.length) {
    const list = el('div', { className: 'hint', style: { fontFamily: 'var(--mono, monospace)', color: 'var(--fg, inherit)' } });
    for (const a of addrs) list.append(el('div', { textContent: a.address + '  ' + a.name + (a.linkLocal ? '  (no network)' : a.virtual ? '  (virtual)' : '') }));
    const copy = el('button', { textContent: 'Copy address', onclick: () => { const t = (real[0] || addrs[0]).address; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => setStatus('Address copied: ' + t), () => setStatus('This computer\'s address: ' + t)); } });
    out.push(el('div', { className: 'hint', textContent: 'This computer (' + (net.host || '') + '):' }), list,
      el('div', { className: 'fld' }, copy, ndiFwBad(net) ? null : recheck),
      el('div', { className: 'hint', textContent: 'Source not showing up on the other computer? There, open NDI Access Manager (free NDI Tools) > Remote Sources, add this address, then restart Resolume / OBS / VDMX. Venue or guest Wi-Fi often keeps devices apart: a cable or your own router is the sure way.' }));
  }
  // 3. settings: adapter and Discovery Server
  const s = ndi.settings;
  if (s) {
    const names = [...new Set(real.map(a => a.name))];
    if (s.adapter && !names.includes(s.adapter)) names.push(s.adapter);
    const ad = el('select');
    ad.append(el('option', { value: '', textContent: 'Automatic (all)' }));
    for (const n of names) ad.append(el('option', { value: n, textContent: n + (real.some(a => a.name === n) ? '' : ' (not connected)') }));
    ad.value = s.adapter || '';
    const ds = el('input', { type: 'text', value: s.discovery || '', placeholder: 'none: found automatically', maxLength: 300 });
    const apply = el('button', { textContent: 'Apply', disabled: true, onclick: () => ndiApplySettings({ adapter: ad.value, discovery: ds.value.trim() }) });
    const dirty = () => { apply.disabled = ad.value === (s.adapter || '') && ds.value.trim() === (s.discovery || ''); };
    ad.onchange = dirty; ds.oninput = dirty;
    out.push(el('div', { className: 'fld' }, el('label', { textContent: 'Adapter' }), ad),
      el('div', { className: 'fld' }, el('label', { textContent: 'Discovery', title: 'NDI Discovery Server' }), ds),
      el('div', { className: 'fld' }, apply));
    if (s.adapterMissing) out.push(el('div', { className: 'hint', style: { color: 'var(--warn)' }, textContent: 'Adapter "' + s.adapter + '" is not connected: NDI uses every adapter.' }));
    else if (!s.adapter && addrs.some(a => a.virtual)) out.push(el('div', { className: 'hint', textContent: 'This computer has virtual adapters (VPN, WSL, Docker...). If a receiver lists the source but shows no picture, pick the real adapter here.' }));
    out.push(el('div', { className: 'hint', textContent: 'Discovery Server: only when the venue runs one (address like 192.168.1.10). Every receiver must use the same server (NDI Access Manager > Advanced); NDI apps without it will no longer see this source. Applying restarts NDI: receivers reconnect in a few seconds.' }));
  }
  return out;
}
// change the adapter / Discovery Server: the desktop restarts the sender, so the running NDI screens are restarted too
async function ndiApplySettings(s) {
  const live = [];
  screens.forEach((x, i) => { if (x.ndiSend) { live.push(i); ndiStop(x); } });
  let r;
  try { r = await ndi.api.setSettings(s); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  ndi.status = null; ndi.settings = null;
  for (const i of live) await ndiStart(i);
  ndi.settings = await ndi.api.settings().catch(() => null);
  setStatus(r && r.ok ? 'NDI: network settings applied' + (live.length ? ', sources restarted' : '') : 'NDI: ' + ((r && r.error) || 'settings not applied'));
  refreshOutPanels();
}
// once an NDI source is running: say so when this computer's firewall keeps other computers out
async function ndiWarnFirewall() {
  const net = await ndiNetCheck(false);
  if (ndiFwBad(net) && ndiLive().length) setStatus('NDI is on, but Windows Firewall keeps other computers out: Advanced Output > NDI > Allow through the firewall');
}
function ndiLine(s) {
  const n = s.ndiSend;
  if (!n) return '';
  if (n.error) return 'NDI error: ' + n.error;
  const [w, h] = ndiSize(s);
  return `Sending ${w} x ${h} at ${n.fpsOut.toFixed(0)} fps to ${n.conns} receiver${n.conns === 1 ? '' : 's'}` + (n.conns ? '' : ' (none yet: pick it in your NDI app)');
}
// keeps the meter line in the open panel current without rebuilding it
function tickNdiUI() {
  const m = document.querySelector('#outProps .ndi-meter');
  if (m) { const s = screens[outUI.screen], t = ndiLine(s); if (m.textContent !== t) m.textContent = t; }
}
setInterval(tickNdiUI, 500);

// start the NDI screens that should run (desktop app, Auto output on): like a display that is always connected
function initNdi() {
  if (!ndi.api) return;
  ndiStatus().then(st => { if (st.ok && display.autoOut) screens.forEach((s, i) => { if (s.device === 'ndi') ndiStart(i); }); });
}
