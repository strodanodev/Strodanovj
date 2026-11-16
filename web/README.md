# Strodano VJ - web edition

Runs in Chrome or Edge with nothing to install or compile.

**Run it:** double-click `index.html`. **Change it:** edit a file, press F5.

- `shaders.js` - built-in effects and generators (add an entry, refresh, it appears in the lists)
- `engine.js` - WebGL2 engine: clips, mixing, effect chains, output mapping, save/load
- `mediafolder.js` - remembered media folder: clips relink from it by file name on every start
- `midi.js` - MIDI control and learn mode
- `ui.js` - interface and main loop
- `index.html` - layout and styles

Inside the app, **Shader Editor** compiles custom effects and generators as you type, and loads single-pass ISF shaders.

**Media folder...** (Files tab) remembers a folder of clips. After a restart the browser may ask for permission again: click **Reconnect**.

**MIDI** (menu bar) turns on learn mode: click a fader, clip, column or button, then move a knob or press a pad. Esc finishes. Mappings are kept in the browser, listed in the Composition tab, and work for every composition.

Limits of running in a browser: video codecs are whatever the browser plays (H.264 MP4/MOV yes; ProRes, HAP and DXV no), FFGL plugins cannot load, and without a media folder the clips must be relinked after a reload by adding the same files again.
