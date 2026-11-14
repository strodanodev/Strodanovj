// Strodano VJ - small OpenGL helpers (GPL-3.0)
#pragma once
#include <glad/gl.h>
#include <string>

struct Fbo {
    GLuint fbo = 0, tex = 0;
    int w = 0, h = 0;
    void create(int w, int h);
    void destroy();
    void bind() const;
    void clear(float r = 0, float g = 0, float b = 0, float a = 0) const;
};

// Two render targets that swap: effects read from one and write to the other.
struct PingPong {
    Fbo f[2];
    int cur = 0;
    void create(int w, int h) { f[0].create(w, h); f[1].create(w, h); cur = 0; }
    void destroy() { f[0].destroy(); f[1].destroy(); }
    Fbo& src() { return f[cur]; }
    Fbo& dst() { return f[1 - cur]; }
    void swap() { cur = 1 - cur; }
};

namespace gfx {
void init();                                   // call once per GL context that owns the shared objects
GLuint makeVao();                              // VAOs are per-context
GLuint program(const std::string& fragBody);   // fullscreen-triangle program; returns 0 on failure
GLuint programVF(const std::string& vs, const std::string& fs);
void drawFullscreen();                         // draws with the currently bound program
GLuint makeTexture(int w, int h, const void* rgba = nullptr);
void resetState();                             // restore the state our passes rely on (after foreign code ran)
extern const char* kHeader;                    // "#version 410 core" + common uniforms
}
