// Strodano VJ (web) - show safety: blackout, GPU loss recovery, keep the screen awake, confirm before closing a live show. GPL-3.0.
// Blackout: Shift+B, the BLACK button or a mapped pad fades the whole output (monitors and output windows) to black over
// half a second, and back. GPU loss: if the graphics driver resets (sleep, driver update, a GPU hang) every WebGL object
// is gone; the page saves the session, reloads itself, and puts back the playing clips, the blackout state and the
// output windows (they stay open through the reload). Three losses within a minute stop the reloading: the browser
// would block WebGL by then, and a loop of reloads helps nobody.
'use strict';
const safety = { black: false, gain: 1, fade: 0.5, wake: null };
const RECOVER_KEY = 'strodano-vj-recover', LOSSES_KEY = 'strodano-vj-gpu-losses';
const isElectron = /Electron\//.test(navigator.userAgent);
function outGain() { return safety.gain; }
function setBlackout(on) {
  safety.black = on === undefined ? !safety.black : !!on;
  const b = $('blackBtn');
  if (b) b.classList.toggle('on', safety.black);
  setStatus(safety.black ? 'BLACKOUT: the output fades to black. Shift+B (or BLACK) brings it back.' : 'Output back from blackout.');
}
function safetyTick(dt) {
  const target = safety.black ? 0 : 1, step = dt / safety.fade;
  safety.gain += Math.max(-step, Math.min(step, target - safety.gain));
}

// ---------- GPU loss ----------
glc.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  const now = Date.now();
  let losses = [];
  try { losses = JSON.parse(sessionStorage.getItem(LOSSES_KEY) || '[]').filter(t => now - t < 60000); } catch (err) {}
  losses.push(now);
  try { sessionStorage.setItem(LOSSES_KEY, JSON.stringify(losses)); } catch (err) {}
  if (losses.length > 3) { setStatus('The graphics card keeps failing. Save your composition, then restart the app or the computer.'); return; }
  setStatus('The graphics card was reset. Recovering the show...');
  try { autosave(); } catch (err) {}
  try {
    sessionStorage.setItem(RECOVER_KEY, JSON.stringify({
      active: comp.layers.map(L => L.active), black: safety.black, outputs: screens.map((s, i) => (s.win && !s.win.closed ? i : -1)).filter(i => i >= 0), ndi: screens.map((s, i) => (s.ndiSend ? i : -1)).filter(i => i >= 0), vdo: screens.map((s, i) => (s.vdoSend ? i : -1)).filter(i => i >= 0), sel: [sel.l, sel.c] }));
  } catch (err) {}
  window.vjKeepOutputs = true;   // engine.js leaves the output windows open through the reload
  setTimeout(() => location.reload(), 250);
});
// After a recovery reload: the composition is already back (autosave); put back what was playing and the output windows.
window.addEventListener('load', () => {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(RECOVER_KEY) || 'null'); sessionStorage.removeItem(RECOVER_KEY); } catch (e) {}
  if (!r) return;
  if (r.black) { safety.black = true; safety.gain = 0; }
  if (Array.isArray(r.sel)) { sel.l = Math.min(comp.layers.length - 1, r.sel[0] | 0); sel.c = r.sel[1] | 0; }
  const replay = () => (r.active || []).forEach((ci, li) => { const L = comp.layers[li]; if (L && ci >= 0 && L.active !== ci && L.pendingCol !== ci && L.clips[ci] && !L.clips[ci].missing) trigger(li, ci); });
  replay();
  setTimeout(replay, 2000);   // clips relinked from the media folder or remembered files arrive a moment later
  let lost = 0;
  for (const i of r.outputs || []) if (screens[i] && !openOutput(i)) lost++;   // the windows are still open; this picks them up again
  if (typeof syncDisplays === 'function') syncDisplays();
  for (const i of r.vdo || []) if (screens[i] && typeof vdoStart === 'function') vdoStart(i);   // same ID and password: viewers reconnect
  for (const i of r.ndi || []) if (screens[i] && typeof ndiStart === 'function') ndiStart(i);   // same names: receivers stay connected   // and puts them back on their displays (display.js)
  setStatus(lost ? 'Recovered after a graphics reset. Click Output to reopen the output window.' : 'Recovered after a graphics reset. The show is running again.');
  ui.gridDirty = ui.propsDirty = true;
});

// ---------- keep the screen awake, confirm before closing a live show ----------
async function keepAwake() {
  if (isElectron || !navigator.wakeLock || safety.wake || document.hidden) return;   // the desktop app does this itself
  try { safety.wake = await navigator.wakeLock.request('screen'); safety.wake.addEventListener('release', () => { safety.wake = null; }); } catch (e) {}
}
['pointerdown', 'keydown'].forEach(t => window.addEventListener(t, keepAwake, { capture: true }));
document.addEventListener('visibilitychange', keepAwake);
window.addEventListener('beforeunload', e => {
  if (window.vjKeepOutputs || isElectron) return;   // recovery reload; the desktop app asks in its own dialog
  if (liveScreens().length || (typeof ndiLive === 'function' && ndiLive().length) || (typeof vdoLive === 'function' && vdoLive().length)) { e.preventDefault(); e.returnValue = ''; }   // an output window is live: ask before ending the show
});

// The BLACK button sits in the transport bar, before the frame-rate readout (added once ui.js has defined el / $).
document.addEventListener('DOMContentLoaded', () => {
  const t = $('transport'), fps = $('fps');
  if (!t || $('blackBtn')) return;
  const b = el('button', { id: 'blackBtn', className: 'black-btn' + (safety.black ? ' on' : ''), textContent: 'BLACK', title: 'Fade the output to black and back (Shift+B)', dataset: { midi: 'blackout' }, onclick: () => setBlackout() });
  t.insertBefore(b, fps || null);
});
