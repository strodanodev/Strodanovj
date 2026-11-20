// Strodano VJ (web) - keyboard shortcuts. GPL-3.0.
// Keys use KeyboardEvent.code (physical keys), so they work the same on any keyboard layout. They are ignored while typing
// in a text field, while the Shader Editor is open, and when Ctrl / Cmd / Alt is held (browser shortcuts keep working).
'use strict';
const KEYS_HELP = [
  ['1 ... 9, 0', 'Trigger the clip in column 1 ... 10 of the selected layer'],
  ['Shift + 1 ... 9, 0', 'Trigger the whole column'],
  ['Up / Down', 'Select the layer above / below'],
  ['B  /  S  /  X', 'Bypass / solo / eject the selected layer'],
  ['Shift + X', 'Eject all layers'],
  ['Shift + B', 'Blackout: fade the output to black, and back'],
  ['F1 ... F8', 'Recall snapshot 1 ... 8 (Shift: store)'],
  ['Left / Right', 'Crossfader a step toward A / B'],
  ['Shift + Left / Right', 'Crossfader all the way to A / B'],
  [',  /  .  (hold)', 'Nudge the playing clip of the selected layer slower / faster while held (Shift: harder)'],
  ['[  /  ]', 'Speed of that clip -0.01x / +0.01x, kept (Shift: 0.1x)'],
  ['\\', 'Speed of that clip back to 1x'],
  ['Space', 'Tap tempo'],
  ['R', 'Resync the beat'],
  ['?', 'Show or hide this list'],
];
function typingIn(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'button', 'file'].includes(t.type);
}
function toggleKeysHelp(show) {
  const m = $('keysModal');
  m.hidden = show === undefined ? !m.hidden : !show;
}
function selectLayer(i) {
  i = Math.min(comp.layers.length - 1, Math.max(0, i));
  if (i === sel.l) return;
  sel.l = i; sel.c = -1; propTab = 'layer'; ui.gridDirty = ui.propsDirty = true;
}
function setCrossfade(v) { comp.crossfade = Math.min(1, Math.max(0, v)); reflectMidi('crossfade', comp.crossfade); }
// Returns true when the key was a shortcut (the caller then cancels the browser's own action for it).
function onShortcut(e) {
  if (e.key === 'Escape' && !$('keysModal').hidden) { toggleKeysHelp(false); return true; }
  if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target) || !$('shModal').hidden) return false;
  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) { toggleKeysHelp(); return true; }
  const L = comp.layers[sel.l], digit = /^Digit(\d)$/.exec(e.code), fkey = /^F([1-8])$/.exec(e.code);
  if (fkey) { if (!e.repeat) { if (e.shiftKey) snapStore(+fkey[1] - 1); else snapRecall(+fkey[1] - 1); } return true; }   // snapshots.js
  if (digit) {
    const col = (+digit[1] + 9) % 10;   // 1 -> column 1 ... 0 -> column 10
    if (e.repeat || col >= comp.columns) return true;
    if (e.shiftKey) triggerColumn(col);
    else if (L) { trigger(sel.l, col); sel.c = col; if (L.clips[col]) propTab = 'clip'; ui.gridDirty = ui.propsDirty = true; }
    return true;
  }
  switch (e.code) {
    case 'ArrowUp': selectLayer(sel.l + 1); return true;     // the grid shows higher layers on top
    case 'ArrowDown': selectLayer(sel.l - 1); return true;
    case 'ArrowLeft': setCrossfade(e.shiftKey ? 0 : Math.round(comp.crossfade * 10 - 1) / 10); return true;
    case 'ArrowRight': setCrossfade(e.shiftKey ? 1 : Math.round(comp.crossfade * 10 + 1) / 10); return true;
    case 'KeyB': if (!e.repeat) { if (e.shiftKey) setBlackout(); else if (L) { L.bypass = !L.bypass; ui.gridDirty = true; } } return true;
    case 'KeyS': if (!e.repeat && L) { L.solo = !L.solo; ui.gridDirty = true; } return true;
    case 'KeyX': if (!e.repeat) { if (e.shiftKey) comp.layers.forEach((_, i) => eject(i)); else eject(sel.l); } return true;
    case 'Space': if (!e.repeat) $('tap').click(); return true;
    case 'KeyR': if (!e.repeat) $('resync').click(); return true;
    case 'Comma': case 'Period':   // nudge while held (clipopts.js); the keyup handler below lets go
      if (!e.repeat && L) nudgeSet('key:' + e.code, sel.l, (e.code === 'Period' ? 1 : -1) * (e.shiftKey ? NUDGE_HOLD_HARD : NUDGE_HOLD));
      return true;
    case 'BracketLeft': case 'BracketRight': if (L) clipSpeedStep(L.clips[L.active], (e.code === 'BracketRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01)); return true;
    case 'Backslash': if (!e.repeat && L) clipSpeedReset(L.clips[L.active]); return true;
    case 'KeyN': if (!e.repeat && L) textNextLine(L.clips[L.active], e.shiftKey ? -1 : 1); return true;
  }
  return false;
}
function initKeys() {
  $('keysBody').append(...KEYS_HELP.map(([k, what]) => el('div', { className: 'fld' }, el('label', { textContent: k }), el('span', { textContent: what }))));
  // Capture phase, so a focused slider or button does not also act on the key (arrows, Space).
  document.addEventListener('keydown', e => { if (onShortcut(e)) e.preventDefault(); }, true);
  // a nudge key let go ends its push, even when focus moved to a text field meanwhile; leaving the window ends every key push
  document.addEventListener('keyup', e => { if (e.code === 'Comma' || e.code === 'Period') nudgeSet('key:' + e.code, 0, 0); }, true);
  window.addEventListener('blur', () => nudgeEnd('key:'));
  document.addEventListener('keyup', e => { if (e.code === 'Space' && !typingIn(e.target) && $('shModal').hidden) e.preventDefault(); }, true);
}
