// Strodano VJ desktop: updates. GPL-3.0.
// Windows: electron-updater reads the newest published GitHub release (latest.yml beside the installer), downloads the
// installer when the page says so (web/update.js: never while a show is running unless the user asks) and installs it
// only on "Restart and update", silently, then opens the app again. Nothing is installed on a plain quit: a silent
// installer still running when the app is opened again would close it.
// macOS: updating in place needs a Developer ID signature, which this app does not have, so the app only finds out
// that a newer release exists (GitHub's "latest" redirect) and offers the download.
// The installer is not code-signed, so the updater cannot check a publisher; it checks the download's SHA-512 against
// latest.yml from the same release over https.
// State sent to the page ('update:state'): { state: 'idle' | 'available' | 'downloading' | 'ready' | 'error',
//   current, version, percent, manual (true = offer a download instead of installing), error }.
// Testing: STRODANO_UPDATE_URL=http://127.0.0.1:<port>/ points a packaged build at a folder with latest.yml and the
// installer (local addresses only). Every state change is written to update.log in the app's data folder.
'use strict';
const { app, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const REPO = 'https://github.com/strodanodev/Strodanovj';
const DOWNLOAD = 'https://www.strodano.live/api/download?os=';
const FIRST_CHECK = 15e3, EVERY = 4 * 3600e3;

function setupUpdater(getWin, { selftest, beforeInstall }) {
  const state = { state: 'idle', current: app.getVersion(), version: '', percent: 0, manual: false, error: '' };
  const testUrl = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.STRODANO_UPDATE_URL || '') ? process.env.STRODANO_UPDATE_URL : '';
  const active = !selftest && (app.isPackaged || !!testUrl);
  const logFile = path.join(app.getPath('userData'), 'update.log');
  try { fs.writeFileSync(logFile, ''); } catch (e) {}
  const log = t => { try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + t + '\n'); } catch (e) {} };
  const set = patch => {
    Object.assign(state, patch);
    log(state.state + (state.version ? ' ' + state.version : '') + (state.state === 'downloading' ? ' ' + state.percent + '%' : '') + (state.error ? ' ' + state.error : ''));
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('update:state', state);
  };
  const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

  let au = null, asked = false;   // asked: the user chose Help > Check for updates and wants an answer either way
  if (active && process.platform === 'win32') {
    au = require('electron-updater').autoUpdater;
    au.autoDownload = false; au.autoInstallOnAppQuit = false; au.disableWebInstaller = true; au.allowPrerelease = false;
    au.logger = { info: () => {}, warn: m => log('warn ' + m), error: m => log('error ' + m), debug: () => {} };
    if (testUrl) { if (!app.isPackaged) au.forceDevUpdateConfig = true; au.setFeedURL({ provider: 'generic', url: testUrl }); }
    au.on('update-available', i => { if (state.state !== 'ready' && state.state !== 'downloading') set({ state: 'available', version: i.version, percent: 0, error: '' }); answer(); });
    au.on('update-not-available', () => { if (state.state === 'idle' || state.state === 'error') set({ state: 'idle', error: '' }); answer(); });
    au.on('download-progress', p => { const pc = Math.round(p.percent || 0); if (pc !== state.percent || state.state !== 'downloading') set({ state: 'downloading', percent: pc }); });
    au.on('update-downloaded', i => set({ state: 'ready', version: i.version, percent: 100, error: '' }));
    au.on('error', e => { const m = String(e && e.message || e).split('\n')[0].slice(0, 200); if (state.state === 'ready') log('error ' + m); else set({ state: state.version ? 'available' : 'error', error: m }); answer(); });
  }

  // Help > Check for updates: tell the person what was found (the header label covers the automatic checks).
  function answer() {
    if (!asked) return;
    asked = false;
    const w = getWin();
    if (!w || w.isDestroyed()) return;
    if (state.state === 'available' || state.state === 'ready' || state.state === 'downloading') return;   // the header label shows it: the page opens its dialog
    dialog.showMessageBox(w, { type: 'info', title: 'Strodano VJ', message: state.error ? 'Could not check for updates' : 'Strodano VJ is up to date',
      detail: state.error ? 'Check the internet connection and try again.\n\n' + state.error : 'You have version ' + state.current + ', the newest one.' });
  }

  async function check(byUser) {
    if (byUser) asked = true;
    if (!active) { if (byUser) { state.error = ''; answer(); } return; }
    if (au) { try { await au.checkForUpdates(); } catch (e) { /* reported through the error event */ } return; }
    // macOS (and any other platform): only find out whether a newer release exists
    try {
      const r = await fetch(REPO + '/releases/latest', { method: 'HEAD', redirect: 'manual' });
      const v = /\/releases\/tag\/v(\d+\.\d+\.\d+)$/.exec(r.headers.get('location') || '');
      if (!v) throw new Error('GitHub did not name the latest release');
      if (newer(v[1], state.current)) set({ state: 'available', version: v[1], manual: true, error: '' });
      else if (state.state !== 'available') set({ state: 'idle', error: '' });
    } catch (e) { if (state.state !== 'available') set({ state: 'error', error: String(e && e.message || e).slice(0, 200) }); }
    answer();
  }

  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => { check(true); return true; });
  ipcMain.handle('update:download', async () => {
    if (!au || state.state !== 'available' || state.manual) return false;
    set({ state: 'downloading', percent: 0, error: '' });
    try { await au.downloadUpdate(); } catch (e) { /* reported through the error event */ }
    return true;
  });
  ipcMain.handle('update:install', () => {
    if (state.manual) { shell.openExternal(DOWNLOAD + (process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac' : 'mac-intel') : 'win')); return true; }
    if (!au || state.state !== 'ready') return false;
    log('installing ' + state.version);
    beforeInstall();                 // the quit question is skipped: the person already said yes on the page
    au.quitAndInstall(true, true);   // silent, and the app opens again afterwards
    return true;
  });

  if (active) { setTimeout(() => check(false), FIRST_CHECK); setInterval(() => check(false), EVERY); }
  return { check: () => check(true), state };
}

module.exports = { setupUpdater };
