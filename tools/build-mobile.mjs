// Builds the deployable phone edition into dist-mobile/ (static files, any https host). GPL-3.0.
//   node tools/build-mobile.mjs
// - copies mobile.html and every local file it loads (read from its <script src> / <link href>), plus the files the
//   scripts load later (VDO.Ninja SDK, QR library, licences, icons, service worker, manifest)
// - checks that sw.js caches every script mobile.html loads (else the installed app would break offline)
// - builds starter/ = the STRODANO starter pack (starter.js) from the website's compressed media
//   (../website/public/media, made by `npm run media` there) and one cutout from ../strodano assets
// - adds index.html (opens the app) and .nojekyll (GitHub Pages)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web'), OUT = path.join(ROOT, 'dist-mobile');
const MEDIA = path.resolve(ROOT, '..', 'website', 'public', 'media'), ASSETS = path.resolve(ROOT, '..', 'strodano assets');
const fail = m => { console.error('build-mobile: ' + m); process.exit(1); };

// 0. Strodano VJ Pro from the private repo (tools/pro.mjs). It is published only behind /premium/ (below), where the
// apps download it after sign-in (web/prodl.js); the phone site is where every app gets it, so this fails without it.
import { buildPro } from './pro.mjs';
let pro;
try { pro = buildPro(); console.log(`build-mobile: Pro ${pro.version}, ${pro.files} files`); } catch (e) { fail(e.message); }

// start clean, but keep .vercel/ (the link to the Vercel project, so `vercel deploy` keeps deploying to the same one)
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f !== '.vercel') rmSync(path.join(OUT, f), { recursive: true, force: true });
const copy = (rel, from = path.join(WEB, rel)) => { if (!existsSync(from)) fail('missing ' + from); mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); copyFileSync(from, path.join(OUT, rel)); };

// 1. the app
const html = readFileSync(path.join(WEB, 'mobile.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('/'));
const extra = ['mobile.html', 'watch.html', 'sw.js', 'vendor/vdoninja-sdk.min.js', 'vendor/vdoninja-LICENSE-MPL-2.0.txt', 'vendor/qrcode-LICENSE.txt', 'vendor/three-LICENSE.txt',
  ...readdirSync(path.join(WEB, 'icons')).map(f => 'icons/' + f)];
const files = [...new Set([...refs, ...extra])];
files.forEach(f => copy(f));
copy('LICENSE', path.join(ROOT, 'LICENSE'));

// 2. the service worker must cache every script the page loads
const sw = readFileSync(path.join(WEB, 'sw.js'), 'utf8');
const shell = new Set([...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
const scripts = refs.filter(r => r.endsWith('.js'));
const uncached = scripts.filter(s => !shell.has(s));
if (uncached.length) fail('sw.js SHELL is missing ' + uncached.join(', ') + ' (add them and bump VERSION)');
const stale = [...shell].filter(s => !existsSync(path.join(WEB, s)));
if (stale.length) fail('sw.js SHELL lists files that do not exist: ' + stale.join(', '));

// 3. the STRODANO starter pack (names must match STARTER_FILES in web/starter.js)
const PACK = [['hero.mp4', 'strodano-hero.mp4'], ['stage.mp4', 'strodano-stage.mp4'], ['live-1.webp', 'strodano-live-1.webp'], ['live-2.webp', 'strodano-live-2.webp'],
  ['logo-main.webp', 'strodano-logo.webp'], ['logo-neon.webp', 'strodano-neon.webp']];
const starterNames = [...readFileSync(path.join(WEB, 'starter.js'), 'utf8').matchAll(/\['(strodano-(?!pro-)[^']+)'/g)].map(m => m[1]);
mkdirSync(path.join(OUT, 'starter'), { recursive: true });
for (const [from, to] of PACK) {
  if (!existsSync(path.join(MEDIA, from))) fail(`${path.join(MEDIA, from)} not found: run "npm run media" in ../website first`);
  copyFileSync(path.join(MEDIA, from), path.join(OUT, 'starter', to));
}
// the duo cutout (transparent) is not in the website's media: 1100 px webp with its alpha, through the website's ffmpeg
const ffmpeg = path.resolve(ROOT, '..', 'website', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (!existsSync(ffmpeg)) fail('ffmpeg-static not found: run "npm install" in ../website');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(ASSETS, 'strodano duo cutout.webp'), '-vf', "scale='min(1100,iw)':-2",
  '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', '82', path.join(OUT, 'starter', 'strodano-duo.webp')], { stdio: 'inherit' });
const built = readdirSync(path.join(OUT, 'starter'));
const missing = starterNames.filter(n => !built.includes(n));
if (missing.length) fail('starter.js wants files the pack does not have: ' + missing.join(', '));
writeFileSync(path.join(OUT, 'starter', 'README.txt'),
  'STRODANO starter pack: footage, photos and logos (c) STRODANO. All rights reserved.\n' +
  'These media files are NOT covered by the GPL licence of the Strodano VJ software. They are included so the\n' +
  'phone edition opens with a ready show; do not reuse them outside Strodano VJ without permission.\n');

// 3b. the premium pack (names must match PREMIUM_FILES in web/starter.js and PREMIUM_PACK in web/premium.js, the desktop
// page's copy): Pro / Festival only, behind middleware.js
// Only what the free starter does not have: its two videos in full HD, and the duo + logo lockup. The rest of the
// premium value is the 3D show (starter.js premiumProject) built around them.
const PREMIUM = [
  ['top section.mp4', 'strodano-pro-visors-hd.mp4'], ['mid section.MOV', 'strodano-pro-club-hd.mp4'], ['uwu png.png', 'strodano-pro-lockup.webp'],
];
const premiumNames = [...readFileSync(path.join(WEB, 'starter.js'), 'utf8').matchAll(/\['(strodano-pro-[^']+)'/g)].map(m => m[1]);
mkdirSync(path.join(OUT, 'premium'), { recursive: true });
for (const [from, to] of PREMIUM) {
  const src = path.join(ASSETS, from), dst = path.join(OUT, 'premium', to);
  if (!existsSync(src)) fail(src + ' not found');
  const args = to.endsWith('.mp4')
    // 1920x1080 30 fps H.264 (the starter has 720p), no sound, fast start: plays on every phone and loops cleanly
    ? ['-i', src, '-an', '-vf', 'scale=-2:1080,fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-maxrate', '4000k', '-bufsize', '8000k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]
    // at most 1600 px on the long side, alpha kept
    : ['-i', src, '-vf', "scale='if(gt(iw,ih),min(1600,iw),-2)':'if(gt(iw,ih),-2,min(1600,ih))'", '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', '85', dst];
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}
const premiumMissing = premiumNames.filter(n => !existsSync(path.join(OUT, 'premium', n)));
if (premiumMissing.length || premiumNames.length !== PREMIUM.length) fail('starter.js PREMIUM_FILES and the premium pack do not match: ' + (premiumMissing.join(', ') || 'different counts'));
const deskNames = [...readFileSync(path.join(WEB, 'premium.js'), 'utf8').matchAll(/\['(strodano-pro-[^']+)'/g)].map(m => m[1]);
if (deskNames.join() !== premiumNames.join()) fail('premium.js PREMIUM_PACK (desktop) and starter.js PREMIUM_FILES (phone) list different files');
// 3c. Strodano VJ Pro: premium/pro-<version>.js + premium/pro-api<N>.json = { manifest, sig }. The manifest
// {v, api, version, file, sha256, size} is signed with MODULE_SIGNING_KEY (ECDSA P-256, raw r|s; env, else
// ../website/.env.local; the apps check it against PRO_PUBKEY in web/prodl.js and desktop/pro.js). One manifest per
// PRO_API, so an app only ever sees bundles made for it.
{
  const api = +(readFileSync(path.join(WEB, 'prodl.js'), 'utf8').match(/const PRO_API = (\d+);/) || [])[1];
  const deskApi = +(readFileSync(path.join(ROOT, 'desktop', 'pro.js'), 'utf8').match(/const PRO_API = (\d+);/) || [])[1];
  const proJson = JSON.parse(readFileSync(path.join(ROOT, '..', 'strodano-vj-premium', 'pro.json'), 'utf8'));
  if (!api || api !== deskApi || proJson.api !== api) fail(`PRO_API differs: web/prodl.js ${api}, desktop/pro.js ${deskApi}, private pro.json ${proJson.api}`);
  let keyText = process.env.MODULE_SIGNING_KEY || '';
  if (!keyText) { try { keyText = (readFileSync(path.resolve(ROOT, '..', 'website', '.env.local'), 'utf8').match(/^MODULE_SIGNING_KEY=(.+)$/m) || [])[1] || ''; } catch (e) {} }
  if (!keyText) fail('MODULE_SIGNING_KEY is not set (env or ../website/.env.local): the Pro bundle cannot be signed');
  const { createPrivateKey, createHash, sign } = await import('node:crypto');
  const key = createPrivateKey(keyText.includes('BEGIN') ? keyText.replace(/\\n/g, '\n') : Buffer.from(keyText.trim(), 'base64').toString('utf8'));
  const code = readFileSync(path.join(WEB, 'pro', 'pro.js'));
  const file = 'pro-' + pro.version + '.js';
  writeFileSync(path.join(OUT, 'premium', file), code);
  const manifest = JSON.stringify({ v: 1, api, version: pro.version, file, sha256: createHash('sha256').update(code).digest('hex'), size: code.length, built: new Date().toISOString() });
  const sig = sign('sha256', Buffer.from(manifest), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  writeFileSync(path.join(OUT, 'premium', 'pro-api' + api + '.json'), JSON.stringify({ manifest, sig }));
  console.log(`build-mobile: Pro ${pro.version} signed for API ${api} (${(code.length / 1024).toFixed(0)} KB) behind /premium/`);
}
writeFileSync(path.join(OUT, 'premium', 'README.txt'), 'STRODANO premium pack (c) STRODANO. All rights reserved. For Strodano VJ Pro and Festival subscribers only.\n');
// Vercel Routing Middleware: a premium file is served only with a fresh signature from the website (GET /api/app/pack),
// ?e=<unix expiry>&s=<base64url HMAC-SHA256 of "premium:<e>">, keyed with PACK_SECRET (set on both Vercel projects)
writeFileSync(path.join(OUT, 'middleware.js'), `// Generated by tools/build-mobile.mjs. GPL-3.0.
export const config = { matcher: '/premium/:path*' };
const deny = m => new Response(m, { status: 403, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
export default async function middleware(req) {
  const u = new URL(req.url), e = u.searchParams.get('e') || '', s = u.searchParams.get('s') || '', now = Date.now() / 1000;
  const secret = process.env.PACK_SECRET;
  if (!secret) return deny('Not available');
  if (!/^[0-9]{10}$/.test(e) || +e < now || +e > now + 7200 || !/^[A-Za-z0-9_-]{43}$/.test(s)) return deny('This download link has run out: get the pack again from the app');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('HMAC', key, b64(s), new TextEncoder().encode('premium:' + e)))) return deny('Not allowed');
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
`);

// 4. entry points
writeFileSync(path.join(OUT, 'index.html'), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Strodano VJ Mobile</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0; url=mobile.html">
<link rel="manifest" href="manifest.webmanifest"></head><body style="background:#070708;color:#eee;font-family:system-ui;padding:24px">
<a href="mobile.html" style="color:#cc6688">Open Strodano VJ Mobile</a></body></html>\n`);
writeFileSync(path.join(OUT, '.nojekyll'), '');
// Vercel: plain static files; the service worker and the page are always revalidated so an update reaches phones at once
writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({
  cleanUrls: false, trailingSlash: false,
  // the branded web link viewer: <site>/live/<name>#<password>
  rewrites: [{ source: '/live/:name', destination: '/watch.html' }],
  headers: [
    { source: '/(sw.js|mobile.html|watch.html|index.html|manifest.webmanifest)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    // the desktop app downloads the pack from file:// (origin null), so the files allow any origin: the signature is the lock
    { source: '/premium/(.*)', headers: [{ key: 'Cache-Control', value: 'private, no-store' }, { key: 'Access-Control-Allow-Origin', value: '*' }] },
    { source: '/starter/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
    { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
  ],
}, null, 2) + '\n');

const size = d => readdirSync(d).reduce((n, f) => { const p = path.join(d, f), s = statSync(p); return n + (s.isDirectory() ? size(p) : s.size); }, 0);
console.log(`dist-mobile: ${files.length + 1} app files, starter pack ${(size(path.join(OUT, 'starter')) / 1e6).toFixed(1)} MB, premium pack ${(size(path.join(OUT, 'premium')) / 1e6).toFixed(1)} MB, total ${(size(OUT) / 1e6).toFixed(1)} MB`);
