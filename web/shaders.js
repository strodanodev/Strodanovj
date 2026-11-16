// Strodano VJ (web) - built-in effects and generators. GPL-3.0.
// Add an entry here and refresh the page: it shows up in the Effects / Sources list.
// Effects define vec4 fx(); generators define vec4 gen(). Params are 0..1 and arrive as p.x, p.y, p.z, p.w.
'use strict';
const P = (name, def) => ({ name, def });
const BUILTIN_FX = [
  { name: 'Invert', params: [P('Amount', 1)], body: `vec4 fx(){ vec4 c = texture(tex, uv); return vec4(mix(c.rgb, 1.0 - c.rgb, p.x), c.a); }` },
  { name: 'Hue Rotate', params: [P('Hue', 0.5), P('Auto Speed', 0)], body: `vec4 fx(){ vec4 c = texture(tex, uv); float a = (p.x + time * p.y) * 6.2831853;
 vec3 k = vec3(0.57735); float ca = cos(a), sa = sin(a);
 vec3 r = c.rgb * ca + cross(k, c.rgb) * sa + k * dot(k, c.rgb) * (1.0 - ca); return vec4(r, c.a); }` },
  { name: 'Brightness Contrast', params: [P('Brightness', 0.5), P('Contrast', 0.5)], body: `vec4 fx(){ vec4 c = texture(tex, uv); vec3 r = (c.rgb - 0.5) * (p.y * 2.0) + 0.5 + (p.x * 2.0 - 1.0); return vec4(clamp(r, 0.0, 1.0), c.a); }` },
  { name: 'Saturation', params: [P('Saturation', 0)], body: `vec4 fx(){ vec4 c = texture(tex, uv); return vec4(mix(vec3(luma(c.rgb)), c.rgb, p.x * 2.0), c.a); }` },
  { name: 'Colorize', params: [P('Hue', 0.6), P('Saturation', 1), P('Amount', 1)], body: `vec4 fx(){ vec4 c = texture(tex, uv); vec3 t = hsv2rgb(vec3(p.x, p.y, 1.0)) * luma(c.rgb); return vec4(mix(c.rgb, t, p.z), c.a); }` },
  { name: 'Posterize', params: [P('Levels', 0.2)], body: `vec4 fx(){ vec4 c = texture(tex, uv); float n = 2.0 + floor(p.x * 30.0); return vec4(floor(c.rgb * n) / (n - 1.0), c.a); }` },
  { name: 'Threshold', params: [P('Level', 0.5), P('Softness', 0.05)], body: `vec4 fx(){ vec4 c = texture(tex, uv); float l = smoothstep(p.x - p.y - 0.001, p.x + p.y + 0.001, luma(c.rgb)); return vec4(vec3(l), c.a); }` },
  { name: 'Mirror', params: [P('Vertical', 0), P('Flip Side', 0)], body: `vec4 fx(){ vec2 s = uv; if (p.x < 0.5) { s.x = p.y < 0.5 ? 0.5 - abs(s.x - 0.5) : 0.5 + abs(s.x - 0.5); }
 else { s.y = p.y < 0.5 ? 0.5 - abs(s.y - 0.5) : 0.5 + abs(s.y - 0.5); } return texture(tex, s); }` },
  { name: 'Kaleidoscope', params: [P('Segments', 0.3), P('Rotation', 0), P('Auto Speed', 0)], body: `vec4 fx(){ vec2 s = uv - 0.5; s.x *= res.x / res.y; float n = 2.0 + floor(p.x * 14.0); float seg = 6.2831853 / n;
 float a = atan(s.y, s.x) + (p.y + time * p.z * 0.25) * 6.2831853; float r = length(s);
 a = mod(a, seg); a = abs(a - seg * 0.5); s = r * vec2(cos(a), sin(a)); s.x *= res.y / res.x;
 return texture(tex, fract(s + 0.5)); }` },
  { name: 'Pixelate', params: [P('Size', 0.2)], body: `vec4 fx(){ float s = 1.0 + p.x * 120.0; vec2 cell = vec2(s) / res; return texture(tex, (floor(uv / cell) + 0.5) * cell); }` },
  { name: 'RGB Shift', params: [P('Amount', 0.2), P('Angle', 0)], body: `vec4 fx(){ float a = p.y * 6.2831853; vec2 d = vec2(cos(a), sin(a)) * p.x * 0.08; vec4 c = texture(tex, uv);
 return vec4(texture(tex, uv + d).r, c.g, texture(tex, uv - d).b, c.a); }` },
  { name: 'Blur', params: [P('Radius', 0.3)], body: `vec4 fx(){ vec2 px = (1.0 + p.x * 24.0) / res; vec4 s = vec4(0.0);
 for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996; float r = sqrt((float(i) + 0.5) / 16.0);
  s += texture(tex, uv + vec2(cos(a), sin(a)) * r * px); } return s / 16.0; }` },
  { name: 'Edge Detect', params: [P('Strength', 0.5), P('Mix Original', 0)], body: `vec4 fx(){ vec2 px = 1.0 / res; float l = luma(texture(tex, uv - vec2(px.x, 0.0)).rgb), r = luma(texture(tex, uv + vec2(px.x, 0.0)).rgb);
 float u = luma(texture(tex, uv + vec2(0.0, px.y)).rgb), d = luma(texture(tex, uv - vec2(0.0, px.y)).rgb);
 float e = clamp(length(vec2(r - l, u - d)) * (1.0 + p.x * 12.0), 0.0, 1.0); vec4 c = texture(tex, uv);
 return vec4(mix(vec3(e), c.rgb + e, p.y), c.a); }` },
  { name: 'Strobe', params: [P('Rate', 0.5), P('Beat Sync', 1), P('Duty', 0.5)], body: `vec4 fx(){ vec4 c = texture(tex, uv); float ph = p.y > 0.5 ? fract(beat * exp2(floor(p.x * 4.0) - 1.0)) : fract(time * (1.0 + p.x * 29.0));
 return ph < p.z ? c : vec4(0.0, 0.0, 0.0, c.a); }` },
  { name: 'Wave Warp', params: [P('Amount', 0.2), P('Frequency', 0.3), P('Speed', 0.3)], body: `vec4 fx(){ vec2 s = uv; float f = 2.0 + p.y * 40.0; float t = time * p.z * 8.0;
 s.x += sin(s.y * f + t) * p.x * 0.1; s.y += cos(s.x * f + t) * p.x * 0.1; return texture(tex, s); }` },
  { name: 'Tile', params: [P('Tiles X', 0.15), P('Tiles Y', 0.15)], body: `vec4 fx(){ vec2 n = 1.0 + floor(p.xy * 15.0); return texture(tex, fract(uv * n)); }` },
  { name: 'Transform', params: [P('Scale', 0.5), P('Rotation', 0), P('X', 0.5), P('Y', 0.5)], body: `vec4 fx(){ vec2 s = uv - 0.5 - (p.zw - 0.5); s.x *= res.x / res.y; float a = p.y * 6.2831853; float k = max(p.x * 2.0, 0.001);
 s = mat2(cos(a), -sin(a), sin(a), cos(a)) * s / k; s.x *= res.y / res.x; s += 0.5;
 return (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) ? vec4(0.0) : texture(tex, s); }` },
  { name: 'Flip', params: [P('Horizontal', 1), P('Vertical', 0)], body: `vec4 fx(){ vec2 s = uv; if (p.x > 0.5) s.x = 1.0 - s.x; if (p.y > 0.5) s.y = 1.0 - s.y; return texture(tex, s); }` },
  { name: 'Vignette', params: [P('Size', 0.5), P('Softness', 0.5)], body: `vec4 fx(){ vec4 c = texture(tex, uv); float d = length(uv - 0.5) * 1.414; float v = 1.0 - smoothstep(p.x, p.x + p.y + 0.001, d); return vec4(c.rgb * v, c.a); }` },
  { name: 'Audio Pulse', params: [P('Zoom', 0.3), P('Flash', 0.3), P('Kick Bass Mid High', 0)], body: `vec4 fx(){ float a = p.z < 0.25 ? kick : p.z < 0.5 ? audio.x : p.z < 0.75 ? audio.y : audio.z;
 vec4 c = texture(tex, (uv - 0.5) / (1.0 + a * p.x * 0.5) + 0.5); return vec4(c.rgb * (1.0 + a * p.y * 2.0), c.a); }` },
  { name: 'Noise Grain', params: [P('Amount', 0.3)], body: `vec4 fx(){ vec4 c = texture(tex, uv); float n = hash(uv * res + fract(time) * 100.0) - 0.5; return vec4(c.rgb + n * p.x, c.a); }` },
];
const BUILTIN_GEN = [
  { name: 'Solid Color', params: [P('Hue', 0), P('Saturation', 0), P('Brightness', 1)], body: `vec4 gen(){ return vec4(hsv2rgb(vec3(p.x, p.y, p.z)), 1.0); }` },
  { name: 'Gradient', params: [P('Hue A', 0.6), P('Hue B', 0.9), P('Speed', 0.2), P('Vertical', 0)], body: `vec4 gen(){ float t = p.w > 0.5 ? uv.y : uv.x; t = 0.5 + 0.5 * sin((t + time * p.z) * 6.2831853);
 return vec4(mix(hsv2rgb(vec3(p.x, 1.0, 1.0)), hsv2rgb(vec3(p.y, 1.0, 1.0)), t), 1.0); }` },
  { name: 'Checkerboard', params: [P('Size', 0.3), P('Scroll Speed', 0.2)], body: `vec4 gen(){ float n = 2.0 + floor(p.x * 30.0); vec2 s = uv; s.x *= res.x / res.y; s += time * p.y * 0.5;
 vec2 c = floor(s * n); return vec4(vec3(mod(c.x + c.y, 2.0)), 1.0); }` },
  { name: 'Lines', params: [P('Count', 0.3), P('Speed', 0.3), P('Angle', 0), P('Width', 0.5)], body: `vec4 gen(){ float a = p.z * 3.14159265; vec2 s = uv - 0.5; s.x *= res.x / res.y; float d = s.x * cos(a) + s.y * sin(a);
 float v = fract(d * (1.0 + floor(p.x * 40.0)) + time * p.y * 2.0); return vec4(vec3(step(v, p.w)), 1.0); }` },
  { name: 'Plasma', params: [P('Scale', 0.3), P('Speed', 0.3), P('Hue', 0)], body: `vec4 gen(){ vec2 s = (uv - 0.5) * (2.0 + p.x * 20.0); s.x *= res.x / res.y; float t = time * (0.2 + p.y * 3.0);
 float v = sin(s.x + t) + sin(s.y * 1.3 - t * 0.7) + sin((s.x + s.y) * 0.7 + t * 1.3) + sin(length(s) * 1.5 - t);
 return vec4(hsv2rgb(vec3(fract(p.z + v * 0.125), 0.85, 1.0)), 1.0); }` },
  { name: 'Noise', params: [P('Scale', 0.5), P('Speed', 0.5)], body: `vec4 gen(){ float s = 4.0 + p.x * 200.0; vec2 c = floor(uv * vec2(s * res.x / res.y, s)); float t = floor(time * (1.0 + p.y * 59.0));
 return vec4(vec3(hash(c + t * 17.0)), 1.0); }` },
  { name: 'Tunnel', params: [P('Speed', 0.3), P('Twist', 0.3), P('Hue', 0.55)], body: `vec4 gen(){ vec2 s = uv - 0.5; s.x *= res.x / res.y; float r = length(s) + 0.0001; float a = atan(s.y, s.x) / 6.2831853;
 float z = 0.3 / r + time * (0.2 + p.x * 3.0); float w = fract(a * 8.0 + z * p.y * 2.0);
 float v = step(0.5, fract(z)) * step(0.5, w) + step(fract(z), 0.5) * step(w, 0.5);
 return vec4(hsv2rgb(vec3(p.z, 0.7, 1.0)) * v * clamp(r * 3.0, 0.0, 1.0), 1.0); }` },
  { name: 'Beat Flash', params: [P('Hue', 0), P('Saturation', 0), P('Decay', 0.5)], body: `vec4 gen(){ float v = pow(1.0 - fract(beat), 1.0 + p.z * 8.0); return vec4(hsv2rgb(vec3(p.x, p.y, 1.0)) * v, 1.0); }` },
  { name: 'Audio Rings', params: [P('Hue', 0.55), P('Size', 0.5)], body: `vec4 gen(){ vec2 s = uv - 0.5; s.x *= res.x / res.y; float r = length(s), k = 0.6 + p.y; vec3 c = vec3(0.0);
 for (int i = 0; i < 3; i++) { float lv = i == 0 ? audio.x : i == 1 ? audio.y : audio.z; float rad = (0.12 + 0.13 * float(i)) * k + lv * 0.08;
  c += hsv2rgb(vec3(p.x + float(i) * 0.12, 0.8, 1.0)) * smoothstep(0.004 + lv * 0.03, 0.0, abs(r - rad)) * (0.25 + lv); }
 c += hsv2rgb(vec3(p.x, 0.5, 1.0)) * kick * smoothstep(0.12 * k, 0.0, r); return vec4(c, 1.0); }` },
];
const TEMPLATE_FX = `// @param Amount 0.5
// @param Speed 0.3
vec4 fx(){
  vec2 s = uv;
  s.x += sin(s.y * 30.0 + time * p.y * 10.0) * p.x * 0.05;
  vec4 c = texture(tex, s);
  return vec4(c.rgb, c.a);
}`;
const TEMPLATE_GEN = `// @param Hue 0.6
// @param Speed 0.3
vec4 gen(){
  vec2 s = uv - 0.5;
  s.x *= res.x / res.y;
  float d = length(s);
  float v = 0.5 + 0.5 * sin(d * 40.0 - time * (1.0 + p.y * 10.0));
  return vec4(hsv2rgb(vec3(p.x, 0.8, v)), 1.0);
}`;
