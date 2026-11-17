# Strodano VJ

Open-source live-visuals (VJ) software with a built-in DJ mode: a layer/column clip grid, real-time effects and transitions, 3D visuals, camera and hand-gesture control, MIDI, and projection mapping. GPL-3.0.

Status: **0.2**. The desktop app for Windows and macOS is built and self-tested by GitHub Actions.

## Install (desktop app)

Download the installer for your system from **Releases**:

- Windows: `StrodanoVJ-<version>-win-x64.exe`
- Mac with Apple Silicon (M1 and later): `StrodanoVJ-<version>-mac-arm64.dmg`
- Mac with Intel: `StrodanoVJ-<version>-mac-x64.dmg`

macOS 12 (Monterey) or later; Windows 10 or later.

The installers are not code-signed. Windows SmartScreen: *More info > Run anyway*. macOS: the first time, right-click the app > *Open*, or allow it under *System Settings > Privacy & Security*. The app asks for camera access the first time you use the camera or hand tracking.

You can also run it without installing: open `web/index.html` in Chrome or Edge.

## What it does

See [`web/README.md`](web/README.md) for the full feature guide. In short:

- **Clip grid** of video, images, generators, text, camera and 3D (three.js) clips; layers with opacity, 8 blend modes, bypass, solo, A/B crossfader; beat-timed transitions (fade, wipes, dissolve, luma, iris...).
- **Clips**: in / out points, loop or play-once, and **beat sync** (a clip stretches to 1 beat ... 8 bars and follows the tempo).
- **Effects**: built-in, camera-reactive "smart" effects, custom GLSL and ISF shaders with a live editor. Any slider can follow a beat LFO, the music, the camera, your hands or a MIDI knob.
- **Control**: MIDI learn, keyboard shortcuts, **hand gestures** (MediaPipe), 8 **snapshots** (F1-F8), tap tempo.
- **DJ mode**: two decks with automatic tempo and beat-grid analysis; the visuals follow the music.
- **Output**: multiple screens and slices, corner-pin and mesh warping, masks, soft edges.
- **Show safety**: blackout (Shift+B), automatic recovery when the graphics driver resets, the display never sleeps, quitting asks first, autosave.

## Run and build from source

```sh
cd desktop
npm install
npm start                 # run the app
npm run selftest          # boot, shaders, output window, GPU-reset recovery; prints a JSON report
npm run dist:win          # or dist:mac: installers in desktop/dist
```

`desktop/` is a thin Electron wrapper; the app itself is `web/` (plain HTML + JavaScript, no build step). Releases come from `.github/workflows/desktop.yml`: a `v*` tag builds the installers on Windows and macOS and collects them in a **draft** release.

## Native edition (C++)

The rest of this repository is an earlier native edition (OpenGL 4.1, FFmpeg, Dear ImGui, FFGL 2.x plugin host). It is no longer the main product but still builds: `.github/workflows/build.yml` compiles it for Linux, Windows and macOS and keeps its installers as run artifacts.

```sh
# Linux (Debian/Ubuntu)
sudo apt install ninja-build libavcodec-dev libavformat-dev libswscale-dev libavutil-dev libglfw3-dev libgl1-mesa-dev
cmake -S . -B build -G Ninja && cmake --build build
./build/StrodanoVJ
```

FFGL plugins are scanned from `Documents/Strodano/Plugins`, `Documents/Resolume Arena/Extra Effects`, `Documents/Resolume Avenue/Extra Effects` and a `plugins` folder next to the app.

## License

GPL-3.0. See `LICENSE`. The desktop app uses Electron (MIT), three.js (MIT, `web/vendor/three-LICENSE.txt`) and MediaPipe (Apache-2.0, `web/vendor/mediapipe/LICENSE-Apache-2.0.txt`). The native edition uses FFmpeg, GLFW, Dear ImGui, glad and nlohmann/json under their own licenses.
