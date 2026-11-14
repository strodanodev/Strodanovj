// Strodano VJ - built-in effects and generators (GPL-3.0)
#pragma once
#include <glad/gl.h>
#include <string>
#include <vector>

struct ParamDef { const char* name; float def; };

struct ShaderDef {
    const char* name;
    std::vector<ParamDef> params;   // up to 4, all normalised 0..1
    const char* body;               // GLSL defining vec4 fx() (effects) or vec4 gen() (generators)
    GLuint prog = 0;
    bool tried = false;
};

std::vector<ShaderDef>& builtinEffects();
std::vector<ShaderDef>& builtinGenerators();
int findEffect(const std::string& name);       // -1 if unknown
int findGenerator(const std::string& name);
GLuint effectProgram(int idx);                 // compiled on first use
GLuint generatorProgram(int idx);
