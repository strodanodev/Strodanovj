// Strodano VJ - builds web/pro/pro.js, the Pro and Festival features, from the private repo. GPL-3.0 (this script).
// The features themselves are closed source (strodanodev/strodano-vj-premium, private). This joins its files, in the
// order its pro.json gives, into one classic script that sets window.SVJ_PRO (plan.js proLoaded) and is loaded by
// index.html and mobile.html. Without it the app runs with the Free features only.
//
//   node tools/pro.mjs                 build from ../strodano-vj-premium (beside this repo)
//   node tools/pro.mjs --src <dir>     build from another checkout (CI: the private repo checked out into the workspace)
//   node tools/pro.mjs --watch         build again whenever a file there changes (development: edit, then reload)
//   node tools/pro.mjs --clean         remove web/pro (test the Free build)
//
// The official builds call it first (desktop: npm run dist:*, phone: tools/build-mobile.mjs, CI: desktop.yml) and fail
// when the private repo is missing, so a release never ships without its paid features by accident.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'web', 'pro'), OUT = path.join(OUT_DIR, 'pro.js');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SRC = path.resolve(opt('--src') || process.env.SVJ_PRO_SRC || path.join(ROOT, '..', 'strodano-vj-premium'));

if (args.includes('--clean')) { rmSync(OUT_DIR, { recursive: true, force: true }); console.log('pro: removed web/pro (Free build)'); process.exit(0); }

export function buildPro(src = SRC) {
  const manifest = path.join(src, 'pro.json');
  if (!existsSync(manifest)) throw new Error(`pro: no private repo at ${src} (pro.json missing). Clone strodanodev/strodano-vj-premium beside this repo, or pass --src.`);
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  const parts = m.files.map(f => {
    const p = path.join(src, f);
    if (!existsSync(p)) throw new Error('pro: ' + f + ' is listed in pro.json but missing');
    return `// ---- ${path.basename(f)} ----\n` + readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/^'use strict';\s*$/m, '').trimEnd() + '\n';
  });
  const head = `// Strodano VJ Pro ${m.version}. Copyright (c) 2026 Strodano. All rights reserved. Not open source: see the licence\n` +
    `// in strodanodev/strodano-vj-premium. Built ${new Date().toISOString()} by tools/pro.mjs.\n'use strict';\n` +
    `window.SVJ_PRO = { version: ${JSON.stringify(m.version)}, files: ${m.files.length} };\n`;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, head + parts.join('\n'));
  return { version: m.version, files: m.files.length, bytes: Buffer.byteLength(head + parts.join('\n')) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const run = () => { try { const r = buildPro(); console.log(`pro: web/pro/pro.js ${r.version}, ${r.files} files, ${(r.bytes / 1024).toFixed(0)} KB`); return true; } catch (e) { console.error(e.message); return false; } };
  const ok = run();
  if (args.includes('--watch')) {
    let t = null;
    watch(SRC, { recursive: true }, (ev, f) => { if (!f || !/\.(js|json)$/.test(f)) return; clearTimeout(t); t = setTimeout(run, 150); });
    console.log('pro: watching ' + SRC);
  } else if (!ok) process.exit(1);
}
