// Strodano VJ - builds web/pro/pro.js, the Pro and Festival features, from the private repo. GPL-3.0 (this script).
// The features themselves are closed source (strodanodev/strodano-vj-premium, private). This joins its files, in the
// order its pro.json gives, into one classic script that sets window.SVJ_PRO (plan.js proLoaded) and is loaded by
// index.html and mobile.html. Without it the app runs with the Free features only.
//
//   node tools/pro.mjs                 build from ../strodano-vj-premium (beside this repo), minified
//   node tools/pro.mjs --src <dir>     build from another checkout (CI: the private repo checked out into the workspace)
//   node tools/pro.mjs --dev           build without minifying (readable stack traces)
//   node tools/pro.mjs --watch         build again whenever a file there changes (development: edit, then reload; --dev)
//   node tools/pro.mjs --clean         remove web/pro (test the Free build)
//
// Released apps do not contain it: tools/build-mobile.mjs builds it, signs it and publishes it behind vj.strodano.live/premium/,
// where apps on a paid plan download it (web/prodl.js). Development (npm start, a localhost page, CI's selftest) loads
// web/pro/pro.js directly.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'web', 'pro'), OUT = path.join(OUT_DIR, 'pro.js');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SRC = path.resolve(opt('--src') || process.env.SVJ_PRO_SRC || path.join(ROOT, '..', 'strodano-vj-premium'));

if (args.includes('--clean')) { rmSync(OUT_DIR, { recursive: true, force: true }); console.log('pro: removed web/pro (Free build)'); process.exit(0); }

// The official bundle is minified with esbuild (from desktop/node_modules: run npm ci in desktop/ first). Top-level names
// stay as they are, because the core calls them; everything inside functions is renamed and every comment goes.
function minify(code) {
  let esbuild;
  try { esbuild = createRequire(path.join(ROOT, 'desktop', 'package.json'))('esbuild'); }
  catch (e) { throw new Error('pro: esbuild is missing: run npm ci in desktop/ (or build with --dev)'); }
  return esbuild.transformSync(code, { minify: true, target: 'es2022', legalComments: 'none', charset: 'utf8' }).code;
}

export function buildPro(src = SRC, { dev = false } = {}) {
  const manifest = path.join(src, 'pro.json');
  if (!existsSync(manifest)) throw new Error(`pro: no private repo at ${src} (pro.json missing). Clone strodanodev/strodano-vj-premium beside this repo, or pass --src.`);
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  const parts = m.files.map(f => {
    const p = path.join(src, f);
    if (!existsSync(p)) throw new Error('pro: ' + f + ' is listed in pro.json but missing');
    return `// ---- ${path.basename(f)} ----\n` + readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/^'use strict';\s*$/m, '').trimEnd() + '\n';
  });
  const body = `'use strict';\nwindow.SVJ_PRO = { version: ${JSON.stringify(m.version)}, files: ${m.files.length}${dev ? ', dev: true' : ''} };\n` + parts.join('\n');
  const head = `// Strodano VJ Pro ${m.version}. All Rights Reserved STRODANO 2027. Not open source: no permission to copy, modify\n` +
    `// or redistribute. Built ${new Date().toISOString()} by tools/pro.mjs.\n`;
  const out = head + (dev ? body : minify(body));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, out);
  return { version: m.version, files: m.files.length, bytes: Buffer.byteLength(out), dev };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dev = args.includes('--dev') || args.includes('--watch');
  const run = () => {
    try { const r = buildPro(SRC, { dev }); console.log(`pro: web/pro/pro.js ${r.version}, ${r.files} files, ${(r.bytes / 1024).toFixed(0)} KB, ${r.dev ? 'not minified' : 'minified'}`); return true; }
    catch (e) { console.error(e.message); return false; }
  };
  const ok = run();
  if (args.includes('--watch')) {
    let t = null;
    watch(SRC, { recursive: true }, (ev, f) => { if (!f || !/\.(js|json)$/.test(f)) return; clearTimeout(t); t = setTimeout(run, 150); });
    console.log('pro: watching ' + SRC);
  } else if (!ok) process.exit(1);
}
