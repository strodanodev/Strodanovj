'use strict';
// Resizable, minimisable panels in the main column: DJ decks, Agent, More options, Playlist and the Composition
// (clip grid). They share the space above the bottom row; without this they all shrink together and each one cuts
// off part way through a row of controls. Each panel gets a slim title bar (click to minimise, ↺ to reset its size)
// and a drag handle on its bottom edge. Sizes and minimised panels are remembered on this computer.

const PANEL_KEY = 'strodano-vj-panels';
const PANEL_DEFS = [
  { id: 'dj', name: 'DJ decks' },
  { id: 'agent', name: 'Agent' },
  { id: 'more', name: 'More options', sel: '.amore' },   // a <details>: its summary is the title bar
  { id: 'playlist', name: 'Playlist' },                  // its own header row holds the minimise button
  { id: 'grid', name: 'Composition' },
];
const pnl = { sizes: {}, min: {}, items: [] };
try {
  const s = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}');
  for (const d of PANEL_DEFS) {
    if (s.sizes && Number.isFinite(s.sizes[d.id])) pnl.sizes[d.id] = Math.max(40, Math.min(4000, s.sizes[d.id]));
    if (s.min && s.min[d.id] === true) pnl.min[d.id] = true;
  }
} catch (e) {}
function panelSave() { try { localStorage.setItem(PANEL_KEY, JSON.stringify({ sizes: pnl.sizes, min: pnl.min })); } catch (e) {} }

const CHEV = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
function panelItem(id) { return pnl.items.find(p => p.id === id); }
// open = the panel's mode is on (DJ / Agent panel showing, grid not replaced by the playlist), minimised or not
function panelOpen(p) {
  const e = p.el;
  if (!e || !e.isConnected) return false;
  if (p.id === 'more') { const a = panelItem('agent'); return !!a && panelOpen(a) && !pnl.min.agent; }
  if (p.id === 'playlist') return !e.hidden && !e.classList.contains('collapsed');
  return !e.hidden && e.style.display !== 'none';
}
function panelMinimised(p) { return p.id === 'more' ? !p.el.open : !!pnl.min[p.id]; }

function setPanelMin(id, on) {
  const p = panelItem(id); if (!p) return;
  if (id === 'more') { p.el.open = !on; return; }
  if (on) pnl.min[id] = true; else delete pnl.min[id];
  panelSave(); panelSync();
}
function resetPanelSize(id) { delete pnl.sizes[id]; panelSave(); panelSync(); }

function panelBar(p) {
  const bar = el('div', { className: 'pbar', title: 'Click to minimise or restore. Drag the line under the panel to resize it.' });
  const chev = el('button', { className: 'pchev', innerHTML: CHEV, ariaLabel: 'Minimise ' + p.name });
  const reset = el('button', { className: 'preset', textContent: '↺', title: 'Reset to the automatic size', onclick: e => { e.stopPropagation(); resetPanelSize(p.id); } });
  bar.append(chev, el('span', { className: 'pname', textContent: p.name }), reset);
  bar.addEventListener('click', () => setPanelMin(p.id, !pnl.min[p.id]));
  p.reset = reset; p.chev = chev;
  return bar;
}
// A drag handle under the panel sets its height. Dragging works in pixels; the panel can still shrink when the
// window is short, so the bottom row (properties, monitors, browser) always keeps its room.
function panelSplit(p) {
  const s = el('div', { className: 'psplit', title: 'Drag to resize. Double-click for the automatic size.' });
  s.addEventListener('dblclick', () => resetPanelSize(p.id));
  s.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    s.setPointerCapture(e.pointerId);
    s.classList.add('drag');
    const y0 = e.clientY, h0 = p.el.getBoundingClientRect().height;
    const bot = $('bottom'), bMin = Math.min(240, innerHeight * 0.34);
    const slack = bot ? Math.max(0, bot.getBoundingClientRect().height - bMin) : 0;
    const max = Math.max(40, h0 + slack + panelsBelow(p));
    const move = ev => { pnl.sizes[p.id] = Math.round(Math.max(40, Math.min(max, h0 + ev.clientY - y0))); panelApply(p); };
    const up = () => { s.classList.remove('drag'); s.removeEventListener('pointermove', move); s.removeEventListener('pointerup', up); s.removeEventListener('pointercancel', up); panelSave(); panelSync(); };
    s.addEventListener('pointermove', move); s.addEventListener('pointerup', up); s.addEventListener('pointercancel', up);
  });
  return s;
}
// room the panels under this one can give up while it grows (they keep a 60px sliver)
function panelsBelow(p) {
  let room = 0, after = false;
  for (const q of pnl.items) {
    if (q === p) { after = true; continue; }
    if (after && panelOpen(q) && !panelMinimised(q)) room += Math.max(0, q.el.getBoundingClientRect().height - 60);
  }
  return room;
}
function setStyle(e, k, v) { if (e.style[k] !== v) e.style[k] = v; }
function panelApply(p) {
  const h = pnl.sizes[p.id];
  // user size: a flex basis that holds while other panels give way, and only shrinks once they can't (short window);
  // automatic: the stylesheet's own rules
  if (h && !panelMinimised(p)) { setStyle(p.el, 'flex', `0 0.02 ${h}px`); setStyle(p.el, 'maxHeight', 'none'); }
  else { setStyle(p.el, 'flex', ''); setStyle(p.el, 'maxHeight', ''); }
}

function panelSync() {
  for (const p of pnl.items) {
    const open = panelOpen(p), mini = open && panelMinimised(p);
    if (p.id === 'more') { if (p.el.hidden === open) p.el.hidden = !open; }
    else p.el.classList.toggle('pmin', !!pnl.min[p.id]);
    if (p.bar) p.bar.hidden = !open;
    if (p.bar) p.bar.classList.toggle('on', mini);
    if (p.chev) p.chev.setAttribute('aria-label', (mini ? 'Restore ' : 'Minimise ') + p.name);
    if (p.reset) p.reset.hidden = !pnl.sizes[p.id] || mini;
    p.split.hidden = !open || mini;
    panelApply(p);
  }
  const pb = $('plMinBtn');
  if (pb) { const m = !!pnl.min.playlist; pb.classList.toggle('on', m); pb.title = m ? 'Show the song list' : 'Minimise the song list'; }
}
// a soft shadow on the bottom edge of a panel whose content scrolls, so a cut-off row reads as "more below"
function panelShade() {
  for (const p of pnl.items) {
    const e = p.el;
    if (!e.isConnected || e.hidden) continue;
    const more = e.scrollHeight - e.clientHeight - e.scrollTop > 2;
    if (e.classList.contains('pmore') !== more) e.classList.toggle('pmore', more);
  }
}

function initPanels() {
  for (const d of PANEL_DEFS) {
    const e = d.sel ? document.querySelector(d.sel) : $(d.id);
    if (!e || pnl.items.some(p => p.id === d.id)) continue;
    const p = { id: d.id, name: d.name, el: e };
    if (d.id === 'more') {
      // More options sits under the Agent panel as its own panel, so it scrolls and resizes on its own
      const a = $('agent'); if (a && e.parentNode === a) a.after(e);
      e.addEventListener('toggle', panelSync);
    } else if (d.id !== 'playlist') {
      p.bar = panelBar(p);
      e.before(p.bar);
    }
    p.split = panelSplit(p);
    e.after(p.split);
    pnl.items.push(p);
  }
  // follow the DJ / Agent / Playlist toggles, which flip hidden, classes and the grid's display
  const mo = new MutationObserver(panelSync);
  for (const p of pnl.items) mo.observe(p.el, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  panelSync();
  setInterval(panelShade, 400);
}
window.addEventListener('load', () => { if ($('main')) initPanels(); });
