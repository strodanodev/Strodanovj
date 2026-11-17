// Fails the Mac build when the packaged app would not start on the oldest macOS we promise (build.mac.minimumSystemVersion).
// Electron raises its own minimum with Chromium (Electron 44 needs macOS 13), and a native module can raise it too, so this
// reads every Mach-O binary in the .app (fat or thin) and the Info.plist, not just the Electron version.
// Usage: node check-macos-min.js <path to .app or a folder holding .app bundles>
'use strict';
const fs = require('fs'), path = require('path');
const want = require('./package.json').build.mac.minimumSystemVersion;
const ver = s => s.split('.').map(Number);
const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const fmt = v => `${v >>> 16}.${(v >>> 8) & 255}`;

function machoMins(buf) {   // the minimum macOS of each slice (LC_BUILD_VERSION, or the older LC_VERSION_MIN_MACOSX)
  const magic = buf.readUInt32BE(0), slices = [];
  if (magic === 0xcafebabe) for (let i = 0, n = buf.readUInt32BE(4); i < n; i++) slices.push(buf.readUInt32BE(8 + i * 20 + 8));
  else if (magic === 0xcffaedfe) slices.push(0);
  const mins = [];
  for (const off of slices) {
    if (buf.readUInt32BE(off) !== 0xcffaedfe) continue;   // 64-bit little-endian slices only (arm64 / x64)
    let p = off + 32;
    for (let i = 0, n = buf.readUInt32LE(off + 16); i < n; i++) {
      const cmd = buf.readUInt32LE(p), size = buf.readUInt32LE(p + 4);
      if (cmd === 0x32 && buf.readUInt32LE(p + 8) === 1) mins.push(fmt(buf.readUInt32LE(p + 12)));   // platform 1 = macOS
      if (cmd === 0x24) mins.push(fmt(buf.readUInt32LE(p + 8)));
      p += size;
    }
  }
  return mins;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;   // framework Versions/Current links; the real files are walked once
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const root = process.argv[2];
if (!root) { console.error('usage: node check-macos-min.js <app or folder>'); process.exit(2); }
const apps = root.endsWith('.app') ? [root] : walk(root, []).filter(f => /\.app[\\/]Contents[\\/]Info\.plist$/.test(f) && !/\.app[\\/].*\.app[\\/]/.test(f)).map(f => path.dirname(path.dirname(f)));
if (!apps.length) { console.error(`No .app bundle under ${root}`); process.exit(2); }
let bad = 0;
for (const app of apps) {
  const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
  const ls = (plist.match(/<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)<\/string>/) || [])[1] || '(none)';
  if (ls === '(none)' || newer(ls, want)) { console.error(`${app}: Info.plist asks for macOS ${ls}`); bad++; }
  let bins = 0, highest = '0.0';
  for (const f of walk(app, [])) {
    let fd, head = Buffer.alloc(4);
    try { fd = fs.openSync(f, 'r'); fs.readSync(fd, head, 0, 4, 0); } catch (e) { continue; } finally { if (fd !== undefined) fs.closeSync(fd); }
    const m = head.readUInt32BE(0);
    if (m !== 0xcafebabe && m !== 0xcffaedfe) continue;
    bins++;
    for (const v of machoMins(fs.readFileSync(f))) {
      if (newer(v, highest)) highest = v;
      if (newer(v, want)) { console.error(`${path.relative(app, f)} needs macOS ${v}`); bad++; }
    }
  }
  console.log(`${path.basename(app)}: Info.plist macOS ${ls}, ${bins} binaries, the newest needs macOS ${highest} (promised: ${want})`);
}
if (bad) { console.error(`FAIL: ${bad} part(s) need a newer macOS than ${want}`); process.exit(1); }
console.log('OK');
