cmake_minimum_required(VERSION 3.21)
project(StrodanoVJ VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

# ---- GLFW (system package if present, otherwise built from source) ----
if(UNIX AND NOT APPLE)
  find_package(glfw3 3.3 QUIET)
endif()
if(NOT glfw3_FOUND)
  set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
  set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(glfw GIT_REPOSITORY https://github.com/glfw/glfw.git GIT_TAG 3.4 GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(glfw)
endif()

# ---- Dear ImGui ----
FetchContent_Declare(imgui GIT_REPOSITORY https://github.com/ocornut/imgui.git GIT_TAG v1.91.9b GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(imgui)
add_library(imgui STATIC
  ${imgui_SOURCE_DIR}/imgui.cpp ${imgui_SOURCE_DIR}/imgui_draw.cpp ${imgui_SOURCE_DIR}/imgui_tables.cpp
  ${imgui_SOURCE_DIR}/imgui_widgets.cpp ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
  ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp)
target_include_directories(imgui PUBLIC ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
target_link_libraries(imgui PUBLIC glfw)

# ---- JSON ----
FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(json)

# ---- FFmpeg ----
option(STRODANO_STATIC_FFMPEG "Link a static FFmpeg found through pkg-config (used for the macOS app)" OFF)
add_library(ffmpeg INTERFACE)
if(MSVC)
  find_package(FFMPEG REQUIRED)   # provided by vcpkg
  target_include_directories(ffmpeg INTERFACE ${FFMPEG_INCLUDE_DIRS})
  target_link_directories(ffmpeg INTERFACE ${FFMPEG_LIBRARY_DIRS})
  target_link_libraries(ffmpeg INTERFACE ${FFMPEG_LIBRARIES})
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(AV REQUIRED libavformat libavcodec libswscale libavutil)
  if(STRODANO_STATIC_FFMPEG)
    target_include_directories(ffmpeg INTERFACE ${AV_STATIC_INCLUDE_DIRS})
    target_link_directories(ffmpeg INTERFACE ${AV_STATIC_LIBRARY_DIRS})
    target_link_libraries(ffmpeg INTERFACE ${AV_STATIC_LIBRARIES})
    if(APPLE)
      foreach(fw CoreFoundation CoreVideo CoreMedia VideoToolbox AudioToolbox Security)
        target_link_libraries(ffmpeg INTERFACE "-framework ${fw}")
      endforeach()
    else()
      target_link_options(ffmpeg INTERFACE ${AV_STATIC_LDFLAGS_OTHER})
    endif()
  else()
    target_include_directories(ffmpeg INTERFACE ${AV_INCLUDE_DIRS})
    target_link_directories(ffmpeg INTERFACE ${AV_LIBRARY_DIRS})
    target_link_libraries(ffmpeg INTERFACE ${AV_LIBRARIES})
  endif()
endif()

# ---- application ----
set(SOURCES
  src/main.cpp src/ui.cpp src/comp.cpp src/video.cpp src/effects.cpp src/ffgl_host.cpp src/output.cpp src/gfx.cpp
  third_party/glad/src/gl.c)
if(WIN32)
  list(APPEND SOURCES packaging/app.rc)
endif()
add_executable(StrodanoVJ WIN32 MACOSX_BUNDLE ${SOURCES})
target_include_directories(StrodanoVJ PRIVATE third_party/glad/include)
target_link_libraries(StrodanoVJ PRIVATE imgui glfw ffmpeg nlohmann_json::nlohmann_json)
if(MSVC)
  target_link_options(StrodanoVJ PRIVATE /ENTRY:mainCRTStartup)
  target_compile_definitions(StrodanoVJ PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
  target_compile_options(StrodanoVJ PRIVATE /utf-8)
elseif(UNIX AND NOT APPLE)
  find_package(Threads REQUIRED)
  target_link_libraries(StrodanoVJ PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
endif()
if(APPLE)
  set_target_properties(StrodanoVJ PROPERTIES
    OUTPUT_NAME "Strodano VJ"
    MACOSX_BUNDLE_BUNDLE_NAME "Strodano VJ"
    MACOSX_BUNDLE_GUI_IDENTIFIER "dev.strodano.vj"
    MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
    MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_SOURCE_DIR}/packaging/Info.plist.in")
endif()

# ---- install / Windows installer ----
if(WIN32)
  install(TARGETS StrodanoVJ RUNTIME DESTINATION .)
  install(DIRECTORY "$<TARGET_FILE_DIR:StrodanoVJ>/" DESTINATION . FILES_MATCHING PATTERN "*.dll")
  install(FILES LICENSE README.md DESTINATION .)
  set(CMAKE_INSTALL_SYSTEM_RUNTIME_DESTINATION .)
  include(InstallRequiredSystemLibraries)
  set(CPACK_GENERATOR NSIS)
  set(CPACK_PACKAGE_NAME "Strodano VJ")
  set(CPACK_PACKAGE_VENDOR "Strodano")
  set(CPACK_PACKAGE_VERSION ${PROJECT_VERSION})
  set(CPACK_PACKAGE_INSTALL_DIRECTORY "Strodano VJ")
  set(CPACK_PACKAGE_FILE_NAME "StrodanoVJ-${PROJECT_VERSION}-windows-x64-setup")
  set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_SOURCE_DIR}/LICENSE")
  set(CPACK_PACKAGE_EXECUTABLES "StrodanoVJ" "Strodano VJ")
  set(CPACK_NSIS_DISPLAY_NAME "Strodano VJ")
  set(CPACK_NSIS_ENABLE_UNINSTALL_BEFORE_INSTALL ON)
  set(CPACK_NSIS_MODIFY_PATH OFF)
  include(CPack)
endif()
