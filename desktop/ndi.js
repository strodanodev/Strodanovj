// Strodano VJ NDI output, main-process side. GPL-3.0.
// Starts the sender process (ndi-worker.js) and creates / removes NDI sources for the page (web/ndi.js). The frames
// themselves skip this process: the page POSTs them to the sender's loopback endpoint (port + token from
// ndi:status). Receivers on the same network (wired or Wi-Fi) see each running screen as an NDI source named
// "<computer> (<name>)".
// The sender is a utilityProcess (its own OS process), not a worker_threads Worker: as a Worker inside this main
// process its event loop froze for 0.2-1.6 s several times a second (measured 2026-11-19: 720p30 reached the receiver
// at 10-15 fps with 1.6 s gaps, half the frames dropped); the same endpoint in its own process: 0 dropped, 44 ms max.
'use strict';
const { ipcMain, utilityProcess } = require('electron');
const path = require('path');

let worker = null, seq = 0, status = null;
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
    const w = worker = utilityProcess.fork(path.join(__dirname.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked'), 'ndi-worker.js'), [], { serviceName: 'Strodano VJ NDI', stdio: 'inherit' });
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
