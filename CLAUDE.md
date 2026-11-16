# Strodano VJ - project notes for Claude Code

Open-source, lightweight Resolume-style live-visuals (VJ) app. GPL-3.0. Owner: Sedano (strodanodev/Strodanovj).

## Two editions in this repo

- `web/` - **the edition under active development.** Plain HTML + classic scripts, WebGL2, no build step, no dependencies. Open `web/index.html` in Chrome/Edge; edit and refresh. Must keep working from `file://` (so: no ES modules, no fetch of local files, no bundler).
  - `shaders.js` built-in effects/generators (`vec4 fx()` / `vec4 gen()`, params 0..1 in `p`/`q`)
  - `engine.js` GL helpers, shader registry (built-in, custom, single-pass ISF), media pool, composition, renderer, output mapping (slices, homography corner-pin, mesh warp, masks), save/load
  - `mediafolder.js` remembered media folder (File System Access API; handle kept in IndexedDB, Reconnect button when permission lapses)
  - `midi.js` Web MIDI + learn mode. Mappable controls carry `data-midi="<target id>"` (`master`, `crossfade`, `tap`, `resync`, `column:C`, `clip:L:C`, `layer:L:opacity|bypass|solo|eject`, `fx:<uid>:<param>|mix|bypass`, `gen:<uid>:<param>`); effects and generator clips carry a `uid` saved in the .svj so mappings follow them; mappings live in localStorage, app-wide
  - `keys.js` keyboard shortcuts on `KeyboardEvent.code`, capture phase; ignored while typing, in the Shader Editor, or with Ctrl/Cmd/Alt
  - `motion.js` beat-synced LFOs (`owner.mod[paramIndex] = {shape, rate, depth}` on effects and generator clips, applied at render time by `modParams`, so the saved slider value stays the centre) and the beat lengths for clip transitions. Transitions themselves are in `engine.js` (`switchActive` / `applyTransition`: the outgoing clip keeps playing and fades out over `L.trans` beats into `L.tf`)
  - `analysis.js` track analysis (`analyseTrack`: BPM, beat grid `grid0` + `beatLen`, first beat of the bar, waveform peaks). Self-contained, because its source is also run in a Worker made from a Blob URL (the only worker that loads from `file://`)
  - `audio.js` DJ audio: two decks on decoded buffers (sample-locked sync; tempo changes pitch, no key lock), the music clock (`musicClock`, which sets `comp.beats` / `comp.bpm` from the audible deck's position while a track plays), live levels in `audioFeat` (shader uniforms `audio.xyzw` = bass, mid, high, level, and `kick`; plus `bar`, `phrase`). The AudioContext is created on first Load/Play, never at page load
  - `analysis.js` also returns `key` / `camelot`, `loudDb` (auto-gain), `flux` (energy) and `mixIn` / `mixOut` / `beatEnd` (seconds: first beat, start of the outro on an 8-bar phrase, last beat)
  - `crate.js` DJ track list: analyses each track once and caches it in IndexedDB `strodano-vj-tracks` by name + size + date (bump `ANALYSIS_VERSION` when `analyseTrack`'s output changes); energy 1..10 relative to the list; next-track suggestions by tempo gap, Camelot key and energy. Audio files in the media folder join the list
  - `mix.js` auto-mix (Mix button: blend, bass swap, echo out, cut; starts on the next phrase or bar, timed in the outgoing deck's beats from `deckPos`, drives `comp.crossfade`), autopilot, and beat-quantised clip launches (`quantHold`, called at the top of `trigger()` in engine.js; a held trigger fires later through `trigger()` again). Runs from `audioTick()`, plus a timer when no window gives frames
  - `dj.js` DJ panel (decks, waveforms, beat grid, mixer row, track list). Built once and refreshed in place from `tickDJ()`, not through the dirty-flag rebuilds. MIDI targets `deck:A|B:play|cue|sync|volume|tempo|bass|load`, `deck:mix:go|auto`
  - `ui.js` DOM UI, Advanced Output editor, Shader Editor, autosave (localStorage), main loop (exactly one rAF request outstanding; the watchdog must never add a second)
- Native C++ (`src/`, `CMakeLists.txt`) - OpenGL 4.1 + FFmpeg + Dear ImGui + FFGL 2.x plugin host. Kept as the later native/FFGL edition. `.github/workflows/build.yml` builds the Windows NSIS installer and macOS .dmg; first run (2026-11-17) was green on Linux, Windows and both macOS architectures.

## Decisions already made

- Web first, because the owner wants to test without installing/compiling and change code live. FFGL plugins are dropped in the web edition; ISF/GLSL shaders replace them.
- Same workflow and panel arrangement as Resolume (layer/column clip grid, faders, B/S/X, A/B crossfader, BPM tap, effects, advanced output) but its own visual design, not a pixel copy.
- v1 scope: core VJ features + advanced mapping (multiple screens/slices, warping, masks). Since added: media folder, MIDI learn (including effect and generator parameters), keyboard shortcuts, beat LFOs on parameters, beat-timed clip transitions (cross-fade). Not yet: OSC, other transition types (wipes), per-clip effects, audio levels as a modulation source for sliders.
- Hard requirement: steady 30 fps or better with H.264 MP4 / .mov clips.

## State of testing

- Web: measured on a real GPU (RTX 3080 Ti, 2026-11-17): 3 x 1080p video layers with effects composite in ~1.3 ms, a 1080p output window costs ~1.5 ms (4K ~4.1 ms), so the `drawImage` copy path is not a bottleneck. Media folder tested with an OPFS folder, MIDI with synthetic messages. **Still never used by hand** (drag from Explorer, real pop-up output on a second display, a real MIDI controller, the real folder picker).
- Native: CI builds Linux (`--selftest`), Windows installer and macOS arm64/x86_64 .dmg. Installers never run by hand.

## Known gaps / next steps

1. Hand test: output window fullscreen on a second display, a real MIDI controller, the real folder picker, drag from Explorer.
2. Wipe / other transition types; audio levels (`audioFeat`) as an LFO-like modulation source on sliders.
3. Re-upload video only on new frames (`requestVideoFrameCallback`). (Panels are no longer rebuilt while a slider in them is held; faders mirror each other through `reflectMidi` instead of a grid rebuild.)
4. Installers for the web edition would need a desktop wrapper (Electron/Tauri).

## Testing the web edition headlessly

Playwright + Chrome with `--use-angle=swiftshader --enable-unsafe-swiftshader --autoplay-policy=no-user-gesture-required`; `window.strodano.checkShaders()` returns the list of shaders that fail to compile.
