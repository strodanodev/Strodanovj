// Strodano VJ (web, desktop page) - the STRODANO premium pack for Pro and Festival. GPL-3.0 (the media itself is
// STRODANO's own, not GPL, and never in the repository).
// The pack is the one the phone edition has (starter.js PREMIUM_FILES; tools/build-mobile.mjs fails when the two
// lists differ). Its files are on the phone site under premium/, behind a check at the edge that only lets a request
// through with a fresh signature. The website gives that signature (GET /api/app/pack) only to an app signed in to a
// Pro or Festival account, so the pack cannot be had by editing this code: the lock is on the server.
// Downloaded files are kept in IndexedDB ('strodano-vj-premium', store 'files', key = file name, value = File) and
// put back into the media pool on every start, where saved clips relink to them by name like any added file.
'use strict';
const PREMIUM_SITE = 'https://vj.strodano.live/premium/';
const PREMIUM_PACK = [
  ['strodano-pro-crowd.mp4', 'Crowd'], ['strodano-pro-stage.mp4', 'Main stage'],
  ['strodano-pro-booth-1.webp', 'Booth'], ['strodano-pro-booth-2.webp', 'Booth 2'],
  ['strodano-pro-press-1.webp', 'Press 1'], ['strodano-pro-press-2.webp', 'Press 2'], ['strodano-pro-press-3.webp', 'Press 3'], ['strodano-pro-press-4.webp', 'Press 4'],
  ['strodano-pro-uwu.webp', 'UwU'], ['strodano-pro-avatar.webp', 'Avatar logo'], ['strodano-pro-mark.webp', 'Supporting logo'],
];
const premium = { busy: false, done: 0, total: 0, have: new Set(), ready: false };
// On a development page (plan.js ENT_DEV) localStorage `strodano-vj-pack` can point at another copy of the files.
const premiumBase = () => { let b = ''; try { b = (ENT_DEV && localStorage.getItem('strodano-vj-pack')) || ''; } catch (e) {} return b || PREMIUM_SITE; };
const premiumMissing = () => PREMIUM_PACK.map(f => f[0]).filter(n => !premium.have.has(n));

function premiumDB(op, key, value) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('strodano-vj-premium', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('files');
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result, tx = db.transaction('files', op === 'all' ? 'readonly' : 'readwrite'), st = tx.objectStore('files');
      const r = op === 'all' ? st.getAll() : st.put(value, key);
      tx.oncomplete = () => { db.close(); resolve(r.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
// On start: the pack files already on this computer go back into the media pool.
async function initPremium() {
  try {
    const files = (await premiumDB('all')).filter(f => f && PREMIUM_PACK.some(p => p[0] === f.name));
    files.forEach(f => premium.have.add(f.name));
    if (files.length) addMediaFiles(files);
  } catch (e) { /* no storage (private window): the pack can still be downloaded for this session */ }
  premium.ready = true; ui.browserDirty = true;
}
function premiumSay(t) { setStatus(t); ui.browserDirty = true; }
async function premiumGet() {
  if (premium.busy) return;
  if (!entGate('pack')) return;
  if (!ent.token) { setStatus('Sign in to your Strodano account to download the premium pack'); entAccount(); return; }
  const need = premiumMissing();
  if (!need.length) { browserTab = 'files'; return premiumSay('The premium pack is in Files: ' + PREMIUM_PACK.length + ' clips starting with "strodano-pro"'); }
  premium.busy = true; premium.done = 0; premium.total = need.length; premiumSay('Premium pack: checking your plan...');
  try {
    let r = null;
    try { r = await entFetch('/api/app/pack', null, ent.token); } catch (e) {}
    if (!r) return premiumSay('The premium pack needs an internet connection to download');
    if (r.status === 401) { entRefresh(); return premiumSay('This app was signed out: sign in again to download the pack'); }
    if (r.status === 403) {   // the website says this account has no paid plan (any more): believe it, then offer the upgrade
      ent.plan = r.json.plan in ENT_RANK ? r.json.plan : 'free'; ent.at = Date.now(); entSave(); entShow();
      premiumSay('The premium pack comes with Pro and Festival'); entPrompt('pack'); return;
    }
    if (!r.ok || !r.json.sig) return premiumSay('The premium pack is not available right now. Try again later.');
    const q = '?e=' + encodeURIComponent(r.json.exp) + '&s=' + encodeURIComponent(r.json.sig), files = [];
    for (const n of need) {
      premiumSay('Premium pack: downloading ' + (premium.done + 1) + ' of ' + premium.total + '...');
      try {
        const f = await fetch(premiumBase() + encodeURIComponent(n) + q, { cache: 'no-store' });
        if (!f.ok) throw new Error(f.status);
        const b = await f.blob(), file = new File([b], n, { type: /\.mp4$/i.test(n) ? 'video/mp4' : 'image/webp' });
        files.push(file); premium.have.add(n);
        try { await premiumDB('put', n, file); } catch (e) { /* kept for this session only */ }
      } catch (e) { /* counted below */ }
      premium.done++;
    }
    if (files.length) addMediaFiles(files);
    browserTab = 'files';
    premiumSay(files.length === need.length ? 'Premium pack ready: ' + PREMIUM_PACK.length + ' clips are in Files (they start with "strodano-pro") and stay on this computer'
      : files.length ? 'Part of the premium pack could not be downloaded: press Premium pack again for the rest' : 'The premium pack could not be downloaded. Try again in a moment.');
  } finally { premium.busy = false; ui.browserDirty = true; }
}
// The row on the Files tab: the download button until the whole pack is here.
function premiumRow() {
  if (!premium.ready || !premiumMissing().length) return null;
  const paid = entCan('pack');
  return el('div', { className: 'fld' },
    el('span', { className: 'hint', style: { flex: '1' }, textContent: premium.busy ? 'Premium pack: ' + premium.done + ' of ' + premium.total + ' downloaded' : 'STRODANO premium pack: ' + PREMIUM_PACK.length + ' more clips' + (paid ? '' : ' (Pro and Festival)') }),
    el('button', { className: paid ? 'on' : '', disabled: premium.busy, textContent: premium.busy ? 'Downloading...' : premium.have.size ? 'Get the rest' : 'Premium pack', title: 'Download STRODANO footage and photos for Pro and Festival into Files (about 11 MB, once)', onclick: premiumGet }));
}
