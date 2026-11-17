// electron-builder afterPack hook: the macOS app is not signed with a developer certificate, so sign it ad hoc.
// Apple Silicon Macs refuse to start an app whose signature is broken (packaging changes the Electron bundle), and report it
// as "damaged"; an ad-hoc signature fixes that. Gatekeeper still asks on first start (right-click > Open, or System
// Settings > Privacy & Security > Open Anyway), as for any app downloaded without notarisation.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const appPath = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
