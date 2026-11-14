// Strodano VJ - output screens, slices, warping and masks (GPL-3.0)
#pragma once
#include "gfx.h"
#include <string>
#include <vector>

struct GLFWwindow;

struct Slice {
    std::string name = "Slice";
    bool enabled = true;
    bool isMask = false;                       // draws black instead of the composition
    float in[4] = {0, 0, 1, 1};                // x, y, w, h inside the composition (top-left origin, 0..1)
    float c[4][2] = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};   // output corners TL, TR, BR, BL (0..1)
    int grid = 0;                              // 0 = corner pin only; N = N x N cell mesh warp
    std::vector<float> warp;                   // (N+1)*(N+1) offsets (dx, dy)
    float feather = 0;                         // soft edge width, for edge blending and soft masks
    float bright = 1;
    bool flipH = false, flipV = false;
    void setGrid(int n);
};

struct Screen {
    std::string name = "Screen";
    int monitor = 0;
    bool fullscreen = true;
    GLFWwindow* win = nullptr;
    GLuint vao = 0;
    Fbo fbo;
    int w = 1920, h = 1080;
    std::vector<Slice> slices;
};

namespace output {
extern bool testPattern;
void init(GLFWwindow* mainWindow);
std::vector<Screen>& screens();
void addScreen();
void removeScreen(int idx);
bool open(int idx);
void close(int idx);
bool anyOpen();
void render(GLuint compTex);     // main context: draw every screen's slices into its FBO
void present();                  // blit to the output windows and swap them
void shutdown();
void slicePoint(const Slice& sl, float s, float t, float& x, float& y);   // unit square -> output position
std::string serialize();
void deserialize(const std::string& json);
}
