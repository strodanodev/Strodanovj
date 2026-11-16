# Strodano VJ - project notes for Claude Code

Open-source, lightweight Resolume-style live-visuals (VJ) app. GPL-3.0. Owner: Sedano (strodanodev/Strodanovj).

## Two editions in this repo

- `web/` - **the edition under active development.** Plain HTML + classic scripts, WebGL2, no build step, no dependencies. Open `web/index.html` in Chrome/Edge; edit and refresh. Must keep working from `file://` (so: no ES modules, no fetch of local files, no bundler).
  - `shaders.js` built-in effects/generators (`vec4 fx()` / `vec4 gen()`, params 0..1 in `p`/`q`)
  - `engine.js` GL helpers, shader registry (built-in, custom, single-pass ISF), media pool, composition, renderer, output mapping (slices, homography corner-pin, mesh warp, masks), save/load
  - `mediafolder.js` remembered media folder (File System Access API; handle kept in IndexedDB, Reconnect button when permission lapses)
  - `midi.js` Web MIDI + learn mode. Mappable controls carry `data-midi="<target id>"` (`master`, `crossfade`, `tap`, `resync`, `column:C`, `clip:L:C`, `layer:L:opacity|bypass|solo|eject`); mappings live in localStorage, app-wide
  - `ui.js` DOM UI, Advanced Output editor, Shader Editor, autosave (localStorage), main loop (exactly one rAF request outstanding; the watchdog must never add a second)
- Native C++ (`src/`, `CMakeLists.txt`) - OpenGL 4.1 + FFmpeg + Dear ImGui + FFGL 2.x plugin host. Kept as the later native/FFGL edition. `.github/workflows/build.yml` builds the Windows NSIS installer and macOS .dmg; first run (2026-11-17) was green on Linux, Windows and both macOS architectures.

## Decisions already made

- Web first, because the owner wants to test without installing/compiling and change code live. FFGL plugins are dropped in the web edition; ISF/GLSL shaders replace them.
- Same workflow and panel arrangement as Resolume (layer/column clip grid, faders, B/S/X, A/B crossfader, BPM tap, effects, advanced output) but its own visual design, not a pixel copy.
- v1 scope: core VJ features + advanced mapping (multiple screens/slices, warping, masks). Since added: media folder, MIDI learn. Not yet: audio, OSC, keyboard shortcuts, clip transitions, per-clip effects, MIDI on effect parameters.
- Hard requirement: steady 30 fps or better with H.264 MP4 / .mov clips.

## State of testing

- Web: measured on a real GPU (RTX 3080 Ti, 2026-11-17): 3 x 1080p video layers with effects composite in ~1.3 ms, a 1080p output window costs ~1.5 ms (4K ~4.1 ms), so the `drawImage` copy path is not a bottleneck. Media folder tested with an OPFS folder, MIDI with synthetic messages. **Still never used by hand** (drag from Explorer, real pop-up output on a second display, a real MIDI controller, the real folder picker).
- Native: CI builds Linux (`--selftest`), Windows installer and macOS arm64/x86_64 .dmg. Installers never run by hand.

## Known gaps / next steps

1. Hand test: output window fullscreen on a second display, a real MIDI controller, the real folder picker, drag from Explorer.
2. Keyboard shortcuts, audio-reactive input (FFT uniforms + parameter modulation), clip transitions, BPM-synced LFOs on parameters.
3. Re-upload video only on new frames (`requestVideoFrameCallback`); stop rebuilding the whole clip grid while a fader is dragged.
4. Installers for the web edition would need a desktop wrapper (Electron/Tauri).

## Testing the web edition headlessly

Playwright + Chrome with `--use-angle=swiftshader --enable-unsafe-swiftshader --autoplay-policy=no-user-gesture-required`; `window.strodano.checkShaders()` returns the list of shaders that fail to compile.
