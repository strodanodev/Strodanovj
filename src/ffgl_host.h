// Strodano VJ - FFGL 2.x plugin host (GPL-3.0)
// Loads the same FFGL plugins (.dll on Windows, .bundle on macOS) that Resolume loads.
#pragma once
#include <glad/gl.h>
#include <cstdint>
#include <string>
#include <vector>

struct FFGLParamInfo {
    std::string name;
    uint32_t type = 10;
    float def = 0, min = 0, max = 1;
    bool usable = true;          // false for text/file/buffer parameters (not exposed yet)
};

struct FFGLPlugin {
    std::string path, name, id;
    uint32_t type = 0;           // 0 effect, 1 source, 2 mixer
    void* lib = nullptr;
    void* mainFn = nullptr;
    std::vector<FFGLParamInfo> params;
    bool isEffect() const { return type == 0; }
    bool isSource() const { return type == 1; }
};

struct FFGLInstance {
    FFGLPlugin* plug = nullptr;
    void* id = nullptr;
    int w = 0, h = 0;
};

namespace ffgl {
std::vector<FFGLPlugin*>& plugins();
void scan(const std::vector<std::string>& dirs);     // loads every plugin found (recursively)
std::vector<std::string> defaultDirs();
FFGLPlugin* find(const std::string& id, const std::string& name);
FFGLInstance* instantiate(FFGLPlugin* p, int w, int h);
void destroy(FFGLInstance* inst);
// Renders into dstFbo. inputTex may be 0 for sources.
bool process(FFGLInstance* inst, const std::vector<float>& params, GLuint inputTex, GLuint dstFbo, int w, int h,
             double time, float bpm, float barPhase);
}
