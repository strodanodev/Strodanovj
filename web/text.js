// Strodano VJ (web) - text clips: titles, names, lyrics. GPL-3.0.
// Each line of the text is one cue; lines advance by hand (N key, Next line) or on the beat. The visible line is drawn
// once into a canvas (fill in red, outline in green, so colours can change without redrawing) and only redrawn when the
// words shown change. Size, position, colour and the animations are applied on the GPU every frame, so the sliders work
// with the ~ LFOs / music / camera sources and with MIDI like any generator.
'use strict';
const TEXT_FONTS = ['Inter', 'Arial Black', 'Impact', 'Georgia', 'Courier New', 'Trebuchet MS', 'Verdana', 'Segoe UI'];
const TEXT_ANIMS = ['None', 'Pulse on beat', 'Kick bounce', 'Typewriter', 'Scroll', 'One word per beat', 'Strobe', 'Fade in each line'];
const TEXT_ADVANCE = [[0, 'By hand (N key)'], [1, 'Every beat'], [4, 'Every bar'], [8, 'Every 2 bars'], [16, 'Every 4 bars'], [32, 'Every phrase']];
const TEXT_PARAMS = [P('Size', 0.5), P('X', 0.5), P('Y', 0.5), P('Hue', 0), P('Saturation', 0), P('Brightness', 1), P('Outline', 0.4), P('Speed', 0.5)];
const textProg = mkProg(HEAD + `uniform sampler2D tex; uniform float scl; uniform vec2 off; uniform float wr; uniform vec3 fillCol; uniform vec3 lineCol;
uniform float outline; uniform float reveal; uniform float alpha; uniform vec2 bx; in vec2 uv; out vec4 o;
void main(){ vec2 p = (uv - 0.5 - off) / scl; vec2 s = vec2(p.x / wr + 0.5, p.y + 0.5);
 if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { o = vec4(0.0); return; }
 vec4 c = texture(tex, s); float fw = c.r / max(c.r + c.g, 1e-4);
 float fa = c.a * fw, la = c.a * (1.0 - fw) * outline;
 float rv = 1.0 - smoothstep(reveal - 0.02, reveal, (s.x - bx.x) / max(bx.y - bx.x, 1e-4));
 float a = (fa + la) * rv * alpha;
 o = vec4((fillCol * fa + lineCol * la) / max(fa + la, 1e-4), a); }`);

function hsv(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const textLines = c => { const l = String(c.text || '').split('\n').map(s => s.trim()).filter(Boolean); return l.length ? l : ['']; };
function textShown(c) {
  const lines = textLines(c), n = lines.length;
  const idx = c.advance > 0 ? ((Math.floor(comp.beats / c.advance) % n) + n) % n : ((c.line % n) + n) % n;
  let s = lines[idx];
  if (c.anim === 5) { const w = s.split(/\s+/).filter(Boolean); s = w.length ? w[((Math.floor(comp.beats) % w.length) + w.length) % w.length] : ''; }
  return { idx, s };
}
function textRender(c, s) {
  const cv = c.cv || (c.cv = document.createElement('canvas')), x = cv.getContext('2d');
  const px = Math.round(comp.h * 0.14), pad = px * 0.4;
  const font = `${c.bold ? 800 : 400} ${px}px "${c.font}", system-ui, sans-serif`;
  x.font = font;
  const tw = x.measureText(s).width;
  cv.width = c.anim === 4 ? Math.max(comp.w, Math.ceil(tw + pad * 2)) : comp.w; cv.height = comp.h;
  x.font = font; x.textBaseline = 'middle'; x.lineJoin = 'round';
  x.textAlign = ['left', 'center', 'right'][c.align] || 'center';
  const ax = c.align === 0 ? pad : c.align === 2 ? cv.width - pad : cv.width / 2;
  x.clearRect(0, 0, cv.width, cv.height);
  x.lineWidth = px * 0.14; x.strokeStyle = 'rgb(0,255,0)'; x.strokeText(s, ax, cv.height / 2);
  x.fillStyle = 'rgb(255,0,0)'; x.fillText(s, ax, cv.height / 2);
  const x0 = c.align === 0 ? ax : c.align === 2 ? ax - tw : ax - tw / 2;
  c.bx = [x0 / cv.width, (x0 + tw) / cv.width];
  if (!c.tex) c.tex = mkTex(0, 0);
  gl.bindTexture(gl.TEXTURE_2D, c.tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}
function textThumb(c) {
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
  const x = cv.getContext('2d'), p = c.params, [r, g, b] = hsv(p[3], p[4], Math.max(0.35, p[5]));
  x.fillStyle = '#111'; x.fillRect(0, 0, 160, 90);
  x.font = `${c.bold ? 800 : 400} 22px "${c.font}", system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`; x.fillText(textLines(c)[0].slice(0, 14) || 'Text', 80, 45, 150);
  c.thumb = cv.toDataURL('image/jpeg', 0.7); ui.gridDirty = true;
}
function textDraw(f) {
  const c = this, p = modParams(c.params, c.mod), { idx, s } = textShown(c);
  const key = [idx, s, c.font, c.bold, c.align, c.anim === 4, comp.w, comp.h].join('|');
  if (key !== c.key) { if (idx !== c.lastIdx) { c.lineAt = comp.time; c.lineBeat = comp.beats; c.lastIdx = idx; } c.key = key; textRender(c, s); }
  const b = comp.beats, spd = p[7];
  let scl = 0.25 + p[0] * 1.5, ox = p[1] - 0.5, oy = p[2] - 0.5, reveal = 1.01, alpha = 1;
  const wr = c.cv.width / comp.w;
  if (c.anim === 1) scl *= 1 + 0.15 * Math.pow(1 - (b - Math.floor(b)), 3);
  else if (c.anim === 2) scl *= 1 + 0.3 * audioFeat.kick;
  else if (c.anim === 3) reveal = Math.min(1.01, (b - c.lineBeat) / (1 + (1 - spd) * 7));
  else if (c.anim === 4) { const per = 32 - spd * 28, t = ((b / per) % 1 + 1) % 1; ox = (0.5 + wr * scl / 2) - t * (1 + wr * scl); }
  else if (c.anim === 6) alpha = ((b * (1 + Math.floor(spd * 3))) % 1 + 1) % 1 < 0.5 ? 1 : 0;
  else if (c.anim === 7) alpha = Math.min(1, (comp.time - c.lineAt) / (0.15 + (1 - spd) * 0.85));
  clearFbo(f);
  gl.useProgram(textProg.p);
  bindTex(0, c.tex);
  const T = textProg.loc;
  gl.uniform1i(T('tex'), 0); gl.uniform1f(T('scl'), scl); gl.uniform2f(T('off'), ox, oy); gl.uniform1f(T('wr'), wr);
  gl.uniform3f(T('fillCol'), ...hsv(p[3], p[4], p[5])); gl.uniform3f(T('lineCol'), 0, 0, 0);
  gl.uniform1f(T('outline'), p[6]); gl.uniform1f(T('reveal'), reveal); gl.uniform1f(T('alpha'), alpha); gl.uniform2f(T('bx'), c.bx[0], c.bx[1]);
  tri();
  return true;
}
function textClip(o = {}) {
  const c = { uid: newUid(), type: 'text', name: 'Text', text: 'STRODANO VJ', font: 'Inter', bold: true, align: 1, anim: 0, advance: 0, line: 0,
    params: TEXT_PARAMS.map(x => x.def), speed: 1, thumb: null, key: '', lastIdx: -1, lineAt: 0, lineBeat: 0, bx: [0, 1] };
  if (typeof o.text === 'string') c.text = o.text.slice(0, 20000);
  if (TEXT_FONTS.includes(o.font)) c.font = o.font;
  if (typeof o.bold === 'boolean') c.bold = o.bold;
  const int = (v, n) => Math.min(n - 1, Math.max(0, v | 0));
  if (o.align !== undefined) c.align = int(o.align, 3);
  if (o.anim !== undefined) c.anim = int(o.anim, TEXT_ANIMS.length);
  if (TEXT_ADVANCE.some(a => a[0] === o.advance)) c.advance = o.advance;
  if (Array.isArray(o.params)) o.params.forEach((v, i) => { if (i < c.params.length && typeof v === 'number' && isFinite(v)) c.params[i] = Math.min(1, Math.max(0, v)); });
  c.name = textLines(c)[0].slice(0, 24) || 'Text';
  if (typeof o.name === 'string' && o.name) c.name = o.name;
  c.draw = textDraw;
  textThumb(c);
  return c;
}
function textNextLine(c, d = 1) { if (c && c.type === 'text') { c.line += d; c.advance = 0; ui.propsDirty = true; } }

CLIP_TYPES.text = {
  toJSON: c => ({ type: 'text', uid: c.uid, name: c.name, text: c.text, font: c.font, bold: c.bold, align: c.align, anim: c.anim, advance: c.advance, params: c.params, mod: c.mod }),
  fromJSON: j => textClip(j),
  free: c => { if (c.tex) { gl.deleteTexture(c.tex); c.tex = null; } },
  props: (c, p) => {
    const sel2 = (label, opts, cur, set) => el('div', { className: 'fld' }, el('label', { textContent: label }),
      el('select', { onchange: e => { set(+e.target.value); } }, ...opts.map(([v, n]) => el('option', { value: v, textContent: n, selected: v === cur }))));
    const ta = el('textarea', { className: 'text-edit', value: c.text, rows: 4, spellcheck: false, placeholder: 'One line per cue',
      oninput: e => { c.text = e.target.value; }, onchange: () => { c.name = textLines(c)[0].slice(0, 24) || 'Text'; textThumb(c); } });
    const { idx } = textShown(c), n = textLines(c).length;
    p.append(ta,
      el('div', { className: 'fld' }, el('button', { textContent: '< Prev', onclick: () => textNextLine(c, -1) }), el('button', { textContent: 'Next line >', title: 'N key', onclick: () => textNextLine(c, 1) }),
        el('span', { className: 'hint', textContent: `Line ${idx + 1} of ${n}` })),
      sel2('Lines advance', TEXT_ADVANCE, c.advance, v => { c.advance = v; }),
      sel2('Animation', TEXT_ANIMS.map((a, i) => [i, a]), c.anim, v => { c.anim = v; }),
      el('div', { className: 'fld' }, el('label', { textContent: 'Font' }),
        el('select', { onchange: e => { c.font = e.target.value; textThumb(c); } }, ...TEXT_FONTS.map(f => el('option', { value: f, textContent: f, selected: f === c.font }))),
        el('label', { className: 'chk' }, el('input', { type: 'checkbox', checked: c.bold, onchange: e => { c.bold = e.target.checked; textThumb(c); } }), ' Bold')),
      sel2('Align', [[0, 'Left'], [1, 'Centre'], [2, 'Right']], c.align, v => { c.align = v; }));
    TEXT_PARAMS.forEach((pd, k) => {
      const f = fld(pd.name, 0, 1, 0.001, () => c.params[k], v => { c.params[k] = v; if (k >= 3 && k <= 5) clearTimeout(c.thumbT), (c.thumbT = setTimeout(() => textThumb(c), 300)); });
      f.slider.dataset.midi = 'gen:' + c.uid + ':' + k;
      p.append(...lfoControls(c, k, f));
    });
  },
};
SOURCE_PANELS.push(() => {
  const item = el('div', { className: 'src-item', textContent: 'Text', title: 'Titles, names, lyrics. Drag onto a clip slot, or double-click to fill the selected slot',
    ondblclick: () => { const ci = sel.c >= 0 ? sel.c : comp.layers[sel.l].clips.findIndex(x => !x); if (ci >= 0) setClip(sel.l, ci, textClip()); } });
  draggable(item, { kind: 'make', make: () => textClip() });
  return [el('h4', { textContent: 'Text' }), el('div', { className: 'list' }, item)];
});
