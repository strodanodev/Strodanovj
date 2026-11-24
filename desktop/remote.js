// Strodano VJ desktop: remote control without internet (LAN mode, Phase 4 of ../remote-control-spec.md). GPL-3.0.
// The computer running the show serves the remote page itself on ONE network adapter (never on all of them), so a phone
// on the same Wi-Fi opens http://<address>:<port>/remote.html from the QR code, and a ROG Ally in Remote mode connects
// straight to the WebSocket. This file only carries bytes: an HTTP server for a short list of files, a WebSocket at
// /link whose text frames go to and from the page, and a UDP beacon so the Ally can find this computer. Every message is
// signed by the two pages (web/remotelink.js, HMAC with the pairing secret, which never travels); a socket that does not
// sign correctly within 10 s is closed by the page. Nothing is stored.
//   control window (page)                main process (here)                     the remote
//   strodanoDesktop.lan.start({address}) -> HTTP + WebSocket on address:8787 (or the next free port)
//   lan.onEvent({k: open|msg|close, id}) <- a socket opened / sent a text frame / closed
//   lan.send(id, text), lan.drop(id)     -> to that socket
//   beacon every 2 s on UDP 8788: {a: 'strodano-vj-remote', v, name, port, room}   (room only, never the secret)
//   Remote mode (the Ally): lan.find(true) listens for beacons and sends lan:hosts [{name, address, port, room}].
'use strict';
const { ipcMain } = require('electron');
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { addresses } = require('./ndinet');

const PORT = 8787, BEACON_PORT = 8788, BEACON_MS = 2000, HOST_TTL = 7000;
const MAX_SOCKETS = 8, MAX_FRAME = 300 * 1024;
// the remote page's own files, nothing else (web/ is inside app.asar when packaged)
const FILES = { '/': 'remote.html', '/remote.html': 'remote.html', '/remote.js': 'remote.js', '/remotelink.js': 'remotelink.js', '/core.js': 'core.js', '/theme.js': 'theme.js', '/logo.png': 'logo.png' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const computerName = () => String(os.hostname() || 'Computer').replace(/[^\w .\-]/g, '').slice(0, 40);

let getWin = () => null, webDir = '';
const lan = { server: null, wss: null, address: '', port: 0, room: '', sockets: new Map(), seq: 0, beacon: null, beaconT: 0 };
const find = { sock: null, hosts: new Map(), t: 0 };

const toPage = (ch, v) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, v); };
const fromControl = e => { const w = getWin(); return !!(w && !w.isDestroyed() && e.sender === w.webContents); };

// The page served over the network: marked as such (remote.js then talks to ws://<this host>/link and never loads the
// internet SDK), and without the web fonts (with no internet, waiting for them would hold the page up).
function pageText(file) {
  let s = fs.readFileSync(path.join(webDir, file), 'utf8');
  if (file === 'remote.html') s = s.replace('<meta name="robots"', '<meta name="svj-lan" content="1">\n<meta name="robots"').replace(/^.*fonts\.(googleapis|gstatic)\.com.*$/gm, '');
  return s;
}
function serve(req, res) {
  const u = (req.url || '/').split('?')[0], file = req.method === 'GET' || req.method === 'HEAD' ? FILES[u] : null;
  const head = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
  if (!file) { res.writeHead(404, { ...head, 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  try {
    const body = /\.(html|js)$/.test(file) ? Buffer.from(pageText(file)) : fs.readFileSync(path.join(webDir, file));
    res.writeHead(200, { ...head, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) { res.writeHead(500, { ...head, 'Content-Type': 'text/plain' }); res.end('Error'); }
}

function listen(address, port) {
  return new Promise(resolve => {
    const server = http.createServer(serve);
    server.once('error', err => resolve({ err }));
    server.listen(port, address, () => resolve({ server }));
  });
}
async function start(o) {
  stop();
  const list = addresses(), want = String((o && o.address) || '');
  const pick = list.find(a => a.address === want) || list.find(a => !a.virtual && !a.linkLocal) || list[0];
  if (!pick) return { ok: false, error: 'This computer is not on a network' };
  let server = null, port = 0, lastErr = null;
  for (let p = PORT; p < PORT + 10 && !server; p++) { const r = await listen(pick.address, p); if (r.server) { server = r.server; port = p; } else lastErr = r.err; }
  if (!server) return { ok: false, error: 'No free port from ' + PORT + ' to ' + (PORT + 9) + (lastErr ? ': ' + lastErr.code : '') };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  server.on('upgrade', (req, sock, head) => {
    if ((req.url || '').split('?')[0] !== '/link' || lan.sockets.size >= MAX_SOCKETS) { sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, ws => {
      const id = 's' + (++lan.seq);
      lan.sockets.set(id, ws);
      ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
      toPage('lan:event', { k: 'open', id, addr: String(req.socket.remoteAddress || '').replace(/^::ffff:/, '') });
      ws.on('message', (data, isBinary) => { if (!isBinary) toPage('lan:event', { k: 'msg', id, text: data.toString('utf8') }); });
      ws.on('close', () => { lan.sockets.delete(id); toPage('lan:event', { k: 'close', id }); });
      ws.on('error', () => {});
    });
  });
  // a phone that walked away without closing: WebSocket pings every 10 s find it (the page has its own, faster heartbeat)
  const alive = setInterval(() => { for (const ws of lan.sockets.values()) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) {} } }, 10000);
  server.on('close', () => clearInterval(alive));
  Object.assign(lan, { server, wss, address: pick.address, port, room: String((o && o.room) || '').slice(0, 40) });
  startBeacon(pick.address);
  return { ok: true, address: pick.address, port, adapter: pick.name, url: 'http://' + pick.address + ':' + port + '/remote.html' };
}
function stop() {
  clearInterval(lan.beaconT); lan.beaconT = 0;
  if (lan.beacon) { try { lan.beacon.close(); } catch (e) {} lan.beacon = null; }
  for (const ws of lan.sockets.values()) { try { ws.terminate(); } catch (e) {} }
  lan.sockets.clear();
  if (lan.wss) { try { lan.wss.close(); } catch (e) {} lan.wss = null; }
  if (lan.server) { try { lan.server.close(); } catch (e) {} lan.server = null; }
  lan.address = ''; lan.port = 0;
}

// ---------- the beacon: "a Strodano VJ show is here" ----------
// Sent to the network's broadcast address of the chosen adapter and to 255.255.255.255. Venue networks that block
// broadcasts make it useless; then the remote types the address shown on the computer.
function broadcastAddr(address) {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.address !== address || !a.netmask) continue;
    const ip = address.split('.').map(Number), m = a.netmask.split('.').map(Number);
    if (ip.length === 4 && m.length === 4) return ip.map((x, i) => (x | (~m[i] & 255)) & 255).join('.');
  }
  return '';
}
function startBeacon(address) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', () => {});
  sock.bind(0, address, () => {
    try { sock.setBroadcast(true); } catch (e) {}
    const targets = [...new Set([broadcastAddr(address), '255.255.255.255'].filter(Boolean))];
    const send = () => {
      if (!lan.server) return;
      const msg = Buffer.from(JSON.stringify({ a: 'strodano-vj-remote', v: 1, name: computerName(), port: lan.port, room: lan.room }));
      for (const t of targets) sock.send(msg, BEACON_PORT, t, () => {});
    };
    send();
    lan.beaconT = setInterval(send, BEACON_MS);
  });
  lan.beacon = sock;
}
// The remote's side (Remote mode): computers heard in the last few seconds.
function findOn(on) {
  clearInterval(find.t); find.t = 0;
  if (find.sock) { try { find.sock.close(); } catch (e) {} find.sock = null; }
  find.hosts.clear();
  if (!on) return true;
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', () => {});
  sock.on('message', (buf, rinfo) => {
    let m = null;
    try { m = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
    if (!m || m.a !== 'strodano-vj-remote' || !(m.port > 0 && m.port < 65536)) return;
    const key = rinfo.address + ':' + m.port, had = find.hosts.has(key);
    find.hosts.set(key, { name: String(m.name || 'Computer').replace(/[^\w .\-]/g, '').slice(0, 40), address: rinfo.address, port: m.port | 0, room: /^svjr_[a-z2-9]{10}$/.test(m.room) ? m.room : '', seen: Date.now() });
    if (!had) sendHosts();
  });
  sock.bind(BEACON_PORT, () => { try { sock.setBroadcast(true); } catch (e) {} });
  find.sock = sock;
  find.t = setInterval(() => { let gone = false; for (const [k, h] of find.hosts) if (Date.now() - h.seen > HOST_TTL) { find.hosts.delete(k); gone = true; } if (gone) sendHosts(); }, 1000);
  return true;
}
const sendHosts = () => toPage('lan:hosts', [...find.hosts.values()].map(({ seen, ...h }) => h));

function setupRemote(win, dir) {
  getWin = win; webDir = dir;
  ipcMain.handle('lan:addresses', e => (fromControl(e) ? addresses() : []));
  ipcMain.handle('lan:start', (e, o) => (fromControl(e) ? start(o) : { ok: false, error: 'not allowed' }));
  ipcMain.handle('lan:stop', e => { if (fromControl(e)) stop(); return true; });
  ipcMain.on('lan:send', (e, m) => { if (!fromControl(e) || !m) return; const ws = lan.sockets.get(m.id); if (ws && ws.readyState === 1) { try { ws.send(String(m.text)); } catch (err) {} } });
  ipcMain.on('lan:drop', (e, id) => { if (!fromControl(e)) return; const ws = lan.sockets.get(id); if (ws) { try { ws.close(); } catch (err) {} } });
  ipcMain.handle('lan:find', (e, on) => (fromControl(e) ? findOn(!!on) : false));
  ipcMain.handle('lan:hosts', e => (fromControl(e) ? [...find.hosts.values()].map(({ seen, ...h }) => h) : []));
}
// the page is being replaced (Remote mode switch, reload): nothing of its LAN session may stay open
function resetRemote() { stop(); findOn(false); }
module.exports = { setupRemote, stopRemote: resetRemote, resetRemote };
