#include "comp.h"
#include "output.h"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>

using json = nlohmann::json;
const char* kBlendNames[BlendCount] = {"Alpha", "Add", "Subtract", "Multiply", "Screen", "Lighten", "Darken", "Difference"};

static GLuint g_srcProg = 0, g_blendProg = 0, g_copyProg = 0;

static void ensurePrograms() {
    if (g_srcProg) return;
    g_srcProg = gfx::program(
        "uniform sampler2D tex; uniform vec2 scl; uniform vec2 off; in vec2 uv; out vec4 o;\n"
        "void main(){ vec2 q = (uv - 0.5 - off) / scl + 0.5;\n"
        " if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { o = vec4(0.0); return; }\n"
        " o = texture(tex, vec2(q.x, 1.0 - q.y)); }\n");
    g_blendProg = gfx::program(
        "uniform sampler2D base; uniform sampler2D top; uniform float opacity; uniform int mode; in vec2 uv; out vec4 o;\n"
        "void main(){ vec4 b = texture(base, uv); vec4 t = texture(top, uv); float a = t.a * opacity; vec3 r;\n"
        " if (mode == 1) r = b.rgb + t.rgb; else if (mode == 2) r = b.rgb - t.rgb; else if (mode == 3) r = b.rgb * t.rgb;\n"
        " else if (mode == 4) r = 1.0 - (1.0 - b.rgb) * (1.0 - t.rgb); else if (mode == 5) r = max(b.rgb, t.rgb);\n"
        " else if (mode == 6) r = min(b.rgb, t.rgb); else if (mode == 7) r = abs(b.rgb - t.rgb); else r = t.rgb;\n"
        " o = vec4(clamp(mix(b.rgb, r, a), 0.0, 1.0), b.a + a * (1.0 - b.a)); }\n");
    g_copyProg = gfx::program(
        "uniform sampler2D tex; uniform float gain; in vec2 uv; out vec4 o;\n"
        "void main(){ vec4 c = texture(tex, uv); o = vec4(c.rgb * gain, c.a); }\n");
}

bool isMediaFile(const std::string& path) {
    std::string e = std::filesystem::path(path).extension().string();
    for (auto& c : e) c = (char)tolower((unsigned char)c);
    static const char* exts[] = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".mpg", ".mpeg", ".png", ".jpg", ".jpeg", ".gif", ".bmp"};
    for (auto* x : exts) if (e == x) return true;
    return false;
}

// ---------- effects ----------
Effect makeBuiltinEffect(int idx) {
    Effect e;
    auto& d = builtinEffects()[idx];
    e.builtin = idx;
    e.name = d.name;
    for (auto& p : d.params) e.params.push_back(p.def);
    return e;
}
Effect makeFFGLEffect(FFGLPlugin* p) {
    Effect e;
    e.plug = p;
    e.name = p->name;
    for (auto& pr : p->params) e.params.push_back(pr.def);
    e.eventPulse.assign(p->params.size(), 0);
    return e;
}
void freeEffect(Effect& e) {
    if (e.inst) ffgl::destroy(e.inst);
    e.inst = nullptr;
}

static void setCommonUniforms(GLuint prog, const std::vector<float>& params, const Composition& c) {
    float p[4] = {0, 0, 0, 0};
    for (size_t i = 0; i < params.size() && i < 4; i++) p[i] = params[i];
    glUniform4fv(glGetUniformLocation(prog, "p"), 1, p);
    glUniform1f(glGetUniformLocation(prog, "time"), (float)std::fmod(c.time, 3600.0));
    glUniform1f(glGetUniformLocation(prog, "beat"), (float)std::fmod(c.beats, 1024.0));
    glUniform2f(glGetUniformLocation(prog, "res"), (float)c.w, (float)c.h);
}

void applyChain(std::vector<Effect>& chain, PingPong& rt, const Composition& c) {
    for (auto& e : chain) {
        if (e.bypass) continue;
        if (e.builtin >= 0) {
            GLuint prog = effectProgram(e.builtin);
            if (!prog) continue;
            rt.dst().bind();
            glUseProgram(prog);
            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, rt.src().tex);
            glUniform1i(glGetUniformLocation(prog, "tex"), 0);
            glUniform1f(glGetUniformLocation(prog, "mixAmt"), e.mix);
            setCommonUniforms(prog, e.params, c);
            gfx::drawFullscreen();
            rt.swap();
        } else if (e.plug) {
            if (e.inst && (e.inst->w != c.w || e.inst->h != c.h)) freeEffect(e);
            if (!e.inst) e.inst = ffgl::instantiate(e.plug, c.w, c.h);
            if (!e.inst) continue;
            std::vector<float> params = e.params;
            for (size_t i = 0; i < e.eventPulse.size() && i < params.size(); i++) {
                if (e.eventPulse[i] > 0) { params[i] = 1.0f; e.eventPulse[i]--; }
            }
            rt.dst().clear();
            float bar = (float)std::fmod(c.beats / 4.0, 1.0);
            if (ffgl::process(e.inst, params, rt.src().tex, rt.dst().fbo, c.w, c.h, c.time, c.bpm, bar)) rt.swap();
        }
    }
}

// ---------- composition ----------
static void freeClip(Clip& c) {
    if (c.thumb) glDeleteTextures(1, &c.thumb);
    c = Clip();
}
static void freeLayer(Layer& L) {
    L.player.reset();
    L.pending.reset();
    if (L.srcInst) ffgl::destroy(L.srcInst);
    L.srcInst = nullptr;
    for (auto& e : L.fx) freeEffect(e);
    for (auto& c : L.clips) freeClip(c);
    L.rt.destroy();
}

void Composition::init(int w_, int h_, int nLayers, int nCols) {
    ensurePrograms();
    clearAll();
    w = w_; h = h_; columns = nCols;
    rt.create(w, h);
    for (int i = 0; i < nLayers; i++) addLayer();
}

void Composition::clearAll() {
    for (auto& L : layers) freeLayer(L);
    layers.clear();
    for (auto& e : fx) freeEffect(e);
    fx.clear();
    rt.destroy();
    outTex = 0;
    master = 1.0f; crossfade = 0.5f;
}

void Composition::resize(int w_, int h_) {
    w = std::clamp(w_, 16, 8192); h = std::clamp(h_, 16, 8192);
    rt.destroy(); rt.create(w, h);
    for (auto& L : layers) {
        L.rt.destroy(); L.rt.create(w, h);
        if (L.srcInst) {
            ffgl::destroy(L.srcInst);
            L.srcInst = (L.active >= 0 && L.clips[L.active].plug) ? ffgl::instantiate(L.clips[L.active].plug, w, h) : nullptr;
        }
    }
}

void Composition::addLayer() {
    layers.emplace_back();
    Layer& L = layers.back();
    L.name = "Layer " + std::to_string(layers.size());
    L.clips.resize(columns);
    L.rt.create(w, h);
}

void Composition::removeLayer(int idx) {
    if (idx < 0 || idx >= (int)layers.size() || layers.size() <= 1) return;
    freeLayer(layers[idx]);
    layers.erase(layers.begin() + idx);
}

void Composition::setColumns(int n) {
    n = std::clamp(n, 1, 64);
    for (auto& L : layers) {
        if (L.active >= n) eject((int)(&L - &layers[0]));
        for (int i = n; i < (int)L.clips.size(); i++) freeClip(L.clips[i]);
        L.clips.resize(n);
    }
    columns = n;
}

void Composition::eject(int li) {
    if (li < 0 || li >= (int)layers.size()) return;
    Layer& L = layers[li];
    L.player.reset();
    L.pending.reset();
    L.pendingCol = -1;
    if (L.srcInst) { ffgl::destroy(L.srcInst); L.srcInst = nullptr; }
    L.active = -1;
    L.outTex = 0;
}

void Composition::trigger(int li, int col) {
    if (li < 0 || li >= (int)layers.size()) return;
    Layer& L = layers[li];
    if (col < 0 || col >= (int)L.clips.size()) return;
    Clip& c = L.clips[col];
    if (c.empty()) return;
    if (c.type == ClipType::Video) {
        if (L.active == col && L.player && !L.pending) { L.player->seek(0); return; }
        // Open on the decoder thread; the old clip keeps playing until the first frame is ready.
        L.pending = std::make_unique<VideoPlayer>(c.path);
        L.pendingCol = col;
        return;
    }
    L.pending.reset();
    L.pendingCol = -1;
    L.player.reset();
    if (L.srcInst) { ffgl::destroy(L.srcInst); L.srcInst = nullptr; }
    if (c.type == ClipType::FFGLSource) L.srcInst = ffgl::instantiate(c.plug, w, h);
    L.active = col;
}

void Composition::triggerColumn(int col) {
    for (int i = 0; i < (int)layers.size(); i++) {
        if (col < (int)layers[i].clips.size() && !layers[i].clips[col].empty()) trigger(i, col);
    }
}

void Composition::update(double dt) {
    time += dt;
    beats += dt * bpm / 60.0;
    for (auto& L : layers) {
        if (L.pending) {
            L.pending->paused = true;
            L.pending->update(0);
            if (L.pending->failed()) {
                L.pending.reset();
                L.pendingCol = -1;
            } else if (L.pending->ready()) {
                if (L.srcInst) { ffgl::destroy(L.srcInst); L.srcInst = nullptr; }
                L.player = std::move(L.pending);
                L.player->paused = false;
                L.active = L.pendingCol;
                L.pendingCol = -1;
            }
        }
        if (L.player && L.active >= 0) {
            L.player->speed = L.clips[L.active].speed;
            L.player->update(dt);
        }
    }
}

void Composition::render() {
    ensurePrograms();
    gfx::resetState();
    bool anySolo = false;
    for (auto& L : layers) anySolo |= L.solo;

    for (auto& L : layers) {
        L.outTex = 0;
        if (L.active < 0 || L.bypass || (anySolo && !L.solo)) continue;
        Clip& c = L.clips[L.active];
        L.rt.cur = 0;
        L.rt.dst().clear();
        bool drew = false;
        if (c.type == ClipType::Video && L.player && L.player->ready()) {
            float va = (float)L.player->w / (float)L.player->h, ca = (float)w / (float)h;
            float sx = 1, sy = 1;
            if (L.fit == 0) { if (va > ca) sx = va / ca; else sy = ca / va; }
            else if (L.fit == 1) { if (va > ca) sy = ca / va; else sx = va / ca; }
            glUseProgram(g_srcProg);
            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, L.player->tex);
            glUniform1i(glGetUniformLocation(g_srcProg, "tex"), 0);
            glUniform2f(glGetUniformLocation(g_srcProg, "scl"), sx * L.scale, sy * L.scale);
            glUniform2f(glGetUniformLocation(g_srcProg, "off"), L.posX, L.posY);
            gfx::drawFullscreen();
            drew = true;
        } else if (c.type == ClipType::Generator) {
            GLuint prog = generatorProgram(c.gen);
            if (prog) {
                glUseProgram(prog);
                setCommonUniforms(prog, c.params, *this);
                gfx::drawFullscreen();
                drew = true;
            }
        } else if (c.type == ClipType::FFGLSource && L.srcInst) {
            float bar = (float)std::fmod(beats / 4.0, 1.0);
            drew = ffgl::process(L.srcInst, c.params, 0, L.rt.dst().fbo, w, h, time, bpm, bar);
        }
        if (!drew) continue;
        L.rt.swap();
        applyChain(L.fx, L.rt, *this);
        L.outTex = L.rt.src().tex;
    }

    rt.cur = 0;
    rt.src().clear(0, 0, 0, 0);
    for (auto& L : layers) {
        if (!L.outTex) continue;
        float gain = 1.0f;
        if (L.xfade == 1) gain = std::clamp((1.0f - crossfade) * 2.0f, 0.0f, 1.0f);
        if (L.xfade == 2) gain = std::clamp(crossfade * 2.0f, 0.0f, 1.0f);
        float op = L.opacity * gain;
        if (op <= 0.0f) continue;
        rt.dst().bind();
        glUseProgram(g_blendProg);
        glActiveTexture(GL_TEXTURE1);
        glBindTexture(GL_TEXTURE_2D, L.outTex);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, rt.src().tex);
        glUniform1i(glGetUniformLocation(g_blendProg, "base"), 0);
        glUniform1i(glGetUniformLocation(g_blendProg, "top"), 1);
        glUniform1f(glGetUniformLocation(g_blendProg, "opacity"), op);
        glUniform1i(glGetUniformLocation(g_blendProg, "mode"), L.blend);
        gfx::drawFullscreen();
        rt.swap();
    }
    applyChain(fx, rt, *this);
    rt.dst().bind();
    glUseProgram(g_copyProg);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, rt.src().tex);
    glUniform1i(glGetUniformLocation(g_copyProg, "tex"), 0);
    glUniform1f(glGetUniformLocation(g_copyProg, "gain"), master);
    gfx::drawFullscreen();
    rt.swap();
    outTex = rt.src().tex;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

// ---------- clips ----------
static Clip* slot(Composition& c, int li, int col) {
    if (li < 0 || li >= (int)c.layers.size()) return nullptr;
    if (col < 0 || col >= (int)c.layers[li].clips.size()) return nullptr;
    return &c.layers[li].clips[col];
}

void Composition::clearClip(int li, int col) {
    Clip* c = slot(*this, li, col);
    if (!c) return;
    if (layers[li].active == col || layers[li].pendingCol == col) eject(li);
    freeClip(*c);
}

bool Composition::setVideo(int li, int col, const std::string& path) {
    if (!slot(*this, li, col)) return false;
    clearClip(li, col);
    Clip& c = layers[li].clips[col];
    c.type = ClipType::Video;
    c.path = path;
    c.name = std::filesystem::u8path(path).stem().u8string();
    std::vector<uint8_t> px;
    if (grabThumbnail(path, 160, 90, px)) c.thumb = gfx::makeTexture(160, 90, px.data());
    return true;
}

void Composition::setGenerator(int li, int col, int gen) {
    if (!slot(*this, li, col) || gen < 0 || gen >= (int)builtinGenerators().size()) return;
    clearClip(li, col);
    Clip& c = layers[li].clips[col];
    auto& d = builtinGenerators()[gen];
    c.type = ClipType::Generator;
    c.gen = gen;
    c.name = d.name;
    for (auto& p : d.params) c.params.push_back(p.def);
    if (GLuint prog = generatorProgram(gen)) {   // render a small still as the thumbnail
        Fbo f;
        f.create(160, 90);
        f.bind();
        glUseProgram(prog);
        Composition tmp;
        tmp.w = 160; tmp.h = 90; tmp.time = 1.3; tmp.beats = 0.1;
        setCommonUniforms(prog, c.params, tmp);
        gfx::drawFullscreen();
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        c.thumb = f.tex;
        c.thumbFlip = true;
        f.tex = 0;
        f.destroy();
    }
}

void Composition::setFFGLSource(int li, int col, FFGLPlugin* p) {
    if (!slot(*this, li, col) || !p) return;
    clearClip(li, col);
    Clip& c = layers[li].clips[col];
    c.type = ClipType::FFGLSource;
    c.plug = p;
    c.name = p->name;
    for (auto& pr : p->params) c.params.push_back(pr.def);
}

// ---------- persistence ----------
static json fxToJson(const std::vector<Effect>& chain) {
    json a = json::array();
    for (auto& e : chain) {
        json j;
        j["name"] = e.name;
        j["ffgl"] = e.plug != nullptr;
        if (e.plug) j["id"] = e.plug->id;
        j["params"] = e.params;
        j["mix"] = e.mix;
        j["bypass"] = e.bypass;
        a.push_back(j);
    }
    return a;
}
static void fxFromJson(const json& a, std::vector<Effect>& chain) {
    if (!a.is_array()) return;
    for (auto& j : a) {
        Effect e;
        std::string name = j.value("name", "");
        if (j.value("ffgl", false)) {
            FFGLPlugin* p = ffgl::find(j.value("id", ""), name);
            if (!p) continue;   // plugin not installed on this machine
            e = makeFFGLEffect(p);
        } else {
            int idx = findEffect(name);
            if (idx < 0) continue;
            e = makeBuiltinEffect(idx);
        }
        if (j.contains("params") && j["params"].is_array()) {
            for (size_t i = 0; i < j["params"].size() && i < e.params.size(); i++) e.params[i] = j["params"][i].get<float>();
        }
        e.mix = j.value("mix", 1.0f);
        e.bypass = j.value("bypass", false);
        chain.push_back(std::move(e));
    }
}

bool Composition::save(const std::string& path) {
    json j;
    j["app"] = "Strodano VJ";
    j["version"] = 1;
    j["width"] = w; j["height"] = h; j["columns"] = columns;
    j["master"] = master; j["crossfade"] = crossfade; j["bpm"] = bpm;
    j["effects"] = fxToJson(fx);
    json ls = json::array();
    for (auto& L : layers) {
        json l;
        l["name"] = L.name; l["opacity"] = L.opacity; l["blend"] = L.blend; l["bypass"] = L.bypass; l["solo"] = L.solo;
        l["xfade"] = L.xfade; l["scale"] = L.scale; l["x"] = L.posX; l["y"] = L.posY; l["fit"] = L.fit;
        l["effects"] = fxToJson(L.fx);
        json cs = json::array();
        for (auto& c : L.clips) {
            json cj;
            cj["type"] = (int)c.type;
            if (!c.empty()) {
                cj["name"] = c.name; cj["path"] = c.path; cj["speed"] = c.speed; cj["params"] = c.params;
                if (c.type == ClipType::Generator) cj["gen"] = builtinGenerators()[c.gen].name;
                if (c.plug) cj["id"] = c.plug->id;
            }
            cs.push_back(cj);
        }
        l["clips"] = cs;
        ls.push_back(l);
    }
    j["layers"] = ls;
    j["output"] = json::parse(output::serialize(), nullptr, false);
    std::error_code ec;
    std::filesystem::create_directories(std::filesystem::u8path(path).parent_path(), ec);
    std::ofstream f(std::filesystem::u8path(path));
    if (!f) return false;
    f << j.dump(1);
    file = path;
    return (bool)f;
}

bool Composition::load(const std::string& path) {
    std::ifstream f(std::filesystem::u8path(path));
    if (!f) return false;
    json j = json::parse(f, nullptr, false);
    if (j.is_discarded() || !j.contains("layers") || !j["layers"].is_array()) return false;
    try {
        init(j.value("width", 1920), j.value("height", 1080), 0, std::clamp(j.value("columns", 8), 1, 64));
        master = j.value("master", 1.0f); crossfade = j.value("crossfade", 0.5f); bpm = j.value("bpm", 120.0f);
        if (j.contains("effects")) fxFromJson(j["effects"], fx);
        for (auto& l : j["layers"]) {
            addLayer();
            int li = (int)layers.size() - 1;
            Layer& L = layers[li];
            L.name = l.value("name", L.name); L.opacity = l.value("opacity", 1.0f);
            L.blend = std::clamp(l.value("blend", 0), 0, BlendCount - 1);
            L.bypass = l.value("bypass", false); L.solo = l.value("solo", false); L.xfade = std::clamp(l.value("xfade", 0), 0, 2);
            L.scale = l.value("scale", 1.0f); L.posX = l.value("x", 0.0f); L.posY = l.value("y", 0.0f); L.fit = std::clamp(l.value("fit", 0), 0, 2);
            if (l.contains("effects")) fxFromJson(l["effects"], L.fx);
            if (!l.contains("clips") || !l["clips"].is_array()) continue;
            int col = 0;
            for (auto& cj : l["clips"]) {
                if (col >= columns) break;
                ClipType t = (ClipType)cj.value("type", 0);
                std::string name = cj.value("name", "");
                if (t == ClipType::Video) setVideo(li, col, cj.value("path", ""));
                else if (t == ClipType::Generator) setGenerator(li, col, findGenerator(cj.value("gen", "")));
                else if (t == ClipType::FFGLSource) setFFGLSource(li, col, ffgl::find(cj.value("id", ""), name));
                Clip& c = layers[li].clips[col];
                if (!c.empty()) {
                    c.speed = cj.value("speed", 1.0f);
                    if (cj.contains("params") && cj["params"].is_array())
                        for (size_t i = 0; i < cj["params"].size() && i < c.params.size(); i++) c.params[i] = cj["params"][i].get<float>();
                }
                col++;
            }
        }
        if (layers.empty()) addLayer();
        if (j.contains("output")) output::deserialize(j["output"].dump());
    } catch (const std::exception&) {
        if (layers.empty()) init(1920, 1080, 3, 8);
        return false;
    }
    file = path;
    return true;
}
