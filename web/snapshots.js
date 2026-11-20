// Strodano VJ (web) - snapshots: 8 stored states of the show, recalled with one key, pad or gesture. GPL-3.0.
// A snapshot is a "look" (looks.js: captureLook / recallLook / lookFromJSON): per layer the playing clip, opacity,
// bypass and every effect's values, plus the composition effects. So snapshots, the DJ section looks and segment looks share
// one format. Numbers glide in over the Glide setting (lookGlide.morph, shared with the section looks); clips switch through
// trigger(), so clip transitions and beat-quantised launches apply. "On next bar" waits for the bar line before recalling.
// Keys: F1-F8 recall, Shift+F1-F8 store. MIDI / gestures: map a pad to a slot (data-midi 'snap:N') in Map mode.
// Saved with the composition (engine.js compToJSON / loadComp).
'use strict';
const SNAP_COUNT = 8;
const snaps = { slots: new Array(SNAP_COUNT).fill(null), names: new Array(SNAP_COUNT).fill(''), onBar: false, pending: -1, pendBar: 0 };

function snapStore(i) {
  snaps.slots[i] = captureLook();
  setStatus('Snapshot ' + (i + 1) + ' stored. F' + (i + 1) + ' (or its button) recalls it.');
  ui.propsDirty = true;
}
function snapRecallNow(i) {
  snaps.pending = -1;
  if (!snaps.slots[i]) return;
  recallLook(snaps.slots[i]);
  setStatus('Snapshot ' + (i + 1) + ' recalled.');
  ui.propsDirty = true;
}
function snapRecall(i) {
  if (!snaps.slots[i]) { setStatus('Snapshot ' + (i + 1) + ' is empty. Shift+F' + (i + 1) + ' or Shift+click stores the show as it is now.'); return; }
  if (snaps.onBar) { snaps.pending = i; snaps.pendBar = Math.floor(comp.beats / 4); setStatus('Snapshot ' + (i + 1) + ' on the next bar...'); ui.propsDirty = true; }
  else snapRecallNow(i);
}
function snapClear(i) { snaps.slots[i] = null; snaps.names[i] = ''; if (snaps.pending === i) snaps.pending = -1; ui.propsDirty = true; }
// Called every frame (vjTick). Look glides advance in looks.js tickTweens (audio.js audioTick); this only fires a recall waiting for the bar line.
function snapTick() { if (snaps.pending >= 0 && Math.floor(comp.beats / 4) !== snaps.pendBar) snapRecallNow(snaps.pending); }

function snapsToJSON() {
  return { slots: snaps.slots, names: snaps.names, onBar: snaps.onBar, morph: lookGlide.morph };
}
function snapsFromJSON(j) {
  snaps.slots = new Array(SNAP_COUNT).fill(null); snaps.names = new Array(SNAP_COUNT).fill(''); snaps.pending = -1; snaps.onBar = false;
  if (!j || typeof j !== 'object') return;
  for (let i = 0; i < SNAP_COUNT; i++) {
    snaps.slots[i] = Array.isArray(j.slots) ? lookFromJSON(j.slots[i]) : null;
    if (Array.isArray(j.names) && typeof j.names[i] === 'string') snaps.names[i] = j.names[i].slice(0, 24);
  }
  snaps.onBar = !!j.onBar;
  if ([0, 1, 4, 8].includes(j.morph)) lookGlide.morph = j.morph;   // older files keep it in the section looks (score)
}

// ---------- Composition tab ----------
function snapPanel() {
  const box = el('div', { className: 'snap-box' }, el('h4', { textContent: 'Snapshots' }));
  const row = el('div', { className: 'snap-row' });
  for (let i = 0; i < SNAP_COUNT; i++) {
    const full = !!snaps.slots[i];
    row.append(el('button', {
      className: 'snap' + (full ? ' full' : '') + (snaps.pending === i ? ' pending' : ''), textContent: String(i + 1), dataset: { midi: 'snap:' + i },
      title: full ? `Recall snapshot ${i + 1} (F${i + 1}). Shift+click stores over it, right-click clears it.` : `Empty. Click (or Shift+F${i + 1}) to store the show as it is now.`,
      onclick: e => { if (e.shiftKey || !full) snapStore(i); else snapRecall(i); },
      oncontextmenu: e => { e.preventDefault(); if (full) { snapClear(i); setStatus('Snapshot ' + (i + 1) + ' cleared.'); } } }));
  }
  box.append(row);
  const morph = el('select', { title: 'How long a recalled snapshot takes to glide in (shared with the DJ section looks)', onchange: e => { lookGlide.morph = +e.target.value; } },
    ...[[0, 'Instant'], [1, 'Glide 1 beat'], [4, 'Glide 1 bar'], [8, 'Glide 2 bars']].map(([v, n]) => el('option', { value: v, textContent: n, selected: v === lookGlide.morph })));
  box.append(el('div', { className: 'fld' }, morph,
    el('label', { className: 'chk' }, el('input', { type: 'checkbox', checked: snaps.onBar, onchange: e => { snaps.onBar = e.target.checked; } }), ' On next bar')),
    el('div', { className: 'hint', textContent: 'A snapshot keeps the playing clips, layer opacity and bypass, and every effect value.' }));
  return box;
}

// One per-frame hook for the show-safety and clip features (ui.js frame, after update()).
function vjTick(dt) { safetyTick(dt); clipOptsTick(dt); snapTick(); if (typeof gpTick === 'function') gpTick(dt); ctlTick(); }
