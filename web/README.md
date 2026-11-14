# Strodano VJ - web edition

Runs in Chrome or Edge with nothing to install or compile.

**Run it:** double-click `index.html`. **Change it:** edit a file, press F5.

- `shaders.js` - built-in effects and generators (add an entry, refresh, it appears in the lists)
- `engine.js` - WebGL2 engine: clips, mixing, effect chains, output mapping, save/load
- `ui.js` - interface and main loop
- `index.html` - layout and styles

Inside the app, **Shader Editor** compiles custom effects and generators as you type, and loads single-pass ISF shaders.

Limits of running in a browser: video codecs are whatever the browser plays (H.264 MP4/MOV yes; ProRes, HAP and DXV no), FFGL plugins cannot load, and after a page reload the clips must be relinked by adding the same files again.
