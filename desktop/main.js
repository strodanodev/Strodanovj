// Strodano VJ desktop app: the web edition (../web) in an Electron window. GPL-3.0.
// Show-safety settings: the frame loop never slows down when windows are covered or minimised, the display never goes
// to sleep, quitting asks first, there is no Reload shortcut (it would end the show), a crashed page reloads itself (the
// composition comes back from its autosave), and output windows open without a pop-up blocker.
// `electron . --selftest` loads the app, opens an output window, simulates a GPU reset and prints a JSON report
// (exit code 0 = all good); CI runs it before packaging (STRODANO_SOFTWARE_GL=1 on Windows runners, which have no GPU;
// macOS runners have a virtual Metal GPU and SwiftShader does not start there).
'use strict';
const { app, BrowserWindow, session, powerSaveBlocker, dialog, Menu, shell, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { setupNdi, stopNdi } = require('./ndi');
const { setupNdiNet } = require('./ndinet');
const { setupPower } = require('./power');
const { setupUpdater } = require('./updater');
const { setupRekordbox, stopRekordbox } = require('./rekordbox');
const { setupPro } = require('./pro');
const { setupRemote, stopRemote, resetRemote } = require('./remote');

const selftest = process.argv.includes('--selftest');
// Packaged, the page is inside app.asar (package.json build.files), whose hash the Electron binary checks on start
// (afterpack.js fuses), so the shipped app's files cannot be edited.
const webDir = app.isPackaged ? path.join(__dirname, 'web') : path.join(__dirname, '..', 'web');
const isMac = process.platform === 'darwin';
// Developer tools only in development (`npm start`). The packaged app has no DevTools, no menu item for them, and
// refuses to start with a remote-debugging switch (the Node inspector switches are turned off by a fuse).
const devTools = !app.isPackaged;
if (!devTools && ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins'].some(s => app.commandLine.hasSwitch(s))) { app.exit(1); }

if (!selftest && !app.requestSingleInstanceLock()) app.quit();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force_high_performance_gpu');
if (process.env.STRODANO_SOFTWARE_GL) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }

let win = null, quitting = false, updater = null;
const outputs = new Map();   // output window name ('strodano_out_N') -> BrowserWindow
const ALLOWED = new Set(['media', 'midi', 'midiSysex', 'fullscreen', 'fileSystem', 'clipboard-sanitized-write', 'window-management', 'pointerLock']);

// The control window's full screen state is kept across starts (userData/window.json), so a handheld (ROG Ally) that
// was set to full screen opens that way. In full screen the menu bar (File, Edit, View, Help) is hidden: F11, the
// sidebar's full screen button or Shift + Menu on a gamepad goes back.
const winStateFile = () => path.join(app.getPath('userData'), 'window.json');
function readWinState() { try { return JSON.parse(fs.readFileSync(winStateFile(), 'utf8')) || {}; } catch (e) { return {}; } }
function writeWinState(st) { try { fs.writeFileSync(winStateFile(), JSON.stringify(st)); } catch (e) {} }
function setFull(on) {
  if (!win || win.isDestroyed()) return;
  win.setFullScreen(!!on);
}
ipcMain.handle('window:fullscreen', (e, on) => { if (on === null || on === undefined) return !!(win && win.isFullScreen()); setFull(on); return !!on; });
// Remote mode (Phase 3 of ../remote-control-spec.md): the control window shows web/remote.html instead of the show, so
// this computer (a ROG Ally) plays a show running on another one. Kept in window.json, so a computer set up as a remote
// starts as one; never during the self-test. Switching closes this computer's output windows: its own show stops.
// get = { on, name }: name is this computer's name, which the remote page gives the other computer to tell devices apart.
const remoteOn = () => !selftest && !!readWinState().remote;
const pageFile = () => path.join(webDir, remoteOn() ? 'remote.html' : 'index.html');
ipcMain.handle('window:remote', (e, on) => {
  if (!win || win.isDestroyed() || e.sender !== win.webContents) return null;   // only the control window may ask
  if (on === null || on === undefined) return { on: remoteOn(), name: String(os.hostname() || '').replace(/[^\w .\-]/g, '').slice(0, 40) };
  if (selftest) return false;
  writeWinState({ ...readWinState(), remote: !!on });
  for (const c of outputs.values()) if (!c.isDestroyed()) c.close();
  win.loadFile(pageFile());
  return !!on;
});

function createWindow() {
  const st = selftest ? {} : readWinState(), wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1000, minHeight: 640, backgroundColor: '#0a0a0a', title: 'Strodano VJ', show: !selftest,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false, devTools, preload: path.join(__dirname, 'preload.js') },
  });
  // Output windows (window.open('', 'strodano_out_N')) open as real windows; other links go to the browser.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName && frameName.startsWith('strodano_out_')) {
      return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: '#000000', autoHideMenuBar: true, title: 'Strodano VJ output', webPreferences: { backgroundThrottling: false, devTools } } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child, d) => {
    child.setMenuBarVisibility(false);
    const name = d && d.frameName;
    if (name && name.startsWith('strodano_out_')) { outputs.set(name, child); child.on('closed', () => { if (outputs.get(name) === child) outputs.delete(name); }); }
  });
  // a screen smaller than the window (a handheld at 150 % scaling): use all of it
  if (!selftest && (wa.width < 1600 || wa.height < 1000)) win.maximize();
  const fsChanged = on => {
    win.setMenuBarVisibility(!on);   // more room: no File / Edit / View / Help in full screen
    writeWinState({ ...readWinState(), fullscreen: on });
    win.webContents.send('window:fullscreen', on);
  };
  win.on('enter-full-screen', () => fsChanged(true));
  win.on('leave-full-screen', () => fsChanged(false));
  if (st.fullscreen) win.once('ready-to-show', () => { win.setMenuBarVisibility(false); win.setFullScreen(true); });
  // the control window moved to another display: which displays count as "external" changes
  let movedT = 0;
  win.on('moved', () => { clearTimeout(movedT); movedT = setTimeout(sendDisplays, 300); });
  // a new page in the control window (Remote mode switch, a reload): its LAN remote session ends with it (desktop/remote.js)
  win.webContents.on('did-start-navigation', d => { if (d && d.isMainFrame && !d.isSameDocument) resetRemote(); });
  win.webContents.on('will-prevent-unload', e => e.preventDefault());   // the page's own "leave?" prompt: the close dialog below asks instead
  win.webContents.on('render-process-gone', (e, d) => { if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => win.reload(), 500); });
  win.on('close', e => {
    if (quitting || selftest) return;
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Strodano VJ',
      message: 'Quit Strodano VJ?', detail: remoteOn() ? 'This is the remote: the show on the other computer keeps running.' : 'The show stops and the output windows close. Your composition is saved automatically.' });
    if (r === 0) quitting = true; else e.preventDefault();
  });
  win.on('closed', () => { win = null; app.quit(); });
  win.loadFile(pageFile());
  if (selftest) runSelftest();
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Help', submenu: [
      { label: 'Check for updates...', click: () => { if (updater) updater.check(); } },
      { label: 'Project page', click: () => shell.openExternal('https://github.com/strodanodev/Strodanovj') },
      ...(devTools ? [{ label: 'Developer tools', click: () => { if (win) win.webContents.toggleDevTools(); } }] : []),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- displays (web/display.js) ----------
// The page decides which output goes where; the main process lists displays, reports hot-plugs and places windows,
// because only it can put a window fullscreen on a given display without a click.
function displayList() {
  const ctl = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()).id : screen.getPrimaryDisplay().id, prim = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || ('Display ' + (i + 1)), x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height,
    scale: d.scaleFactor, hz: d.displayFrequency || 0, primary: d.id === prim, control: d.id === ctl, internal: !!d.internal }));
}
let dispT = 0;
function sendDisplays() { if (win && !win.isDestroyed()) win.webContents.send('displays:changed', displayList()); }
const displaysChanged = () => { clearTimeout(dispT); dispT = setTimeout(sendDisplays, 400); };   // a plug-in fires added + metrics-changed in a burst
ipcMain.handle('displays:list', () => displayList());
ipcMain.handle('output:place', (e, { frame, displayId }) => {
  const child = outputs.get(frame);
  if (!child || child.isDestroyed()) return false;
  if (displayId == null) {   // back to a normal window on the control display
    child.setFullScreen(false); child.setAlwaysOnTop(false);
    const wa = (win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).workArea;
    child.setBounds({ x: wa.x + Math.round((wa.width - 960) / 2), y: wa.y + Math.round((wa.height - 540) / 2), width: 960, height: 540 });
    return true;
  }
  const d = screen.getAllDisplays().find(x => x.id === displayId);
  if (!d) return false;
  if (child.isFullScreen()) child.setFullScreen(false);
  child.setBounds(d.bounds);   // move first: fullscreen happens on the display the window is on
  child.setFullScreen(true);
  child.setAlwaysOnTop(true, 'screen-saver');   // nothing (notifications, other windows) covers the show
  child.showInactive();   // keep keyboard focus in the control window
  return true;
});
ipcMain.handle('displays:identify', (e, marks) => {
  for (const m of marks) {
    const d = screen.getAllDisplays().find(x => x.id === m.id);
    if (!d) continue;
    const w = new BrowserWindow({ ...d.bounds, frame: false, transparent: true, alwaysOnTop: true, focusable: false, skipTaskbar: true, resizable: false, hasShadow: false, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: false, devTools } });
    w.setIgnoreMouseEvents(true); w.setAlwaysOnTop(true, 'screen-saver');
    const esc = String(m.text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const [num, ...rest] = esc.split('\n');
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(0,0,0,.55);color:#fff;font-family:system-ui;border:8px solid #ff7a1a;box-sizing:border-box"><div style="font-size:38vh;font-weight:700;line-height:1">${num}</div>
      <div style="font-size:4vh;opacity:.85">${rest.join('<br>')}</div></body>`));
    w.once('ready-to-show', () => w.showInactive());
    setTimeout(() => { if (!w.isDestroyed()) w.close(); }, 3000);
  }
  return true;
});

// ---------- self-test ----------
function runSelftest() {
  const wc = win.webContents, report = {}, wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => wc.executeJavaScript(code, true);
  let loads = 0;
  const finish = (ok, why) => {
    report.ok = ok; if (why) report.reason = why;
    console.log('SELFTEST ' + JSON.stringify(report));
    app.exit(ok ? 0 : 1);
  };
  setTimeout(() => finish(false, 'timed out'), 90000);
  wc.on('console-message', e => { if (e.level === 'error') (report.consoleErrors = report.consoleErrors || []).push(String(e.message).slice(0, 200)); });
  wc.on('did-finish-load', async () => {
    loads++;
    try {
      await wait(4000);
      if (loads === 1) {
        report.boot = await js(`(() => { const d = gl.getExtension('WEBGL_debug_renderer_info');
          return { webgl2: !!gl, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '', badShaders: strodano.checkShaders(), three: typeof THREE !== 'undefined',
            layers: comp.layers.length, threeD: comp.layers.flatMap(L => L.clips.filter(c => c && c.type === '3d')).length, status: document.getElementById('status').textContent }; })()`);
        report.output = await js(`(async () => { const ok = openOutput(0); await new Promise(r => setTimeout(r, 1500));
          const s = screens[0]; return { opened: ok, live: !!(s.win && !s.win.closed), size: s.ctx ? [s.ctx.canvas.width, s.ctx.canvas.height] : null }; })()`);
        report.fps = await js(`new Promise(r => setTimeout(() => r(Math.round(window.__fps || 0)), 2500))`);
        report.displays = await js(`(async () => { const l = await window.strodanoDesktop.displays(); return { count: l.length, bridge: display.desktop, known: display.list.length }; })()`);
        // output fullscreen on a display (the control one: CI has only one), then Esc puts it back in a window. Each step is
        // waited for (up to 10 s) and timed, inMs / backMs: with software GL the FIRST fullscreen takes about 4 s on v0.4.8
        // and on v0.4.9 alike (measured 2026-11-25), so the fixed 2.5 s wait used before failed or passed by chance.
        report.place = await js(`(async () => { const d = display.list[0], s = screens[0], w = s.win, nap = ms => new Promise(r => setTimeout(r, ms));
          s.device = d.key; let t0 = performance.now(); openOnDisplay(0, d);
          while (w.innerWidth !== d.w && performance.now() - t0 < 10000) await nap(50);
          const r = { size: [w.innerWidth, w.innerHeight], display: [d.w, d.h], inMs: Math.round(performance.now() - t0), placed: s.placedOn === d.key, label: document.getElementById('outBtn').textContent };
          t0 = performance.now(); outputEscape(0);
          while (w.innerWidth >= d.w && performance.now() - t0 < 10000) await nap(50);
          r.back = [w.innerWidth, w.innerHeight]; r.backMs = Math.round(performance.now() - t0); s.device = 'auto'; r.live = liveScreens().length; return r; })()`);
        // NDI: a network screen sends for 8 s (only checked where an NDI Runtime is installed; CI has none)
        report.ndi = await js(`(async () => { const st = await ndiStatus(); if (!st.ok) return { available: false, error: st.error };
          screens.push({ name: 'NDI test', device: 'ndi', ndiName: 'Strodano VJ selftest', ndiRes: '1280x720', ndiFps: 30, win: null, ctx: null, slices: [newSlice('Slice 1')] });
          const i = screens.length - 1, s = screens[i]; out.testPattern = true; await ndiStart(i); const t0 = performance.now(); await new Promise(r => setTimeout(r, 8000));
          const n = s.ndiSend || {}, r = { available: true, version: st.version, sent: n.sent, fps: +(n.sent * 1000 / (performance.now() - t0)).toFixed(1), conns: n.conns, dropped: n.dropped, dropGpu: n.dropGpu, dropNet: n.dropNet, rttMaxMs: Math.round(n.rttMax), workerMs: n.ms, rttMs: Math.round(n.rtt), readMs: +(n.readMs || 0).toFixed(1), error: n.error || '', label: document.getElementById('outBtn').textContent };
          closeOutput(i); screens.splice(i, 1); out.testPattern = false; return r; })()`);
        // rekordbox stick (only where one is plugged in): found by the drive scan, database read, one playlist's songs handed over as files
        report.rekordbox = await js(`(async () => { const st = await window.strodanoDesktop.rekordbox.list(); if (!st.length) return { sticks: 0 }; if (typeof rbOpenStick !== 'function') return { sticks: st.length, skipped: 'no Pro bundle' };
          try { await rbOpenStick(st[0]); const l = rb.db.lists.filter(x => !x.folder).map(x => ({ x, ts: rbListTracks(rb.db, x.id) })).filter(o => o.ts.length).sort((a, b) => a.ts.length - b.ts.length)[0];
            const ts = l ? l.ts : [...rb.db.tracks.values()].slice(0, 5); await rbDeskFetch(ts.map(t => t.path));
            const fs = ts.map(t => rb.deskFiles.get(t.path)).filter(Boolean), named = fs.filter((f, i) => ts.filter(t => rb.deskFiles.get(t.path))[i].path.endsWith('/' + f.name)).length;
            const head = fs[0] ? new Uint8Array(await fs[0].slice(0, 4).arrayBuffer()).length : 0, m = ts[0] ? await rbMeta(ts[0]) : null;
            const r = { sticks: st.length, name: st[0].name, tracks: rb.db.tracks.size, playlists: rb.db.lists.length, list: l ? l.x.name : '', asked: ts.length, files: fs.length, named, bytes: fs.reduce((n, f) => n + f.size, 0), head, grid: !!(m && m.grid), cues: m ? m.cues.length : 0 };
            rb.stick = null; rb.db = null; rb.deskFiles = new Map(); return r; } catch (e) { return { sticks: st.length, error: String(e && e.message || e) }; } })()`);
        report.rekordbox.ok = !report.rekordbox.sticks || !!report.rekordbox.skipped || (!report.rekordbox.error && report.rekordbox.files > 0 && report.rekordbox.named === report.rekordbox.files && report.rekordbox.head === 4);
        report.ndi.ok = !report.ndi.available || (report.ndi.sent > 0 && !report.ndi.error);
        report.place.ok =report.place.placed && report.place.size[0] === report.place.display[0] && report.place.back[0] < report.place.display[0] && report.place.live === 1;
        await js(`gl.getExtension('WEBGL_lose_context').loseContext(); true`);   // simulated GPU reset: the page reloads itself
      } else {
        report.recovered = await js(`({ recovery: window.vjRecovered || '', status: document.getElementById('status').textContent, outputLive: liveScreens().length, lost: gl.isContextLost() })`);
        const b = report.boot, o = report.output, r = report.recovered;
        // Pro: development (npm start, CI) loads web/pro/pro.js from tools/pro.mjs and must have it (STRODANO_FREE=1 tests this repo
        // alone); a packaged app has Pro only once an account downloaded it (web/prodl.js), so there it is reported, not required
        report.pro = await js(`window.SVJ_PRO ? window.SVJ_PRO.version : ''`);
        const proOk = !!report.pro || app.isPackaged || process.env.STRODANO_FREE === '1';
        const ok = proOk && report.displays && report.displays.count > 0 && report.displays.bridge && (report.place.ok || isMac) && report.ndi.ok && report.rekordbox.ok && b.webgl2 && !b.badShaders.length && b.three && o.opened && o.live && !r.lost && r.outputLive > 0 && r.recovery === 'ok';
        finish(ok, ok ? '' : 'a check failed');
      }
    } catch (e) { finish(false, String(e && e.message || e)); }
  });
}

app.whenReady().then(() => {
  setupPro();   // desktop/pro.js: the downloaded Strodano VJ Pro bundle, before the page asks for it
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED.has(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ALLOWED.has(perm));
  if (!selftest) powerSaveBlocker.start('prevent-display-sleep');
  buildMenu();
  createWindow();
  setupNdi(() => win);
  setupNdiNet();   // desktop/ndinet.js: NDI network check (firewall, addresses) for the NDI panel
  setupPower();   // desktop/power.js: Windows must not slow the app down while its window is minimized or covered
  setupRekordbox(() => win);   // desktop/rekordbox.js: finds rekordbox USB sticks as they are plugged in
  setupRemote(() => win, webDir);   // desktop/remote.js: remote control without internet (LAN server, beacon)
  updater = setupUpdater(() => win, { selftest, beforeInstall: () => { quitting = true; } });   // desktop/updater.js
  screen.on('display-added', displaysChanged); screen.on('display-removed', displaysChanged); screen.on('display-metrics-changed', displaysChanged);
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { stopNdi(); stopRekordbox(); stopRemote(); });
app.on('window-all-closed', () => app.quit());
