// Strodano VJ (web, desktop page) - updates of the desktop app. GPL-3.0.
// The desktop shell (desktop/updater.js) finds a newer version and reports it here; this file shows the header label
// (#updBtn, hidden until there is something to say) and its dialog, and decides WHEN to download: straight away when
// no show is running (no output, broadcast or recording), otherwise when the show stops or the person says so.
// Installing is always the person's choice ("Restart and update"): the app closes, installs and opens again.
// On a Mac the app cannot replace itself (no Developer ID signature), so the dialog offers the download instead.
// In a browser there is no desktop shell and nothing here does anything.
'use strict';
const upd = { api: window.strodanoDesktop && window.strodanoDesktop.update, s: null };
const UPD_NOTES = 'https://github.com/strodanodev/Strodanovj/releases/tag/v';
// A show is running: an output window, NDI, a web link or a recording.
const updBusy = () => liveScreens().length + ndiLive().length + vdoLive().length > 0 || (typeof rec !== 'undefined' && rec.on);
function updShow() {
  const b = document.getElementById('updBtn'), s = upd.s;
  if (!b) return;
  const text = !s ? '' : s.state === 'ready' ? 'Update ready' : s.state === 'downloading' ? 'Updating ' + s.percent + '%' : s.state === 'available' ? 'Update ' + s.version : '';
  b.hidden = !text;
  if (text && b.lastChild.textContent !== text) b.lastChild.textContent = text;
  b.classList.toggle('on', !!s && s.state === 'ready');
}
// Download by itself only while nothing is live.
function updMaybeDownload() {
  const s = upd.s;
  if (s && s.state === 'available' && !s.manual && !updBusy()) upd.api.download();
}
function updDialog() {
  const s = upd.s;
  if (!s || !upd.api) return;
  const notes = el('a', { textContent: 'What is new', href: UPD_NOTES + s.version, target: '_blank', rel: 'noopener', style: entBtnStyle(false) });
  const head = 'Version ' + s.version, have = ' You have ' + s.current + '.';
  if (s.manual) return entDialog('UPDATE', head + ' is available', 'On a Mac the new version is installed by hand: download it, open it, and drag Strodano VJ over the old one. Your compositions and settings stay.' + have,
    [entBtn('Later', entClose), notes, entBtn('Download', () => { upd.api.install(); entClose(); }, true)]);
  if (s.state === 'available') return entDialog('UPDATE', head + ' is available', (updBusy() ? 'It downloads by itself once the show stops (no output, broadcast or recording), or now if you choose.' : 'It is about to download in the background.') + have + (s.error ? ' The last try did not work: ' + s.error : ''),
    [entBtn('Later', entClose), notes, entBtn('Download now', () => { upd.api.download(); entClose(); setStatus('Downloading version ' + s.version + ' in the background'); }, true)]);
  if (s.state === 'downloading') return entDialog('UPDATE', head + ' is downloading', s.percent + '% so far. You can keep working: nothing is installed until you say so.', [notes, entBtn('Close', entClose, true)]);
  if (s.state === 'ready') return entDialog('UPDATE', head + ' is ready to install', 'Restart and update closes Strodano VJ, installs the new version (about a minute) and opens it again. ' +
    (updBusy() ? 'A show is running now: the outputs, broadcasts and recording stop. ' : '') + 'Your composition is saved automatically.' + have,
    [entBtn('Later', entClose), notes, entBtn('Restart and update', e => { if (updBusy()) armThen(e.currentTarget, 'stop the show and update', () => upd.api.install()); else upd.api.install(); }, true)]);
}
function updState(s) {
  const was = upd.s && upd.s.state;
  upd.s = s; updShow(); updMaybeDownload();
  if (s.state === 'ready' && was !== 'ready') setStatus('Version ' + s.version + ' is downloaded: click Update ready in the header when you want to install it');
  else if (s.state === 'available' && was !== 'available' && (s.manual || updBusy())) setStatus('Version ' + s.version + ' of Strodano VJ is available: see Update in the header');
}
window.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('updBtn');
  if (!b || !upd.api) return;
  b.addEventListener('click', updDialog);
  upd.api.onState(updState);
  upd.api.state().then(updState).catch(() => {});
  setInterval(updMaybeDownload, 30e3);   // a show that has stopped lets a waiting download start
});
