// Strodano VJ desktop app: the web edition (../web) in an Electron window. GPL-3.0.
// Show-safety settings: the frame loop never slows down when windows are covered or minimised, the display never goes
// to sleep, quitting asks first, there is no Reload shortcut (it would end the show), a crashed page reloads itself (the
// composition comes back from its autosave), and output windows open without a pop-up blocker.
// `electron . --selftest` loads the app, opens an output window, simulates a GPU reset and prints a JSON report
// (exit code 0 = all good); CI runs it before packaging (STRODANO_SOFTWARE_GL=1 there: the runners have no GPU).
'use strict';
const { app, BrowserWindow, session, powerSaveBlocker, dialog, Menu, shell } = require('electron');
const path = require('path');

const selftest = process.argv.includes('--selftest');
const webDir = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
const isMac = process.platform === 'darwin';

if (!selftest && !app.requestSingleInstanceLock()) app.quit();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force_high_performance_gpu');
if (process.env.STRODANO_SOFTWARE_GL) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }

let win = null, quitting = false;
const ALLOWED = new Set(['media', 'midi', 'midiSysex', 'fullscreen', 'fileSystem', 'clipboard-sanitized-write', 'window-management', 'pointerLock']);

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1000, minHeight: 640, backgroundColor: '#0a0a0a', title: 'Strodano VJ', show: !selftest,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  // Output windows (window.open('', 'strodano_out_N')) open as real windows; other links go to the browser.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName && frameName.startsWith('strodano_out_')) {
      return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: '#000000', autoHideMenuBar: true, title: 'Strodano VJ output', webPreferences: { backgroundThrottling: false } } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', child => child.setMenuBarVisibility(false));
  win.webContents.on('will-prevent-unload', e => e.preventDefault());   // the page's own "leave?" prompt: the close dialog below asks instead
  win.webContents.on('render-process-gone', (e, d) => { if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => win.reload(), 500); });
  win.on('close', e => {
    if (quitting || selftest) return;
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Strodano VJ',
      message: 'Quit Strodano VJ?', detail: 'The show stops and the output windows close. Your composition is saved automatically.' });
    if (r === 0) quitting = true; else e.preventDefault();
  });
  win.on('closed', () => { win = null; app.quit(); });
  win.loadFile(path.join(webDir, 'index.html'));
  if (selftest) runSelftest();
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Help', submenu: [
      { label: 'Project page', click: () => shell.openExternal('https://github.com/strodanodev/Strodanovj') },
      { label: 'Developer tools', click: () => { if (win) win.webContents.toggleDevTools(); } },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
  wc.on('console-message', (e, level, message) => { if (level >= 3) (report.consoleErrors = report.consoleErrors || []).push(String(message).slice(0, 200)); });
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
        await js(`gl.getExtension('WEBGL_lose_context').loseContext(); true`);   // simulated GPU reset: the page reloads itself
      } else {
        report.recovered = await js(`({ status: document.getElementById('status').textContent, outputLive: liveScreens().length, lost: gl.isContextLost() })`);
        const b = report.boot, o = report.output, r = report.recovered;
        const ok = b.webgl2 && !b.badShaders.length && b.three && o.opened && o.live && !r.lost && r.outputLive > 0 && /Recovered/.test(r.status);
        finish(ok, ok ? '' : 'a check failed');
      }
    } catch (e) { finish(false, String(e && e.message || e)); }
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED.has(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ALLOWED.has(perm));
  if (!selftest) powerSaveBlocker.start('prevent-display-sleep');
  buildMenu();
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
