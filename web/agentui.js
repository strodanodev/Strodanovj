// Strodano VJ (web) - Agent panel. GPL-3.0.
// Made for someone who has never VJ'd: one Start button, one Vibe choice, and the playlist (playlist.js) under it.
// Start plays the playlist in order, mixing each song into the next (autopilot, mix.js) while the Agent directs the
// visuals. Everything else (what to listen to, where looks come from, column tags, render) waits under "More options".
// Built once and refreshed in place from tickAgentUI() (like the DJ panel), so it never rebuilds the clip grid.
'use strict';
const AGUI_KEY = 'strodano-vj-agent-open';
const agUI = { open: false, dirty: true };
function agentUIDirty() { agUI.dirty = true; if (typeof plDirty === 'function') plDirty(); }

// ---------- the show: one button ----------
const showOn = () => agent.on;
function startShow() {
  if (showOn()) { stopShow(); return; }
  audioCtx();
  if (live.src === 'dj') {
    const unplayed = crate.tracks.some(t => t.state !== 'error' && !t.played);
    if (crate.tracks.length && !unplayed && !audio.decks.some(d => d.playing)) { crate.tracks.forEach(t => { t.played = false; }); crateDirty(); }   // played them all: start over
    if (crate.tracks.length) { mixer.order = true; setAuto(true); }
  }
  setAgent(true);
  if (live.src === 'dj' && !crate.tracks.length) setStatus('The Agent is on. Add songs to the playlist and it plays and mixes them, or play music and tap the tempo.');
  else if (live.src === 'dj') setStatus('Show started: the playlist plays in order and the Agent directs the visuals');
}
function stopShow() {
  if (mixer.m) cancelMix();
  setAuto(false); mixer.order = false;
  if (live.src === 'dj') audio.decks.forEach(deckPause);
  else if (live.el && !live.el.paused) live.el.pause();
  setAgent(false);
  setStatus('Show stopped');
}
// "Next song": mix into the next playlist song on the next phrase (or finish a mix that is running).
function nextSong() {
  if (live.src !== 'dj') return;
  if (mixer.m) { startMix(); return; }
  const out = refDeck();
  if (!out) { startShow(); return; }
  const inn = otherDeck(out), want = crateNextTrack(out);
  if (want && trackOf(inn) !== want) { if (inn.playing) return; crateLoad(want, inn); setStatus('Getting ' + want.name + ' ready: press Next song again in a moment'); return; }
  startMix();
}

function buildAgentPanel() {
  const root = $('agent'), u = agUI;
  const seg = (opts, get, set) => {
    const box = el('span', { className: 'seg' });
    box.refresh = () => [...box.children].forEach(b => b.classList.toggle('on', b.dataset.v === String(get())));
    opts.forEach(([v, t, title]) => box.append(el('button', { textContent: t, title: title || '', dataset: { v }, onclick: () => { set(v); box.refresh(); } })));
    return box;
  };
  const chk = (label, title, get, set) => { const i = el('input', { type: 'checkbox', checked: get(), onchange: e => { set(e.target.checked); saveAgent(); } }); return el('label', { title }, i, ' ' + label); };
  const sel = (title, opts, get, set) => el('select', { title, onchange: e => { set(e.target.value); saveAgent(); } }, ...opts.map(([v, t]) => el('option', { value: v, textContent: t, selected: String(get()) === String(v) })));

  // main row: Start, Vibe, Next song, Record
  u.on = el('button', { className: 'agentgo', dataset: { midi: 'agent:on' }, title: 'Start: plays the playlist in order, mixes each song into the next and directs the visuals. Press again to stop.', onclick: startShow });
  u.vibe = seg(Object.entries(AGENT_VIBES).map(([k, v]) => [k, v.label, v.title]), () => agent.vibe, setVibe);
  u.nextSong = el('button', { textContent: 'Next song', title: 'Mix into the next song on the next phrase (press again during the mix to finish it now)', onclick: nextSong });
  u.rec = el('button', { className: 'recbtn', dataset: { midi: 'agent:rec' }, title: 'Record the output and the sound to a video file (up to one hour)', onclick: recToggle });
  u.rtime = el('span', { className: 'dt' });
  // live touches: always there, small
  u.next = el('button', { textContent: 'New look', dataset: { midi: 'agent:next' }, title: 'A new look on the next bar', onclick: agentNext });
  u.hold = el('button', { textContent: 'Hold', dataset: { midi: 'agent:hold' }, title: 'Keep the current look: no changes until you release it', onclick: () => agentHold() });
  u.drop = el('button', { textContent: 'Drop!', dataset: { midi: 'agent:drop' }, title: 'Cut to a peak look with a flash, right now', onclick: agentDrop });
  u.meter = el('span', { className: 'meter' }, el('i'));
  u.info = el('span', { className: 'ainfo' });
  u.now = el('div', { className: 'hint anow' });
  // music file transport (only when listening to a file)
  u.play = el('button', { textContent: 'Play', onclick: () => { if (!live.el) return; audioCtx(); if (live.el.paused) live.el.play().catch(() => {}); else live.el.pause(); } });
  u.seek = el('input', { type: 'range', min: 0, max: 1, step: 0.0001, value: 0, title: 'Position', oninput: e => { if (live.el && fileDur()) live.el.currentTime = +e.target.value * fileDur(); } });
  u.ftime = el('span', { className: 'dt' });
  u.fileRow = el('div', { className: 'ar' }, u.play, u.seek, u.ftime);
  const show = el('div', { className: 'acard ashow' },
    el('div', { className: 'ar amain' }, u.on, el('span', { className: 'albl', textContent: 'Vibe' }), u.vibe, u.nextSong, u.rec, u.rtime),
    el('div', { className: 'ar' }, u.next, u.hold, u.drop, u.meter, u.info),
    u.fileRow, u.now);

  // more options
  u.src = seg([['dj', 'Playlist', 'Play the songs in the playlist (they are analysed in advance, so the visuals know every drop)'], ['mic', 'Microphone / line-in', 'Listen to a microphone or the line input: music from anywhere'],
    ['file', 'Music file...', 'Play a local music file or a recorded mix (MP3, WAV, M4A, MP4...)']], () => live.src, v => {
    if (v === 'dj') { useDecks(); agentUIDirty(); }
    else if (v === 'mic') { setAuto(false); useMic().then(() => { u.src.refresh(); agentUIDirty(); }); }
    else $('agentFileInput').click();
  });
  u.tags = el('div', { className: 'atags' });
  const fmt = recFormat();
  u.rprog = el('span', { className: 'mixprog' }, el('i'));
  u.renderFile = el('button', { textContent: 'Render music file', title: 'Play the open music file from the start with the Agent directing, and save it all as a video', onclick: () => renderMix('file') });
  u.renderList = el('button', { textContent: 'Render playlist', title: 'Mix the playlist with the Agent directing, and save it all as a video', onclick: () => { mixer.order = true; renderMix('list'); } });
  u.more = el('details', { className: 'amore' }, el('summary', { textContent: 'More options' }),
    el('div', { className: 'amgrid' },
      el('div', null, el('h4', { textContent: 'Listen to' }), el('div', { className: 'ar' }, u.src),
        el('h4', { textContent: 'Visuals' }),
        el('div', { className: 'ar' }, el('span', { textContent: 'Looks from' }), sel('Where the looks come from', [['gen', 'The Agent (generated)'], ['clips', 'My clip columns'], ['both', 'Both']], () => agent.visuals, v => { agent.visuals = v; agUI.dirty = true; }),
          el('span', { textContent: 'Vary every' }), sel('A small change to the look this often (on the phrase). The Vibe sets this too.', [[8, '8 bars'], [16, '16 bars'], [32, '32 bars'], [0, 'never']], () => agent.vary, v => { agent.vary = +v; })),
        el('div', { className: 'ar' }, chk('New look on each song', 'Change the look when the song changes (microphone / music file)', () => agent.onSong, v => { agent.onSong = v; }),
          chk('Use my videos', 'Generated looks may use the videos in Files as their source', () => agent.useMedia, v => { agent.useMedia = v; if (typeof plReplanAll === 'function') plReplanAll(); }),
          chk('Strobe on drops', 'Adds a beat strobe to drop looks. Flashing light can trigger seizures in people with photosensitive epilepsy.', () => agent.strobe, v => { agent.strobe = v; }))),
      el('div', null, el('h4', { textContent: 'My clip columns' }),
        el('div', { className: 'hint', textContent: 'With "My clip columns" or "Both", the Agent plays your columns: tag them so it knows which to use when. Untagged columns can be used any time.' }), u.tags),
      el('div', null, el('h4', { textContent: 'Record and render' }),
        el('div', { className: 'ar' }, el('span', { textContent: 'Quality' }),
          el('select', { onchange: e => { rec.quality = e.target.value; try { localStorage.setItem('strodano-vj-rec-quality', rec.quality); } catch (err) {} } },
            ...Object.entries(REC_QUALITY).map(([k, q]) => el('option', { value: k, textContent: q.label, selected: k === rec.quality })))),
        el('div', { className: 'ar' }, u.renderFile, u.renderList, u.rprog),
        el('div', { className: 'hint', textContent: (fmt ? 'Saves as ' + fmt.ext.toUpperCase() + '. ' : 'This browser cannot record video. ') + 'Recording and rendering run in real time, up to one hour: keep this window visible, or open the output window, until they finish.' }))));

  root.append(show, u.more);
  $('agentFileInput').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { setAuto(false); await useFile(f); u.src.refresh(); agentUIDirty(); } });
  if (typeof initPlaylist === 'function') initPlaylist();
  try { if (localStorage.getItem(AGUI_KEY) === '1') toggleAgentPanel(true); } catch (e) {}
}
function toggleAgentPanel(on) {
  agUI.open = on;
  $('agent').hidden = !on;
  const b = $('agentBtn'); if (b) b.classList.toggle('on', on);
  $('app').classList.toggle('agentopen', on);
  agUI.dirty = true;
  if (typeof plApplyView === 'function') plApplyView();
  try { localStorage.setItem(AGUI_KEY, on ? '1' : '0'); } catch (e) {}
}
function renderTags() {
  const box = agUI.tags;
  box.textContent = '';
  for (let ci = 0; ci < comp.columns; ci++) {
    const used = comp.layers.some(L => !L.agent && L.clips[ci]);
    box.append(el('label', { className: used ? '' : 'empty', title: used ? '' : 'Column ' + (ci + 1) + ' has no clips' }, 'Col ' + (ci + 1) + ' ',
      el('select', { onchange: e => { comp.agentTags = comp.agentTags || {}; if (e.target.value) comp.agentTags[ci] = e.target.value; else delete comp.agentTags[ci]; } },
        ...COL_TAGS.map(t => el('option', { value: t, textContent: t || 'Any', selected: colTag(ci) === t })))));
  }
}
let agTagCols = -1;
function tickAgentUI() {
  if (typeof tickPlaylist === 'function') tickPlaylist();   // also warms planned looks while the panel is closed
  if (!agUI.open) return;
  const u = agUI;
  if (agUI.dirty || agTagCols !== comp.columns) { agUI.dirty = false; agTagCols = comp.columns; renderTags(); u.src.refresh(); u.vibe.refresh(); }
  setText(u.on, agent.on ? '■  Stop' : '▶  Start');
  u.on.classList.toggle('on', agent.on);
  u.hold.classList.toggle('on', agent.hold);
  u.nextSong.hidden = live.src !== 'dj';
  u.nextSong.disabled = !refDeck() && !crate.tracks.length;
  setText(u.nextSong, mixer.m ? (mixer.m.started ? 'Finish mix' : 'Mixing soon...') : 'Next song');
  u.fileRow.hidden = live.src !== 'file';
  if (live.el && live.src === 'file') {
    setText(u.play, live.el.paused ? 'Play' : 'Pause');
    const d = fileDur();
    if (document.activeElement !== u.seek) u.seek.value = d ? fileTime() / d : 0;
    setText(u.ftime, mmss(fileTime()) + ' / ' + mmss(d));
  }
  u.meter.firstChild.style.width = (Math.min(1, audioFeat.level) * 100).toFixed(0) + '%';
  const mc = audio.ctx ? musicClock() : null, k = musicKey();
  const src = live.src === 'dj' ? (audio.clockDeck ? audio.clockDeck.name || 'Deck ' + audio.clockDeck.id : 'Playlist') : live.src === 'mic' ? 'Microphone' : live.fileName || 'Music file';
  setText(u.info, src + '  ·  ' + (mc ? mc.bpm.toFixed(0) + ' BPM' : live.src !== 'dj' && audio.ctx ? 'finding the beat...' : 'not playing') + (k ? '  ·  key ' + k : '') + '  ·  ' + live.band + (live.section === 'breakdown' ? ', breakdown' : ''));
  const why = agent.hold ? 'Holding this look' : agent.scored ? 'DJ section looks are in charge of the clips' : comp.beats < agent.holdUntil ? 'You are playing: the Agent waits ' + Math.ceil((agent.holdUntil - comp.beats) / 4) + ' bars' : agent.pending ? 'Next change on the bar (' + agent.pending.reason + ')' : '';
  const mixTxt = live.src === 'dj' && (mixer.auto || mixer.m) ? '  ·  ' + mixStatus() : '';
  setText(u.now, !agent.on ? (live.src === 'dj' ? (crate.tracks.length ? 'Press Start: the playlist plays in order and the visuals follow the music by themselves.' : 'Drop songs on the playlist below, pick a vibe, and press Start. No programming needed.') : 'Press Start and the Agent takes over the visuals.')
    : (agent.showingClips ? (agent.col >= 0 ? 'Showing your column ' + (agent.col + 1) : 'Showing your clips') : 'Look: ' + lookLabel(agent.look)) + (why ? '  ·  ' + why : '') + mixTxt);
  setText(u.rec, rec.on ? (rec.stopping ? 'Saving...' : '● Stop rec') : '● Record');
  u.rec.classList.toggle('on', rec.on);
  setText(u.rtime, rec.on ? mmss(recElapsed()) + ' / 60:00  ' + (rec.bytes / 1048576).toFixed(0) + ' MB' : '');
  const p = renderProgress();
  u.rprog.hidden = p === null;
  if (p !== null) u.rprog.firstChild.style.width = (p * 100).toFixed(1) + '%';
  u.renderFile.disabled = rec.on || live.src !== 'file'; u.renderList.disabled = rec.on;
}
