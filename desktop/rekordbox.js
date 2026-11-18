// Strodano VJ desktop: rekordbox USB sticks (web/rekordbox.js). GPL-3.0.
// A page cannot see drives, so the main process looks for them: every few seconds each mounted volume is checked for
// PIONEER/rekordbox/export.pdb, and the page is told when a stick appears or goes. The page may then
//   - read a small file of that stick (the database, the per-track analysis files), and
//   - have the stick's song files put into a hidden <input type=file> of the page. That gives the page real File
//     objects backed by the disk: nothing is copied into memory until a song is decoded. Chromium only lets a user
//     gesture or the DevTools protocol fill a file input, so this goes through webContents.debugger for the length of
//     one call (it cannot run while the Developer tools are open: they hold the same connection).
// Both are limited to paths inside a stick found by the scan.
'use strict';
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB = ['PIONEER', 'rekordbox', 'export.pdb'];
const READ_MAX = 96 * 1024 * 1024;   // the database of a very large stick is a few tens of MB
const sticks = new Map();            // id -> { id, root, name, plus }
let getWin = () => null, timer = null, scanning = false;

const exists = p => fs.promises.access(p).then(() => true, () => false);
async function candidates() {
  if (process.platform === 'win32') {
    const sys = (process.env.SystemDrive || 'C:').toUpperCase();
    return 'ABDEFGHIJKLMNOPQRSTUVWXYZC'.split('').map(l => l + ':').filter(d => d !== sys).map(d => ({ root: d + '\\', name: d }));
  }
  const dirs = process.platform === 'darwin' ? ['/Volumes'] : ['/media/' + os.userInfo().username, '/run/media/' + os.userInfo().username, '/media', '/mnt'];
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = await fs.promises.readdir(d); } catch (e) {}
    for (const n of names) out.push({ root: path.join(d, n) + path.sep, name: n });
  }
  return out;
}
async function scan() {
  if (scanning) return;   // a slow drive (an empty card reader, a network share that went away) must not pile scans up
  scanning = true;
  try {
    const found = new Map();
    for (const c of await candidates()) {
      const db = path.join(c.root, ...DB);
      if (!await exists(db)) continue;
      let st;
      try { st = await fs.promises.stat(db); } catch (e) { continue; }
      // the volume's serial number (Windows) or its name: the same stick is recognised when it comes back
      const id = (process.platform === 'win32' ? 'v' + st.dev : 'n' + c.name).replace(/[^\w.-]/g, '_').slice(0, 80);
      if (!found.has(id)) found.set(id, { id, root: c.root, name: c.name, plus: await exists(path.join(c.root, 'PIONEER', 'rekordbox', 'exportLibrary.db')) });
    }
    const changed = found.size !== sticks.size || [...found.values()].some(s => !sticks.has(s.id) || sticks.get(s.id).root !== s.root);
    if (changed) {
      sticks.clear();
      for (const s of found.values()) sticks.set(s.id, s);
      const w = getWin();
      if (w && !w.isDestroyed()) w.webContents.send('rekordbox:sticks', list());
    }
  } finally { scanning = false; }
}
const list = () => [...sticks.values()].map(s => ({ id: s.id, name: s.name, plus: s.plus }));

// A path on a stick ("/Contents/Artist/song.mp3") as a real path, or null when it would leave the stick.
function resolve(id, rel) {
  const s = sticks.get(String(id));
  if (!s) return null;
  const parts = String(rel).split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(p => p === '..' || p === '.' || p.includes('\0') || p.includes(':'))) return null;
  const full = path.join(s.root, ...parts);
  return full.startsWith(s.root) ? full : null;
}
const fromApp = e => { const w = getWin(); return !!w && !w.isDestroyed() && e.sender === w.webContents; };

function setupRekordbox(winGetter) {
  getWin = winGetter;
  ipcMain.handle('rekordbox:sticks', async e => { if (!fromApp(e)) return []; await scan(); return list(); });
  ipcMain.handle('rekordbox:read', async (e, { id, rel }) => {
    const p = fromApp(e) && resolve(id, rel);
    if (!p) throw new Error('not on a rekordbox stick');
    const st = await fs.promises.stat(p);
    if (!st.isFile() || st.size > READ_MAX) throw new Error('not a readable file');
    return fs.promises.readFile(p);
  });
  // rels -> the page's <input type=file id=inputId> gets the ones that exist, in the same order; ok[i] says which
  ipcMain.handle('rekordbox:files', async (e, { id, rels, inputId }) => {
    if (!fromApp(e) || !/^[\w-]{1,40}$/.test(inputId)) return { error: 'not allowed' };
    const ok = [], files = [];
    for (const rel of rels) {
      const p = resolve(id, rel);
      let good = false;
      if (p) { try { good = (await fs.promises.stat(p)).isFile(); } catch (err) {} }
      ok.push(good);
      if (good) files.push(p);
    }
    const dbg = e.sender.debugger;
    let mine = false;
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); mine = true; }
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 0 });
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#' + inputId });
      if (!nodeId) return { error: 'the page has no such input' };
      await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files });
      return { ok };
    } catch (err) {
      return { error: /already attached/i.test(String(err && err.message)) ? 'Close the Developer tools and try again: they block reading the stick' : 'Could not hand over the files: ' + (err && err.message || err) };
    } finally { if (mine) { try { dbg.detach(); } catch (err) {} } }
  });
  scan();
  timer = setInterval(scan, 3000);
}
function stopRekordbox() { clearInterval(timer); }

module.exports = { setupRekordbox, stopRekordbox };
