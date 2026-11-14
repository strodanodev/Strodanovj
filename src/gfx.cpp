#include "gfx.h"
#include <cstdio>
#include <vector>

void Fbo::create(int w_, int h_) {
    destroy();
    w = w_; h = h_;
    tex = gfx::makeTexture(w, h);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}
void Fbo::destroy() {
    if (fbo) glDeleteFramebuffers(1, &fbo);
    if (tex) glDeleteTextures(1, &tex);
    fbo = tex = 0;
}
void Fbo::bind() const {
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glViewport(0, 0, w, h);
}
void Fbo::clear(float r, float g, float b, float a) const {
    bind();
    glClearColor(r, g, b, a);
    glClear(GL_COLOR_BUFFER_BIT);
}

namespace gfx {
const char* kHeader = "#version 410 core\n";
static const char* kVS =
    "#version 410 core\n"
    "out vec2 uv;\n"
    "void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);\n"
    "  uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }\n";
static GLuint g_vao = 0;

GLuint makeVao() { GLuint v; glGenVertexArrays(1, &v); return v; }
void init() { g_vao = makeVao(); resetState(); }

static GLuint compile(GLenum type, const std::string& src) {
    GLuint s = glCreateShader(type);
    const char* c = src.c_str();
    glShaderSource(s, 1, &c, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[2048];
        glGetShaderInfoLog(s, sizeof log, nullptr, log);
        fprintf(stderr, "shader compile error:\n%s\n", log);
        glDeleteShader(s);
        return 0;
    }
    return s;
}
GLuint programVF(const std::string& vs, const std::string& fs) {
    GLuint v = compile(GL_VERTEX_SHADER, vs), f = compile(GL_FRAGMENT_SHADER, fs);
    if (!v || !f) return 0;
    GLuint p = glCreateProgram();
    glAttachShader(p, v); glAttachShader(p, f);
    glLinkProgram(p);
    glDeleteShader(v); glDeleteShader(f);
    GLint ok = 0;
    glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[2048];
        glGetProgramInfoLog(p, sizeof log, nullptr, log);
        fprintf(stderr, "program link error:\n%s\n", log);
        glDeleteProgram(p);
        return 0;
    }
    return p;
}
GLuint program(const std::string& fragBody) { return programVF(kVS, std::string(kHeader) + fragBody); }

void drawFullscreen() {
    glBindVertexArray(g_vao);
    glDrawArrays(GL_TRIANGLES, 0, 3);
}
GLuint makeTexture(int w, int h, const void* rgba) {
    GLuint t;
    glGenTextures(1, &t);
    glBindTexture(GL_TEXTURE_2D, t);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    return t;
}
void resetState() {
    glUseProgram(0);
    glDisable(GL_BLEND);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_STENCIL_TEST);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
    glBindBuffer(GL_PIXEL_UNPACK_BUFFER, 0);
    glActiveTexture(GL_TEXTURE0);
    glBindVertexArray(g_vao);
}
}
