// Strodano VJ - open-source live visuals (GPL-3.0)
#include "app.h"
#include "output.h"
#include <glad/gl.h>
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <thread>

namespace fs = std::filesystem;
static App* g_app = nullptr;

static void dropCallback(GLFWwindow* w, int count, const char** paths) {
    if (!g_app) return;
    glfwGetCursorPos(w, &g_app->dropX, &g_app->dropY);
    for (int i = 0; i < count; i++) g_app->dropped.push_back(paths[i]);
}

static std::string homeDir() {
#ifdef _WIN32
    const char* h = getenv("USERPROFILE");
#else
    const char* h = getenv("HOME");
#endif
    return h ? h : ".";
}

static void setupDirs(App& app) {
    fs::path home = fs::u8path(homeDir());
#if defined(_WIN32)
    const char* appdata = getenv("APPDATA");
    fs::path cfg = (appdata ? fs::u8path(appdata) : home) / "Strodano VJ";
#elif defined(__APPLE__)
    fs::path cfg = home / "Library" / "Application Support" / "Strodano VJ";
#else
    fs::path cfg = home / ".config" / "strodano-vj";
#endif
    fs::path docs = home / "Documents" / "Strodano";
    std::error_code ec;
    fs::create_directories(cfg, ec);
    fs::create_directories(docs / "Plugins", ec);
    app.configDir = cfg.u8string();
    app.docsDir = docs.u8string();
    app.browseDir = home.u8string();
    for (const char* sub : {"Videos", "Movies"})
        if (fs::is_directory(home / sub, ec)) { app.browseDir = (home / sub).u8string(); break; }
    app.pluginDirs = ffgl::defaultDirs();
}

static void writePPM(const std::string& path, int w, int h, const std::vector<unsigned char>& rgba) {
    std::ofstream f(path, std::ios::binary);
    f << "P6\n" << w << " " << h << "\n255\n";
    for (int y = h - 1; y >= 0; y--)
        for (int x = 0; x < w; x++) f.write((const char*)&rgba[((size_t)y * w + x) * 4], 3);
}

int main(int argc, char** argv) {
    // --selftest <outdir> [video]: render a fixed scene for a few seconds, dump images and timings, then exit.
    std::string selfTestDir, selfTestVideo;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--selftest") && i + 1 < argc) {
            selfTestDir = argv[++i];
            if (i + 1 < argc) selfTestVideo = argv[++i];
        }
    }
    const bool selfTest = !selfTestDir.empty();

    if (!glfwInit()) { fprintf(stderr, "Could not initialise GLFW\n"); return 1; }
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
    if (!selfTest) glfwWindowHint(GLFW_MAXIMIZED, GLFW_TRUE);
    GLFWwindow* win = glfwCreateWindow(1600, 900, "Strodano VJ", nullptr, nullptr);
    glfwDefaultWindowHints();
    if (!win) { fprintf(stderr, "Could not create an OpenGL 4.1 window. Update your graphics driver.\n"); glfwTerminate(); return 1; }
    glfwMakeContextCurrent(win);
    if (!gladLoadGL((GLADloadfunc)glfwGetProcAddress)) { fprintf(stderr, "Could not load OpenGL\n"); return 1; }
    glfwSwapInterval(1);

    App app;
    g_app = &app;
    app.win = win;
    setupDirs(app);
    glfwSetDropCallback(win, dropCallback);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    static std::string iniPath = (fs::u8path(app.configDir) / "ui.ini").u8string();
    io.IniFilename = selfTest ? nullptr : iniPath.c_str();
    float scale = 1.0f;
#ifndef __APPLE__
    float sx = 1, sy = 1;
    glfwGetWindowContentScale(win, &sx, &sy);
    scale = sx > 1.0f ? sx : 1.0f;
#endif
    ImFontConfig fc;
    fc.SizePixels = std::floor(13.0f * scale);
    io.Fonts->AddFontDefault(&fc);
    setupStyle(scale);
    ImGui_ImplGlfw_InitForOpenGL(win, true);
    ImGui_ImplOpenGL3_Init("#version 410 core");

    gfx::init();
    output::init(win);
    if (!selfTest) ffgl::scan(app.pluginDirs);
    else if (const char* extra = getenv("STRODANO_PLUGIN_DIR")) ffgl::scan({extra});

    Composition& comp = app.comp;
    std::string autosave = (fs::u8path(app.configDir) / "autosave.svj").u8string();
    bool loaded = false;
    if (!selfTest) {
        std::error_code ec;
        if (fs::exists(fs::u8path(autosave), ec)) loaded = comp.load(autosave);
        if (loaded) comp.file.clear();
    }
    if (!loaded) {   // first run: a small demo so the screen is not empty
        comp.init(1920, 1080, 3, 8);
        comp.setGenerator(0, 0, findGenerator("Plasma"));
        comp.setGenerator(0, 1, findGenerator("Tunnel"));
        comp.setGenerator(0, 2, findGenerator("Gradient"));
        comp.setGenerator(1, 0, findGenerator("Lines"));
        comp.setGenerator(1, 1, findGenerator("Checkerboard"));
        comp.setGenerator(2, 0, findGenerator("Beat Flash"));
        comp.layers[1].blend = BlendAdd;
        comp.layers[2].blend = BlendAdd;
        comp.trigger(0, 0);
    }
    if (selfTest) {
        comp.trigger(1, 0);
        comp.layers[1].opacity = 0.5f;
        comp.layers[0].fx.push_back(makeBuiltinEffect(findEffect("Kaleidoscope")));
        comp.fx.push_back(makeBuiltinEffect(findEffect("RGB Shift")));
        if (!selfTestVideo.empty()) { comp.setVideo(2, 1, selfTestVideo); comp.layers[2].blend = BlendAlpha; comp.layers[2].scale = 0.6f; comp.trigger(2, 1); }
        for (auto* p : ffgl::plugins()) {
            printf("selftest: FFGL plugin '%s' type %u params %zu\n", p->name.c_str(), p->type, p->params.size());
            if (p->isEffect()) comp.fx.push_back(makeFFGLEffect(p));
            if (p->isSource()) { comp.setFFGLSource(1, 3, p); comp.trigger(1, 3); }
        }
        auto& sl = output::screens()[0].slices[0];
        float q[4][2] = {{0.1f, 0.05f}, {0.9f, 0.15f}, {0.8f, 0.9f}, {0.05f, 0.8f}};
        memcpy(sl.c, q, sizeof q);
        sl.setGrid(2);
        sl.warp[4 * 2] = 0.05f;
        app.showOutputSetup = false;
        app.selLayer = 2; app.selCol = 1;
    }

    double last = glfwGetTime(), fpsT = last, worst = 0, total = 0;
    int fpsN = 0, frame = 0, swapMode = -1;
    while (!glfwWindowShouldClose(win) && !app.wantQuit) {
        glfwPollEvents();
        double now = glfwGetTime();
        double dt = std::min(now - last, 0.1);
        last = now;
        if (selfTest) dt = 1.0 / 60.0;

        comp.update(dt);
        comp.render();
        output::render(comp.outTex);

        int fw, fh;
        glfwGetFramebufferSize(win, &fw, &fh);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, fw, fh);
        glClearColor(0.05f, 0.05f, 0.06f, 1);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();
        drawUI(app);
        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        gfx::resetState();

        // The output windows carry the vsync when they are open, so the UI never holds the show back.
        int wantMode = output::anyOpen() ? 0 : 1;
        if (wantMode != swapMode) { glfwSwapInterval(wantMode); swapMode = wantMode; }
        double work = glfwGetTime() - now;
        if (selfTest && frame == 50) {
            std::vector<unsigned char> px((size_t)fw * fh * 4);
            glReadPixels(0, 0, fw, fh, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
            writePPM(selfTestDir + "/ui_main.ppm", fw, fh, px);
        }
        if (selfTest && frame == 150) {
            std::vector<unsigned char> px((size_t)fw * fh * 4);
            glReadPixels(0, 0, fw, fh, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
            writePPM(selfTestDir + "/ui.ppm", fw, fh, px);
            px.resize((size_t)comp.w * comp.h * 4);
            glBindFramebuffer(GL_FRAMEBUFFER, comp.rt.src().fbo);
            glReadPixels(0, 0, comp.w, comp.h, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
            writePPM(selfTestDir + "/comp.ppm", comp.w, comp.h, px);
            Screen& s0 = output::screens()[0];
            px.resize((size_t)s0.w * s0.h * 4);
            glBindFramebuffer(GL_FRAMEBUFFER, s0.fbo.fbo);
            glReadPixels(0, 0, s0.w, s0.h, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
            writePPM(selfTestDir + "/screen.ppm", s0.w, s0.h, px);
            glBindFramebuffer(GL_FRAMEBUFFER, 0);
        }
        glfwSwapBuffers(win);
        output::present();

        frame++;
        fpsN++;
        if (frame > 30) { total += work; worst = std::max(worst, work); }
        if (now - fpsT >= 0.5) {
            app.fps = (float)(fpsN / (now - fpsT));
            app.frameMs = (float)(work * 1000.0);
            fpsT = now; fpsN = 0;
        }
        if (selfTest && frame == 60) app.showOutputSetup = true;
        if (selfTest && frame >= 180) break;
        // Safety net when the driver ignores vsync: do not spin faster than ~250 fps.
        double spent = glfwGetTime() - now;
        if (!selfTest && spent < 0.004) std::this_thread::sleep_for(std::chrono::duration<double>(0.004 - spent));
    }
    if (selfTest) {
        printf("selftest: %d frames, avg render+ui %.2f ms, worst %.2f ms, video ready: %s\n", frame, total / std::max(1, frame - 30) * 1000.0,
               worst * 1000.0, comp.layers[2].player && comp.layers[2].player->ready() ? "yes" : "no");
    } else {
        std::string keep = comp.file;
        comp.save(autosave);
        comp.file = keep;
    }
    comp.clearAll();
    output::shutdown();
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(win);
    glfwTerminate();
    return 0;
}
