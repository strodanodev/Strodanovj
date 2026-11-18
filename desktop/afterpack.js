// electron-builder afterPack hook: lock the packaged app, then (macOS) sign it ad hoc.
// Fuses (switches compiled into the Electron binary) close the ways into a shipped app's code:
//   RunAsNode off                 ELECTRON_RUN_AS_NODE cannot turn the app into a plain Node.js
//   NODE_OPTIONS / --inspect off  no injected scripts, no Node debugger on the main process
//   asar integrity on             the binary checks the hash of app.asar (where the page lives) on start, so edited
//                                 files stop the app instead of running
//   only load from asar           a loose resources/app folder next to it is ignored
// They are flipped here, not with package.json `electronFuses`, because electron-builder flips those after this hook,
// which would break the ad-hoc signature made below.
// The macOS app is not signed with a developer certificate, so it is signed ad hoc: Apple Silicon Macs refuse to start
// an app whose signature is broken (packaging and fuses change the Electron bundle) and report it as "damaged".
// Gatekeeper still asks on first start (right-click > Open, or System Settings > Privacy & Security > Open Anyway), as
// for any app downloaded without notarisation.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function afterPack(ctx) {
  const { FuseV1Options, FuseVersion } = await import('@electron/fuses');
  await ctx.packager.addElectronFuses(ctx, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  if (ctx.electronPlatformName !== 'darwin') return;
  const appPath = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
