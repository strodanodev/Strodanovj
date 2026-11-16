// Strodano VJ (web) - Agent panel: what to listen to, the Agent's controls, column tags, recording and auto render. GPL-3.0.
// Built once and refreshed in place from tickAgentUI() (like the DJ panel), so it never rebuilds the clip grid.
'use strict';
const AGUI_KEY = 'strodano-vj-agent-open';
const agUI = { open: false, dirty: true };
function agentUIDirty() { agUI.dirty = true; }

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

  // listen
  u.src = seg([['dj', 'DJ decks', 'Follow the two DJ decks (their tracks are analysed in advance)'], ['mic', 'Microphone / line-in', 'Listen to a microphone or the line input: music from anywhere'],
    ['file', 'Music file...', 'Play a local music file or a recorded mix (MP3, WAV, M4A, MP4...)']], () => live.src, v => {
    if (v === 'dj') useDecks();
    else if (v === 'mic') useMic().then(() => u.src.refresh());
    else $('agentFileInput').click();
  });
  u.play = el('button', { textContent: 'Play', onclick: () => { if (!live.el) return; audioCtx(); if (live.el.paused) live.el.play().catch(() => {}); else live.el.pause(); } });
  u.seek = el('input', { type: 'range', min: 0, max: 1, step: 0.0001, value: 0, title: 'Position', oninput: e => { if (live.el && fileDur()) live.el.currentTime = +e.target.value * fileDur(); } });
  u.ftime = el('span', { className: 'dt' });
  u.fileRow = el('div', { className: 'ar' }, u.play, u.seek, u.ftime);
  u.meter = el('span', { className: 'meter' }, el('i'));
  u.info = el('span', { className: 'ainfo' });
  const listen = el('div', { className: 'acard' }, el('h4', { textContent: 'Listen to' }), el('div', { className: 'ar' }, u.src), u.fileRow, el('div', { className: 'ar' }, u.meter, u.info));

  // agent
  u.on = el('button', { className: 'agentgo', dataset: { midi: 'agent:on' }, title: 'The Agent picks the visuals and changes them with the music', onclick: () => setAgent(!agent.on) });
  u.next = el('button', { textContent: 'Next look', dataset: { midi: 'agent:next' }, title: 'A new look on the next bar', onclick: agentNext });
  u.hold = el('button', { textContent: 'Hold', dataset: { midi: 'agent:hold' }, title: 'Keep the current look: no changes until you release it', onclick: () => agentHold() });
  u.drop = el('button', { textContent: 'Drop!', dataset: { midi: 'agent:drop' }, title: 'Cut to a peak look with a flash, right now', onclick: agentDrop });
  u.now = el('div', { className: 'hint anow' });
  const ag = el('div', { className: 'acard' }, el('h4', { textContent: 'Agent' }),
    el('div', { className: 'ar' }, u.on, u.next, u.hold, u.drop),
    el('div', { className: 'ar' }, el('span', { textContent: 'Visuals' }), sel('Where the looks come from', [['gen', 'Generated looks'], ['clips', 'My clip columns'], ['both', 'Both']], () => agent.visuals, v => { agent.visuals = v; agUI.dirty = true; }),
      el('span', { textContent: 'Vary every' }), sel('A small change to the look this often (on the phrase)', [[8, '8 bars'], [16, '16 bars'], [32, '32 bars'], [0, 'never']], () => agent.vary, v => { agent.vary = +v; })),
    el('div', { className: 'ar' }, chk('New look on each song', 'Change the look when the song changes', () => agent.onSong, v => { agent.onSong = v; }),
      chk('Use my videos', 'Generated looks may use the videos in Files as their source', () => agent.useMedia, v => { agent.useMedia = v; }),
      chk('Strobe on drops', 'Adds a beat strobe to drop looks. Flashing light can trigger seizures in people with photosensitive epilepsy.', () => agent.strobe, v => { agent.strobe = v; })),
    u.now);

  // column tags
  u.tags = el('div', { className: 'atags' });
  const tags = el('div', { className: 'acard' }, el('h4', { textContent: 'Pre-programmed columns' }),
    el('div', { className: 'hint', textContent: 'With "My clip columns" or "Both", the Agent plays your columns: tag them so it knows which to use when. Untagged columns can be used any time.' }), u.tags);

  // record
  const fmt = recFormat();
  u.rec = el('button', { className: 'recbtn', dataset: { midi: 'agent:rec' }, title: 'Record the output and the sound to a video file (up to one hour)', onclick: recToggle });
  u.rtime = el('span', { className: 'dt' });
  u.rprog = el('span', { className: 'mixprog' }, el('i'));
  u.renderFile = el('button', { textContent: 'Render music file', title: 'Play the open music file from the start with the Agent directing, and save it all as a video', onclick: () => renderMix('file') });
  u.renderList = el('button', { textContent: 'Render track list', title: 'Mix the DJ track list with autopilot, the Agent directing, and save it all as a video', onclick: () => renderMix('list') });
  const recCard = el('div', { className: 'acard' }, el('h4', { textContent: 'Record and render' }),
    el('div', { className: 'ar' }, u.rec, u.rtime, el('span', { textContent: 'Quality' }),
      el('select', { onchange: e => { rec.quality = e.target.value; try { localStorage.setItem('strodano-vj-rec-quality', rec.quality); } catch (err) {} } },
        ...Object.entries(REC_QUALITY).map(([k, q]) => el('option', { value: k, textContent: q.label, selected: k === rec.quality })))),
    el('div', { className: 'ar' }, u.renderFile, u.renderList, u.rprog),
    el('div', { className: 'hint', textContent: (fmt ? 'Saves as ' + fmt.ext.toUpperCase() + '. ' : 'This browser cannot record video. ') + 'Recording and rendering run in real time, up to one hour: keep this window visible, or open the output window, until they finish.' }));

  root.append(listen, ag, tags, recCard);
  $('agentFileInput').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { await useFile(f); u.src.refresh(); agUI.dirty = true; } });
  try { if (localStorage.getItem(AGUI_KEY) === '1') toggleAgentPanel(true); } catch (e) {}
}
function toggleAgentPanel(on) {
  agUI.open = on;
  $('agent').hidden = !on;
  const b = $('agentBtn'); if (b) b.classList.toggle('on', on);
  $('app').classList.toggle('agentopen', on);
  agUI.dirty = true;
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
  if (!agUI.open) return;
  const u = agUI;
  if (agUI.dirty || agTagCols !== comp.columns) { agUI.dirty = false; agTagCols = comp.columns; renderTags(); u.src.refresh(); }
  setText(u.on, agent.on ? 'Agent ON' : 'Agent OFF');
  u.on.classList.toggle('on', agent.on);
  u.hold.classList.toggle('on', agent.hold);
  u.fileRow.hidden = live.src !== 'file';
  if (live.el) {
    setText(u.play, live.el.paused ? 'Play' : 'Pause');
    const d = fileDur();
    if (document.activeElement !== u.seek) u.seek.value = d ? fileTime() / d : 0;
    setText(u.ftime, mmss(fileTime()) + ' / ' + mmss(d));
  }
  u.meter.firstChild.style.width = (Math.min(1, audioFeat.level) * 100).toFixed(0) + '%';
  const mc = audio.ctx ? musicClock() : null, k = musicKey();
  const src = live.src === 'dj' ? (audio.clockDeck ? 'Deck ' + audio.clockDeck.id : 'No deck playing') : live.src === 'mic' ? 'Microphone' : live.fileName || 'Music file';
  setText(u.info, src + '  ·  ' + (mc ? mc.bpm.toFixed(1) + ' BPM' : live.src !== 'dj' && audio.ctx ? 'finding the beat...' : 'tap tempo') + (k ? '  ·  key ' + k : '') + '  ·  ' + live.band + (live.section === 'breakdown' ? ', breakdown' : ''));
  const why = agent.hold ? 'Holding this look' : agent.scored ? 'DJ section looks are in charge of the clips' : comp.beats < agent.holdUntil ? 'You are playing: the Agent waits ' + Math.ceil((agent.holdUntil - comp.beats) / 4) + ' bars' : agent.pending ? 'Next change on the bar (' + agent.pending.reason + ')' : '';
  setText(u.now, !agent.on ? 'Turn the Agent on and it takes over the visuals: no programming needed.' : (agent.showingClips ? (agent.col >= 0 ? 'Showing your column ' + (agent.col + 1) : 'Showing your clips') : 'Look: ' + lookLabel(agent.look)) + (why ? '  ·  ' + why : ''));
  setText(u.rec, rec.on ? (rec.stopping ? 'Saving...' : 'Stop') : 'Record');
  u.rec.classList.toggle('on', rec.on);
  setText(u.rtime, rec.on ? mmss(recElapsed()) + ' / 60:00  ' + (rec.bytes / 1048576).toFixed(0) + ' MB' : '');
  const p = renderProgress();
  u.rprog.hidden = p === null;
  if (p !== null) u.rprog.firstChild.style.width = (p * 100).toFixed(1) + '%';
  u.renderFile.disabled = rec.on || live.src !== 'file'; u.renderList.disabled = rec.on;
}
