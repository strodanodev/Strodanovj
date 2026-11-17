// Display output: which physical display each output screen goes to, and auto output (Resolume-style "Output > Fullscreen").
// GPL-3.0.
// Every screen has a `device`: 'auto' (the next external display free), 'window' (a normal window you drag yourself), or a
// display key (`label@x,y`, saved in the .svj; matched by key, then by label, so a rearranged desk still finds it).
// Auto output: when a display that is not the control display appears (plugged in, or present at start), the screens
// assigned to it open fullscreen on it; when it goes away its output window closes (otherwise the OS would throw a
// fullscreen output over the control screen).
// Desktop app: displays and placement come from the main process (desktop/preload.js `strodanoDesktop`): no clicks needed.
// Browser: the Window Management API (`getScreenDetails`, asks permission once); a pop-up needs a click, so a detected
// display shows "click to send output" and the next click anywhere opens it; fullscreen there needs a double-click.
'use strict';
const display = {
  desktop: typeof window.strodanoDesktop === 'object' && !!window.strodanoDesktop,
  list: [],                // [{key, id, num, label, x, y, w, h, scale, hz, primary, control}]
  autoOut: true,           // open / close outputs as displays come and go (localStorage)
  seen: new Set(),         // display keys present at the last refresh: a key not in here is "new"
  details: null,           // browser: ScreenDetails once permission is granted
  extended: false,         // browser: window.screen.isExtended (no permission needed)
  pending: false,          // browser: an output is waiting for a click to open
  started: false,
};
const DISPLAY_PREF = 'strodano-vj-display';
try { const p = JSON.parse(localStorage.getItem(DISPLAY_PREF) || '{}'); if (typeof p.autoOut === 'boolean') display.autoOut = p.autoOut; } catch (e) {}
function saveDisplayPref() { try { localStorage.setItem(DISPLAY_PREF, JSON.stringify({ autoOut: display.autoOut })); } catch (e) {} }

const displayKey = d => `${d.label}@${d.x},${d.y}`;
const screenDevice = s => s.device || 'auto';
function displayName(d) { return d ? 'Display ' + d.num + (d.label && !/^Display \d+$/.test(d.label) ? ' (' + d.label + ')' : '') : ''; }
function displayInfo(d) { return `${d.w * (d.scale || 1) | 0} x ${d.h * (d.scale || 1) | 0}` + (d.hz ? ` ${Math.round(d.hz)} Hz` : '') + (d.control ? ', control' : d.primary ? ', main' : ''); }

// numbered like the OS: main display first, then left to right
function setDisplays(raw) {
  const l = raw.map(d => ({ ...d })).sort((a, b) => (b.primary - a.primary) || (a.x - b.x) || (a.y - b.y));
  l.forEach((d, i) => { d.num = i + 1; d.key = displayKey(d); });
  const fresh = l.filter(d => !display.seen.has(d.key) && !d.control);
  const gone = [...display.seen].filter(k => !l.some(d => d.key === k));
  display.list = l; display.seen = new Set(l.map(d => d.key));
  if (fresh.length && display.started) setStatus(fresh.map(displayName).join(', ') + ' connected' + (display.autoOut ? '' : ' (auto output is off)'));
  if (gone.length && display.started) setStatus('A display was disconnected');
  syncDisplays(fresh.map(d => d.key));
  ui.propsDirty = true;
  if (typeof renderOutPanels === 'function' && !$('outModal').hidden) renderOutPanels();
}

// screen index -> display (or null): fixed choices first, then 'auto' screens take the free external displays in order
function displayTargets() {
  const t = screens.map(() => null), used = new Set();
  screens.forEach((s, i) => {
    const dev = screenDevice(s);
    if (dev === 'auto' || dev === 'window' || dev === 'ndi' || dev === 'vdo') return;
    const lab = dev.slice(0, dev.lastIndexOf('@'));
    const d = display.list.find(x => x.key === dev) || display.list.find(x => x.label === lab && !used.has(x.key));
    if (d) { t[i] = d; used.add(d.key); }
  });
  const free = display.list.filter(d => !d.control && !used.has(d.key));
  screens.forEach((s, i) => { if (screenDevice(s) === 'auto' && free.length) t[i] = free.shift(); });
  return t;
}
const displayFor = i => displayTargets()[i] || null;

function placeOutput(i, d) {
  const s = screens[i];
  if (!s || !s.win || s.win.closed) return;
  s.placedOn = d ? d.key : '';
  if (display.desktop) { window.strodanoDesktop.placeOutput('strodano_out_' + i, d ? d.id : null).catch(() => {}); return; }
  try {   // browser: move and size the pop-up; real fullscreen needs a gesture in that window (double-click)
    if (d) { s.win.moveTo(d.x, d.y); s.win.resizeTo(d.w, d.h); } else { s.win.resizeTo(960, 540); s.win.moveTo(window.screenX + 60, window.screenY + 60); }
  } catch (e) {}
  const sd = d && display.details && display.details.screens.find(x => displayKey(browserDisplay(x)) === d.key);
  if (sd) s.win.document.documentElement.requestFullscreen({ screen: sd }).catch(() => {});
}
// open (or move) screen i's output on its display; from a click in the browser, else only in the desktop app
function openOnDisplay(i, d) {
  const s = screens[i];
  if (screenDevice(s) === 'ndi') { if (typeof ndiStart === 'function') ndiStart(i); return true; }   // network output (ndi.js)
  if (screenDevice(s) === 'vdo') { if (typeof vdoStart === 'function') vdoStart(i); return true; }   // web link output (vdo.js)
  if (!(s.win && !s.win.closed)) {
    if (!openOutput(i, d ? { x: d.x, y: d.y, w: d.w, h: d.h } : null)) return false;
  }
  placeOutput(i, d);
  return true;
}

// Bring the output windows in line with the displays. `fresh` = keys of displays that just appeared (auto-open them).
function syncDisplays(fresh = []) {
  const t = displayTargets();
  let waiting = false;
  screens.forEach((s, i) => {
    const d = t[i], live = s.win && !s.win.closed;
    if (live && s.placedOn && (!d || d.key !== s.placedOn)) {
      if (!display.list.some(x => x.key === s.placedOn)) { closeOutput(i); s.placedOn = ''; setStatus(s.name + ': its display was disconnected, output closed'); return; }
      placeOutput(i, d);   // reassigned to another display, or back to a window
      return;
    }
    if (!d) return;
    if (live) { if (s.placedOn !== d.key) placeOutput(i, d); return; }
    if (display.autoOut && fresh.includes(d.key)) {
      if (display.desktop) openOnDisplay(i, d); else waiting = true;
    }
  });
  if (waiting) armPendingOutput();
  syncOutBtn();
}

// ---------- browser: Window Management API ----------
function browserDisplay(x) {
  return { id: x.label + x.left + ',' + x.top, label: x.label || 'Display', x: x.left, y: x.top, w: x.width, h: x.height, scale: x.devicePixelRatio || 1, hz: 0,
    primary: !!x.isPrimary, control: display.details ? x === display.details.currentScreen : !!x.isPrimary, internal: !!x.isInternal };
}
function browserRefresh() {
  if (display.details) { setDisplays(display.details.screens.map(browserDisplay)); return; }
  const s = window.screen;   // without permission: only "is there another display", and this one
  display.extended = !!s.isExtended;
  setDisplays([{ id: 'this', label: 'This display', x: s.availLeft || 0, y: s.availTop || 0, w: s.width, h: s.height, scale: window.devicePixelRatio || 1, hz: 0, primary: true, control: true }]);
}
async function askDisplays() {   // from a click: asks for the window-management permission
  if (!('getScreenDetails' in window)) { setStatus('This browser cannot list displays. Use Chrome or Edge, or the desktop app.'); return false; }
  try {
    display.details = await window.getScreenDetails();
    display.details.addEventListener('screenschange', browserRefresh);
    display.details.addEventListener('currentscreenchange', browserRefresh);
    browserRefresh();
    return true;
  } catch (e) { setStatus('Display access was refused. Allow "Window management" for this page in the site settings.'); return false; }
}
// a pop-up needs a click: the next click anywhere in the control window opens the waiting outputs
function armPendingOutput() {
  if (display.pending) return;
  display.pending = true;
  setStatus('Display detected: click anywhere to send the output to it');
  window.addEventListener('pointerdown', () => {
    display.pending = false;
    const t = displayTargets();
    screens.forEach((s, i) => { if (t[i] && !(s.win && !s.win.closed)) openOnDisplay(i, t[i]); });
    syncOutBtn(); ui.propsDirty = true;
  }, { once: true, capture: true });
}

// ---------- UI ----------
function identifyDisplays() {
  if (display.desktop) { window.strodanoDesktop.identify(display.list.map(d => ({ id: d.id, text: d.num + '\n' + d.label + '\n' + displayInfo(d) }))); return; }
  // browser: number the live output windows (other displays cannot be drawn on without a window there)
  screens.forEach(s => {
    if (!(s.win && !s.win.closed)) return;
    const d = display.list.find(x => x.key === s.placedOn), doc = s.win.document;
    const n = doc.createElement('div');
    n.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:700 30vh system-ui;background:rgba(0,0,0,.5);border:8px solid #ff7a1a;box-sizing:border-box';
    n.textContent = d ? String(d.num) : s.name;
    doc.body.append(n); s.win.setTimeout(() => n.remove(), 3000);
  });
  setStatus(display.details ? 'Numbers shown on the output windows' : 'Click "Find displays" first to number the displays');
}
// Advanced Output: the "Display" block of the selected screen, and the list of displays
function displayPanel(scr, i) {
  const t = displayTargets()[i], live = !!((scr.win && !scr.win.closed) || scr.ndiSend || scr.vdoSend);
  const sel = el('select', { onchange: e => {
    const was = screenDevice(scr);
    scr.device = e.target.value;
    if (was === 'ndi' && scr.device !== 'ndi') ndiStop(scr);
    if (was === 'vdo' && scr.device !== 'vdo') vdoStop(scr);
    if (scr.device === 'vdo') { if (scr.win && !scr.win.closed) closeOutput(i); if (live) vdoStart(i); renderOutPanels(); syncOutBtn(); return; }   // starts only from a click: it goes on the internet
    if (scr.device === 'ndi') { if (scr.win && !scr.win.closed) closeOutput(i); if (live || display.autoOut) ndiStart(i); renderOutPanels(); syncOutBtn(); return; }
    const d = displayFor(i);
    if (d && (live || display.autoOut)) openOnDisplay(i, d); else if (live) placeOutput(i, null);
    renderOutPanels(); syncOutBtn();
  } });
  sel.append(el('option', { value: 'auto', textContent: 'Auto (next external display)' }), el('option', { value: 'window', textContent: 'Window (drag it yourself)' }),
    el('option', { value: 'ndi', textContent: 'NDI (network, Wi-Fi)' + (ndi.api ? '' : ' - desktop app only'), disabled: !ndi.api && screenDevice(scr) !== 'ndi' }),
    el('option', { value: 'vdo', textContent: 'Web link (internet, vdo.ninja)' }));
  for (const d of display.list) sel.append(el('option', { value: d.key, textContent: displayName(d) + ' - ' + displayInfo(d) }));
  const dev = screenDevice(scr);
  if (dev !== 'auto' && dev !== 'window' && dev !== 'ndi' && dev !== 'vdo' && !display.list.some(d => d.key === dev)) sel.append(el('option', { value: dev, textContent: dev.slice(0, dev.lastIndexOf('@')) + ' (not connected)' }));
  sel.value = dev;
  if (dev === 'ndi') return [el('div', { className: 'fld' }, el('label', { textContent: 'Display' }), sel), ...ndiPanel(scr, i)];
  if (dev === 'vdo') return [el('div', { className: 'fld' }, el('label', { textContent: 'Display' }), sel), ...vdoPanel(scr, i)];
  const where = t ? 'Goes to ' + displayName(t) + (live && scr.placedOn === t.key ? ' (live, fullscreen)' : '') : dev === 'window' ? 'Opens as a window' : dev === 'auto' ? 'No external display: opens as a window' : 'That display is not connected';
  return [el('div', { className: 'fld' }, el('label', { textContent: 'Display' }), sel), el('div', { className: 'hint', textContent: where + (t && t.control ? '. This is the control display: Esc in the output returns it to a window.' : '') })];
}
function displaysList() {
  const box = [el('h4', { textContent: 'Displays' })];
  for (const d of display.list) {
    const users = screens.filter((s, i) => displayTargets()[i] === d).map(s => s.name);
    box.push(el('div', { className: 'sel-item', title: d.label, textContent: d.num + '. ' + d.label + '  ' + displayInfo(d) + (users.length ? '  > ' + users.join(', ') : '') }));
  }
  if (!display.desktop && !display.details) box.push(el('div', { className: 'hint', textContent: display.extended ? 'Another display is connected.' : 'One display found.' }),
    el('button', { textContent: 'Find displays', style: { width: '100%' }, onclick: async () => { await askDisplays(); renderOutPanels(); } }));
  box.push(el('div', { className: 'fld' }, el('button', { textContent: 'Identify', title: 'Show each display\'s number on it for 3 seconds', onclick: identifyDisplays }),
    el('label', { style: { flex: '1', color: 'var(--dim)' }, title: 'Open outputs fullscreen when their display is connected, close them when it is unplugged' },
      el('input', { type: 'checkbox', checked: display.autoOut, onchange: e => { display.autoOut = e.target.checked; saveDisplayPref(); if (display.autoOut) syncDisplays(display.list.map(d => d.key)); } }), ' Auto output')));
  return box;
}
// header Output button label: where the output is
function outputWhere() {
  const t = displayTargets(), on = screens.map((s, i) => (s.ndiSend ? 'NDI' : s.vdoSend ? 'Web link' : s.win && !s.win.closed && t[i] && s.placedOn === t[i].key ? 'Display ' + t[i].num : '')).filter(Boolean);
  return on.length ? on.join(' + ') : '';
}
// Esc in an output window that covers a display: back to a window (the way out when it landed on the wrong screen)
function outputEscape(i) { const s = screens[i]; if (s && s.placedOn) { s.device = 'window'; placeOutput(i, null); ui.propsDirty = true; if (!$('outModal').hidden) renderOutPanels(); syncOutBtn(); } }

function initDisplays() {
  if (display.desktop) {
    window.strodanoDesktop.onDisplays(setDisplays);
    window.strodanoDesktop.displays().then(l => { setDisplays(l); display.started = true; }).catch(() => { display.started = true; });
    return;
  }
  browserRefresh();
  display.started = true;
  if (window.screen && 'onchange' in window.screen) window.screen.addEventListener('change', () => { const was = display.extended; browserRefresh(); if (!was && display.extended && !display.details) setStatus('A second display was connected: Advanced Output > Find displays to use it'); });
  // permission given before: list the displays without asking again
  if (navigator.permissions && 'getScreenDetails' in window) navigator.permissions.query({ name: 'window-management' }).then(p => { if (p.state === 'granted') askDisplays(); }).catch(() => {});
}
