# Strodano VJ

Open-source, lightweight live-visuals (VJ) software: a layer/column clip grid, real-time effects, FFGL plugin support and projection mapping. GPL-3.0.

Status: **0.1, early**. It builds and passes a headless self-test on Linux in CI; the Windows and macOS installers are produced by GitHub Actions.

## Two editions

- **`web/`** - the main edition for now. Open `web/index.html` in Chrome or Edge: no install, no build, edit and refresh. See `web/README.md`.
- **Native (C++)** - the rest of this repository. Adds FFmpeg decoding and the FFGL plugin host; needs a build.

The sections below describe the native edition.

## Features

- **Clip grid**: layers (rows) and columns. Click a clip to trigger it, click a column header to trigger the whole column. Drag video files in from the OS or the built-in file browser.
- **Video**: H.264 MP4 and MOV (plus anything else FFmpeg decodes, including ProRes and HAP, and still images). Each clip decodes on its own thread and a new clip only takes over once its first frame is ready, so triggering never stalls the output.
- **Mixing**: per-layer opacity fader, 8 blend modes, bypass, solo, eject, A/B crossfader assignment, master fader, layer scale/position.
- **BPM**: tap tempo, resync, beat-synced effects.
- **20 built-in effects** and **8 built-in generators** (GLSL), on layers and on the whole composition.
- **FFGL 2.x plugin host**: loads the same FFGL effect and source plugins Resolume uses.
- **Advanced output**: multiple screens (one per display), multiple slices per screen, input cropping, corner-pin (perspective) warping, mesh warping, masks, soft edges, test pattern.
- **Save / open** compositions (`.svj`, JSON). The last session is restored on start.

## Install

Download the installer for your system from the latest run under **Actions** (or from **Releases** once a version is tagged):

- Windows: `StrodanoVJ-<version>-windows-x64-setup.exe`
- macOS: `StrodanoVJ-<version>-macos-arm64.dmg` (Apple Silicon) or `-x86_64.dmg` (Intel)

The installers are not code-signed. Windows SmartScreen: *More info → Run anyway*. macOS: right-click the app → *Open* (or allow it under *System Settings → Privacy & Security*).

Requires a GPU with OpenGL 4.1.

## FFGL plugins

Plugins are scanned from:

- `Documents/Strodano/Plugins`
- `Documents/Resolume Arena/Extra Effects` and `Documents/Resolume Avenue/Extra Effects` (so an existing collection is picked up)
- a `plugins` folder next to where the app is started

Only FFGL 2.x plugins are supported, and the plugin must match the app's architecture (64-bit Windows `.dll`; on macOS a `.bundle` built for arm64 or x86_64 to match the app). Text and file parameters are not exposed yet. Resolume Wire patches and the DXV codec are proprietary and are not supported.

## Build from source

Needs CMake 3.21+, a C++17 compiler and FFmpeg development libraries. GLFW, Dear ImGui and nlohmann/json are fetched by CMake.

```sh
# Linux (Debian/Ubuntu)
sudo apt install ninja-build libavcodec-dev libavformat-dev libswscale-dev libavutil-dev libglfw3-dev libgl1-mesa-dev
cmake -S . -B build -G Ninja && cmake --build build
./build/StrodanoVJ
```

Windows and macOS: see `.github/workflows/build.yml` for the exact steps the installers are built with.

`StrodanoVJ --selftest <outdir> [video]` renders a fixed scene for 180 frames, writes screenshots and exits; CI uses it as a smoke test.

## Not there yet

Audio playback, MIDI/OSC control, clip transitions, per-clip effects, hardware video decoding, FFGL mixers, keyboard shortcuts, native file dialogs.

## License

GPL-3.0. See `LICENSE`. Uses FFmpeg, GLFW, Dear ImGui, glad and nlohmann/json under their own licenses. The FFGL plugin interface follows the FreeFrame GL specification.
