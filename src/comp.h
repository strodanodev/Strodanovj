// Strodano VJ - composition model and renderer (GPL-3.0)
#pragma once
#include "effects.h"
#include "ffgl_host.h"
#include "gfx.h"
#include "video.h"
#include <memory>
#include <string>
#include <vector>

struct Effect {
    int builtin = -1;                 // index into builtinEffects(), or -1 for FFGL
    FFGLPlugin* plug = nullptr;
    FFGLInstance* inst = nullptr;
    std::string name;
    std::vector<float> params;
    std::vector<int> eventPulse;      // FFGL event params: frames left to hold "pressed"
    float mix = 1.0f;
    bool bypass = false;
};

enum class ClipType { Empty, Video, Generator, FFGLSource };

struct Clip {
    ClipType type = ClipType::Empty;
    std::string path, name;
    int gen = -1;
    FFGLPlugin* plug = nullptr;
    std::vector<float> params;
    float speed = 1.0f;
    GLuint thumb = 0;
    bool thumbFlip = false;           // FBO-rendered thumbnails are bottom-up
    bool empty() const { return type == ClipType::Empty; }
};

enum BlendMode { BlendAlpha, BlendAdd, BlendSubtract, BlendMultiply, BlendScreen, BlendLighten, BlendDarken, BlendDifference, BlendCount };
extern const char* kBlendNames[BlendCount];

struct Layer {
    std::string name;
    std::vector<Clip> clips;
    int active = -1;
    std::unique_ptr<VideoPlayer> player, pending;
    int pendingCol = -1;
    FFGLInstance* srcInst = nullptr;
    float opacity = 1.0f;
    int blend = BlendAlpha;
    bool bypass = false, solo = false;
    int xfade = 0;                    // 0 none, 1 A, 2 B
    float scale = 1.0f, posX = 0, posY = 0;
    int fit = 0;                      // 0 fill, 1 fit, 2 stretch
    std::vector<Effect> fx;
    PingPong rt;
    GLuint outTex = 0;                // result of last render (0 if nothing rendered)
};

struct Composition {
    int w = 1920, h = 1080;
    int columns = 8;
    std::vector<Layer> layers;        // index 0 is the bottom layer
    std::vector<Effect> fx;
    float master = 1.0f;
    float crossfade = 0.5f;
    float bpm = 120.0f;
    double beats = 0;                 // running beat counter
    double time = 0;
    PingPong rt;
    GLuint outTex = 0;
    std::string file;

    void init(int w, int h, int layers, int columns);
    void resize(int w, int h);
    void addLayer();
    void removeLayer(int idx);
    void setColumns(int n);
    void trigger(int layer, int col);
    void triggerColumn(int col);
    void eject(int layer);
    void update(double dt);           // advance clocks, upload video frames
    void render();                    // produce outTex
    void clearAll();

    bool setVideo(int layer, int col, const std::string& path);
    void setGenerator(int layer, int col, int gen);
    void setFFGLSource(int layer, int col, FFGLPlugin* p);
    void clearClip(int layer, int col);

    bool save(const std::string& path);
    bool load(const std::string& path);
};

Effect makeBuiltinEffect(int idx);
Effect makeFFGLEffect(FFGLPlugin* p);
void freeEffect(Effect& e);
void applyChain(std::vector<Effect>& chain, PingPong& rt, const Composition& c);
bool isMediaFile(const std::string& path);
