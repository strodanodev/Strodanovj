// Strodano VJ - user interface (GPL-3.0)
#include "app.h"
#include "output.h"
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>

namespace fs = std::filesystem;

static const ImU32 kAccent = IM_COL32(255, 122, 26, 255);
static const ImU32 kAccentDim = IM_COL32(150, 74, 20, 255);
static const ImU32 kCellBg = IM_COL32(30, 32, 38, 255);
static const ImU32 kCellEmpty = IM_COL32(22, 23, 27, 255);

static ImTextureID texId(GLuint t) { return (ImTextureID)(intptr_t)t; }

void setupStyle(float scale) {
    ImGui::StyleColorsDark();
    ImGuiStyle& s = ImGui::GetStyle();
    s.WindowRounding = 0; s.FrameRounding = 3; s.GrabRounding = 3; s.TabRounding = 3;
    s.WindowBorderSize = 1; s.FramePadding = ImVec2(6, 4); s.ItemSpacing = ImVec2(6, 5);
    ImVec4* c = s.Colors;
    c[ImGuiCol_WindowBg] = ImVec4(0.075f, 0.08f, 0.095f, 1);
    c[ImGuiCol_ChildBg] = ImVec4(0.06f, 0.065f, 0.075f, 1);
    c[ImGuiCol_PopupBg] = ImVec4(0.09f, 0.095f, 0.11f, 1);
    c[ImGuiCol_Border] = ImVec4(0.18f, 0.19f, 0.22f, 1);
    c[ImGuiCol_FrameBg] = ImVec4(0.14f, 0.15f, 0.18f, 1);
    c[ImGuiCol_FrameBgHovered] = ImVec4(0.2f, 0.21f, 0.25f, 1);
    c[ImGuiCol_FrameBgActive] = ImVec4(0.25f, 0.26f, 0.3f, 1);
    c[ImGuiCol_TitleBg] = c[ImGuiCol_TitleBgActive] = ImVec4(0.1f, 0.105f, 0.12f, 1);
    c[ImGuiCol_MenuBarBg] = ImVec4(0.1f, 0.105f, 0.12f, 1);
    c[ImGuiCol_SliderGrab] = ImVec4(1.0f, 0.48f, 0.1f, 1);
    c[ImGuiCol_SliderGrabActive] = ImVec4(1.0f, 0.6f, 0.25f, 1);
    c[ImGuiCol_CheckMark] = ImVec4(1.0f, 0.48f, 0.1f, 1);
    c[ImGuiCol_Button] = ImVec4(0.17f, 0.18f, 0.22f, 1);
    c[ImGuiCol_ButtonHovered] = ImVec4(0.26f, 0.27f, 0.32f, 1);
    c[ImGuiCol_ButtonActive] = ImVec4(1.0f, 0.48f, 0.1f, 1);
    c[ImGuiCol_Header] = ImVec4(0.17f, 0.18f, 0.22f, 1);
    c[ImGuiCol_HeaderHovered] = ImVec4(0.26f, 0.27f, 0.32f, 1);
    c[ImGuiCol_HeaderActive] = ImVec4(0.6f, 0.3f, 0.08f, 1);
    c[ImGuiCol_Tab] = ImVec4(0.12f, 0.125f, 0.15f, 1);
    c[ImGuiCol_TabHovered] = ImVec4(0.6f, 0.3f, 0.08f, 1);
    c[ImGuiCol_TabSelected] = ImVec4(0.42f, 0.22f, 0.07f, 1);
    c[ImGuiCol_DragDropTarget] = ImVec4(1.0f, 0.48f, 0.1f, 1);
    s.ScaleAllSizes(scale);
}

// ---------- small helpers ----------
static bool toggleButton(const char* label, bool on, ImVec2 size = ImVec2(0, 0), ImU32 onCol = kAccent) {
    if (on) {
        ImGui::PushStyleColor(ImGuiCol_Button, onCol);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, onCol);
        ImGui::PushStyleColor(ImGuiCol_Text, IM_COL32(15, 15, 15, 255));
    }
    bool clicked = ImGui::Button(label, size);
    if (on) ImGui::PopStyleColor(3);
    return clicked;
}

static void imageFit(GLuint tex, float texAspect, ImVec2 avail, bool flipY = true) {
    ImVec2 p = ImGui::GetCursorScreenPos();
    float w = avail.x, h = avail.x / texAspect;
    if (h > avail.y) { h = avail.y; w = h * texAspect; }
    ImVec2 a(p.x + (avail.x - w) * 0.5f, p.y + (avail.y - h) * 0.5f), b(a.x + w, a.y + h);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(a, b, IM_COL32(0, 0, 0, 255));
    if (tex) dl->AddImage(texId(tex), a, b, flipY ? ImVec2(0, 1) : ImVec2(0, 0), flipY ? ImVec2(1, 0) : ImVec2(1, 1));
    dl->AddRect(a, b, IM_COL32(60, 62, 70, 255));
    ImGui::Dummy(avail);
}

struct CellRect { ImVec2 a, b; int layer, col; };
static std::vector<CellRect> g_cells;

struct ClipRef { int layer, col; };

static void addEffectTo(App& app, std::vector<Effect>& chain, int builtin, FFGLPlugin* plug) {
    if (plug) chain.push_back(makeFFGLEffect(plug));
    else if (builtin >= 0) chain.push_back(makeBuiltinEffect(builtin));
    (void)app;
}

static void acceptEffectDrop(App& app, std::vector<Effect>& chain) {
    if (ImGui::BeginDragDropTarget()) {
        if (const ImGuiPayload* p = ImGui::AcceptDragDropPayload("FX")) addEffectTo(app, chain, *(const int*)p->Data, nullptr);
        if (const ImGuiPayload* p = ImGui::AcceptDragDropPayload("FFX")) addEffectTo(app, chain, -1, ffgl::plugins()[*(const int*)p->Data]);
        ImGui::EndDragDropTarget();
    }
}

static void ffglParamUI(FFGLPlugin* plug, std::vector<float>& params, std::vector<int>* pulses) {
    for (size_t i = 0; i < plug->params.size() && i < params.size(); i++) {
        auto& pi = plug->params[i];
        if (!pi.usable) continue;
        ImGui::PushID((int)i);
        if (pi.type == 0) {
            bool b = params[i] > 0.5f;
            if (ImGui::Checkbox(pi.name.c_str(), &b)) params[i] = b ? 1.0f : 0.0f;
        } else if (pi.type == 1) {
            if (ImGui::Button(pi.name.c_str()) && pulses && i < pulses->size()) (*pulses)[i] = 2;
        } else {
            ImGui::SliderFloat(pi.name.c_str(), &params[i], pi.min, pi.max, "%.3f");
        }
        ImGui::PopID();
    }
}

static void effectChainUI(App& app, std::vector<Effect>& chain, const char* id) {
    ImGui::PushID(id);
    ImGui::SeparatorText("Effects");
    int removeIdx = -1, moveIdx = -1, moveDir = 0;
    for (int i = 0; i < (int)chain.size(); i++) {
        Effect& e = chain[i];
        ImGui::PushID(i);
        bool on = !e.bypass;
        if (ImGui::Checkbox("##on", &on)) e.bypass = !on;
        ImGui::SameLine();
        bool open = ImGui::TreeNodeEx("##fx", ImGuiTreeNodeFlags_DefaultOpen | ImGuiTreeNodeFlags_SpanAvailWidth | ImGuiTreeNodeFlags_AllowOverlap,
                                      "%s%s", e.name.c_str(), e.plug ? "  (FFGL)" : "");
        float bw = ImGui::GetFrameHeight();
        ImGui::SameLine(ImGui::GetContentRegionMax().x - bw * 3 - 8);
        if (ImGui::Button("^", ImVec2(bw, 0))) { moveIdx = i; moveDir = -1; }
        ImGui::SameLine(0, 2);
        if (ImGui::Button("v", ImVec2(bw, 0))) { moveIdx = i; moveDir = 1; }
        ImGui::SameLine(0, 2);
        if (ImGui::Button("x", ImVec2(bw, 0))) removeIdx = i;
        if (open) {
            ImGui::PushItemWidth(-110);
            if (e.builtin >= 0) {
                auto& d = builtinEffects()[e.builtin];
                for (size_t k = 0; k < d.params.size() && k < e.params.size(); k++)
                    ImGui::SliderFloat(d.params[k].name, &e.params[k], 0.0f, 1.0f, "%.2f");
                ImGui::SliderFloat("Mix", &e.mix, 0.0f, 1.0f, "%.2f");
            } else if (e.plug) {
                ffglParamUI(e.plug, e.params, &e.eventPulse);
            }
            ImGui::PopItemWidth();
            ImGui::TreePop();
        }
        ImGui::PopID();
    }
    if (removeIdx >= 0) { freeEffect(chain[removeIdx]); chain.erase(chain.begin() + removeIdx); }
    if (moveIdx >= 0 && moveIdx + moveDir >= 0 && moveIdx + moveDir < (int)chain.size()) std::swap(chain[moveIdx], chain[moveIdx + moveDir]);
    ImVec2 av = ImGui::GetContentRegionAvail();
    ImGui::PushStyleColor(ImGuiCol_Button, IM_COL32(26, 28, 33, 255));
    ImGui::Button("Drop effects here", ImVec2(av.x, std::max(28.0f, std::min(av.y - 4, 60.0f))));
    ImGui::PopStyleColor();
    acceptEffectDrop(app, chain);
    ImGui::PopID();
}

// ---------- clip grid ----------
static void swapClips(App& app, ClipRef a, ClipRef b) {
    Composition& c = app.comp;
    if (a.layer == b.layer && a.col == b.col) return;
    if (c.layers[a.layer].active == a.col || c.layers[a.layer].pendingCol == a.col) c.eject(a.layer);
    if (c.layers[b.layer].active == b.col || c.layers[b.layer].pendingCol == b.col) c.eject(b.layer);
    std::swap(c.layers[a.layer].clips[a.col], c.layers[b.layer].clips[b.col]);
}

static void clipCell(App& app, int li, int col, ImVec2 size) {
    Composition& comp = app.comp;
    Layer& L = comp.layers[li];
    Clip& c = L.clips[col];
    ImGui::PushID(col);
    ImVec2 a = ImGui::GetCursorScreenPos(), b(a.x + size.x, a.y + size.y);
    ImGui::InvisibleButton("cell", size);
    bool hovered = ImGui::IsItemHovered();
    if (ImGui::IsItemClicked(ImGuiMouseButton_Left)) {
        app.selLayer = li; app.selCol = col;
        comp.trigger(li, col);
    }
    if (!c.empty() && ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceAllowNullID)) {
        ClipRef r{li, col};
        ImGui::SetDragDropPayload("CLIP", &r, sizeof r);
        ImGui::TextUnformatted(c.name.c_str());
        ImGui::EndDragDropSource();
    }
    if (ImGui::BeginDragDropTarget()) {
        if (const ImGuiPayload* p = ImGui::AcceptDragDropPayload("FILE")) comp.setVideo(li, col, (const char*)p->Data);
        if (const ImGuiPayload* p = ImGui::AcceptDragDropPayload("GEN")) comp.setGenerator(li, col, *(const int*)p->Data);
        if (const ImGuiPayload* p = ImGui::AcceptDragDropPayload("SRC")) comp.setFFGLSource(li, col, ffgl::plugins()[*(const int*)p->Data]);
        if (const ImGuiPayload* p = ImGui::AcceptDragDropPayload("CLIP")) swapClips(app, *(const ClipRef*)p->Data, ClipRef{li, col});
        ImGui::EndDragDropTarget();
    }
    if (ImGui::BeginPopupContextItem("cellctx")) {
        if (ImGui::MenuItem("Clear clip", nullptr, false, !c.empty())) comp.clearClip(li, col);
        ImGui::EndPopup();
    }
    g_cells.push_back({a, b, li, col});

    Clip& cc = comp.layers[li].clips[col];   // may have changed above
    ImDrawList* dl = ImGui::GetWindowDrawList();
    float labelH = ImGui::GetFontSize() + 4;
    dl->AddRectFilled(a, b, cc.empty() ? kCellEmpty : kCellBg, 3);
    if (!cc.empty()) {
        ImVec2 ta(a.x + 2, a.y + 2), tb(b.x - 2, b.y - labelH);
        if (cc.thumb) dl->AddImage(texId(cc.thumb), ta, tb, cc.thumbFlip ? ImVec2(0, 1) : ImVec2(0, 0), cc.thumbFlip ? ImVec2(1, 0) : ImVec2(1, 1));
        else dl->AddRectFilled(ta, tb, IM_COL32(45, 48, 58, 255));
        dl->PushClipRect(ImVec2(a.x + 3, b.y - labelH), ImVec2(b.x - 3, b.y), true);
        dl->AddText(ImVec2(a.x + 4, b.y - labelH + 1), IM_COL32(215, 215, 220, 255), cc.name.c_str());
        dl->PopClipRect();
    }
    bool active = L.active == col, pending = L.pendingCol == col;
    if (active && L.player && L.player->duration > 0) {
        float f = (float)std::clamp(L.player->pos / L.player->duration.load(), 0.0, 1.0);
        dl->AddRectFilled(ImVec2(a.x + 2, b.y - labelH - 3), ImVec2(a.x + 2 + (size.x - 4) * f, b.y - labelH), kAccent);
    }
    ImU32 border = active ? kAccent : pending ? IM_COL32(240, 220, 80, 255) : hovered ? IM_COL32(110, 112, 125, 255) : IM_COL32(48, 50, 58, 255);
    dl->AddRect(a, b, border, 3, 0, active || pending ? 2.0f : 1.0f);
    if (app.selLayer == li && app.selCol == col) dl->AddRect(ImVec2(a.x + 2, a.y + 2), ImVec2(b.x - 2, b.y - 2), IM_COL32(255, 255, 255, 110), 2);
    ImGui::PopID();
}

static void gridPanel(App& app, ImVec2 pos, ImVec2 size) {
    Composition& comp = app.comp;
    ImGui::SetNextWindowPos(pos);
    ImGui::SetNextWindowSize(size);
    ImGui::Begin("##grid", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBringToFrontOnFocus |
                                    ImGuiWindowFlags_HorizontalScrollbar);
    g_cells.clear();
    float fh = ImGui::GetFrameHeight();
    float ctrlW = fh * 11.5f;
    float cellW = std::clamp((ImGui::GetContentRegionAvail().x - ctrlW - 8) / comp.columns - 4, fh * 4.2f, fh * 7.0f);
    float cellH = cellW * 9.0f / 16.0f + ImGui::GetFontSize() + 6;
    ImVec2 sp(4, 4);
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, sp);

    // header row: composition controls + column triggers
    ImGui::BeginGroup();
    ImGui::AlignTextToFramePadding();
    ImGui::TextColored(ImVec4(1, 0.48f, 0.1f, 1), "COMPOSITION");
    ImGui::SameLine();
    if (ImGui::Button("X##all")) for (int i = 0; i < (int)comp.layers.size(); i++) comp.eject(i);
    if (ImGui::IsItemHovered()) ImGui::SetTooltip("Eject all layers");
    ImGui::SameLine();
    ImGui::SetNextItemWidth(ctrlW - ImGui::GetCursorPosX() + ImGui::GetStyle().WindowPadding.x);
    ImGui::SliderFloat("##master", &comp.master, 0.0f, 1.0f, "Master %.2f");
    ImGui::EndGroup();
    for (int col = 0; col < comp.columns; col++) {
        ImGui::SameLine(ctrlW + 8 + col * (cellW + sp.x));
        ImGui::PushID(col);
        char lbl[32];
        snprintf(lbl, sizeof lbl, "Column %d", col + 1);
        if (ImGui::Button(lbl, ImVec2(cellW, 0))) comp.triggerColumn(col);
        ImGui::PopID();
    }

    for (int li = (int)comp.layers.size() - 1; li >= 0; li--) {
        Layer& L = comp.layers[li];
        ImGui::PushID(li);
        ImVec2 rowStart = ImGui::GetCursorScreenPos();
        if (app.selLayer == li)
            ImGui::GetWindowDrawList()->AddRectFilled(rowStart, ImVec2(rowStart.x + ctrlW, rowStart.y + cellH), IM_COL32(40, 30, 22, 255), 3);
        ImGui::BeginGroup();
        float sq = fh;
        if (ImGui::Button("X", ImVec2(sq, 0))) comp.eject(li);
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Eject clip");
        ImGui::SameLine();
        if (toggleButton("B", L.bypass, ImVec2(sq, 0), IM_COL32(230, 80, 70, 255))) L.bypass = !L.bypass;
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Bypass layer");
        ImGui::SameLine();
        if (toggleButton("S", L.solo, ImVec2(sq, 0), IM_COL32(240, 220, 80, 255))) L.solo = !L.solo;
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Solo layer");
        ImGui::SameLine();
        if (toggleButton("A##xa", L.xfade == 1, ImVec2(sq, 0))) L.xfade = L.xfade == 1 ? 0 : 1;
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Assign to crossfader side A");
        ImGui::SameLine(0, 1);
        if (toggleButton("B##xb", L.xfade == 2, ImVec2(sq, 0))) L.xfade = L.xfade == 2 ? 0 : 2;
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Assign to crossfader side B");
        ImGui::SameLine();
        if (ImGui::Selectable(L.name.c_str(), app.selLayer == li, 0, ImVec2(ctrlW - sq * 5 - 28, fh))) { app.selLayer = li; app.selCol = -1; }
        ImGui::SetNextItemWidth(ctrlW * 0.56f);
        ImGui::SliderFloat("##op", &L.opacity, 0.0f, 1.0f, "Opacity %.2f");
        ImGui::SameLine();
        ImGui::SetNextItemWidth(ctrlW * 0.44f - sp.x - 4);
        ImGui::Combo("##blend", &L.blend, kBlendNames, BlendCount);
        ImGui::EndGroup();
        acceptEffectDrop(app, L.fx);
        for (int col = 0; col < comp.columns; col++) {
            ImGui::SameLine(ctrlW + 8 + col * (cellW + sp.x));
            ImGui::SetCursorScreenPos(ImVec2(ImGui::GetCursorScreenPos().x, rowStart.y));
            clipCell(app, li, col, ImVec2(cellW, cellH));
        }
        ImGui::SetCursorScreenPos(ImVec2(rowStart.x, rowStart.y + cellH + sp.y));
        ImGui::PopID();
    }
    ImGui::PopStyleVar();
    ImGui::End();
}

// ---------- properties (bottom left) ----------
static void propertiesPanel(App& app, ImVec2 pos, ImVec2 size) {
    Composition& comp = app.comp;
    ImGui::SetNextWindowPos(pos);
    ImGui::SetNextWindowSize(size);
    ImGui::Begin("##props", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBringToFrontOnFocus);
    app.selLayer = std::clamp(app.selLayer, 0, (int)comp.layers.size() - 1);
    Layer& L = comp.layers[app.selLayer];
    static int lastLayer = -1, lastCol = -1;
    bool selChanged = lastLayer != app.selLayer || lastCol != app.selCol;
    bool clipSelected = app.selCol >= 0 && app.selCol < (int)L.clips.size() && !L.clips[app.selCol].empty();
    if (ImGui::BeginTabBar("proptabs")) {
        if (ImGui::BeginTabItem("Composition")) {
            ImGui::PushItemWidth(-110);
            ImGui::SliderFloat("Master", &comp.master, 0.0f, 1.0f, "%.2f");
            ImGui::SliderFloat("Crossfader", &comp.crossfade, 0.0f, 1.0f, "%.2f");
            ImGui::DragFloat("BPM", &comp.bpm, 0.1f, 20.0f, 300.0f, "%.1f");
            ImGui::Text("Resolution: %d x %d", comp.w, comp.h);
            ImGui::PopItemWidth();
            effectChainUI(app, comp.fx, "compfx");
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Layer", nullptr, selChanged && !clipSelected ? ImGuiTabItemFlags_SetSelected : 0)) {
            ImGui::PushItemWidth(-110);
            char nb[64];
            snprintf(nb, sizeof nb, "%s", L.name.c_str());
            if (ImGui::InputText("Name", nb, sizeof nb)) L.name = nb;
            ImGui::SliderFloat("Opacity", &L.opacity, 0.0f, 1.0f, "%.2f");
            ImGui::Combo("Blend", &L.blend, kBlendNames, BlendCount);
            ImGui::Combo("Scaling", &L.fit, "Fill\0Fit\0Stretch\0");
            ImGui::SliderFloat("Scale", &L.scale, 0.05f, 4.0f, "%.2f");
            ImGui::SliderFloat("Position X", &L.posX, -1.0f, 1.0f, "%.3f");
            ImGui::SliderFloat("Position Y", &L.posY, -1.0f, 1.0f, "%.3f");
            ImGui::PopItemWidth();
            if (ImGui::SmallButton("Reset transform")) { L.scale = 1; L.posX = L.posY = 0; }
            ImGui::SameLine();
            if (ImGui::SmallButton("Remove layer") && comp.layers.size() > 1) {
                comp.removeLayer(app.selLayer);
                app.selLayer = std::clamp(app.selLayer, 0, (int)comp.layers.size() - 1);
                ImGui::EndTabItem(); ImGui::EndTabBar(); ImGui::End();
                return;
            }
            effectChainUI(app, L.fx, "layerfx");
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Clip", nullptr, selChanged && clipSelected ? ImGuiTabItemFlags_SetSelected : 0)) {
            if (!clipSelected) {
                ImGui::TextDisabled("Select a clip in the grid.");
            } else {
                Clip& c = L.clips[app.selCol];
                ImGui::PushItemWidth(-110);
                char nb[128];
                snprintf(nb, sizeof nb, "%s", c.name.c_str());
                if (ImGui::InputText("Name", nb, sizeof nb)) c.name = nb;
                if (c.type == ClipType::Video) {
                    ImGui::TextWrapped("%s", c.path.c_str());
                    ImGui::SliderFloat("Speed", &c.speed, 0.0f, 4.0f, "%.2fx");
                    if (ImGui::SmallButton("1x")) c.speed = 1.0f;
                    if (L.active == app.selCol && L.player) {
                        VideoPlayer& vp = *L.player;
                        double dur = vp.duration;
                        float pos = (float)vp.pos;
                        ImGui::SameLine();
                        if (ImGui::SmallButton(vp.paused ? "Play" : "Pause")) vp.paused = !vp.paused;
                        ImGui::SameLine();
                        if (ImGui::SmallButton("Restart")) vp.seek(0);
                        if (dur > 0 && ImGui::SliderFloat("Position", &pos, 0.0f, (float)dur, "%.2f s")) vp.seek(pos);
                        ImGui::Text("%d x %d, %.2f s", vp.w, vp.h, dur);
                    } else {
                        ImGui::TextDisabled("Not playing. Click the clip to trigger it.");
                    }
                } else if (c.type == ClipType::Generator) {
                    auto& d = builtinGenerators()[c.gen];
                    for (size_t k = 0; k < d.params.size() && k < c.params.size(); k++)
                        ImGui::SliderFloat(d.params[k].name, &c.params[k], 0.0f, 1.0f, "%.2f");
                } else if (c.type == ClipType::FFGLSource && c.plug) {
                    ImGui::TextDisabled("FFGL source: %s", c.plug->path.c_str());
                    ffglParamUI(c.plug, c.params, nullptr);
                }
                ImGui::PopItemWidth();
            }
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }
    lastLayer = app.selLayer; lastCol = app.selCol;
    ImGui::End();
}

// ---------- monitors (bottom centre) ----------
static void monitorPanel(App& app, ImVec2 pos, ImVec2 size) {
    Composition& comp = app.comp;
    ImGui::SetNextWindowPos(pos);
    ImGui::SetNextWindowSize(size);
    ImGui::Begin("##monitor", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBringToFrontOnFocus);
    float aspect = (float)comp.w / (float)comp.h;
    ImVec2 av = ImGui::GetContentRegionAvail();
    float half = (av.x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;
    float th = ImGui::GetTextLineHeightWithSpacing();
    ImGui::BeginGroup();
    ImGui::TextColored(ImVec4(1, 0.48f, 0.1f, 1), "OUTPUT");
    imageFit(comp.outTex, aspect, ImVec2(half, av.y - th));
    ImGui::EndGroup();
    ImGui::SameLine();
    ImGui::BeginGroup();
    Layer& L = comp.layers[std::clamp(app.selLayer, 0, (int)comp.layers.size() - 1)];
    ImGui::Text("PREVIEW: %s", L.name.c_str());
    imageFit(L.outTex, aspect, ImVec2(half, av.y - th));
    ImGui::EndGroup();
    ImGui::End();
}

// ---------- browser (bottom right) ----------
struct DirEntry { std::string name, full; bool dir; };
static std::vector<DirEntry> g_entries;
static std::string g_listedDir;

static void listDir(const std::string& dir) {
    g_entries.clear();
    g_listedDir = dir;
    std::error_code ec;
    for (auto it = fs::directory_iterator(fs::u8path(dir), fs::directory_options::skip_permission_denied, ec);
         !ec && it != fs::directory_iterator(); it.increment(ec)) {
        std::string name = it->path().filename().u8string();
        if (name.empty() || name[0] == '.') continue;
        bool isDir = it->is_directory(ec);
        std::string full = it->path().u8string();
        if (isDir || isMediaFile(full)) g_entries.push_back({name, full, isDir});
    }
    std::sort(g_entries.begin(), g_entries.end(), [](const DirEntry& a, const DirEntry& b) {
        if (a.dir != b.dir) return a.dir;
        return a.name < b.name;
    });
}

static void putInSelected(App& app, const std::string& file) {
    Composition& comp = app.comp;
    Layer& L = comp.layers[app.selLayer];
    int col = app.selCol;
    if (col < 0 || col >= (int)L.clips.size()) {
        col = -1;
        for (int i = 0; i < (int)L.clips.size(); i++) if (L.clips[i].empty()) { col = i; break; }
    }
    if (col >= 0) comp.setVideo(app.selLayer, col, file);
}

static void browserPanel(App& app, ImVec2 pos, ImVec2 size) {
    Composition& comp = app.comp;
    ImGui::SetNextWindowPos(pos);
    ImGui::SetNextWindowSize(size);
    ImGui::Begin("##browser", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBringToFrontOnFocus);
    if (ImGui::BeginTabBar("browsertabs")) {
        if (ImGui::BeginTabItem("Files")) {
            static char pathBuf[1024] = "";
            if (g_listedDir != app.browseDir) { listDir(app.browseDir); snprintf(pathBuf, sizeof pathBuf, "%s", app.browseDir.c_str()); }
            if (ImGui::Button("Up")) {
                fs::path p = fs::u8path(app.browseDir);
                if (p.has_parent_path() && p.parent_path() != p) app.browseDir = p.parent_path().u8string();
            }
            ImGui::SameLine();
            if (ImGui::Button("Refresh")) g_listedDir.clear();
            ImGui::SameLine();
            ImGui::SetNextItemWidth(-1);
            if (ImGui::InputText("##path", pathBuf, sizeof pathBuf, ImGuiInputTextFlags_EnterReturnsTrue)) {
                std::error_code ec;
                if (fs::is_directory(fs::u8path(pathBuf), ec)) app.browseDir = pathBuf;
            }
            ImGui::BeginChild("filelist");
            std::string go;
            for (auto& e : g_entries) {
                if (e.dir) {
                    ImGui::PushStyleColor(ImGuiCol_Text, IM_COL32(240, 190, 120, 255));
                    if (ImGui::Selectable(("[" + e.name + "]").c_str(), false, ImGuiSelectableFlags_AllowDoubleClick) && ImGui::IsMouseDoubleClicked(0)) go = e.full;
                    ImGui::PopStyleColor();
                } else {
                    if (ImGui::Selectable(e.name.c_str(), false, ImGuiSelectableFlags_AllowDoubleClick) && ImGui::IsMouseDoubleClicked(0)) putInSelected(app, e.full);
                    if (ImGui::BeginDragDropSource()) {
                        ImGui::SetDragDropPayload("FILE", e.full.c_str(), e.full.size() + 1);
                        ImGui::TextUnformatted(e.name.c_str());
                        ImGui::EndDragDropSource();
                    }
                }
            }
            if (g_entries.empty()) ImGui::TextDisabled("No folders or video files here.");
            if (!go.empty()) app.browseDir = go;
            ImGui::EndChild();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Effects")) {
            ImGui::TextDisabled("Drag onto a layer or the effects list. Double-click adds to the selected layer.");
            ImGui::BeginChild("fxlist");
            auto& fx = builtinEffects();
            for (int i = 0; i < (int)fx.size(); i++) {
                if (ImGui::Selectable(fx[i].name, false, ImGuiSelectableFlags_AllowDoubleClick) && ImGui::IsMouseDoubleClicked(0))
                    comp.layers[app.selLayer].fx.push_back(makeBuiltinEffect(i));
                if (ImGui::BeginDragDropSource()) {
                    ImGui::SetDragDropPayload("FX", &i, sizeof i);
                    ImGui::TextUnformatted(fx[i].name);
                    ImGui::EndDragDropSource();
                }
            }
            ImGui::SeparatorText("FFGL plugins");
            int nfx = 0;
            auto& pl = ffgl::plugins();
            for (int i = 0; i < (int)pl.size(); i++) {
                if (!pl[i]->isEffect()) continue;
                nfx++;
                ImGui::PushID(i);
                if (ImGui::Selectable(pl[i]->name.c_str(), false, ImGuiSelectableFlags_AllowDoubleClick) && ImGui::IsMouseDoubleClicked(0))
                    comp.layers[app.selLayer].fx.push_back(makeFFGLEffect(pl[i]));
                if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", pl[i]->path.c_str());
                if (ImGui::BeginDragDropSource()) {
                    ImGui::SetDragDropPayload("FFX", &i, sizeof i);
                    ImGui::TextUnformatted(pl[i]->name.c_str());
                    ImGui::EndDragDropSource();
                }
                ImGui::PopID();
            }
            if (!nfx) ImGui::TextDisabled("None found.");
            if (ImGui::SmallButton("Rescan plugin folders")) ffgl::scan(app.pluginDirs);
            for (auto& d : app.pluginDirs) ImGui::TextDisabled("%s", d.c_str());
            ImGui::EndChild();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Sources")) {
            ImGui::TextDisabled("Drag onto a clip slot.");
            ImGui::BeginChild("srclist");
            auto& gens = builtinGenerators();
            for (int i = 0; i < (int)gens.size(); i++) {
                if (ImGui::Selectable(gens[i].name, false, ImGuiSelectableFlags_AllowDoubleClick) && ImGui::IsMouseDoubleClicked(0) && app.selCol >= 0)
                    comp.setGenerator(app.selLayer, app.selCol, i);
                if (ImGui::BeginDragDropSource()) {
                    ImGui::SetDragDropPayload("GEN", &i, sizeof i);
                    ImGui::TextUnformatted(gens[i].name);
                    ImGui::EndDragDropSource();
                }
            }
            ImGui::SeparatorText("FFGL sources");
            int ns = 0;
            auto& pl = ffgl::plugins();
            for (int i = 0; i < (int)pl.size(); i++) {
                if (!pl[i]->isSource()) continue;
                ns++;
                ImGui::PushID(i);
                ImGui::Selectable(pl[i]->name.c_str());
                if (ImGui::BeginDragDropSource()) {
                    ImGui::SetDragDropPayload("SRC", &i, sizeof i);
                    ImGui::TextUnformatted(pl[i]->name.c_str());
                    ImGui::EndDragDropSource();
                }
                ImGui::PopID();
            }
            if (!ns) ImGui::TextDisabled("None found.");
            ImGui::EndChild();
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }
    ImGui::End();
}

// ---------- transport bar ----------
static void transportBar(App& app, ImVec2 pos, ImVec2 size) {
    Composition& comp = app.comp;
    ImGui::SetNextWindowPos(pos);
    ImGui::SetNextWindowSize(size);
    ImGui::Begin("##transport", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoScrollbar);
    ImGui::AlignTextToFramePadding();
    ImGui::Text("BPM");
    ImGui::SameLine();
    ImGui::SetNextItemWidth(ImGui::GetFrameHeight() * 3.2f);
    ImGui::DragFloat("##bpm", &comp.bpm, 0.1f, 20.0f, 300.0f, "%.1f");
    ImGui::SameLine();
    static std::vector<double> taps;
    if (ImGui::Button("TAP")) {
        double now = glfwGetTime();
        if (!taps.empty() && now - taps.back() > 2.0) taps.clear();
        taps.push_back(now);
        if (taps.size() > 8) taps.erase(taps.begin());
        if (taps.size() >= 2) {
            double avg = (taps.back() - taps.front()) / (double)(taps.size() - 1);
            if (avg > 0.15) comp.bpm = (float)std::clamp(60.0 / avg, 20.0, 300.0);
        }
        comp.beats = std::round(comp.beats);
    }
    ImGui::SameLine();
    if (ImGui::Button("Resync")) comp.beats = 0;
    ImGui::SameLine();
    {   // beat indicator
        ImVec2 p = ImGui::GetCursorScreenPos();
        float r = ImGui::GetFrameHeight() * 0.32f;
        int beat = (int)std::fmod(comp.beats, 4.0);
        float ph = (float)(comp.beats - std::floor(comp.beats));
        ImDrawList* dl = ImGui::GetWindowDrawList();
        for (int i = 0; i < 4; i++) {
            ImVec2 c(p.x + r + i * (r * 2.6f), p.y + ImGui::GetFrameHeight() * 0.5f);
            ImU32 col = i == beat ? IM_COL32(255, 122, 26, (int)(255 * (1.0f - ph * 0.7f))) : IM_COL32(60, 62, 70, 255);
            dl->AddCircleFilled(c, r, col);
        }
        ImGui::Dummy(ImVec2(r * 2.6f * 4, ImGui::GetFrameHeight()));
    }
    ImGui::SameLine(0, 20);
    ImGui::Text("A");
    ImGui::SameLine();
    char right[160];
    snprintf(right, sizeof right, "%s   %.0f fps  %.1f ms", output::anyOpen() ? "OUTPUT LIVE" : "output closed", app.fps, app.frameMs);
    float rightW = ImGui::CalcTextSize(right).x + 20;
    ImGui::SetNextItemWidth(std::max(120.0f, ImGui::GetContentRegionAvail().x - rightW - 40));
    ImGui::SliderFloat("##xf", &comp.crossfade, 0.0f, 1.0f, "Crossfader");
    ImGui::SameLine();
    ImGui::Text("B");
    ImGui::SameLine(ImGui::GetWindowWidth() - rightW);
    if (app.fps > 0 && app.fps < 29.0f) ImGui::TextColored(ImVec4(1, 0.3f, 0.25f, 1), "%s", right);
    else ImGui::TextDisabled("%s", right);
    ImGui::End();
}

// ---------- advanced output ----------
static bool handle(ImDrawList* dl, ImVec2 p, const char* id, ImU32 col, float r, ImVec2& delta) {
    ImGui::SetCursorScreenPos(ImVec2(p.x - r, p.y - r));
    ImGui::InvisibleButton(id, ImVec2(r * 2, r * 2));
    bool act = ImGui::IsItemActive();
    dl->AddCircleFilled(p, r * 0.6f, act || ImGui::IsItemHovered() ? IM_COL32(255, 255, 255, 255) : col);
    dl->AddCircle(p, r * 0.6f, IM_COL32(0, 0, 0, 255));
    if (act && ImGui::IsMouseDragging(0, 0.0f)) { delta = ImGui::GetIO().MouseDelta; return true; }
    return false;
}

static void outputSetup(App& app) {
    if (!app.showOutputSetup) return;
    Composition& comp = app.comp;
    static int selScreen = 0, selSlice = 0, tab = 1;
    auto& screens = output::screens();
    ImGui::SetNextWindowSize(ImVec2(1080, 680), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Advanced Output", &app.showOutputSetup)) { ImGui::End(); return; }
    selScreen = std::clamp(selScreen, 0, std::max(0, (int)screens.size() - 1));
    float fh = ImGui::GetFrameHeight();

    // left: screens and slices
    ImGui::BeginChild("lists", ImVec2(fh * 9.5f, 0), ImGuiChildFlags_Borders);
    ImGui::SeparatorText("Screens");
    for (int i = 0; i < (int)screens.size(); i++) {
        ImGui::PushID(i);
        std::string lbl = screens[i].name + (screens[i].win ? "  [live]" : "");
        if (ImGui::Selectable(lbl.c_str(), selScreen == i)) { selScreen = i; selSlice = 0; }
        ImGui::PopID();
    }
    if (ImGui::SmallButton("+ Screen")) { output::addScreen(); selScreen = (int)screens.size() - 1; selSlice = 0; }
    ImGui::SameLine();
    if (ImGui::SmallButton("- Screen") && screens.size() > 1) { output::removeScreen(selScreen); selScreen = 0; selSlice = 0; }
    Screen& sc = screens[selScreen];
    ImGui::SeparatorText("Slices and masks");
    for (int i = 0; i < (int)sc.slices.size(); i++) {
        ImGui::PushID(1000 + i);
        ImGui::Checkbox("##en", &sc.slices[i].enabled);
        ImGui::SameLine();
        std::string lbl = sc.slices[i].name + (sc.slices[i].isMask ? "  (mask)" : "");
        if (ImGui::Selectable(lbl.c_str(), selSlice == i)) selSlice = i;
        ImGui::PopID();
    }
    if (ImGui::SmallButton("+ Slice")) {
        Slice s; s.name = "Slice " + std::to_string(sc.slices.size() + 1);
        sc.slices.push_back(s); selSlice = (int)sc.slices.size() - 1;
    }
    ImGui::SameLine();
    if (ImGui::SmallButton("+ Mask")) {
        Slice s; s.name = "Mask " + std::to_string(sc.slices.size() + 1); s.isMask = true;
        float q[4][2] = {{0.4f, 0.4f}, {0.6f, 0.4f}, {0.6f, 0.6f}, {0.4f, 0.6f}};
        memcpy(s.c, q, sizeof q);
        sc.slices.push_back(s); selSlice = (int)sc.slices.size() - 1;
    }
    if (!sc.slices.empty()) {
        selSlice = std::clamp(selSlice, 0, (int)sc.slices.size() - 1);
        if (ImGui::SmallButton("Remove")) { sc.slices.erase(sc.slices.begin() + selSlice); selSlice = std::max(0, selSlice - 1); }
        ImGui::SameLine();
        if (ImGui::SmallButton("Up") && selSlice + 1 < (int)sc.slices.size()) { std::swap(sc.slices[selSlice], sc.slices[selSlice + 1]); selSlice++; }
        ImGui::SameLine();
        if (ImGui::SmallButton("Down") && selSlice > 0) { std::swap(sc.slices[selSlice], sc.slices[selSlice - 1]); selSlice--; }
        ImGui::TextDisabled("Later items draw on top.");
    }
    ImGui::EndChild();
    ImGui::SameLine();

    // right: properties
    float propW = fh * 12.5f;
    ImGui::BeginChild("canvaswrap", ImVec2(ImGui::GetContentRegionAvail().x - propW - ImGui::GetStyle().ItemSpacing.x, 0));
    if (toggleButton("Input Selection", tab == 0)) tab = 0;
    ImGui::SameLine();
    if (toggleButton("Output Transformation", tab == 1)) tab = 1;
    ImGui::SameLine();
    ImGui::Checkbox("Test pattern", &output::testPattern);
    ImVec2 av = ImGui::GetContentRegionAvail();
    float aspect = tab == 0 ? (float)comp.w / comp.h : (float)sc.w / sc.h;
    float margin = 24;
    float cw = av.x - margin * 2, ch = cw / aspect;
    if (ch > av.y - margin * 2) { ch = av.y - margin * 2; cw = ch * aspect; }
    ImVec2 org = ImGui::GetCursorScreenPos();
    ImVec2 a(org.x + (av.x - cw) * 0.5f, org.y + (av.y - ch) * 0.5f), b(a.x + cw, a.y + ch);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(a, b, IM_COL32(0, 0, 0, 255));
    GLuint tex = tab == 0 ? comp.outTex : sc.fbo.tex;
    if (tex) dl->AddImage(texId(tex), a, b, ImVec2(0, 1), ImVec2(1, 0));
    dl->AddRect(a, b, IM_COL32(90, 92, 100, 255));
    auto toPx = [&](float x, float y) { return ImVec2(a.x + x * cw, a.y + y * ch); };
    float hr = 9;
    for (int i = 0; i < (int)sc.slices.size(); i++) {
        Slice& sl = sc.slices[i];
        bool sel = i == selSlice;
        ImU32 col = sel ? kAccent : IM_COL32(150, 150, 160, 160);
        ImGui::PushID(2000 + i);
        if (tab == 0) {
            if (sl.isMask) { ImGui::PopID(); continue; }
            ImVec2 p0 = toPx(sl.in[0], sl.in[1]), p1 = toPx(sl.in[0] + sl.in[2], sl.in[1] + sl.in[3]);
            dl->AddRect(p0, p1, col, 0, 0, sel ? 2.0f : 1.0f);
            dl->AddText(ImVec2(p0.x + 4, p0.y + 3), col, sl.name.c_str());
            if (sel) {
                ImVec2 d;
                if (handle(dl, ImVec2((p0.x + p1.x) * 0.5f, (p0.y + p1.y) * 0.5f), "mv", kAccent, hr, d)) { sl.in[0] += d.x / cw; sl.in[1] += d.y / ch; }
                if (handle(dl, p1, "sz", kAccent, hr, d)) { sl.in[2] = std::max(0.01f, sl.in[2] + d.x / cw); sl.in[3] = std::max(0.01f, sl.in[3] + d.y / ch); }
                if (handle(dl, p0, "tl", kAccent, hr, d)) {
                    float dx = d.x / cw, dy = d.y / ch;
                    sl.in[0] += dx; sl.in[1] += dy; sl.in[2] = std::max(0.01f, sl.in[2] - dx); sl.in[3] = std::max(0.01f, sl.in[3] - dy);
                }
            }
        } else {
            ImVec2 q[4];
            for (int k = 0; k < 4; k++) q[k] = toPx(sl.c[k][0], sl.c[k][1]);
            dl->AddPolyline(q, 4, col, ImDrawFlags_Closed, sel ? 2.0f : 1.0f);
            dl->AddText(ImVec2(q[0].x + 4, q[0].y + 3), col, sl.name.c_str());
            if (sel) {
                ImVec2 d;
                ImVec2 ctr((q[0].x + q[1].x + q[2].x + q[3].x) * 0.25f, (q[0].y + q[1].y + q[2].y + q[3].y) * 0.25f);
                if (handle(dl, ctr, "mv", IM_COL32(120, 200, 255, 255), hr, d))
                    for (int k = 0; k < 4; k++) { sl.c[k][0] += d.x / cw; sl.c[k][1] += d.y / ch; }
                if (sl.grid > 0) {
                    int n = sl.grid;
                    for (int j = 0; j <= n; j++)
                        for (int ii = 0; ii <= n; ii++) {
                            bool corner = (ii == 0 || ii == n) && (j == 0 || j == n);
                            if (corner) continue;
                            float x, y;
                            output::slicePoint(sl, (float)ii / n, (float)j / n, x, y);
                            ImGui::PushID(j * 16 + ii);
                            if (handle(dl, toPx(x, y), "w", IM_COL32(120, 255, 160, 255), hr * 0.8f, d)) {
                                size_t idx = ((size_t)j * (n + 1) + ii) * 2;
                                sl.warp[idx] += d.x / cw; sl.warp[idx + 1] += d.y / ch;
                            }
                            ImGui::PopID();
                        }
                }
                for (int k = 0; k < 4; k++) {
                    ImGui::PushID(k);
                    if (handle(dl, q[k], "c", kAccent, hr, d)) { sl.c[k][0] += d.x / cw; sl.c[k][1] += d.y / ch; }
                    ImGui::PopID();
                }
            }
        }
        ImGui::PopID();
    }
    ImGui::SetCursorScreenPos(org);
    ImGui::Dummy(av);
    ImGui::EndChild();
    ImGui::SameLine();

    ImGui::BeginChild("props", ImVec2(propW, 0), ImGuiChildFlags_Borders);
    ImGui::SeparatorText("Screen");
    ImGui::PushItemWidth(-90);
    char nb[64];
    snprintf(nb, sizeof nb, "%s", sc.name.c_str());
    if (ImGui::InputText("Name", nb, sizeof nb)) sc.name = nb;
    int monCount = 0;
    GLFWmonitor** mons = glfwGetMonitors(&monCount);
    int monIdx = std::clamp(sc.monitor, 0, std::max(0, monCount - 1));
    std::string cur = monCount ? std::to_string(monIdx + 1) + ": " + glfwGetMonitorName(mons[monIdx]) : "none";
    if (ImGui::BeginCombo("Display", cur.c_str())) {
        for (int i = 0; i < monCount; i++) {
            const GLFWvidmode* m = glfwGetVideoMode(mons[i]);
            std::string l = std::to_string(i + 1) + ": " + glfwGetMonitorName(mons[i]) + " (" + std::to_string(m->width) + "x" + std::to_string(m->height) + ")";
            if (ImGui::Selectable(l.c_str(), i == monIdx)) sc.monitor = i;
        }
        ImGui::EndCombo();
    }
    ImGui::Checkbox("Fullscreen", &sc.fullscreen);
    if (!sc.fullscreen || !sc.win) {
        int wh[2] = {sc.w, sc.h};
        if (ImGui::InputInt2("Size", wh)) { sc.w = std::clamp(wh[0], 16, 16384); sc.h = std::clamp(wh[1], 16, 16384); }
    }
    ImGui::PopItemWidth();
    if (!sc.win) {
        if (ImGui::Button("Open output", ImVec2(-1, 0)) && !output::open(selScreen)) app.status = "Could not open the output window";
    } else {
        if (toggleButton("Close output", true, ImVec2(-1, 0))) output::close(selScreen);
    }
    if (!sc.slices.empty()) {
        Slice& sl = sc.slices[std::clamp(selSlice, 0, (int)sc.slices.size() - 1)];
        ImGui::SeparatorText(sl.isMask ? "Mask" : "Slice");
        ImGui::PushItemWidth(-90);
        snprintf(nb, sizeof nb, "%s", sl.name.c_str());
        if (ImGui::InputText("Name##sl", nb, sizeof nb)) sl.name = nb;
        ImGui::Checkbox("Mask (draw black)", &sl.isMask);
        if (!sl.isMask) {
            ImGui::DragFloat2("Input X/Y", &sl.in[0], 0.002f, -1.0f, 2.0f, "%.3f");
            ImGui::DragFloat2("Input W/H", &sl.in[2], 0.002f, 0.01f, 2.0f, "%.3f");
            ImGui::Checkbox("Flip H", &sl.flipH);
            ImGui::SameLine();
            ImGui::Checkbox("Flip V", &sl.flipV);
            ImGui::SliderFloat("Brightness", &sl.bright, 0.0f, 1.0f, "%.2f");
        }
        static const char* cn[4] = {"Top left", "Top right", "Bottom right", "Bottom left"};
        for (int k = 0; k < 4; k++) ImGui::DragFloat2(cn[k], sl.c[k], 0.001f, -1.0f, 2.0f, "%.3f");
        int g = sl.grid;
        char gf[32];
        if (g == 0) snprintf(gf, sizeof gf, "Off");
        else snprintf(gf, sizeof gf, "%d x %d", g, g);
        if (ImGui::SliderInt("Warp grid", &g, 0, 6, gf)) sl.setGrid(g);
        ImGui::SliderFloat("Soft edge", &sl.feather, 0.0f, 0.5f, "%.3f");
        ImGui::PopItemWidth();
        if (ImGui::SmallButton("Reset warp")) {
            float q[4][2] = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
            memcpy(sl.c, q, sizeof q);
            sl.setGrid(sl.grid);
        }
        ImGui::SameLine();
        if (ImGui::SmallButton("Reset input")) { sl.in[0] = sl.in[1] = 0; sl.in[2] = sl.in[3] = 1; }
    }
    ImGui::EndChild();
    ImGui::End();
}

// ---------- menus and dialogs ----------
static void handleDrops(App& app) {
    if (app.dropped.empty()) return;
    Composition& comp = app.comp;
    int li = -1, col = -1;
    for (auto& c : g_cells)
        if (app.dropX >= c.a.x && app.dropX < c.b.x && app.dropY >= c.a.y && app.dropY < c.b.y) { li = c.layer; col = c.col; }
    bool onCell = li >= 0;
    if (!onCell) { li = std::clamp(app.selLayer, 0, (int)comp.layers.size() - 1); col = 0; }
    for (auto& f : app.dropped) {
        std::error_code ec;
        if (fs::is_directory(fs::u8path(f), ec)) { app.browseDir = f; continue; }
        if (!isMediaFile(f)) continue;
        // Dropped on a slot: fill from that slot onwards. Dropped elsewhere: use free slots of the selected layer.
        if (!onCell) while (col < comp.columns && !comp.layers[li].clips[col].empty()) col++;
        if (col >= comp.columns) { app.status = "No free clip slot for the dropped file"; break; }
        comp.setVideo(li, col, f);
        col++;
    }
    app.dropped.clear();
}

void drawUI(App& app) {
    Composition& comp = app.comp;
    handleDrops(app);
    static bool openSave = false, openLoad = false, openSettings = false, openAbout = false;
    static char fileBuf[1024] = "";
    auto defaultFile = [&] { return comp.file.empty() ? (fs::u8path(app.docsDir) / "untitled.svj").u8string() : comp.file; };

    if (ImGui::BeginMainMenuBar()) {
        if (ImGui::BeginMenu("Composition")) {
            if (ImGui::MenuItem("New")) { comp.init(comp.w, comp.h, 3, 8); comp.file.clear(); app.selLayer = 0; app.selCol = -1; }
            if (ImGui::MenuItem("Open...")) { openLoad = true; snprintf(fileBuf, sizeof fileBuf, "%s", defaultFile().c_str()); }
            if (ImGui::MenuItem("Save", nullptr, false, !comp.file.empty())) app.status = comp.save(comp.file) ? "Saved " + comp.file : "Save failed";
            if (ImGui::MenuItem("Save As...")) { openSave = true; snprintf(fileBuf, sizeof fileBuf, "%s", defaultFile().c_str()); }
            ImGui::Separator();
            if (ImGui::MenuItem("Settings...")) openSettings = true;
            ImGui::Separator();
            if (ImGui::MenuItem("Quit")) app.wantQuit = true;
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Layer")) {
            if (ImGui::MenuItem("Add layer")) { comp.addLayer(); app.selLayer = (int)comp.layers.size() - 1; app.selCol = -1; }
            if (ImGui::MenuItem("Remove selected layer", nullptr, false, comp.layers.size() > 1)) {
                comp.removeLayer(app.selLayer);
                app.selLayer = std::clamp(app.selLayer, 0, (int)comp.layers.size() - 1);
                app.selCol = -1;
            }
            if (ImGui::MenuItem("Add column")) comp.setColumns(comp.columns + 1);
            if (ImGui::MenuItem("Remove last column", nullptr, false, comp.columns > 1)) comp.setColumns(comp.columns - 1);
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Output")) {
            if (ImGui::MenuItem("Advanced Output...", nullptr, app.showOutputSetup)) app.showOutputSetup = !app.showOutputSetup;
            ImGui::MenuItem("Test pattern", nullptr, &output::testPattern);
            ImGui::Separator();
            auto& sc = output::screens();
            for (int i = 0; i < (int)sc.size(); i++) {
                std::string l = (sc[i].win ? "Close " : "Open ") + sc[i].name;
                if (ImGui::MenuItem(l.c_str())) { if (sc[i].win) output::close(i); else if (!output::open(i)) app.status = "Could not open the output window"; }
            }
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Help")) {
            if (ImGui::MenuItem("About Strodano VJ")) openAbout = true;
            ImGui::EndMenu();
        }
        if (!app.status.empty()) {
            ImGui::SameLine(ImGui::GetWindowWidth() - ImGui::CalcTextSize(app.status.c_str()).x - 20);
            ImGui::TextDisabled("%s", app.status.c_str());
        }
        ImGui::EndMainMenuBar();
    }
    if (openSave) { ImGui::OpenPopup("Save composition"); openSave = false; }
    if (openLoad) { ImGui::OpenPopup("Open composition"); openLoad = false; }
    if (openSettings) { ImGui::OpenPopup("Composition settings"); openSettings = false; }
    if (openAbout) { ImGui::OpenPopup("About"); openAbout = false; }
    ImVec2 centre = ImGui::GetMainViewport()->GetCenter();
    for (int mode = 0; mode < 2; mode++) {
        ImGui::SetNextWindowPos(centre, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        if (ImGui::BeginPopupModal(mode == 0 ? "Save composition" : "Open composition", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::Text("File path:");
            ImGui::SetNextItemWidth(560);
            bool enter = ImGui::InputText("##file", fileBuf, sizeof fileBuf, ImGuiInputTextFlags_EnterReturnsTrue);
            if (ImGui::Button(mode == 0 ? "Save" : "Open", ImVec2(120, 0)) || enter) {
                bool ok = mode == 0 ? comp.save(fileBuf) : comp.load(fileBuf);
                app.status = ok ? std::string(mode == 0 ? "Saved " : "Opened ") + fileBuf : std::string(mode == 0 ? "Save failed" : "Could not open that file");
                if (ok && mode == 1) { app.selLayer = 0; app.selCol = -1; }
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();
            if (ImGui::Button("Cancel", ImVec2(120, 0))) ImGui::CloseCurrentPopup();
            ImGui::EndPopup();
        }
    }
    ImGui::SetNextWindowPos(centre, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    if (ImGui::BeginPopupModal("Composition settings", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        static int wh[2] = {0, 0}, cols = 0;
        if (ImGui::IsWindowAppearing()) { wh[0] = comp.w; wh[1] = comp.h; cols = comp.columns; }
        ImGui::InputInt2("Resolution", wh);
        if (ImGui::SmallButton("1280x720")) { wh[0] = 1280; wh[1] = 720; }
        ImGui::SameLine();
        if (ImGui::SmallButton("1920x1080")) { wh[0] = 1920; wh[1] = 1080; }
        ImGui::SameLine();
        if (ImGui::SmallButton("3840x2160")) { wh[0] = 3840; wh[1] = 2160; }
        ImGui::SliderInt("Columns", &cols, 1, 32);
        if (ImGui::Button("Apply", ImVec2(120, 0))) {
            if (wh[0] != comp.w || wh[1] != comp.h) comp.resize(wh[0], wh[1]);
            if (cols != comp.columns) comp.setColumns(cols);
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button("Cancel", ImVec2(120, 0))) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }
    ImGui::SetNextWindowPos(centre, ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    if (ImGui::BeginPopupModal("About", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Text("Strodano VJ 0.1");
        ImGui::Text("Open-source live visuals. GPL-3.0.");
        ImGui::Text("Built with FFmpeg, GLFW, Dear ImGui and the FFGL plugin standard.");
        ImGui::Text("%d FFGL plugin(s) loaded.", (int)ffgl::plugins().size());
        if (ImGui::Button("Close", ImVec2(120, 0))) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }

    // fixed layout
    const ImGuiViewport* vp = ImGui::GetMainViewport();
    ImVec2 o = vp->WorkPos, s = vp->WorkSize;
    float fh = ImGui::GetFrameHeight();
    float barH = fh + ImGui::GetStyle().WindowPadding.y * 2;
    float bottomMin = std::min(s.y * 0.45f, fh * 14.0f);
    float gridH = std::max(fh * 6.0f, s.y - barH - bottomMin);
    float gridWant = fh * 2.2f + (float)comp.layers.size() * (fh * 5.2f);
    gridH = std::min(gridH, std::max(gridWant, s.y * 0.35f));
    float bottomY = o.y + gridH, bottomH = s.y - gridH - barH;
    float leftW = s.x * 0.27f, rightW = s.x * 0.27f, midW = s.x - leftW - rightW;
    gridPanel(app, o, ImVec2(s.x, gridH));
    propertiesPanel(app, ImVec2(o.x, bottomY), ImVec2(leftW, bottomH));
    monitorPanel(app, ImVec2(o.x + leftW, bottomY), ImVec2(midW, bottomH));
    browserPanel(app, ImVec2(o.x + leftW + midW, bottomY), ImVec2(rightW, bottomH));
    transportBar(app, ImVec2(o.x, o.y + s.y - barH), ImVec2(s.x, barH));
    outputSetup(app);
}
