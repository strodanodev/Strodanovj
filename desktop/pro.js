// Strodano VJ desktop - keeps the downloaded Strodano VJ Pro bundle and hands it to the page at start. GPL-3.0.
// The page (web/prodl.js) downloads the bundle once the app is signed in to a paid plan and passes it here to keep
// (pro:save); at every start it asks for it synchronously (pro:load), so Pro loads in the same place as a built-in
// script would. Both ways the bundle must check out: the manifest's ECDSA P-256 signature against PRO_PUBKEY (the
// module-signing key; web/prodl.js holds the same key, change both together), then the code's SHA-256 and size. A copy
// changed in the data folder therefore never runs. In development (`npm start`, not packaged) the page loads
// web/pro/pro.js from tools/pro.mjs instead.
'use strict';
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRO_API = 1;   // web/prodl.js PRO_API
const PRO_PUBKEY = { kty: 'EC', crv: 'P-256', x: 'cUJQ2qH0YO-fAC8tbxIlx1ewBQts0H9xSHEJHFP1e0w', y: 'pvvGnUcUh0U3i7FC7FlvFeiNvhmfpnuJ5V5zZ9KRLhU' };
const MAX = 16 * 1024 * 1024;
const key = crypto.createPublicKey({ key: PRO_PUBKEY, format: 'jwk' });
const dir = () => path.join(app.getPath('userData'), 'pro');
const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// The manifest when the bundle is genuine and made for this app, else null.
function check(b) {
  try {
    if (!b || typeof b.manifest !== 'string' || typeof b.sig !== 'string' || typeof b.code !== 'string') return null;
    if (!crypto.verify('sha256', Buffer.from(b.manifest, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, b64u(b.sig))) return null;
    const m = JSON.parse(b.manifest), bytes = Buffer.from(b.code, 'utf8');
    if (m.v !== 1 || m.api !== PRO_API || m.size !== bytes.length) return null;
    return crypto.createHash('sha256').update(bytes).digest('hex') === m.sha256 ? m : null;
  } catch (e) { return null; }
}

function setupPro() {
  ipcMain.on('pro:load', e => {
    if (!app.isPackaged) { e.returnValue = { dev: true }; return; }
    try {
      const d = dir(), b = { manifest: fs.readFileSync(path.join(d, 'pro.json'), 'utf8'), sig: fs.readFileSync(path.join(d, 'pro.sig'), 'utf8'), code: fs.readFileSync(path.join(d, 'pro.js'), 'utf8') };
      e.returnValue = check(b) ? b : null;
    } catch (err) { e.returnValue = null; }   // nothing downloaded yet
  });
  ipcMain.handle('pro:save', (e, b) => {
    if (!b || String(b.code || '').length > MAX || !check(b)) return false;
    const d = dir();
    try {
      fs.mkdirSync(d, { recursive: true });
      // written beside, then renamed: a crash mid-write leaves the old bundle (or none), never half of one
      for (const [f, v] of [['pro.js', b.code], ['pro.sig', b.sig], ['pro.json', b.manifest]]) { fs.writeFileSync(path.join(d, f + '.new'), v); }
      for (const f of ['pro.js', 'pro.sig', 'pro.json']) fs.renameSync(path.join(d, f + '.new'), path.join(d, f));
      return true;
    } catch (err) { return false; }
  });
}

module.exports = { setupPro, check };
