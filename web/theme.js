// Strodano VJ (web) - colour themes. GPL-3.0.
// Loaded in <head> so the saved theme is on <html> before the first paint. A theme sets the accent tokens
// (and, for Chrome, the surface tokens) as inline custom properties on <html>, which override the :root
// defaults in index.html. Canvas drawing reads THEME.acc / THEME.hue / THEME.sat, since canvases cannot use CSS vars.
'use strict';
const THEMES = [
  { id: 'rose', name: 'Rose', rgb: [204, 102, 136], hue: 340, sat: 1 },
  { id: 'chrome', name: 'Chrome', rgb: [92, 120, 255], hue: 230, sat: 1,
    // a blue-black cast to sit with the chrome logo
    vars: { bg: '#08090d', top: '#05060a', card: '#0b0c12', 'card-line': '#181b26', surface: '#12141c', 'surface-hover': '#1b1f2c', line: '#1f2230', ctl: '#161924', 'ctl-line': '#2c3142' } },
  { id: 'volt', name: 'Volt', rgb: [214, 224, 58], hue: 63, sat: 1 },
  { id: 'cyan', name: 'Cyan', rgb: [34, 184, 207], hue: 188, sat: 1 },
  { id: 'ember', name: 'Ember', rgb: [255, 122, 26], hue: 25, sat: 1 },
  { id: 'violet', name: 'Violet', rgb: [155, 123, 255], hue: 255, sat: 1 },
  { id: 'mono', name: 'Mono', rgb: [230, 230, 230], hue: 0, sat: 0 },
];
const THEME_KEY = 'strodano.theme';
const THEME = { id: 'rose', acc: '#cc6688', hue: 340, sat: 1 };
const SURFACE_VARS = ['bg', 'top', 'card', 'card-line', 'surface', 'surface-hover', 'line', 'ctl', 'ctl-line'];

function applyTheme(id) {
  const t = THEMES.find(x => x.id === id) || THEMES[0], st = document.documentElement.style, c = t.rgb.join(',');
  st.setProperty('--acc', `rgb(${c})`);
  st.setProperty('--acc-muted', `rgba(${c},.2)`);
  st.setProperty('--acc-btn', `rgba(${c},.15)`);
  st.setProperty('--acc-soft', `rgba(${c},.1)`);
  for (const k of SURFACE_VARS) { const v = t.vars && t.vars[k]; if (v) st.setProperty('--' + k, v); else st.removeProperty('--' + k); }
  document.documentElement.dataset.theme = t.id;
  Object.assign(THEME, { id: t.id, acc: '#' + t.rgb.map(v => v.toString(16).padStart(2, '0')).join(''), hue: t.hue, sat: t.sat });
  try { localStorage.setItem(THEME_KEY, t.id); } catch (e) { /* private window: the theme just isn't remembered */ }
  // the DJ overview strips are cached bitmaps; drop them so they redraw in the new colour
  if (typeof djUI !== 'undefined' && djUI.decks) djUI.decks.forEach(u => { u.ovFor = null; });
  document.querySelectorAll('#themes button').forEach(b => { const on = b.dataset.theme === t.id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}

let savedTheme = null;
try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
applyTheme(savedTheme || 'rose');

// swatches in the topbar
document.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('themes');
  if (!box) return;
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.dataset.theme = t.id; b.title = t.name + ' theme'; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', t.name);
    b.style.setProperty('--sw', `rgb(${t.rgb.join(',')})`);
    b.addEventListener('click', () => applyTheme(t.id));
    box.append(b);
  }
  applyTheme(THEME.id);
});
