// Strodano VJ mobile - service worker: the app works offline once opened (installed PWA). GPL-3.0.
// The app shell is cached on install. Requests go to the network first, so an update shows at once (no stale mix
// of old and new scripts); when the network fails or takes over 2.5 s (offline, a venue with bad signal) the cached
// copy answers. Every good answer refreshes the cache. Bump VERSION when files are added or removed below.
// Never cached: vdo.ninja and other sites (the web link is online by nature), and the MediaPipe hand tracking
// bundle (14 MB, a desktop feature), and the desktop page (index.html): only the files in SHELL go through here.
'use strict';
const VERSION = 'svj-mobile-8';
const SHELL = [
  'mobile.html', 'manifest.webmanifest', 'logo.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'theme.js', 'core.js', 'plan.js', 'shaders.js', 'engine.js', 'mediafolder.js', 'midi.js', 'audio.js', 'live.js', 'looks.js',
  'motion.js', 'camera.js', 'text.js',
  'vendor/three.min.js', 'smart3d.js', 'hands.js', 'inputs.js', 'safety.js', 'display.js', 'ndi.js', 'vdo.js', 'clipopts.js', 'snapshots.js',
  'vendor/qrcode.js', 'vendor/vdoninja-sdk.min.js', 'medialib.js', 'starter.js', 'workspace.js', 'mobileui.js',
];
// Strodano VJ Pro (tools/pro.mjs): cached when the build has it; a Free build has no such file, and addAll would fail.
const OPTIONAL = ['pro/pro.js'];
const SHELL_URLS = new Set([...SHELL, ...OPTIONAL].map(p => new URL(p, self.registration.scope).href));
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).then(() => Promise.all(OPTIONAL.map(p => c.add(p).catch(() => {}))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;   // vdo.ninja, fonts...: straight to the network
  if (!SHELL_URLS.has(u.origin + u.pathname)) return;   // only the phone app's files: the desktop page (index.html) is left alone
  e.respondWith(caches.open(VERSION).then(async c => {
    // shared scripts asked for by the desktop page (index.html over http) always come fresh from the network
    if (r.mode !== 'navigate') { const cl = e.clientId && await self.clients.get(e.clientId); if (cl && !/\/mobile\.html$/.test(new URL(cl.url).pathname)) return fetch(r); }
    const net = fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok && res.type === 'basic') c.put(r, res.clone()); return res; }).catch(() => null);
    e.waitUntil(net);
    const first = await Promise.race([net, new Promise(res => setTimeout(() => res(undefined), 2500))]);
    if (first) return first;
    const hit = await c.match(r, { ignoreSearch: true });
    return hit || (await net) || new Response('Offline', { status: 503, statusText: 'Offline' });
  }));
});
