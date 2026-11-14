// Strodano VJ - application state shared between main and the UI (GPL-3.0)
#pragma once
#include "comp.h"
#include <string>
#include <vector>

struct GLFWwindow;

struct App {
    Composition comp;
    GLFWwindow* win = nullptr;
    int selLayer = 0, selCol = -1;
    bool showOutputSetup = false;
    bool wantQuit = false;
    float fps = 0, frameMs = 0;
    std::string configDir, docsDir, browseDir;
    std::vector<std::string> pluginDirs;
    std::vector<std::string> dropped;      // files dropped from the OS this frame
    double dropX = 0, dropY = 0;
    std::string status;
};

void setupStyle(float scale);
void drawUI(App& app);
