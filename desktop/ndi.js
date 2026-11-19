// Strodano VJ NDI output, main-process side. GPL-3.0.
// Starts the sender process (ndi-worker.js) and creates / removes NDI sources for the page (web/ndi.js). The frames
// themselves skip this process: the page POSTs them to the sender's loopback endpoint (port + token from
// ndi:status). Receivers on the same network (wired or Wi-Fi) see each running screen as an NDI source named
// "<computer> (<name>)".
// The sender is a utilityProcess (its own OS process), not a worker_threads Worker: as a Worker inside this main
// process its event loop froze for 0.2-1.6 s several times a second (measured 2026-11-19: 720p30 reached the receiver
// at 10-15 fps with 1.6 s gaps, half the frames dropped); the same endpoint in its own process: 0 dropped, 44 ms max.
// NDI settings of this app (Advanced Output > NDI > Network): a Discovery Server and / or one network adapter. They go to
// the sender process only, as its own NDI config file (NDI_CONFIG_DIR, read by the NDI library when it starts; tested
// 2026-11-19 with NDI 5.5: a per-process config changes that process alone, other NDI apps keep theirs). The file is
// the computer's own NDI config (NDI Access Manager: groups, remote sources...) with these two keys put over it, so
// Access Manager settings still count. Nothing set = no NDI_CONFIG_DIR, NDI reads the computer's config as before.
// The adapter is kept by NAME, not address: a venue's DHCP hands out a new address every time.
'use strict';
const { app, ipcMain, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { addresses } = require('./ndinet');

let worker = null, seq = 0, status = null;
let settings = null;   // {discovery: 'ip[:port],...', adapter: interface name}
const settingsFile = () => path.join(app.getPath('userData'), 'ndi-settings.json');
function loadSettings() {
  if (settings) return settings;
  try { const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); settings = { discovery: String(s.discovery || ''), adapter: String(s.adapter || '') }; }
  catch (e) { settings = { discovery: '', adapter: '' }; }
  return settings;
}
// the computer's own NDI config (what every other NDI app on it reads)
function globalConfig() {
  const dir = process.env.NDI_CONFIG_DIR || (process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'NDI') : path.join(os.homedir(), '.ndi'));
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'ndi-config.v1.json'), 'utf8')) || {}; } catch (e) { return {}; }
}
// what the sender runs with: {env, discovery, adapter, adapterIp, adapterMissing}
function senderSetup() {
  const s = loadSettings(), info = { discovery: s.discovery, adapter: s.adapter, adapterIp: '', adapterMissing: false };
  let ip = '';
  if (s.adapter) { const a = addresses().find(x => x.name === s.adapter && !x.linkLocal); if (a) ip = info.adapterIp = a.address; else info.adapterMissing = true; }
  if (!s.discovery && !ip) return { env: process.env, ...info };
  const cfg = globalConfig();
  const ndi = cfg.ndi = (cfg.ndi && typeof cfg.ndi === 'object') ? cfg.ndi : {};
  if (s.discovery) { ndi.networks = { ...(ndi.networks || {}), discovery: s.discovery }; }
  if (ip) ndi.adapters = { ...(ndi.adapters || {}), allowed: [ip] };
  const dir = path.join(app.getPath('userData'), 'ndi-config');
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'ndi-config.v1.json'), JSON.stringify(cfg, null, 2)); }
  catch (e) { return { env: process.env, ...info, error: 'could not write the NDI settings: ' + e.message }; }
  return { env: { ...process.env, NDI_CONFIG_DIR: dir }, ...info };
}
let running = null;   // senderSetup() of the running sender
const waiting = new Map();
const orphans = new Map();   // id -> timer: sources left by a page reload, removed unless the page claims them again

function failAll(error) {
  status = { ok: false, error };
  for (const w of waiting.values()) w({ ok: false, error });
  waiting.clear();
}
function call(msg) {
  if (!worker) {
    // packaged: the worker and koffi are unpacked from the asar (package.json asarUnpack)
    running = senderSetup();
    const w = worker = utilityProcess.fork(path.join(__dirname.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked'), 'ndi-worker.js'), [], { serviceName: 'Strodano VJ NDI', stdio: 'inherit', env: running.env });
    w.on('message', m => { const r = waiting.get(m.seq); if (r) { waiting.delete(m.seq); r(m); } });
    w.on('exit', code => { if (worker !== w) return; worker = null; failAll('NDI stopped (sender exited, code ' + code + ')'); });
  }
  return new Promise(res => { const s = ++seq; waiting.set(s, res); worker.postMessage({ ...msg, seq: s }); });
}

function setupNdi(getWin) {
  ipcMain.handle('ndi:status', async () => {
    if (!status || !status.ok) { const r = await call({ op: 'init' }); status = { ok: r.ok, error: r.error || '', version: r.version || '', lib: r.lib || '', port: r.port || 0, token: r.token || '' }; }
    return status;
  });
  ipcMain.handle('ndi:start', async (e, { id, name, groups }) => {
    clearTimeout(orphans.get(id)); orphans.delete(id);
    return call({ op: 'create', id, name, groups });
  });
  ipcMain.handle('ndi:stop', async (e, id) => { clearTimeout(orphans.get(id)); orphans.delete(id); return call({ op: 'destroy', id }); });
  // NDI settings: read (with what the running sender uses), and change (restarts the sender: the page restarts its sources)
  ipcMain.handle('ndi:settings', async () => {
    const s = loadSettings(), r = running || {};
    return { discovery: s.discovery, adapter: s.adapter, running: !!worker, adapterIp: r.adapterIp || '', adapterMissing: !!r.adapterMissing, error: r.error || '' };
  });
  ipcMain.handle('ndi:setsettings', async (e, s) => {
    const discovery = String((s && s.discovery) || '').replace(/\s+/g, '').slice(0, 300);
    if (discovery && !/^[\w.\-:\[\]]+(,[\w.\-:\[\]]+)*$/.test(discovery)) return { ok: false, error: 'Discovery Server: type an address like 192.168.1.10 (several: comma between them).' };
    settings = { discovery, adapter: String((s && s.adapter) || '').slice(0, 200) };
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (err) { return { ok: false, error: 'could not save: ' + err.message }; }
    for (const t of orphans.values()) clearTimeout(t);
    orphans.clear();
    stopNdi(); failAll('NDI restarted with new settings'); status = null;
    return { ok: true };
  });
  // The page reloads (GPU reset, crash): keep its sources for a few seconds so receivers stay connected if it restarts them.
  const w = getWin();
  w.webContents.on('did-start-loading', async () => {
    if (!worker) return;
    const r = await call({ op: 'list' });
    for (const id of r.ids || []) orphans.set(id, setTimeout(() => { orphans.delete(id); call({ op: 'destroy', id }); }, 10000));
  });
}
function stopNdi() { if (worker) { const w = worker; worker = null; w.kill(); } }

module.exports = { setupNdi, stopNdi };
