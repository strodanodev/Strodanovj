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

// start clean, but keep .vercel/ (the link to the Vercel project, so `vercel deploy` keeps deploying to the same one)
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f !== '.vercel') rmSync(path.join(OUT, f), { recursive: true, force: true });
const copy = (rel, from = path.join(WEB, rel)) => { if (!existsSync(from)) fail('missing ' + from); mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); copyFileSync(from, path.join(OUT, rel)); };

// 1. the app
const html = readFileSync(path.join(WEB, 'mobile.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('/'));
const extra = ['mobile.html', 'sw.js', 'vendor/vdoninja-sdk.min.js', 'vendor/vdoninja-LICENSE-MPL-2.0.txt', 'vendor/qrcode-LICENSE.txt', 'vendor/three-LICENSE.txt',
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
  ['avatars.webp', 'strodano-artists.webp'], ['logo-main.webp', 'strodano-logo.webp'], ['logo-neon.webp', 'strodano-neon.webp']];
const starterNames = [...readFileSync(path.join(WEB, 'starter.js'), 'utf8').matchAll(/\['(strodano-[^']+)'/g)].map(m => m[1]);
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

// 4. entry points
writeFileSync(path.join(OUT, 'index.html'), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Strodano VJ Mobile</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0; url=mobile.html">
<link rel="manifest" href="manifest.webmanifest"></head><body style="background:#070708;color:#eee;font-family:system-ui;padding:24px">
<a href="mobile.html" style="color:#cc6688">Open Strodano VJ Mobile</a></body></html>\n`);
writeFileSync(path.join(OUT, '.nojekyll'), '');
// Vercel: plain static files; the service worker and the page are always revalidated so an update reaches phones at once
writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({
  cleanUrls: false, trailingSlash: false,
  headers: [
    { source: '/(sw.js|mobile.html|index.html|manifest.webmanifest)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/starter/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
    { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
  ],
}, null, 2) + '\n');

const size = d => readdirSync(d).reduce((n, f) => { const p = path.join(d, f), s = statSync(p); return n + (s.isDirectory() ? size(p) : s.size); }, 0);
console.log(`dist-mobile: ${files.length + 1} app files, starter pack ${(size(path.join(OUT, 'starter')) / 1e6).toFixed(1)} MB, total ${(size(OUT) / 1e6).toFixed(1)} MB`);
