// Strodano VJ (web) - plans and the account: which features belong to Free, Pro and Festival, signing the app
// in, and the upgrade prompt. GPL-3.0.
// One table (ENT_FEATURES) and two questions: entCan(feature) asks, entGate(feature) asks and, when the answer is
// no, shows the upgrade prompt. Every lock in the app goes through entGate at the point where the feature starts
// (setAgent, toggleDJ, setAuto, recStart, the Advanced Output editor), so MIDI, keys and both front ends share it.
// Locks only stop NEW use: a project that already has slices, masks or a warp keeps playing them.
//
// The plan belongs to an account on the website (www.strodano.live, AIR Kit sign-in). The app cannot run AIR Kit
// (it must work from file:// and inside the desktop shell), so it signs in with a code: entSignIn() asks the
// website for a code, the person approves it on the website's /link page, and the app receives a device token.
// With that token it reads the plan (GET /api/app/plan) at start, every half hour and when the network returns.
// The plan comes as a ticket signed by the website (ECDSA P-256, public key ENT_PUBKEY): `<base64url JSON>.<sig>`
// over {plan, dev, iat, exp}. Only a ticket that verifies, belongs to this device token (dev) and has not run out
// (exp, a week after it was issued) counts, so a venue with no internet keeps its plan for a week, and an edited
// localStorage entry gives nothing. Without an account, or until the stored ticket is checked (`entReady`), the plan
// is Free; `strodano-plan` fires on window whenever the plan in force may have changed.
//
// Testing, only on a page served from this computer (http://localhost: ENT_DEV), never in the desktop app or on the
// phone site (every test switch, including the in-memory one, is ignored unless ENT_DEV): entTest('free' | 'pro' | 'festival') in the console forces a plan, entTest('off') removes every lock,
// entTest() goes back to the account; localStorage `strodano-vj-api` points the app at another website (a local one).
'use strict';
const ENT_RANK = { free: 0, pro: 1, festival: 2 };
const ENT_NAMES = { free: 'Free', pro: 'Pro', festival: 'Festival' };
const ENT_FEATURES = {
  agent:     { plan: 'pro',      name: 'Agent Mode',       what: 'The Agent listens to the music and directs your visuals.' },
  dj:        { plan: 'pro',      name: 'DJ mode',          what: 'Two decks, tempo and beat-grid analysis, and auto-mix.' },
  autopilot: { plan: 'pro',      name: 'Autopilot sets',   what: 'Autopilot picks the next track and mixes it in for you.' },
  record:    { plan: 'pro',      name: 'Recording',        what: 'Record the show with its sound: up to 1 hour on Pro, 10 hours on Festival.' },
  rekordbox: { plan: 'pro',      name: 'rekordbox import', what: 'Bring in playlists from a rekordbox USB stick, with the beat grids, keys and cue points you set there.' },
  pack:      { plan: 'pro',      name: 'Premium pack',     what: 'More STRODANO footage and photos, downloaded into your library.' },
  mapping:   { plan: 'festival', name: 'Advanced mapping', what: 'Several screens, slices, mesh warp, masks and soft edges.' },
};
const ENT_REC_MAX = { free: 0, pro: 3600, festival: 36000 };   // seconds of recording per file
const ENT_SITE = 'https://www.strodano.live';
const ENT_KEY = 'strodano-vj-account', ENT_TEST_KEY = 'strodano-vj-plan-test', ENT_API_KEY = 'strodano-vj-api';
// The public half of the website's PLAN_SIGNING_KEY (website/server/app.mjs planTicket). Change both together.
const ENT_PUBKEY = { kty: 'EC', crv: 'P-256', x: 'ndI3wMvbZ48aKQb_KmrN-5wYZ6o78LsWCQ8T930RSe4', y: 'ILM_PsoVjT498G-otaQeNwnuupeuFZNnhcjj_GEiJ6I' };
const ENT_EVERY = 30 * 60e3;        // how often the plan is read again
// A page served from this computer (development). Only there do the test plan and another website's address count.
const ENT_DEV = location.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
// token: this app's device token; ticket: the website's last signed plan; plan / at / exp: what that ticket says
// (checked), when it was issued and when it runs out (ms); test: a forced plan (ENT_DEV only)
const ent = { token: '', ticket: '', plan: 'free', at: 0, exp: 0, test: '', box: null, link: null, lastTry: 0 };
const entLS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} } };
let entStored = '';
try { const a = JSON.parse(entLS.get(ENT_KEY) || 'null'); if (a && a.token) { ent.token = String(a.token); entStored = String(a.ticket || ''); } } catch (e) {}
if (ENT_DEV) { const t = entLS.get(ENT_TEST_KEY); if (t === 'off' || t in ENT_RANK) ent.test = t; }
const entApi = () => ((ENT_DEV && entLS.get(ENT_API_KEY)) || ENT_SITE).replace(/\/$/, '');
function entSave() { entLS.set(ENT_KEY, ent.token ? JSON.stringify({ token: ent.token, ticket: ent.ticket }) : null); }
const entChanged = () => { entShow(); if (typeof ui !== 'undefined') ui.browserDirty = ui.propsDirty = true; try { window.dispatchEvent(new Event('strodano-plan')); } catch (e) {} };

// ---------- plan tickets ----------
const entB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
let entKeyP = null;
// The key tickets are checked with. A development page pointed at another website (strodano-vj-api) asks that one.
function entKey() {
  if (!entKeyP) entKeyP = (async () => {
    let jwk = ENT_PUBKEY;
    if (ENT_DEV && entLS.get(ENT_API_KEY)) { try { const r = await entFetch('/api/app/key'); if (r.ok && r.json.jwk) jwk = r.json.jwk; } catch (e) {} }
    return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  })();
  return entKeyP;
}
// What a ticket says, when it is genuine, this device's and in force now; null otherwise.
async function entCheck(ticket, token) {
  try {
    const [body, sig] = String(ticket || '').split('.');
    if (!body || !sig || !token) return null;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await entKey(), entB64(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(entB64(body)));
    const dev = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const now = Date.now() / 1000;
    if (t.v !== 1 || t.dev !== dev || !(t.plan in ENT_RANK) || !(t.iat - 600 <= now && now < t.exp)) return null;   // 10 min of clock slack
    return { plan: t.plan, at: t.iat * 1000, exp: t.exp * 1000 };
  } catch (e) { return null; }
}
// Takes a ticket from the website (or the stored one). One that does not check out leaves the app on Free.
async function entTake(ticket) {
  const token = ent.token, t = await entCheck(ticket, token);
  if (ent.token !== token) return false;   // signed out meanwhile
  ent.ticket = t ? String(ticket) : ''; ent.plan = t ? t.plan : 'free'; ent.at = t ? t.at : 0; ent.exp = t ? t.exp : 0;
  entSave(); entChanged();
  return !!t;
}
// The website said this account has no paid plan (premium pack 403): believe it until the next ticket.
function entDowngrade() { ent.ticket = ''; ent.plan = 'free'; ent.at = Date.now(); ent.exp = 0; entSave(); entChanged(); }
// Resolves once the stored ticket is checked; features restored at start (DJ mode) wait for it.
const entReady = ent.token && entStored ? entTake(entStored) : Promise.resolve(false);

// ---------- Strodano VJ Pro bundle ----------
// The Pro and Festival features (DJ mode, auto-mix, Agent Mode, recording, rekordbox import...) are closed source: they
// come as pro/pro.js, built into the official app from a private repo (tools/pro.mjs), which sets window.SVJ_PRO. A build
// of this public repo on its own has every Free feature; a paid feature then says where it comes from.
const proLoaded = () => typeof window !== 'undefined' && !!window.SVJ_PRO;
function proGate(feature) {
  if (!entGate(feature)) return false;
  if (proLoaded()) return true;
  const f = ENT_FEATURES[feature];
  setStatus((f ? f.name : 'This feature') + ' is part of the Strodano VJ app from strodano.live (this build has the Free features only)');
  return false;
}
const agentOn = () => typeof setAgent === 'function' && agent.on;   // not typeof agent: index.html has an element id="agent"

// The plan in force right now.
function entPlan() {
  if (ENT_DEV && ent.test in ENT_RANK) return ent.test;
  return ent.token && ent.ticket && Date.now() < ent.exp ? ent.plan : 'free';
}
const entOff = () => ENT_DEV && ent.test === 'off';
function entCan(feature) {
  const f = ENT_FEATURES[feature];
  return entOff() || !f || ENT_RANK[entPlan()] >= ENT_RANK[f.plan];
}
// Longest recording, in seconds.
const entRecMax = () => (entOff() ? 3600 : ENT_REC_MAX[entPlan()]);
function entGate(feature) {
  if (entCan(feature)) return true;
  entPrompt(feature);
  return false;
}
function entTest(plan) {
  if (!ENT_DEV) return 'Test plans only work on a development page (http://localhost)';
  ent.test = plan === 'off' || plan in ENT_RANK ? plan : '';
  entLS.set(ENT_TEST_KEY, ent.test || null);
  entChanged();
  return ent.test === 'off' ? 'Every lock is off' : ent.test ? 'Forced plan: ' + ENT_NAMES[ent.test] : 'Back to the account: ' + ENT_NAMES[entPlan()];
}

// ---------- the account ----------
async function entFetch(path, body, token) {
  const res = await fetch(entApi() + path, { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  let json = {};
  try { json = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, json };
}
// Reads the plan again. A 401 means this app was signed out (or pushed out by newer devices); no answer at all
// keeps the last ticket, which counts until it runs out (a week after it was issued).
async function entRefresh() {
  if (!ent.token) return;
  ent.lastTry = Date.now();
  let r;
  try { r = await entFetch('/api/app/plan', null, ent.token); } catch (e) { return; }
  if (r.status === 401) { ent.token = ''; ent.ticket = ''; ent.plan = 'free'; ent.at = 0; ent.exp = 0; entSave(); entChanged(); if (typeof setStatus === 'function') setStatus('This app was signed out of your Strodano account'); }
  else if (r.ok) await entTake(r.json.ticket);   // no ticket (a website without its signing key) reads as Free
}
function entSignOut() {
  const t = ent.token;
  ent.token = ''; ent.ticket = ''; ent.plan = 'free'; ent.at = 0; ent.exp = 0;
  entSave(); entChanged();
  if (t) entFetch('/api/app/signout', {}, t).catch(() => {});
  if (typeof setStatus === 'function') setStatus('Signed out. You are on Free.');
}
// Asks the website for a code, shows it, and waits until the person approves it there.
async function entSignIn() {
  entStopLink();
  entDialog('ACCOUNT', 'Getting a sign-in code...', 'One moment.', [entBtn('Cancel', entClose)]);
  let r;
  try { r = await entFetch('/api/link/start', {}); } catch (e) { r = null; }
  if (!r || !r.ok || !r.json.secret) { entDialog('ACCOUNT', 'No connection to strodano.live', 'Signing in needs the internet. Check the connection and try again.', [entBtn('Close', entClose), entBtn('Try again', entSignIn, true)]); return; }
  const { code, secret, url, expiresIn } = r.json, link = { secret, until: Date.now() + (expiresIn || 600) * 1000, timer: 0 };
  ent.link = link;
  const state = el('div', { textContent: 'Waiting for you to approve it on the website...', style: { color: 'var(--dim)', marginTop: '12px', fontSize: '13px' } });
  entDialog('ACCOUNT', 'Sign in on the website', 'Open the sign-in page, sign in, and approve this code:', [
    entBtn('Cancel', () => { entStopLink(); entClose(); }),
    el('a', { textContent: 'Open sign-in page', href: url, target: '_blank', rel: 'noopener', style: entBtnStyle(true) })],
    el('div', { textContent: code, style: { font: '600 30px/1 var(--mono, monospace)', letterSpacing: '.18em', textAlign: 'center', padding: '16px', margin: '14px 0 0', background: 'var(--field, #000)', border: '1px solid var(--line)', borderRadius: '8px', userSelect: 'all' } }), state);
  const poll = async () => {
    if (ent.link !== link) return;
    if (Date.now() > link.until) { entStopLink(); entDialog('ACCOUNT', 'That code ran out', 'Codes last ten minutes. Start again for a new one.', [entBtn('Close', entClose), entBtn('New code', entSignIn, true)]); return; }
    let p = null;
    try { p = await entFetch('/api/link/poll', { secret }); } catch (e) {}
    if (ent.link !== link) return;
    if (p && p.ok && p.json.approved && p.json.token) {
      entStopLink();
      ent.token = p.json.token; ent.ticket = ''; ent.plan = 'free'; ent.at = 0; ent.exp = 0;
      await entTake(p.json.ticket);
      const name = ENT_NAMES[ent.plan];
      if (typeof setStatus === 'function') setStatus('Signed in. You are on ' + name + '.');
      entDialog(name.toUpperCase(), 'Signed in', ent.plan === 'free' ? 'This account is on Free. Pro and Festival unlock here as soon as you subscribe on the website.' : 'Your ' + name + ' features are unlocked on this device.', [entBtn('Done', entClose, true)]);
      return;
    }
    if (p && p.status === 404) { link.until = 0; return poll(); }
    link.timer = setTimeout(poll, 3000);
  };
  link.timer = setTimeout(poll, 3000);
}
function entStopLink() { if (ent.link) { clearTimeout(ent.link.timer); ent.link = null; } }
// The account dialog: the plan, and Sign in or Sign out.
function entAccount() {
  const plan = entPlan(), name = ENT_NAMES[plan];
  if (ENT_DEV && ent.test) return entDialog('TEST', ent.test === 'off' ? 'Every lock is off' : 'Forced plan: ' + name, 'A test setting is in force on this device, not your account.', [entBtn('Close', entClose), entBtn('Back to my account', () => { entTest(); entAccount(); }, true)]);
  if (!ent.token) return entDialog('ACCOUNT', 'You are on Free', 'Sign in with your Strodano account to unlock the Pro or Festival features you subscribed to.', [entBtn('Close', entClose), entBtn('Sign in', entSignIn, true)]);
  const stale = ent.at && Date.now() - ent.at > ENT_EVERY * 2;
  entRefresh();
  entDialog(name.toUpperCase(), 'You are on ' + name, 'This device is signed in to your Strodano account.' + (stale ? ' The plan was last checked ' + new Date(ent.at).toLocaleDateString() + '; it is checked again when there is a connection.' : ''),
    [entBtn('Sign out', () => { entSignOut(); entClose(); }), plan === 'festival' ? null : el('a', { textContent: 'See plans', href: ENT_SITE + '/#pricing', target: '_blank', rel: 'noopener', style: entBtnStyle(false) }), entBtn('Close', entClose, true)]);
}
// Shows the plan on the page's account button, where there is one (#acctBtn on the desktop page).
function entShow() {
  const b = document.getElementById('acctBtn');
  if (!b) return;
  const test = ENT_DEV && ent.test;
  b.textContent = test ? (ent.test === 'off' ? 'Test' : ENT_NAMES[ent.test] + ' (test)') : ent.token ? ENT_NAMES[entPlan()] : 'Sign in';
  b.classList.toggle('on', !test && entPlan() !== 'free');
}

// ---------- dialogs ----------
function entBtnStyle(main) {
  return { font: 'inherit', fontSize: '15px', minHeight: '44px', padding: '0 18px', borderRadius: '8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
    background: main ? 'var(--acc)' : 'var(--ctl)', color: main ? '#fff' : 'var(--txt)', border: '1px solid ' + (main ? 'var(--acc)' : 'var(--ctl-line)'), fontWeight: main ? '600' : '400' };
}
const entBtn = (text, onclick, main) => el('button', { textContent: text, onclick, style: entBtnStyle(main) });
function entClose() { if (ent.box) { ent.box.remove(); ent.box = null; } }
function entDialog(kicker, title, text, buttons, ...extra) {
  entClose();
  const card = el('div', { role: 'dialog', ariaLabel: title,
    style: { width: 'min(420px, 100%)', background: 'var(--card)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '12px', padding: '24px', boxShadow: '0 20px 80px rgba(0,0,0,.8)', font: '15px/1.5 var(--sans)' } },
    el('div', { textContent: kicker, style: { color: 'var(--acc)', fontSize: '12px', letterSpacing: '.12em', fontWeight: '600' } }),
    el('div', { textContent: title, style: { fontSize: '20px', fontWeight: '600', margin: '6px 0 8px' } }),
    el('div', { textContent: text, style: { color: 'var(--dim)' } }), ...extra,
    el('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px', flexWrap: 'wrap' } }, ...buttons));
  ent.box = el('div', { onclick: e => { if (e.target === ent.box) { entStopLink(); entClose(); } },
    style: { position: 'fixed', inset: '0', zIndex: '1000', background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' } }, card);
  document.body.append(ent.box);
}
function entPrompt(feature) {
  const f = ENT_FEATURES[feature], need = ENT_NAMES[f.plan], signedIn = !!ent.token && !(ENT_DEV && ent.test);
  if (typeof setStatus === 'function') setStatus(f.name + ' is part of ' + need);
  entDialog(need.toUpperCase(), f.name + ' is part of ' + need, f.what + ' You are on ' + ENT_NAMES[entPlan()] + '.', [
    entBtn('Not now', entClose),
    signedIn ? null : entBtn('I have ' + need + ': sign in', entSignIn),
    el('a', { textContent: 'See ' + need, href: ENT_SITE + '/checkout/' + f.plan, target: '_blank', rel: 'noopener', onclick: entClose, style: entBtnStyle(true) })]);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ent.box) { entStopLink(); entClose(); e.stopPropagation(); } }, true);

// ---------- keeping the plan current ----------
const entSoon = () => { if (ent.token && Date.now() - ent.lastTry > 60e3) entRefresh(); };
window.addEventListener('online', entSoon);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - ent.lastTry > ENT_EVERY) entSoon(); });
setInterval(() => { if (ent.token) entRefresh(); }, ENT_EVERY);
window.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('acctBtn');
  if (b) b.addEventListener('click', entAccount);
  entShow(); entRefresh();
});
