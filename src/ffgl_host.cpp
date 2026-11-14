#include "ffgl_host.h"
#include "gfx.h"
#include <cstdio>
#include <cstring>
#include <filesystem>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace fs = std::filesystem;

// ---- FFGL ABI (subset), as defined by the FreeFrame GL 2.x specification ----
namespace {
enum : uint32_t {
    FF_GET_INFO = 0, FF_DEINITIALISE = 2, FF_GET_NUM_PARAMETERS = 4, FF_GET_PARAMETER_NAME = 5,
    FF_GET_PARAMETER_DEFAULT = 6, FF_SET_PARAMETER = 8, FF_GET_PARAMETER_TYPE = 15, FF_PROCESS_OPENGL = 17,
    FF_INSTANTIATE_GL = 18, FF_DEINSTANTIATE_GL = 19, FF_SET_TIME = 20, FF_CONNECT = 21, FF_INITIALISE_V2 = 34,
    FF_SET_BEATINFO = 38, FF_SET_HOSTINFO = 39, FF_GET_RANGE = 41,
};
const uint32_t FF_SUCCESS = 0, FF_FAIL = 0xFFFFFFFF;
const uint32_t FF_TYPE_BOOLEAN = 0, FF_TYPE_EVENT = 1, FF_TYPE_STANDARD = 10, FF_TYPE_OPTION = 11,
               FF_TYPE_BUFFER = 12, FF_TYPE_INTEGER = 13, FF_TYPE_FILE = 14, FF_TYPE_TEXT = 100;

union FFMixed { uint32_t UIntValue; void* PointerValue; };
typedef void* FFInstanceID;
struct PluginInfoStruct {
    uint32_t APIMajorVersion, APIMinorVersion;
    char PluginUniqueID[4];
    char PluginName[16];
    uint32_t PluginType;
};
struct SetParameterStruct { uint32_t ParameterNumber; FFMixed NewParameterValue; };
struct SetBeatinfoStruct { float bpm; float barPhase; };
struct SetHostinfoStruct { const char* name; const char* version; };
struct RangeStruct { float min, max; };
struct GetRangeStruct { uint32_t parameterNumber; RangeStruct range; };
struct FFGLViewportStruct { GLuint x, y, width, height; };
struct FFGLTextureStruct { uint32_t Width, Height, HardwareWidth, HardwareHeight; GLuint Handle; };
struct ProcessOpenGLStruct { uint32_t numInputTextures; FFGLTextureStruct** inputTextures; GLuint HostFBO; };

#ifdef _WIN32
typedef FFMixed(__stdcall* MainFn)(uint32_t, FFMixed, FFInstanceID);
#else
typedef FFMixed (*MainFn)(uint32_t, FFMixed, FFInstanceID);
#endif

FFMixed mixedU(uint32_t v) { FFMixed m; m.PointerValue = nullptr; m.UIntValue = v; return m; }
FFMixed mixedP(void* p) { FFMixed m; m.PointerValue = p; return m; }
FFMixed call(FFGLPlugin* p, uint32_t fn, FFMixed in, FFInstanceID id = nullptr) {
    return ((MainFn)p->mainFn)(fn, in, id);
}
// FFGL plugins expect the host context in its default state (no program, texture, buffer or VAO bound).
void defaultState() {
    glUseProgram(0);
    for (int unit = 3; unit >= 0; unit--) {
        glActiveTexture(GL_TEXTURE0 + unit);
        glBindTexture(GL_TEXTURE_2D, 0);
    }
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glBindBuffer(GL_PIXEL_UNPACK_BUFFER, 0);
    glBindVertexArray(0);
    glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
    glBindBuffer(GL_UNIFORM_BUFFER, 0);
    glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
    glDisable(GL_CULL_FACE);
    glFrontFace(GL_CCW);
    glDisable(GL_BLEND);
    glBlendEquation(GL_FUNC_ADD);
    glBlendFunc(GL_ONE, GL_ZERO);
    glDepthMask(GL_TRUE);
    glDisable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glDisable(GL_SCISSOR_TEST);
}
bool failedPtr(FFMixed m) { return !m.PointerValue || (uintptr_t)m.PointerValue == (uintptr_t)FF_FAIL; }

std::string fixedStr(const char* s, size_t n) {
    std::string r(s, strnlen(s, n));
    while (!r.empty() && r.back() == ' ') r.pop_back();
    return r;
}

void* openLib(const fs::path& file) {
#ifdef _WIN32
    return (void*)LoadLibraryW(file.wstring().c_str());
#else
    return dlopen(file.string().c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
}
void* symbol(void* lib, const char* name) {
#ifdef _WIN32
    return (void*)GetProcAddress((HMODULE)lib, name);
#else
    return dlsym(lib, name);
#endif
}
void closeLib(void* lib) {
#ifdef _WIN32
    FreeLibrary((HMODULE)lib);
#else
    dlclose(lib);
#endif
}

FFGLPlugin* loadPlugin(const fs::path& file, const std::string& shownPath) {
    void* lib = openLib(file);
    if (!lib) return nullptr;
    void* fn = symbol(lib, "plugMain");
    if (!fn) { closeLib(lib); return nullptr; }
    auto* p = new FFGLPlugin;
    p->lib = lib; p->mainFn = fn; p->path = shownPath;
    auto reject = [&](const char* why) {
        fprintf(stderr, "FFGL: skipping %s (%s)\n", shownPath.c_str(), why);
        closeLib(lib); delete p; return (FFGLPlugin*)nullptr;
    };
    FFMixed info = call(p, FF_GET_INFO, mixedU(0));
    if (failedPtr(info)) return reject("no plugin info");
    auto* pi = (PluginInfoStruct*)info.PointerValue;
    if (pi->APIMajorVersion < 2) return reject("FFGL 1.x plugin; only FFGL 2.x is supported");
    p->id = fixedStr(pi->PluginUniqueID, 4);
    p->name = fixedStr(pi->PluginName, 16);
    p->type = pi->PluginType;
    if (p->name.empty()) p->name = file.stem().string();
    SetHostinfoStruct host{"Strodano VJ", "0.1"};
    call(p, FF_SET_HOSTINFO, mixedP(&host));
    if (call(p, FF_INITIALISE_V2, mixedU(0)).UIntValue != FF_SUCCESS) return reject("initialise failed");
    uint32_t n = call(p, FF_GET_NUM_PARAMETERS, mixedU(0)).UIntValue;
    if (n == FF_FAIL || n > 512) n = 0;
    for (uint32_t i = 0; i < n; i++) {
        FFGLParamInfo pr;
        FFMixed nm = call(p, FF_GET_PARAMETER_NAME, mixedU(i));
        pr.name = failedPtr(nm) ? "Param " + std::to_string(i + 1) : fixedStr((const char*)nm.PointerValue, 64);
        pr.type = call(p, FF_GET_PARAMETER_TYPE, mixedU(i)).UIntValue;
        if (pr.type == FF_TYPE_TEXT || pr.type == FF_TYPE_FILE || pr.type == FF_TYPE_BUFFER) {
            pr.usable = false;
        } else {
            uint32_t bits = call(p, FF_GET_PARAMETER_DEFAULT, mixedU(i)).UIntValue;
            memcpy(&pr.def, &bits, 4);
            if (pr.type == FF_TYPE_OPTION || pr.type == FF_TYPE_INTEGER || pr.type == FF_TYPE_STANDARD) {
                GetRangeStruct gr{i, {0.0f, 1.0f}};
                call(p, FF_GET_RANGE, mixedP(&gr));
                if (gr.range.max > gr.range.min) { pr.min = gr.range.min; pr.max = gr.range.max; }
            }
            if (!(pr.def == pr.def)) pr.def = 0;   // NaN guard
        }
        p->params.push_back(pr);
    }
    return p;
}
}   // namespace

namespace ffgl {
std::vector<FFGLPlugin*>& plugins() { static std::vector<FFGLPlugin*> v; return v; }

std::vector<std::string> defaultDirs() {
    std::vector<std::string> d;
    std::error_code ec;
    d.push_back((fs::current_path(ec) / "plugins").string());
    const char* home =
#ifdef _WIN32
        getenv("USERPROFILE");
#else
        getenv("HOME");
#endif
    if (home) {
        fs::path docs = fs::path(home) / "Documents";
        d.push_back((docs / "Strodano" / "Plugins").string());
        // Resolume's own plugin folders, so an existing plugin collection is picked up as-is.
        d.push_back((docs / "Resolume Arena" / "Extra Effects").string());
        d.push_back((docs / "Resolume Avenue" / "Extra Effects").string());
    }
    return d;
}

void scan(const std::vector<std::string>& dirs) {
    auto& list = plugins();
    for (const auto& dir : dirs) {
        std::error_code ec;
        if (!fs::is_directory(dir, ec)) continue;
        for (auto it = fs::recursive_directory_iterator(dir, fs::directory_options::skip_permission_denied, ec);
             it != fs::recursive_directory_iterator(); it.increment(ec)) {
            if (ec) break;
            fs::path f = it->path();
            std::string ext = f.extension().string();
            for (auto& c : ext) c = (char)tolower((unsigned char)c);
            fs::path bin;
#if defined(_WIN32)
            if (ext == ".dll" && it->is_regular_file(ec)) bin = f;
#elif defined(__APPLE__)
            if (ext == ".bundle" && it->is_directory(ec)) {
                bin = f / "Contents" / "MacOS" / f.stem();
                it.disable_recursion_pending();
            }
#else
            if (ext == ".so" && it->is_regular_file(ec)) bin = f;
#endif
            if (bin.empty()) continue;
            bool dup = false;
            for (auto* q : list) if (q->path == f.string()) dup = true;
            if (dup) continue;
            if (FFGLPlugin* p = loadPlugin(bin, f.string())) list.push_back(p);
        }
    }
}

FFGLPlugin* find(const std::string& id, const std::string& name) {
    for (auto* p : plugins()) if (p->id == id && p->name == name) return p;
    for (auto* p : plugins()) if (p->name == name) return p;
    return nullptr;
}

FFGLInstance* instantiate(FFGLPlugin* p, int w, int h) {
    if (!p) return nullptr;
    FFGLViewportStruct vp{0, 0, (GLuint)w, (GLuint)h};
    defaultState();
    FFMixed r = call(p, FF_INSTANTIATE_GL, mixedP(&vp));
    gfx::resetState();
    if (failedPtr(r)) return nullptr;
    auto* i = new FFGLInstance;
    i->plug = p; i->id = r.PointerValue; i->w = w; i->h = h;
    return i;
}

void destroy(FFGLInstance* inst) {
    if (!inst) return;
    defaultState();
    call(inst->plug, FF_DEINSTANTIATE_GL, mixedU(0), inst->id);
    gfx::resetState();
    delete inst;
}

bool process(FFGLInstance* inst, const std::vector<float>& params, GLuint inputTex, GLuint dstFbo, int w, int h,
             double time, float bpm, float barPhase) {
    if (!inst) return false;
    FFGLPlugin* p = inst->plug;
    for (size_t i = 0; i < p->params.size() && i < params.size(); i++) {
        if (!p->params[i].usable) continue;
        SetParameterStruct sp;
        sp.ParameterNumber = (uint32_t)i;
        sp.NewParameterValue.PointerValue = nullptr;
        memcpy(&sp.NewParameterValue.UIntValue, &params[i], 4);
        call(p, FF_SET_PARAMETER, mixedP(&sp), inst->id);
    }
    double t = time;
    call(p, FF_SET_TIME, mixedP(&t), inst->id);
    SetBeatinfoStruct bi{bpm, barPhase};
    call(p, FF_SET_BEATINFO, mixedP(&bi), inst->id);

    FFGLTextureStruct tex{(uint32_t)w, (uint32_t)h, (uint32_t)w, (uint32_t)h, inputTex};
    FFGLTextureStruct* texPtr = &tex;
    ProcessOpenGLStruct pgl{inputTex ? 1u : 0u, inputTex ? &texPtr : nullptr, dstFbo};
    defaultState();
    glBindFramebuffer(GL_FRAMEBUFFER, dstFbo);
    glViewport(0, 0, w, h);
    uint32_t res = call(p, FF_PROCESS_OPENGL, mixedP(&pgl), inst->id).UIntValue;
    gfx::resetState();
    return res == FF_SUCCESS;
}
}
