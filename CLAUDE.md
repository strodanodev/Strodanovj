# Strodano VJ - project notes for Claude Code

Open-source, lightweight Resolume-style live-visuals (VJ) app. GPL-3.0. Owner: Sedano (strodanodev/Strodanovj).

## Two editions in this repo

- `web/` - **the edition under active development.** Plain HTML + classic scripts, WebGL2, no build step, no dependencies. Open `web/index.html` in Chrome/Edge; edit and refresh. Must keep working from `file://` (so: no ES modules, no fetch of local files, no bundler).
  - `shaders.js` built-in effects/generators (`vec4 fx()` / `vec4 gen()`, params 0..1 in `p`/`q`)
  - `engine.js` GL helpers, shader registry (built-in, custom, single-pass ISF), media pool, composition, renderer, output mapping (slices, homography corner-pin, mesh warp, masks), save/load
  - `ui.js` DOM UI, Advanced Output editor, Shader Editor, autosave (localStorage), main loop
- Native C++ (`src/`, `CMakeLists.txt`) - OpenGL 4.1 + FFmpeg + Dear ImGui + FFGL 2.x plugin host. Kept as the later native/FFGL edition. `.github/workflows/build.yml` builds the Windows NSIS installer and macOS .dmg; **it has never run** (nothing has been pushed yet), so expect fixes on first CI run.

## Decisions already made

- Web first, because the owner wants to test without installing/compiling and change code live. FFGL plugins are dropped in the web edition; ISF/GLSL shaders replace them.
- Same workflow and panel arrangement as Resolume (layer/column clip grid, faders, B/S/X, A/B crossfader, BPM tap, effects, advanced output) but its own visual design, not a pixel copy.
- v1 scope: core VJ features + advanced mapping (multiple screens/slices, warping, masks). Not yet: audio, MIDI/OSC, clip transitions, per-clip effects.
- Hard requirement: steady 30 fps or better with H.264 MP4 / .mov clips.

## State of testing

- Web: verified in headless Chrome with software GL only - all shaders compile, H.264 .mp4 and .mov play, custom + ISF shaders compile, output window renders warped/masked picture, save/load round-trips. **Never measured on a real GPU and never used by hand** (drag from Explorer, fullscreen on a second display, Save download).
- Native: builds and passes `--selftest` on Linux (llvmpipe), including two FFGL SDK example plugins. Never compiled on Windows or macOS.

## Known gaps / next steps

1. Measure real frame rate in the web edition with several 1080p clips; previews and output windows copy from a hidden WebGL canvas via `drawImage`, which is the first place to look if it is slow.
2. Clips must be relinked after a page reload (browser cannot reopen local files); consider the File System Access API to remember a media folder.
3. Installers for the web edition would need a desktop wrapper (Electron/Tauri).
4. Push this repo to GitHub and get the native CI green.

## Testing the web edition headlessly

Playwright + Chrome with `--use-angle=swiftshader --enable-unsafe-swiftshader --autoplay-policy=no-user-gesture-required`; `window.strodano.checkShaders()` returns the list of shaders that fail to compile.
