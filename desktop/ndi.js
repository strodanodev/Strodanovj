// Strodano VJ NDI output, main-process side. GPL-3.0.
// Starts the sender thread (ndi-worker.js) and creates / removes NDI sources for the page (web/ndi.js). The frames
// themselves skip this process: the page POSTs them to the sender thread's loopback endpoint (port + token from
// ndi:status). Receivers on the same network (wired or Wi-Fi) see each running screen as an NDI source named
// "<computer> (<name>)".
'use strict';
const { ipcMain } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');

let worker = null, seq = 0, status = null;
const waiting = new Map();
const orphans = new Map();   // id -> timer: sources left by a page reload, removed unless the page claims them again

function call(msg) {
  if (!worker) {
    // packaged: the worker and koffi are unpacked from the asar (package.json asarUnpack)
    worker = new Worker(path.join(__dirname.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked'), 'ndi-worker.js'));
    worker.on('message', m => { const w = waiting.get(m.seq); if (w) { waiting.delete(m.seq); w(m); } });
    worker.on('error', e => { status = { ok: false, error: 'NDI stopped: ' + e.message }; for (const w of waiting.values()) w({ ok: false, error: status.error }); waiting.clear(); worker = null; });
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
function stopNdi() { if (worker) { worker.terminate(); worker = null; } }

module.exports = { setupNdi, stopNdi };
