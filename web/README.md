# Strodano VJ - web edition

Runs in Chrome or Edge with nothing to install or compile.

**Run it:** double-click `index.html`. **Change it:** edit a file, press F5.

- `shaders.js` - built-in effects and generators (add an entry, refresh, it appears in the lists)
- `engine.js` - WebGL2 engine: clips, mixing, effect chains, output mapping, save/load
- `mediafolder.js` - remembered media folder: clips relink from it by file name on every start
- `midi.js` - MIDI control and learn mode
- `keys.js` - keyboard shortcuts (press **?** or click **Keys** for the list)
- `motion.js` - beat-synced LFOs on parameters, and clip transition lengths
- `analysis.js`, `audio.js`, `dj.js` - DJ mode: track analysis, the two decks and the music clock, and the deck panel
- `ui.js` - interface and main loop
- `index.html` - layout and styles

Inside the app, **Shader Editor** compiles custom effects and generators as you type, and loads single-pass ISF shaders.

**Media folder...** (Files tab) remembers a folder of clips. After a restart the browser may ask for permission again: click **Reconnect**.

**MIDI** (menu bar) turns on learn mode: click a fader, clip, column, button, effect parameter or generator parameter, then move a knob or press a pad. Esc finishes. Mappings are kept in the browser, listed in the Composition tab, and work for every composition. Effect and generator mappings follow the effect when the chain is reordered, and survive Save / Open.

**Keys:** 1-9, 0 trigger clips on the selected layer (Shift: whole column), Up/Down pick the layer, B / S / X bypass, solo, eject, Left/Right move the crossfader (Shift: all the way), Space taps tempo, R resyncs.

**LFOs:** click **~** next to any effect or generator slider to move it with the beat: pick a shape (sine, triangle, saw, square, random), how long one cycle lasts (1/4 beat to 4 bars) and the depth. The slider stays the centre value. LFOs follow tap tempo, or the music while a DJ deck plays, and are saved with the composition.

**Transitions:** in the Layer tab, **Transition** sets how long a newly triggered clip fades in over the old one (Cut, or 1/4 beat to 4 bars).

**DJ** (menu bar) opens two decks. Drop an audio file on a deck (or press Load): the tempo and beat grid are found automatically, and while a track plays the visuals follow its beat instead of the tapped tempo. **Sync** (on by default) matches a deck's tempo to the other deck and lines the bars up when you press Play. The A/B crossfader blends the two decks together with the layers set to A and B. Shaders can read the music: `bar`, `phrase`, `audio.xyzw` (bass, mid, high, level) and `kick`; try the **Audio Pulse** effect and the **Audio Rings** source. Changing a deck's tempo changes its pitch (no key lock yet).

Limits of running in a browser: video codecs are whatever the browser plays (H.264 MP4/MOV yes; ProRes, HAP and DXV no), FFGL plugins cannot load, and without a media folder the clips must be relinked after a reload by adding the same files again.
