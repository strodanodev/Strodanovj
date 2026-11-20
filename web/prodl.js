// Strodano VJ (web) - loads Strodano VJ Pro, and downloads it once the app is signed in to a paid plan. GPL-3.0.
// Pro (DJ mode, Agent Mode, recording, rekordbox import...) is closed source: it is not in this repo, the installers or
// the phone site's public files. An app signed in to a Pro or Festival account downloads it from
// vj.strodano.live/premium/ with the premium pack's signed link (GET /api/app/pack, plan >= Pro; the site's middleware
// refuses anything else) and keeps it: the desktop app in its data folder through the main process (desktop/pro.js),
// a browser / the phone in localStorage. A bundle comes with a manifest signed by the module-signing key (PRO_PUBKEY;
// the private half is MODULE_SIGNING_KEY, used by tools/build-mobile.mjs): {v, api, version, file, sha256, size}.
// This script runs during start-up where the bundle used to be: the stored copy is put in the page synchronously, so
// the app starts exactly as if Pro were built in, offline too.
// - desktop: the main process checks signature and hash before it hands the code over (strodanoDesktop.pro.load), so
//   a changed copy in the data folder never runs
// - browser / phone: localStorage is read as it is and checked right after; a copy that fails is deleted and the page
//   reloads (there anyone can change the page's code in the browser's own tools anyway)
// - development (npm start, or a page on localhost): pro/pro.js from tools/pro.mjs, unless localStorage
//   `strodano-vj-pro-test` is 'download' (then as released; `strodano-vj-pack` points at another copy of the files)
// A first download starts Pro by reloading the page when no show is live; an update starts at the next start.
'use strict';
const PRO_API = 1;   // the hook surface between core and bundle; must equal pro.json "api" in the private repo
// The public half of MODULE_SIGNING_KEY (website/.env.local). desktop/pro.js holds the same key: change both together.
const PRO_PUBKEY = { kty: 'EC', crv: 'P-256', x: 'cUJQ2qH0YO-fAC8tbxIlx1ewBQts0H9xSHEJHFP1e0w', y: 'pvvGnUcUh0U3i7FC7FlvFeiNvhmfpnuJ5V5zZ9KRLhU' };
const PRO_LS = 'strodano-vj-pro';
const PRO_SITE = 'https://vj.strodano.live/premium/';
const proState = { dev: false, stored: '', loaded: '', busy: false, last: 0 };


let proKeyP = null;
const proKey = () => proKeyP || (proKeyP = crypto.subtle.importKey('jwk', PRO_PUBKEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
// True when the bundle is genuine: the manifest's signature, then the code's SHA-256 and size against it.
async function proCheck(b) {
  try {
    const enc = new TextEncoder();
    if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await proKey(), entB64(b.sig), enc.encode(b.manifest)))) return false;
    const m = JSON.parse(b.manifest), bytes = enc.encode(b.code);
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
    return m.v === 1 && m.api === PRO_API && m.sha256 === h && m.size === bytes.length;
  } catch (e) { return false; }
}
const proShowLive = () => (typeof liveScreens === 'function' && liveScreens().length > 0) || (typeof ndiLive === 'function' && ndiLive().length > 0) ||
  (typeof vdoLive === 'function' && vdoLive().length > 0) || (typeof recTick === 'function' && rec.on);
const proBase = () => { let b = ''; try { b = (ENT_DEV && localStorage.getItem('strodano-vj-pack')) || ''; } catch (e) {} return b || PRO_SITE; };

// Downloads the newest bundle for this app when the account has Pro or Festival and this app does not have it yet.
// Quiet when offline or on Free: it is tried again with the next plan check (plan.js, every half hour and on start).
async function proFetch() {
  if (proState.dev || proState.busy || !ent.token || !entCan('dj')) return;
  if (proState.stored && Date.now() - proState.last < 10 * 60e3) return;
  proState.busy = true; proState.last = Date.now();
  try {
    let r = null;
    try { r = await entFetch('/api/app/pack', null, ent.token); } catch (e) {}
    if (!r || !r.ok || !r.json.sig) return;
    const q = '?e=' + encodeURIComponent(r.json.exp) + '&s=' + encodeURIComponent(r.json.sig);
    const mr = await fetch(proBase() + 'pro-api' + PRO_API + '.json' + q, { cache: 'no-store' });
    if (!mr.ok) return;
    const mj = await mr.json(), m = JSON.parse(mj.manifest);
    if (String(m.version) === proState.stored) return;
    if (!proState.stored) setStatus('Downloading Strodano VJ Pro...');
    const cr = await fetch(proBase() + encodeURIComponent(m.file) + q, { cache: 'no-store' });
    if (!cr.ok) return;
    const b = { manifest: String(mj.manifest), sig: String(mj.sig), code: await cr.text() };
    if (!(await proCheck(b))) { setStatus('The Strodano VJ Pro download did not check out; it will be tried again'); return; }
    const desk = window.strodanoDesktop && window.strodanoDesktop.pro;
    if (desk) { if (!(await desk.save(b))) { setStatus('Strodano VJ Pro could not be saved on this computer'); return; } }
    else { try { localStorage.setItem(PRO_LS, JSON.stringify(b)); } catch (e) { setStatus('Strodano VJ Pro could not be saved: the browser storage is full'); return; } }
    proState.stored = String(m.version);
    if (proState.loaded) setStatus('Strodano VJ Pro ' + m.version + ' is downloaded: it starts the next time the app opens');
    else if (proShowLive()) setStatus('Strodano VJ Pro is downloaded: it starts the next time the app opens (a show is live)');
    else { setStatus('Starting Strodano VJ Pro...'); try { autosave(); } catch (e) {} setTimeout(() => location.reload(), 500); }
  } catch (e) {
  } finally { proState.busy = false; }
}
entReady.then(() => proFetch());
window.addEventListener('strodano-plan', () => proFetch());

// Runs last in this file (proCheck needs everything above), still during start-up.
(function proBoot() {
  const desk = window.strodanoDesktop && window.strodanoDesktop.pro;
  let got = null, forced = false;
  try { forced = ENT_DEV && localStorage.getItem('strodano-vj-pro-test') === 'download'; } catch (e) {}
  try { got = desk ? desk.load() : null; } catch (e) {}
  if (!forced && (desk ? got && got.dev : ENT_DEV)) {   // development: the bundle tools/pro.mjs built
    proState.dev = true;
    document.write('<script src="pro/pro.js"><\/script>');
    return;
  }
  if (!desk) { try { got = JSON.parse(localStorage.getItem(PRO_LS) || 'null'); } catch (e) { got = null; } }
  if (!got || typeof got.code !== 'string' || typeof got.manifest !== 'string') return;
  let m = null;
  try { m = JSON.parse(got.manifest); } catch (e) {}
  if (!m || m.api !== PRO_API) return;   // made for another version of the app: wait for a matching download
  proState.stored = String(m.version);
  const s = document.createElement('script');
  s.textContent = got.code;
  document.head.appendChild(s);   // an inline script runs right here, before the rest of start-up
  if (window.SVJ_PRO) proState.loaded = proState.stored;
  if (!desk) proCheck(got).then(ok => { if (!ok) { try { localStorage.removeItem(PRO_LS); } catch (e) {} location.reload(); } });
})();
