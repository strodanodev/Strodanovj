#include "effects.h"
#include "gfx.h"

static const char* kFxPre =
    "uniform sampler2D tex; uniform vec4 p; uniform float time; uniform float beat; uniform vec2 res; uniform float mixAmt;\n"
    "in vec2 uv; out vec4 o;\n"
    "vec3 hsv2rgb(vec3 c){ vec3 q = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(q - 1.0, 0.0, 1.0), c.y); }\n"
    "float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }\n"
    "float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }\n";
static const char* kFxPost = "\nvoid main(){ o = mix(texture(tex, uv), fx(), mixAmt); }\n";
static const char* kGenPost = "\nvoid main(){ o = gen(); }\n";

std::vector<ShaderDef>& builtinEffects() {
    static std::vector<ShaderDef> v = {
        {"Invert", {{"Amount", 1}},
         "vec4 fx(){ vec4 c = texture(tex, uv); return vec4(mix(c.rgb, 1.0 - c.rgb, p.x), c.a); }"},
        {"Hue Rotate", {{"Hue", 0.5}, {"Auto Speed", 0}},
         "vec4 fx(){ vec4 c = texture(tex, uv); float a = (p.x + time * p.y) * 6.2831853;\n"
         " vec3 k = vec3(0.57735); float ca = cos(a), sa = sin(a);\n"
         " vec3 r = c.rgb * ca + cross(k, c.rgb) * sa + k * dot(k, c.rgb) * (1.0 - ca); return vec4(r, c.a); }"},
        {"Brightness Contrast", {{"Brightness", 0.5}, {"Contrast", 0.5}},
         "vec4 fx(){ vec4 c = texture(tex, uv); vec3 r = (c.rgb - 0.5) * (p.y * 2.0) + 0.5 + (p.x * 2.0 - 1.0); return vec4(clamp(r, 0.0, 1.0), c.a); }"},
        {"Saturation", {{"Saturation", 0}},
         "vec4 fx(){ vec4 c = texture(tex, uv); return vec4(mix(vec3(luma(c.rgb)), c.rgb, p.x * 2.0), c.a); }"},
        {"Colorize", {{"Hue", 0.6}, {"Saturation", 1}, {"Amount", 1}},
         "vec4 fx(){ vec4 c = texture(tex, uv); vec3 t = hsv2rgb(vec3(p.x, p.y, 1.0)) * luma(c.rgb); return vec4(mix(c.rgb, t, p.z), c.a); }"},
        {"Posterize", {{"Levels", 0.2}},
         "vec4 fx(){ vec4 c = texture(tex, uv); float n = 2.0 + floor(p.x * 30.0); return vec4(floor(c.rgb * n) / (n - 1.0), c.a); }"},
        {"Threshold", {{"Level", 0.5}, {"Softness", 0.05}},
         "vec4 fx(){ vec4 c = texture(tex, uv); float l = smoothstep(p.x - p.y - 0.001, p.x + p.y + 0.001, luma(c.rgb)); return vec4(vec3(l), c.a); }"},
        {"Mirror", {{"Vertical", 0}, {"Flip Side", 0}},
         "vec4 fx(){ vec2 q = uv; if (p.x < 0.5) { q.x = p.y < 0.5 ? 0.5 - abs(q.x - 0.5) : 0.5 + abs(q.x - 0.5); }\n"
         " else { q.y = p.y < 0.5 ? 0.5 - abs(q.y - 0.5) : 0.5 + abs(q.y - 0.5); } return texture(tex, q); }"},
        {"Kaleidoscope", {{"Segments", 0.3}, {"Rotation", 0}, {"Auto Speed", 0}},
         "vec4 fx(){ vec2 q = uv - 0.5; q.x *= res.x / res.y; float n = 2.0 + floor(p.x * 14.0); float seg = 6.2831853 / n;\n"
         " float a = atan(q.y, q.x) + (p.y + time * p.z * 0.25) * 6.2831853; float r = length(q);\n"
         " a = mod(a, seg); a = abs(a - seg * 0.5); q = r * vec2(cos(a), sin(a)); q.x *= res.y / res.x;\n"
         " return texture(tex, fract(q + 0.5)); }"},
        {"Pixelate", {{"Size", 0.2}},
         "vec4 fx(){ float s = 1.0 + p.x * 120.0; vec2 cell = vec2(s) / res; return texture(tex, (floor(uv / cell) + 0.5) * cell); }"},
        {"RGB Shift", {{"Amount", 0.2}, {"Angle", 0}},
         "vec4 fx(){ float a = p.y * 6.2831853; vec2 d = vec2(cos(a), sin(a)) * p.x * 0.08; vec4 c = texture(tex, uv);\n"
         " return vec4(texture(tex, uv + d).r, c.g, texture(tex, uv - d).b, c.a); }"},
        {"Blur", {{"Radius", 0.3}},
         "vec4 fx(){ vec2 px = (1.0 + p.x * 24.0) / res; vec4 s = vec4(0.0);\n"
         " for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996; float r = sqrt((float(i) + 0.5) / 16.0);\n"
         "  s += texture(tex, uv + vec2(cos(a), sin(a)) * r * px); } return s / 16.0; }"},
        {"Edge Detect", {{"Strength", 0.5}, {"Mix Original", 0}},
         "vec4 fx(){ vec2 px = 1.0 / res; float l = luma(texture(tex, uv - vec2(px.x, 0)).rgb), r = luma(texture(tex, uv + vec2(px.x, 0)).rgb);\n"
         " float u = luma(texture(tex, uv + vec2(0, px.y)).rgb), d = luma(texture(tex, uv - vec2(0, px.y)).rgb);\n"
         " float e = clamp(length(vec2(r - l, u - d)) * (1.0 + p.x * 12.0), 0.0, 1.0); vec4 c = texture(tex, uv);\n"
         " return vec4(mix(vec3(e), c.rgb + e, p.y), c.a); }"},
        {"Strobe", {{"Rate", 0.5}, {"Beat Sync", 1}, {"Duty", 0.5}},
         "vec4 fx(){ vec4 c = texture(tex, uv); float ph = p.y > 0.5 ? fract(beat * exp2(floor(p.x * 4.0) - 1.0)) : fract(time * (1.0 + p.x * 29.0));\n"
         " return ph < p.z ? c : vec4(0.0, 0.0, 0.0, c.a); }"},
        {"Wave Warp", {{"Amount", 0.2}, {"Frequency", 0.3}, {"Speed", 0.3}},
         "vec4 fx(){ vec2 q = uv; float f = 2.0 + p.y * 40.0; float t = time * p.z * 8.0;\n"
         " q.x += sin(q.y * f + t) * p.x * 0.1; q.y += cos(q.x * f + t) * p.x * 0.1; return texture(tex, q); }"},
        {"Tile", {{"Tiles X", 0.15}, {"Tiles Y", 0.15}},
         "vec4 fx(){ vec2 n = 1.0 + floor(p.xy * 15.0); return texture(tex, fract(uv * n)); }"},
        {"Transform", {{"Scale", 0.5}, {"Rotation", 0}, {"X", 0.5}, {"Y", 0.5}},
         "vec4 fx(){ vec2 q = uv - 0.5 - (p.zw - 0.5); q.x *= res.x / res.y; float a = p.y * 6.2831853; float s = max(p.x * 2.0, 0.001);\n"
         " q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q / s; q.x *= res.y / res.x; q += 0.5;\n"
         " return (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) ? vec4(0.0) : texture(tex, q); }"},
        {"Flip", {{"Horizontal", 1}, {"Vertical", 0}},
         "vec4 fx(){ vec2 q = uv; if (p.x > 0.5) q.x = 1.0 - q.x; if (p.y > 0.5) q.y = 1.0 - q.y; return texture(tex, q); }"},
        {"Vignette", {{"Size", 0.5}, {"Softness", 0.5}},
         "vec4 fx(){ vec4 c = texture(tex, uv); float d = length(uv - 0.5) * 1.414; float v = 1.0 - smoothstep(p.x, p.x + p.y + 0.001, d); return vec4(c.rgb * v, c.a); }"},
        {"Noise Grain", {{"Amount", 0.3}},
         "vec4 fx(){ vec4 c = texture(tex, uv); float n = hash(uv * res + fract(time) * 100.0) - 0.5; return vec4(c.rgb + n * p.x, c.a); }"},
    };
    return v;
}

std::vector<ShaderDef>& builtinGenerators() {
    static std::vector<ShaderDef> v = {
        {"Solid Color", {{"Hue", 0}, {"Saturation", 0}, {"Brightness", 1}},
         "vec4 gen(){ return vec4(hsv2rgb(vec3(p.x, p.y, p.z)), 1.0); }"},
        {"Gradient", {{"Hue A", 0.6}, {"Hue B", 0.9}, {"Speed", 0.2}, {"Vertical", 0}},
         "vec4 gen(){ float t = p.w > 0.5 ? uv.y : uv.x; t = 0.5 + 0.5 * sin((t + time * p.z) * 6.2831853);\n"
         " return vec4(mix(hsv2rgb(vec3(p.x, 1.0, 1.0)), hsv2rgb(vec3(p.y, 1.0, 1.0)), t), 1.0); }"},
        {"Checkerboard", {{"Size", 0.3}, {"Scroll Speed", 0.2}},
         "vec4 gen(){ float n = 2.0 + floor(p.x * 30.0); vec2 q = uv; q.x *= res.x / res.y; q += time * p.y * 0.5;\n"
         " vec2 c = floor(q * n); return vec4(vec3(mod(c.x + c.y, 2.0)), 1.0); }"},
        {"Lines", {{"Count", 0.3}, {"Speed", 0.3}, {"Angle", 0}, {"Width", 0.5}},
         "vec4 gen(){ float a = p.z * 3.14159265; vec2 q = uv - 0.5; q.x *= res.x / res.y; float d = q.x * cos(a) + q.y * sin(a);\n"
         " float v = fract(d * (1.0 + floor(p.x * 40.0)) + time * p.y * 2.0); return vec4(vec3(step(v, p.w)), 1.0); }"},
        {"Plasma", {{"Scale", 0.3}, {"Speed", 0.3}, {"Hue", 0}},
         "vec4 gen(){ vec2 q = (uv - 0.5) * (2.0 + p.x * 20.0); q.x *= res.x / res.y; float t = time * (0.2 + p.y * 3.0);\n"
         " float v = sin(q.x + t) + sin(q.y * 1.3 - t * 0.7) + sin((q.x + q.y) * 0.7 + t * 1.3) + sin(length(q) * 1.5 - t);\n"
         " return vec4(hsv2rgb(vec3(fract(p.z + v * 0.125), 0.85, 1.0)), 1.0); }"},
        {"Noise", {{"Scale", 0.5}, {"Speed", 0.5}},
         "vec4 gen(){ float s = 4.0 + p.x * 200.0; vec2 q = floor(uv * vec2(s * res.x / res.y, s)); float t = floor(time * (1.0 + p.y * 59.0));\n"
         " return vec4(vec3(hash(q + t * 17.0)), 1.0); }"},
        {"Tunnel", {{"Speed", 0.3}, {"Twist", 0.3}, {"Hue", 0.55}},
         "vec4 gen(){ vec2 q = uv - 0.5; q.x *= res.x / res.y; float r = length(q) + 0.0001; float a = atan(q.y, q.x) / 6.2831853;\n"
         " float z = 0.3 / r + time * (0.2 + p.x * 3.0); float v = step(0.5, fract(z)) * step(0.5, fract(a * 8.0 + z * p.y * 2.0)) + step(fract(z), 0.5) * step(fract(a * 8.0 + z * p.y * 2.0), 0.5);\n"
         " return vec4(hsv2rgb(vec3(p.z, 0.7, 1.0)) * v * clamp(r * 3.0, 0.0, 1.0), 1.0); }"},
        {"Beat Flash", {{"Hue", 0}, {"Saturation", 0}, {"Decay", 0.5}},
         "vec4 gen(){ float v = pow(1.0 - fract(beat), 1.0 + p.z * 8.0); return vec4(hsv2rgb(vec3(p.x, p.y, 1.0)) * v, 1.0); }"},
    };
    return v;
}

static int findIn(std::vector<ShaderDef>& v, const std::string& n) {
    for (size_t i = 0; i < v.size(); i++) if (n == v[i].name) return (int)i;
    return -1;
}
int findEffect(const std::string& n) { return findIn(builtinEffects(), n); }
int findGenerator(const std::string& n) { return findIn(builtinGenerators(), n); }

static GLuint get(std::vector<ShaderDef>& v, int idx, const char* post) {
    if (idx < 0 || idx >= (int)v.size()) return 0;
    ShaderDef& d = v[idx];
    if (!d.tried) {
        d.tried = true;
        d.prog = gfx::program(std::string(kFxPre) + d.body + post);
    }
    return d.prog;
}
GLuint effectProgram(int idx) { return get(builtinEffects(), idx, kFxPost); }
GLuint generatorProgram(int idx) { return get(builtinGenerators(), idx, kGenPost); }
