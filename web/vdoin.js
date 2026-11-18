// Web link input: watch another Strodano VJ's web link (a phone running mobile.html, or any vdo.ninja stream) as a
// clip. GPL-3.0. The picture arrives peer to peer through the VDO.Ninja SDK (vdo.js loads it) and plays in a <video>
// like a camera clip, so it takes layers, effects, transitions, blend modes and every output, including NDI: this is
// how a phone's show reaches an NDI network (phone -> web link -> desktop app -> NDI screen).
// One SDK connection per link, shared by every clip that shows it; it waits and re-asks while the phone is not sending
// (not started yet, restarted with a new setting, or the connection dropped).
// Clip fields (saved): link. Live state: c.video, the shared session in vdoIn.sessions.
'use strict';
const vdoIn = { sessions: new Map() };
// "https://vdo.ninja/?view=ID&password=PW" (or "?view=ID&pw=PW", or a bare ID) -> {id, pw}
function parseVdoLink(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^[A-Za-z0-9_]{4,64}$/.test(t)) return { id: t, pw: '' };
  let u;
  try { u = new URL(t.includes('://') ? t : 'https://' + t); } catch (e) { return null; }
  // our branded viewer: <site>/live/<name>#<password>[&clean]
  const lv = u.pathname.match(/\/live\/([A-Za-z0-9_]{4,64})\/?$/), frag = u.hash.slice(1).split('&')[0];
  const q = u.searchParams, id = (lv && lv[1]) || q.get('view') || q.get('v') || q.get('push') || '';
  const pw = (lv && frag && !frag.includes('=') ? frag : '') || q.get('password') || q.get('pw') || q.get('p') || q.get('k') || '';
  if (!/^[A-Za-z0-9_]{4,64}$/.test(id) || (pw && !/^[A-Za-z0-9]{1,64}$/.test(pw))) return null;
  return { id, pw };
}
const vdoInKey = p => p.id + '|' + p.pw;

function vdoInOpen(p) {
  const key = vdoInKey(p);
  let s = vdoIn.sessions.get(key);
  if (s) { s.users++; return s; }
  s = { key, p, users: 1, sdk: null, track: null, state: 'connecting', error: '', clips: new Set(), retry: 0, closed: false };
  vdoIn.sessions.set(key, s);
  vdoInConnect(s);
  return s;
}
function vdoInClose(s) {
  if (!s || --s.users > 0) return;
  s.closed = true; clearTimeout(s.retry);
  vdoIn.sessions.delete(s.key);
  if (s.sdk) { const sdk = s.sdk; s.sdk = null; sdk.disconnect().catch(() => {}); }
}
async function vdoInConnect(s) {
  if (!window.RTCPeerConnection) { s.state = 'error'; s.error = 'this browser has no WebRTC'; return; }
  if (!(await vdoLoad())) { s.state = 'error'; s.error = 'could not load vendor/vdoninja-sdk.min.js'; return; }
  if (s.closed) return;
  try {
    const sdk = s.sdk = new VDONinjaSDK({ salt: 'vdo.ninja', password: s.p.pw || undefined });
    sdk.addEventListener('track', e => {
      const t = e.detail && e.detail.track;
      if (!t || t.kind !== 'video' || s.closed) return;
      s.track = t; s.state = 'live'; s.error = '';
      t.addEventListener('ended', () => { if (s.track === t) { s.track = null; vdoInWait(s); } });
      for (const c of s.clips) vdoInAttach(c, s);
      ui.gridDirty = ui.propsDirty = true;
    });
    sdk.addEventListener('peerDisconnected', () => { s.track = null; vdoInWait(s); });
    sdk.addEventListener('reconnectFailed', () => { s.state = 'error'; s.error = 'lost the connection to vdo.ninja'; vdoInWait(s); });
    await sdk.connect();
    if (s.closed) { sdk.disconnect().catch(() => {}); return; }
    await vdoInView(s);
  } catch (e) { s.state = 'error'; s.error = e && e.message ? e.message : String(e); vdoInWait(s); }
}
async function vdoInView(s) {
  if (s.closed || !s.sdk) return;
  s.state = s.track ? 'live' : 'waiting';
  try { await s.sdk.view(s.p.id, { audio: false, video: true }); } catch (e) { s.error = e && e.message ? e.message : String(e); }
  vdoInWait(s);   // asks again in a while if nothing arrived (the phone may not have started yet)
}
// No picture: ask again every few seconds while a clip still wants it
function vdoInWait(s) {
  clearTimeout(s.retry);
  if (s.closed) return;
  s.retry = setTimeout(() => {
    if (s.closed || (s.track && s.track.readyState === 'live')) return;
    s.state = 'waiting'; ui.propsDirty = true;
    if (s.sdk) vdoInView(s); else vdoInConnect(s);
  }, 5000);
}
function vdoInAttach(c, s) {
  if (!c.video || !s.track) return;
  c.video.srcObject = new MediaStream([s.track]);
  c.video.play().catch(() => {});
  c.video.addEventListener('loadeddata', () => { c.w = c.video.videoWidth; c.h = c.video.videoHeight; c.thumb = thumbOf(c.video, c.w, c.h); ui.gridDirty = true; }, { once: true });
}
function vdoInClip(link, name) {
  const p = parseVdoLink(link);
  if (!p) return null;
  const c = { uid: newUid(), type: 'vdoin', name: name || 'Web link ' + p.id.slice(-4), link: String(link).trim(), w: 0, h: 0, speed: 1, thumb: null };
  c.video = document.createElement('video');
  Object.assign(c.video, { muted: true, playsInline: true, autoplay: true });
  c.session = vdoInOpen(p);
  c.session.clips.add(c);
  vdoInAttach(c, c.session);
  return c;
}
function vdoInLine(c) {
  const s = c.session;
  if (!s) return '';
  if (s.state === 'live' && s.track) return `Receiving ${c.w ? c.w + ' x ' + c.h : ''} from ${s.p.id}`;
  if (s.state === 'error') return 'Web link input: ' + (s.error || 'error') + ' (trying again)';
  if (s.state === 'connecting') return 'Connecting to vdo.ninja...';
  return 'Waiting for ' + s.p.id + ' to start sending (press Go live on the phone)';
}
CLIP_TYPES.vdoin = {
  toJSON: c => ({ type: 'vdoin', uid: c.uid, name: c.name, link: c.link }),
  fromJSON: j => vdoInClip(j.link, String(j.name || 'Web link')),
  free: c => { if (c.video) { c.video.pause(); c.video.srcObject = null; } if (c.session) { c.session.clips.delete(c); vdoInClose(c.session); } c.session = null; c.video = null; },
  props: (c, p) => p.append(el('div', { className: 'hint vdoin-line', textContent: vdoInLine(c) }),
    el('div', { className: 'hint', textContent: 'A web link playing like a camera. To send it on as NDI, set a screen\'s display to NDI in Advanced Output.' })),
};
// One click: a new top layer called Phone, playing the link
function vdoInToLayer(link) {
  const c = vdoInClip(link);
  if (!c) { setStatus('That is not a web link: paste the link the phone shows (https://vdo.ninja/?view=...&password=...)'); return; }
  addLayer();
  const li = comp.layers.length - 1;
  comp.layers[li].name = 'Phone';
  setClip(li, 0, c);
  trigger(li, 0);
  sel.l = li; sel.c = 0; propTab = 'layer';
  ui.gridDirty = ui.propsDirty = true;
  setStatus('The web link plays on the new top layer "Phone". For NDI, set a screen to NDI in Advanced Output.');
}
SOURCE_PANELS.push(() => {
  const box = el('div', { className: 'cam-box' }, el('h4', { textContent: 'Web link input (phone)' }));
  const inp = el('input', { type: 'text', placeholder: 'Paste the phone\'s web link', spellcheck: false, style: { flex: '1', minWidth: '0' } });
  const item = el('div', { className: 'src-item', textContent: 'Web link clip', title: 'Paste a link above, then drag onto a clip slot (or double-click to fill the selected slot)',
    ondblclick: () => { const c = vdoInClip(inp.value); if (!c) { setStatus('Paste the phone\'s web link first'); return; } const ci = sel.c >= 0 ? sel.c : comp.layers[sel.l].clips.findIndex(x => !x); if (ci >= 0) setClip(sel.l, ci, c); else CLIP_TYPES.vdoin.free(c); } });
  item.addEventListener('dragstart', () => { if (!parseVdoLink(inp.value)) setStatus('Paste the phone\'s web link first'); });
  draggable(item, { kind: 'make', make: () => vdoInClip(inp.value) });
  box.append(el('div', { className: 'fld' }, inp),
    el('div', { className: 'fld' }, el('button', { textContent: 'Show on a layer', title: 'Adds a top layer playing this web link', onclick: () => vdoInToLayer(inp.value) })),
    el('div', { className: 'list' }, item),
    el('div', { className: 'hint', textContent: 'Shows a phone running Strodano VJ mobile (or any vdo.ninja link). Set a screen to NDI to pass it on to your NDI network.' }));
  return [box];
});
setInterval(() => { const m = document.querySelector('.vdoin-line'); if (m) { const c = comp.layers[sel.l] && comp.layers[sel.l].clips[sel.c]; if (c && c.type === 'vdoin') { const t = vdoInLine(c); if (m.textContent !== t) m.textContent = t; } } }, 1000);
