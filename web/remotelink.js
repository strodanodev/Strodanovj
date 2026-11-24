// Strodano VJ (web) - remote control link, shared by both ends: the host (the app running the show) and the remote
// (remote.html on a phone). GPL-3.0. See ../../remote-control-spec.md.
// What is here: the protocol version, pairing ids (QR link, short code), the check every control id must pass, a small
// SHA-256 / HMAC (crypto.subtle does not exist on plain http pages, which LAN mode will need), and the transports.
// A transport carries JSON messages between one host and its remotes:
//   rlHost({room, secret, stream?, kbps?, fps?, onOpen(peer), onMsg(peer, msg, lossy), onClose(peer), onState(state, text)}) -> {send(peer, msg), drop(peer), stop()}
//   rlJoin({room, secret, video?, onTrack?(track), onOpen(), onMsg(msg), onClose(), onState(state, text)}) -> {send(msg, lossy), openLossy(), path(), stop()}
// stream / video: the host's small preview picture rides in the same session as a video track (Phase 2).
// Internet: the VDO.Ninja SDK's data channel (vendor/vdoninja-sdk.min.js, loaded on first use). The devices talk directly
// (WebRTC, encrypted); vdo.ninja's server only introduces them, as for the web link. sendData is never given
// allowFallback, so no message can go through that server. Nothing is stored anywhere.
// A host cannot see from its own side whether remotes can find it (2026-11-24: a host that said "live" was unreachable for
// minutes, cause unknown). So rlHost asks for its own room from a second SDK session, right after announcing and every two
// minutes while no remote is connected, and announces again on a new connection when that fails.
// Tests on a page served from this computer: {local: true} uses a BroadcastChannel between two tabs instead.
// The host's side of the feature (what a message does to the show) is not in this repo: it is part of Festival.
'use strict';
const RL_V = 1;                                      // protocol version: hello.v must match
const RL_ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';   // 32 characters, none that look alike (same as vdo.js vdoRand)
const RL_SITE = 'https://vj.strodano.live';
const RL_PART = 48000;                               // a message longer than this (JSON characters) travels in pieces
const RL_PROBE_FIRST = 2000, RL_PROBE_EVERY = 120e3, RL_PROBE_WAIT = 12000;   // the host's own reachability check (rlHost)
const RL_DEV = typeof location !== 'undefined' && location.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

// ---------- SHA-256, HMAC ----------
const RL_K = (() => { const k = [], isP = n => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; }; for (let n = 2; k.length < 64; n++) if (isP(n)) k.push(n); return k; })();
const RL_K256 = RL_K.map(p => Math.floor((Math.cbrt(p) % 1) * 4294967296) >>> 0), RL_H256 = RL_K.slice(0, 8).map(p => Math.floor((Math.sqrt(p) % 1) * 4294967296) >>> 0);
const rlBytes = x => (typeof x === 'string' ? new TextEncoder().encode(x) : x);
function rlSha256(data) {
  const m = rlBytes(data), len = m.length, total = ((len + 9 + 63) >> 6) << 6, b = new Uint8Array(total), w = new Uint32Array(64), h = RL_H256.slice();
  b.set(m); b[len] = 0x80;
  const dv = new DataView(b.buffer);
  dv.setUint32(total - 8, Math.floor(len / 536870912)); dv.setUint32(total - 4, (len << 3) >>> 0);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], c = w[i - 2]; w[i] = (w[i - 16] + (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rr(c, 17) ^ rr(c, 19) ^ (c >>> 10))) >>> 0; }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + RL_K256[i] + w[i]) >>> 0, t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + bb) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  h.forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}
const rlHex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
function rlHmac(key, msg) {
  let k = rlBytes(key);
  if (k.length > 64) k = rlSha256(k);
  const ip = new Uint8Array(64), op = new Uint8Array(64), m = rlBytes(msg);
  for (let i = 0; i < 64; i++) { const c = k[i] || 0; ip[i] = c ^ 0x36; op[i] = c ^ 0x5c; }
  const inner = new Uint8Array(64 + m.length); inner.set(ip); inner.set(m, 64);
  const outer = new Uint8Array(96); outer.set(op); outer.set(rlSha256(inner), 64);
  return rlHex(rlSha256(outer));
}

// ---------- pairing ids ----------
const rlRand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => RL_ALPHA[b & 31]).join('');
const rlWord = (u8, at, n) => Array.from(u8.subarray(at, at + n), b => RL_ALPHA[b & 31]).join('');
// The QR link: the room and the secret ride in the #fragment, which never reaches a server.
const rlLink = (room, secret) => RL_SITE + '/remote#' + room + '.' + secret;
// '#svjr_xxxxxxxxxx.<20 characters>' (or a whole link holding it) -> {room, secret}, or null
function rlParseLink(text) {
  const m = /(svjr_[a-z2-9]{10})\.([a-z2-9]{20})(?![a-z2-9])/.exec(String(text || ''));
  return m ? { room: m[1], secret: m[2] } : null;
}
// The short code, as typed: 8 characters of RL_ALPHA ('' when it is not one). Shown as XXXX-XXXX.
function rlCleanCode(text) {
  const c = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return c.length === 8 && [...c].every(ch => RL_ALPHA.includes(ch)) ? c : '';
}
const rlShowCode = c => (c.slice(0, 4) + '-' + c.slice(4)).toUpperCase();
// A code only introduces: it opens a short-lived room where the host hands over the real room and secret.
function rlCodeIds(code) {
  const h = rlSha256('strodano-remote-code:' + code);
  return { room: 'svjc_' + rlWord(h, 0, 10), secret: rlWord(h, 10, 20) };
}
const rlProof = (secret, room, n) => rlHmac(secret, room + ':' + n);

// ---------- what a control id may be ----------
// The ids are midi.js target ids. Only these families exist for a remote; everything else (full screen, DJ decks,
// anything unknown) is dropped by the host before it looks the id up.
const RL_ID = /^[a-z]+(:[A-Za-z0-9_+\-]{1,40}){0,3}$/;
const RL_FAMILIES = new Set(['master', 'crossfade', 'tap', 'resync', 'bpm', 'column', 'clip', 'layer', 'fx', 'gen', 'snap', 'blackout', 'stopall', 'agent', 'sel', 'focus', 'selected']);
const rlIdOk = id => typeof id === 'string' && id.length <= 120 && RL_ID.test(id) && RL_FAMILIES.has(id.split(':')[0]);

// ---------- long messages travel in pieces ----------
let rlPartSeq = 0;
function rlPack(msg) {
  const s = JSON.stringify(msg);
  if (s.length <= RL_PART) return [msg];
  const k = (++rlPartSeq).toString(36) + rlRand(4), of = Math.ceil(s.length / RL_PART), out = [];
  for (let i = 0; i < of; i++) out.push({ t: 'part', k, i, of, d: s.slice(i * RL_PART, (i + 1) * RL_PART) });
  return out;
}
// store: one object per sender. Returns the whole message when its last piece is in, else null.
function rlUnpack(store, m) {
  if (!m || m.t !== 'part') return m;
  if (typeof m.k !== 'string' || typeof m.d !== 'string' || !(m.of > 1 && m.of <= 64) || !(m.i >= 0 && m.i < m.of)) return null;
  if (store.k !== m.k) { store.k = m.k; store.a = []; store.got = 0; }
  if (store.a[m.i] === undefined) { store.a[m.i] = m.d; store.got++; }
  if (store.got < m.of) return null;
  const s = store.a.join('');
  store.k = ''; store.a = [];
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------- the SDK ----------
let rlSdkP = null;
function rlSdkLoad() {
  if (window.VDONinjaSDK) return Promise.resolve(true);
  if (!rlSdkP) rlSdkP = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'vendor/vdoninja-sdk.min.js';
    sc.onload = () => res(!!window.VDONinjaSDK);
    sc.onerror = () => { rlSdkP = null; res(false); };
    document.head.append(sc);
  });
  return rlSdkP;
}
// salt is always passed: the SDK otherwise takes it from the page's host name, which is empty on file://
const rlSdkNew = secret => new VDONinjaSDK({ salt: 'vdo.ninja', password: secret });
const rlSdkEnd = sdk => { try { const p = sdk.disconnect(); if (p && p.catch) p.catch(() => {}); } catch (e) {} };

// ---------- host ----------
function rlHost(o) {
  if (o.local && RL_DEV) return rlLocalHost(o);
  const h = { sdk: null, stopped: false, parts: new Map(), retry: 0, probeT: 0, probeId: null, repairs: 0 };
  const state = (s, text) => { if (!h.stopped && o.onState) o.onState(s, text || ''); };
  const take = (peer, d, lossy) => {
    if (h.stopped || !d || typeof d !== 'object') return;
    let st = h.parts.get(peer);
    if (!st) h.parts.set(peer, st = {});
    const m = rlUnpack(st, d);
    if (m && typeof m === 'object' && typeof m.t === 'string') o.onMsg(peer, m, !!lossy);
  };
  const gone = peer => { if (!h.stopped && h.parts.delete(peer) && o.onClose) o.onClose(peer); };
  async function start() {
    state('connecting');
    if (!window.RTCPeerConnection) return state('error', 'this browser has no WebRTC');
    if (!(await rlSdkLoad())) return state('error', 'could not load vendor/vdoninja-sdk.min.js');
    if (h.stopped) return;
    try {
      const sdk = h.sdk = rlSdkNew(o.secret);
      sdk.addEventListener('dataChannelOpen', e => { const u = e.detail && e.detail.uuid; if (u && !h.stopped && u !== h.probeId) { h.parts.set(u, {}); if (o.onOpen) o.onOpen(u); } });
      sdk.addEventListener('dataReceived', e => { if (e.detail.uuid !== h.probeId) take(e.detail.uuid, e.detail.data, false); });
      // the remote's second channel (fader moves): unordered, no resends
      sdk.addEventListener('channelOpen', e => { const d = e.detail || {}; if (d.channel && /ctl$/.test(d.label || '')) d.channel.onmessage = ev => { try { take(d.uuid, JSON.parse(ev.data), true); } catch (err) {} }; });
      for (const ev of ['peerDisconnected', 'dataChannelClose']) sdk.addEventListener(ev, e => gone(e.detail && e.detail.uuid));
      sdk.addEventListener('reconnecting', () => state('reconnecting'));
      sdk.addEventListener('reconnected', () => state('live'));
      sdk.addEventListener('reconnectFailed', () => again('lost the connection to the handshake server'));
      await sdk.connect();
      if (h.stopped) return rlSdkEnd(sdk);
      // With a preview picture (o.stream: a small video track, no sound) the room is published; without, only announced
      // (publish() refuses to run without a stream). Bitrate in kbps: the SDK reads a number under 10000 that way.
      if (o.stream) await sdk.publish(o.stream, { streamID: o.room, label: 'Strodano VJ remote', media: { video: { maxBitrate: o.kbps || 400, frameRate: o.fps || 15 } } });
      else await sdk.announce({ streamID: o.room });
      state('live');
      clearTimeout(h.probeT); h.probeT = setTimeout(probe, RL_PROBE_FIRST);
    } catch (e) { again(e && e.message ? e.message : String(e)); }
  }
  function again(text, soon) {
    if (h.stopped) return;
    state(soon ? 'reconnecting' : 'error', text);
    clearTimeout(h.probeT);
    if (h.sdk) { rlSdkEnd(h.sdk); h.sdk = null; }
    for (const p of [...h.parts.keys()]) gone(p);
    clearTimeout(h.retry); h.retry = setTimeout(start, soon ? 500 : 5000);
  }
  // Can this room be found? A second session asks for it, exactly as a remote would. Not while a remote is connected:
  // that is proof enough, and nothing may disturb it.
  async function probe() {
    if (h.stopped || !h.sdk) return;
    const sdk = h.sdk, next = () => { if (!h.stopped && h.sdk === sdk) { clearTimeout(h.probeT); h.probeT = setTimeout(probe, RL_PROBE_EVERY); } };
    if (h.parts.size) return next();
    let p = null, ok = false;
    try {
      p = rlSdkNew(o.secret);
      const opened = new Promise(res => p.addEventListener('dataChannelOpen', () => res(true)));
      await p.connect();
      h.probeId = (p.state && p.state.uuid) || null;   // the host's side ignores this peer
      p.view(o.room, { dataOnly: true }).catch(() => {});
      ok = await Promise.race([opened, new Promise(res => setTimeout(() => res(false), RL_PROBE_WAIT))]);
    } catch (e) {}
    if (p) rlSdkEnd(p);
    if (h.stopped || h.sdk !== sdk) return;
    if (ok || h.parts.size) { h.repairs = 0; return next(); }
    h.repairs++;
    if (o.onRepair) o.onRepair(h.repairs);
    again('this room could not be reached: announcing it again', h.repairs < 4);   // after three quick tries, the slower retry
  }
  h.retry = setTimeout(start, 0);   // never inside this call: the caller's callbacks may use what it returns
  return {
    send(peer, msg) {
      if (!h.sdk || h.stopped) return false;
      try { let ok = true; for (const part of rlPack(msg)) ok = h.sdk.sendData(part, peer) !== false && ok; return ok; } catch (e) { return false; }
    },
    // the SDK has no call to close one peer: its connection is closed underneath, and the host ignores it from now on
    drop(peer) {
      h.parts.delete(peer);
      try { const c = h.sdk && h.sdk.connections && h.sdk.connections.get(peer); for (const k of ['viewer', 'publisher']) if (c && c[k] && c[k].pc) c[k].pc.close(); } catch (e) {}
    },
    stop() { h.stopped = true; clearTimeout(h.retry); clearTimeout(h.probeT); if (h.sdk) { rlSdkEnd(h.sdk); h.sdk = null; } h.parts.clear(); },
  };
}

// ---------- remote ----------
function rlJoin(o) {
  if (o.local && RL_DEV) return rlLocalJoin(o);
  const r = { sdk: null, stopped: false, host: null, lossy: null, parts: {}, ask: 0, open: false };
  const state = (s, text) => { if (!r.stopped && o.onState) o.onState(s, text || ''); };
  const closed = () => { if (r.stopped || !r.open) return; r.open = false; r.host = null; r.lossy = null; if (o.onClose) o.onClose(); };
  async function start() {
    state('connecting');
    if (!window.RTCPeerConnection) return state('error', 'This browser cannot connect (no WebRTC).');
    if (!(await rlSdkLoad())) return state('error', 'Could not load the page fully. Check the connection and reload.');
    if (r.stopped) return;
    try {
      const sdk = r.sdk = rlSdkNew(o.secret);
      sdk.addEventListener('dataChannelOpen', e => {
        if (r.stopped || r.host) return;
        r.host = e.detail.uuid; r.open = true; clearTimeout(r.ask);
        if (o.onOpen) o.onOpen();
      });
      sdk.addEventListener('dataReceived', e => {
        if (r.stopped || e.detail.uuid !== r.host) return;
        const m = rlUnpack(r.parts, e.detail.data);
        if (m && typeof m === 'object' && typeof m.t === 'string') o.onMsg(m);
      });
      for (const ev of ['peerDisconnected', 'dataChannelClose']) sdk.addEventListener(ev, e => { if (e.detail && e.detail.uuid === r.host) closed(); });
      // the host's preview picture, when the caller wants one (o.video) and the host sends one
      sdk.addEventListener('track', e => { const t = e.detail && e.detail.track; if (t && t.kind === 'video' && o.onTrack && !r.stopped) o.onTrack(t); });
      const what = o.video ? { audio: false, video: true } : { dataOnly: true };
      await sdk.connect();
      if (r.stopped) return rlSdkEnd(sdk);
      state('looking');
      // The host may not be there yet: ask again every 3 s. But every request makes the host start a new connection, so
      // once its offer is here (a peer connection exists) the handshake gets 12 s to finish before the next request.
      const under = () => { try { for (const [, c] of sdk.connections || []) { const v = c && c.viewer; if (v && v.pc && v.pc.connectionState !== 'failed' && v.pc.connectionState !== 'closed') return true; } } catch (e) {} return false; };
      let since = 0;
      const ask = () => {
        if (r.stopped || r.host) return;
        if (under()) { since = since || Date.now(); if (Date.now() - since < 12000) { r.ask = setTimeout(ask, 500); return; } }
        since = 0;
        try { const p = sdk.view(o.room, what); if (p && p.catch) p.catch(() => {}); } catch (e) {}
        r.ask = setTimeout(ask, 3000);
      };
      ask();
    } catch (e) { state('error', 'Could not reach the handshake server. Check the connection.'); }
  }
  setTimeout(start, 0);   // never inside this call: the caller's callbacks may use what it returns
  return {
    // lossy = may be dropped, never queued (fader moves). Falls back to the main channel until the second one is open.
    send(msg, lossy) {
      if (!r.sdk || !r.host || r.stopped) return false;
      try {
        if (lossy && r.lossy && r.lossy.readyState === 'open') { r.lossy.send(JSON.stringify(msg)); return true; }
        return r.sdk.sendData(msg, r.host) !== false;
      } catch (e) { return false; }
    },
    openLossy() {
      if (!r.sdk || !r.host || r.lossy) return;
      const host = r.host;
      r.sdk.openChannel(host, 'ctl', { ordered: false, maxRetransmits: 0, timeout: 8000 }).then(ch => { if (!r.stopped && r.host === host) r.lossy = ch; }, () => {});
    },
    // {relayed, type, rttMs} of the path to the host, or null
    async path() {
      try { const q = r.sdk && r.host && await r.sdk.getPeerQuality(r.host); return q ? { relayed: !!q.relayed, type: q.candidatePairType || '', rttMs: q.rttMs } : null; } catch (e) { return null; }
    },
    stop() { r.stopped = true; clearTimeout(r.ask); if (r.sdk) { rlSdkEnd(r.sdk); r.sdk = null; } },
  };
}

// ---------- stand-in transport for tests: two tabs of one browser, pages served from this computer only ----------
function rlLocalHost(o) {
  const bc = new BroadcastChannel('svj-remote-' + o.room), peers = new Map();
  bc.onmessage = e => {
    const d = e.data || {};
    if (d.to !== 'host' || d.secret !== o.secret) return;
    if (d.k === 'open') { peers.set(d.from, {}); bc.postMessage({ to: d.from, k: 'ok' }); if (o.onOpen) o.onOpen(d.from); }
    else if (d.k === 'close') { if (peers.delete(d.from) && o.onClose) o.onClose(d.from); }
    else if (d.k === 'msg' && peers.has(d.from)) { const m = rlUnpack(peers.get(d.from), d.m); if (m && typeof m.t === 'string') o.onMsg(d.from, m, !!d.lossy); }
  };
  setTimeout(() => { if (o.onState) o.onState('live', ''); }, 0);
  return {
    send(peer, msg) { if (!peers.has(peer)) return false; for (const part of rlPack(msg)) bc.postMessage({ to: peer, k: 'msg', m: part }); return true; },
    drop(peer) { if (peers.delete(peer)) bc.postMessage({ to: peer, k: 'close' }); },
    stop() { for (const p of peers.keys()) bc.postMessage({ to: p, k: 'close' }); peers.clear(); bc.close(); },
  };
}
function rlLocalJoin(o) {
  const bc = new BroadcastChannel('svj-remote-' + o.room), me = 'r' + rlRand(8), parts = {};
  let open = false, stopped = false, ask = 0;
  bc.onmessage = e => {
    const d = e.data || {};
    if (d.to !== me || stopped) return;
    if (d.k === 'ok') { if (!open) { open = true; clearInterval(ask); if (o.onOpen) o.onOpen(); } }
    else if (d.k === 'close') { if (open) { open = false; if (o.onClose) o.onClose(); } }
    else if (d.k === 'msg' && open) { const m = rlUnpack(parts, d.m); if (m && typeof m.t === 'string') o.onMsg(m); }
  };
  const hello = () => bc.postMessage({ to: 'host', from: me, secret: o.secret, k: 'open' });
  ask = setInterval(hello, 1000); hello();
  setTimeout(() => { if (o.onState && !stopped) o.onState('looking', ''); }, 0);
  return {
    send(msg, lossy) { if (!open || stopped) return false; bc.postMessage({ to: 'host', from: me, secret: o.secret, k: 'msg', m: msg, lossy: !!lossy }); return true; },
    openLossy() {}, path: async () => ({ relayed: false, type: 'local', rttMs: 0 }),
    stop() { if (stopped) return; stopped = true; clearInterval(ask); if (open) bc.postMessage({ to: 'host', from: me, secret: o.secret, k: 'close' }); bc.close(); },
  };
}
