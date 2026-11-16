# Strodano VJ - web edition

Runs in Chrome or Edge with nothing to install or compile.

**Run it:** double-click `index.html`. **Change it:** edit a file, press F5.

- `shaders.js` - built-in effects and generators (add an entry, refresh, it appears in the lists)
- `engine.js` - WebGL2 engine: clips, mixing, effect chains, output mapping, save/load
- `mediafolder.js` - remembered media folder: clips relink from it by file name on every start
- `midi.js` - MIDI control and learn mode
- `keys.js` - keyboard shortcuts (press **?** or click **Keys** for the list)
- `motion.js` - beat-synced LFOs on parameters, and clip transition lengths
- `camera.js`, `text.js`, `smart3d.js` - camera clips and camera input, text clips, 3D generators (three.js, in `vendor/`)
- `analysis.js`, `audio.js`, `crate.js`, `mix.js`, `score.js`, `cues.js`, `follow.js`, `dj.js` - DJ mode: track analysis, the two decks and the music clock, the track list, auto-mix and autopilot, and the deck panel
- `ui.js` - interface and main loop
- `index.html` - layout and styles

Inside the app, **Shader Editor** compiles custom effects and generators as you type, and loads single-pass ISF shaders.

**Media folder...** (Files tab) remembers a folder of clips. After a restart the browser may ask for permission again: click **Reconnect**.

**MIDI** (menu bar) turns on learn mode: click a fader, clip, column, button, effect parameter or generator parameter, then move a knob or press a pad. Esc finishes. Mappings are kept in the browser, listed in the Composition tab, and work for every composition. Effect and generator mappings follow the effect when the chain is reordered, and survive Save / Open.

**Keys:** 1-9, 0 trigger clips on the selected layer (Shift: whole column), Up/Down pick the layer, B / S / X bypass, solo, eject, Left/Right move the crossfader (Shift: all the way), Space taps tempo, R resyncs.

**LFOs:** click **~** next to any effect or generator slider to move it with the beat: pick a shape (sine, triangle, saw, square, random), how long one cycle lasts (1/4 beat to 4 bars) and the depth. The slider stays the centre value. LFOs follow tap tempo, or the music while a DJ deck plays, and are saved with the composition.

**Transitions:** in the Layer tab, **Transition** sets how a newly triggered clip replaces the old one (Fade, Wipe right / left / up / down, Dissolve, Luma, Through black, Zoom, Iris) and how long it takes (Cut, or 1/4 beat to 4 bars).

**Camera** (Sources tab): drag **Camera clip** onto a slot to show a live camera. **Use as input** analyses the camera so the show reacts to the performer: how much is moving, where, and how bright it is. Effects marked **(cam)** follow it by themselves (Follow Spot, Motion Glitch, Motion Zoom, Camera Key, Camera Displace, Camera Mix), and any slider can follow it: click **~** and pick Camera motion, Camera X, Camera Y or Camera light. Shaders read `cam` (motion, x, y, light) and `camTex`.

**Text** (Sources tab): titles, names or lyrics, one line per cue. Lines move on with **N** (Shift+N goes back), Next line, or automatically every beat / bar / phrase. Animations: pulse on beat, kick bounce, typewriter, scroll, one word per beat, strobe, fade in. Size, position, colour and outline are sliders, so they take LFOs and MIDI.

**3D** (Sources tab): Wire Sphere, Particle Storm, Cube Tunnel, Wave Grid and Neon Knot, made with three.js. They follow the beat and the music, and their Camera sliders react to the camera input.

**DJ** (menu bar) opens two decks. Drop an audio file on a deck (or press Load): the tempo and beat grid are found automatically, and while a track plays the visuals follow its beat instead of the tapped tempo. **Sync** (on by default) matches a deck's tempo to the other deck and lines the bars up when you press Play. The A/B crossfader blends the two decks together with the layers set to A and B. Shaders can read the music: `bar`, `phrase`, `audio.xyzw` (bass, mid, high, level) and `kick`; try the **Audio Pulse** effect and the **Audio Rings** source. Changing a deck's tempo changes its pitch (no key lock yet).

**Mixing for beginners:** drop a folder's worth of tracks on **Tracks** (or use a media folder): each one's tempo, key (Camelot) and energy are worked out once and remembered. While a track plays, the list ranks the others as the next track (Great / Good / OK / Hard, hover for why). Load one into the other deck and press **Mix**: on the next phrase it brings the new track in, in time, with the chosen style (Smooth blend, Bass swap, Echo out, Cut) and length, and the crossfader moves the A/B layers with it. Tracks too far apart in tempo get an echo out instead of a blend. Waveforms mark **MIX IN** and **OUTRO**, and the deck header counts down to the outro. **Autopilot** plays the list by itself, mixing each track in at the previous one's outro. **Clips on bar / beat** makes clip launches wait for the music; **Auto-gain** plays every track at the same loudness; **Own tempo after mix** lets a matched track drift back to its own tempo. Moving the crossfader during a mix hands it to you.

**Song sections and section looks:** every analysed track is split into intro, build, drop, breakdown and outro, shown as a coloured band under each waveform; the deck header counts down to the next drop. Set up the visuals you want for a drop, then press **Drop** in the **Section looks** row (or **Save**); do the same for the other sections and turn on **Auto-score**. Each look then comes back on the first bar of that section in every track, gliding in over the chosen time. Any slider's **~** button can also follow the music instead of a beat LFO: **Kick**, **Bass**, **Mids**, **Highs**, **Loudness**, **Build-up** (rises through each build) or **In drop** (up during drops). Section looks are saved with the composition.

**Track scores:** play a track, press **Rec** in the **Track score** row and perform: every clip, column, fader and effect slider you touch (mouse or MIDI controller) is kept against that track's beats, and plays back every time the track plays, at any tempo, from any point, in any mix. Record again to overdub (only what you touch is replaced); **Undo pass** takes the last pass back. Cues show as ticks on the waveform. Scores are saved with the composition. **During a mix:** save a **Mix** look in the Section looks row to have it come in while an auto-mix runs, and use **Mix progress** or **Mid-mix** on any slider's **~** button to move it with the transition. **External gear:** send MIDI clock from CDJs / Traktor / a drum machine and the visuals follow it when no deck plays. Or turn on **Line-in** and **Recognise tracks**: once a track from the list has played for a while (usually 30-60 s, across a section change) it is recognised with its position, so its sections, section looks and track score run as if it were on a deck. Recognition is a best guess and shows how sure it is; **Forget** drops it.

**Agent** (the robot in the sidebar) is an autopilot for the visuals. Pick what it listens to: the **DJ decks**, a **microphone / line-in** (music from any player or a DJ booth), or a **music file** (MP3, WAV, M4A, or a recorded mix as MP4, even an hour long). Turn the **Agent ON** and it picks looks by itself: colours from the song's key, motion from its tempo and energy, a new look when the song changes, a hard cut to a peak look on each drop (with DJ deck tracks it sees the drop coming: flashes rise through the build and the picture drops to near-black for the last two beats), calm looks in breakdowns and small variations every few bars. No programming needed. **Next look**, **Hold** and **Drop!** steer it. Trigger any clip yourself and it steps aside for 8 bars. To pre-program a set, put your clips in columns, tag the columns **Calm / Groove / Peak / Drop**, and set Visuals to **My clip columns** (or **Both**).

**Record** saves the output with its sound as a video file (MP4 in current Chrome and Edge, otherwise WebM), up to one hour, written straight to disk. **Render music file** plays the open file from the start with the Agent directing and saves the whole thing; **Render track list** does the same with the DJ track list mixed by autopilot. Rendering runs in real time: keep the window visible, or open the output window, until it finishes. **Strobe on drops** adds flashing light: off by default (photosensitive epilepsy).

Limits of running in a browser: video codecs are whatever the browser plays (H.264 MP4/MOV yes; ProRes, HAP and DXV no), FFGL plugins cannot load, and without a media folder the clips must be relinked after a reload by adding the same files again.
