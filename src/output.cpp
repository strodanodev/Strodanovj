#include "output.h"
#include <GLFW/glfw3.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cmath>

using json = nlohmann::json;

void Slice::setGrid(int n) {
    grid = std::clamp(n, 0, 8);
    warp.assign(grid ? (size_t)(grid + 1) * (grid + 1) * 2 : 0, 0.0f);
}

namespace output {
bool testPattern = false;
static GLFWwindow* g_main = nullptr;
static GLuint g_prog = 0, g_blit = 0, g_vao = 0, g_vbo = 0;
static const int kTess = 24;

std::vector<Screen>& screens() { static std::vector<Screen> v; return v; }

void init(GLFWwindow* mainWindow) {
    g_main = mainWindow;
    g_prog = gfx::programVF(
        "#version 410 core\n"
        "layout(location=0) in vec2 pos; layout(location=1) in vec2 tc; layout(location=2) in vec2 st0;\n"
        "out vec2 uv; out vec2 st;\n"
        "void main(){ uv = tc; st = st0; gl_Position = vec4(pos, 0.0, 1.0); }\n",
        "#version 410 core\n"
        "uniform sampler2D tex; uniform float feather; uniform float bright; uniform int mask; uniform int pattern;\n"
        "in vec2 uv; in vec2 st; out vec4 o;\n"
        "void main(){ float a = 1.0;\n"
        " if (feather > 0.0) { vec2 d = min(st, 1.0 - st); a = smoothstep(0.0, feather, d.x) * smoothstep(0.0, feather, d.y); }\n"
        " if (mask == 1) { o = vec4(0.0, 0.0, 0.0, a); return; }\n"
        " vec3 c = texture(tex, uv).rgb * bright;\n"
        " if (pattern == 1) { vec2 g = abs(fract(st * 8.0) - 0.5); float line = step(0.46, max(g.x, g.y));\n"
        "  float edge = step(min(min(st.x, st.y), min(1.0 - st.x, 1.0 - st.y)), 0.01);\n"
        "  float diag = step(abs(st.x - st.y), 0.004) + step(abs(st.x + st.y - 1.0), 0.004);\n"
        "  c = mix(vec3(st.x * 0.35, 0.12, st.y * 0.35), vec3(1.0), clamp(line + edge + diag, 0.0, 1.0)); }\n"
        " o = vec4(c, a); }\n");
    g_blit = gfx::program("uniform sampler2D tex; in vec2 uv; out vec4 o; void main(){ o = vec4(texture(tex, uv).rgb, 1.0); }\n");
    g_vao = gfx::makeVao();
    glGenBuffers(1, &g_vbo);
    glBindVertexArray(g_vao);
    glBindBuffer(GL_ARRAY_BUFFER, g_vbo);
    for (int i = 0; i < 3; i++) {
        glEnableVertexAttribArray(i);
        glVertexAttribPointer(i, 2, GL_FLOAT, GL_FALSE, 6 * sizeof(float), (void*)(i * 2 * sizeof(float)));
    }
    gfx::resetState();
    if (screens().empty()) addScreen();
}

void addScreen() {
    Screen s;
    s.name = "Screen " + std::to_string(screens().size() + 1);
    s.monitor = (int)screens().size() + 1;   // monitor 0 is usually the control display
    Slice sl;
    sl.name = "Slice 1";
    s.slices.push_back(sl);
    screens().push_back(std::move(s));
}

void close(int idx) {
    if (idx < 0 || idx >= (int)screens().size()) return;
    Screen& s = screens()[idx];
    if (!s.win) return;
    glfwMakeContextCurrent(s.win);
    if (s.vao) glDeleteVertexArrays(1, &s.vao);
    s.vao = 0;
    glfwMakeContextCurrent(g_main);
    glfwDestroyWindow(s.win);
    s.win = nullptr;
}

void removeScreen(int idx) {
    if (idx < 0 || idx >= (int)screens().size()) return;
    close(idx);
    screens()[idx].fbo.destroy();
    screens().erase(screens().begin() + idx);
}

bool open(int idx) {
    if (idx < 0 || idx >= (int)screens().size()) return false;
    Screen& s = screens()[idx];
    close(idx);
    int count = 0;
    GLFWmonitor** mons = glfwGetMonitors(&count);
    if (count <= 0) return false;
    GLFWmonitor* mon = mons[std::clamp(s.monitor, 0, count - 1)];
    const GLFWvidmode* mode = glfwGetVideoMode(mon);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
    glfwWindowHint(GLFW_AUTO_ICONIFY, GLFW_FALSE);
    glfwWindowHint(GLFW_FOCUS_ON_SHOW, GLFW_FALSE);
    if (s.fullscreen) {
        glfwWindowHint(GLFW_RED_BITS, mode->redBits);
        glfwWindowHint(GLFW_GREEN_BITS, mode->greenBits);
        glfwWindowHint(GLFW_BLUE_BITS, mode->blueBits);
        glfwWindowHint(GLFW_REFRESH_RATE, mode->refreshRate);
        glfwWindowHint(GLFW_DECORATED, GLFW_FALSE);
        s.win = glfwCreateWindow(mode->width, mode->height, s.name.c_str(), mon, g_main);
    } else {
        glfwWindowHint(GLFW_DECORATED, GLFW_TRUE);
        s.win = glfwCreateWindow(960, 540, s.name.c_str(), nullptr, g_main);
        if (s.win) {
            int mx = 0, my = 0;
            glfwGetMonitorPos(mon, &mx, &my);
            glfwSetWindowPos(s.win, mx + 60, my + 60);
        }
    }
    glfwDefaultWindowHints();
    if (!s.win) return false;
    glfwMakeContextCurrent(s.win);
    s.vao = gfx::makeVao();
    glfwSwapInterval(1);
    glfwMakeContextCurrent(g_main);
    if (s.fullscreen) { s.w = mode->width; s.h = mode->height; }
    return true;
}

bool anyOpen() {
    for (auto& s : screens()) if (s.win) return true;
    return false;
}

// Projective map of the unit square onto the quad c[0..3] (TL, TR, BR, BL).
static void homography(const float c[4][2], float s, float t, float& x, float& y) {
    float x0 = c[0][0], y0 = c[0][1], x1 = c[1][0], y1 = c[1][1], x2 = c[2][0], y2 = c[2][1], x3 = c[3][0], y3 = c[3][1];
    float dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
    float dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
    float den = dx1 * dy2 - dx2 * dy1;
    float g = 0, h = 0;
    if (std::fabs(den) > 1e-9f) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
    float a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
    float wq = g * s + h * t + 1.0f;
    if (std::fabs(wq) < 1e-6f) wq = 1e-6f;
    x = (a * s + b * t + x0) / wq;
    y = (d * s + e * t + y0) / wq;
}

static void warpOffset(const Slice& sl, float s, float t, float& dx, float& dy) {
    dx = dy = 0;
    int n = sl.grid;
    if (n <= 0 || sl.warp.size() < (size_t)(n + 1) * (n + 1) * 2) return;
    float fs = s * n, ft = t * n;
    int i = std::min((int)fs, n - 1), j = std::min((int)ft, n - 1);
    float u = fs - i, v = ft - j;
    auto at = [&](int ii, int jj, int k) { return sl.warp[((size_t)jj * (n + 1) + ii) * 2 + k]; };
    for (int k = 0; k < 2; k++) {
        float top = at(i, j, k) * (1 - u) + at(i + 1, j, k) * u;
        float bot = at(i, j + 1, k) * (1 - u) + at(i + 1, j + 1, k) * u;
        (k == 0 ? dx : dy) = top * (1 - v) + bot * v;
    }
}

void slicePoint(const Slice& sl, float s, float t, float& x, float& y) {
    homography(sl.c, s, t, x, y);
    float dx, dy;
    warpOffset(sl, s, t, dx, dy);
    x += dx; y += dy;
}

static void drawSlice(const Slice& sl, GLuint compTex) {
    static std::vector<float> v;
    v.clear();
    auto vert = [&](int i, int j) {
        float s = (float)i / kTess, t = (float)j / kTess, x, y;
        slicePoint(sl, s, t, x, y);
        float ss = sl.flipH ? 1 - s : s, tt = sl.flipV ? 1 - t : t;
        float u = sl.in[0] + ss * sl.in[2], w = sl.in[1] + tt * sl.in[3];
        v.insert(v.end(), {x * 2 - 1, 1 - y * 2, u, 1 - w, s, t});
    };
    for (int j = 0; j < kTess; j++)
        for (int i = 0; i < kTess; i++) {
            vert(i, j); vert(i + 1, j); vert(i + 1, j + 1);
            vert(i, j); vert(i + 1, j + 1); vert(i, j + 1);
        }
    glBindVertexArray(g_vao);
    glBindBuffer(GL_ARRAY_BUFFER, g_vbo);
    glBufferData(GL_ARRAY_BUFFER, v.size() * sizeof(float), v.data(), GL_STREAM_DRAW);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, compTex);
    glUniform1f(glGetUniformLocation(g_prog, "feather"), sl.feather);
    glUniform1f(glGetUniformLocation(g_prog, "bright"), sl.bright);
    glUniform1i(glGetUniformLocation(g_prog, "mask"), sl.isMask ? 1 : 0);
    glUniform1i(glGetUniformLocation(g_prog, "pattern"), testPattern && !sl.isMask ? 1 : 0);
    glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(v.size() / 6));
}

void render(GLuint compTex) {
    for (auto& s : screens()) {
        if (s.fbo.w != s.w || s.fbo.h != s.h || !s.fbo.fbo) s.fbo.create(s.w, s.h);
        s.fbo.clear(0, 0, 0, 1);
        if (!compTex) continue;
        glUseProgram(g_prog);
        glUniform1i(glGetUniformLocation(g_prog, "tex"), 0);
        glEnable(GL_BLEND);
        glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE);
        for (auto& sl : s.slices) if (sl.enabled) drawSlice(sl, compTex);
        glDisable(GL_BLEND);
    }
    gfx::resetState();
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void present() {
    bool any = false;
    for (size_t i = 0; i < screens().size(); i++) {
        Screen& s = screens()[i];
        if (!s.win) continue;
        if (glfwWindowShouldClose(s.win)) { close((int)i); continue; }
        any = true;
        glfwMakeContextCurrent(s.win);
        int fw, fh;
        glfwGetFramebufferSize(s.win, &fw, &fh);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, fw, fh);
        glDisable(GL_BLEND);
        glUseProgram(g_blit);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, s.fbo.tex);
        glUniform1i(glGetUniformLocation(g_blit, "tex"), 0);
        glBindVertexArray(s.vao);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glfwSwapBuffers(s.win);
    }
    if (any) glfwMakeContextCurrent(g_main);
}

void shutdown() {
    for (size_t i = 0; i < screens().size(); i++) close((int)i);
}

std::string serialize() {
    json a = json::array();
    for (auto& s : screens()) {
        json j;
        j["name"] = s.name; j["monitor"] = s.monitor; j["fullscreen"] = s.fullscreen; j["w"] = s.w; j["h"] = s.h;
        json sls = json::array();
        for (auto& sl : s.slices) {
            json q;
            q["name"] = sl.name; q["enabled"] = sl.enabled; q["mask"] = sl.isMask;
            q["in"] = {sl.in[0], sl.in[1], sl.in[2], sl.in[3]};
            q["corners"] = {sl.c[0][0], sl.c[0][1], sl.c[1][0], sl.c[1][1], sl.c[2][0], sl.c[2][1], sl.c[3][0], sl.c[3][1]};
            q["grid"] = sl.grid; q["warp"] = sl.warp; q["feather"] = sl.feather; q["bright"] = sl.bright;
            q["flipH"] = sl.flipH; q["flipV"] = sl.flipV;
            sls.push_back(q);
        }
        j["slices"] = sls;
        a.push_back(j);
    }
    return a.dump();
}

void deserialize(const std::string& text) {
    json a = json::parse(text, nullptr, false);
    if (!a.is_array() || a.empty()) return;
    while (!screens().empty()) removeScreen(0);
    for (auto& j : a) {
        Screen s;
        s.name = j.value("name", "Screen"); s.monitor = j.value("monitor", 1); s.fullscreen = j.value("fullscreen", true);
        s.w = std::clamp(j.value("w", 1920), 16, 16384); s.h = std::clamp(j.value("h", 1080), 16, 16384);
        if (j.contains("slices") && j["slices"].is_array()) {
            for (auto& q : j["slices"]) {
                Slice sl;
                sl.name = q.value("name", "Slice"); sl.enabled = q.value("enabled", true); sl.isMask = q.value("mask", false);
                if (q.contains("in") && q["in"].size() == 4) for (int i = 0; i < 4; i++) sl.in[i] = q["in"][i].get<float>();
                if (q.contains("corners") && q["corners"].size() == 8)
                    for (int i = 0; i < 8; i++) sl.c[i / 2][i % 2] = q["corners"][i].get<float>();
                sl.setGrid(q.value("grid", 0));
                if (q.contains("warp") && q["warp"].size() == sl.warp.size())
                    for (size_t i = 0; i < sl.warp.size(); i++) sl.warp[i] = q["warp"][i].get<float>();
                sl.feather = q.value("feather", 0.0f); sl.bright = q.value("bright", 1.0f);
                sl.flipH = q.value("flipH", false); sl.flipV = q.value("flipV", false);
                s.slices.push_back(std::move(sl));
            }
        }
        screens().push_back(std::move(s));
    }
}
}
