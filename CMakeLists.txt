cmake_minimum_required(VERSION 3.15)
project(AetherSense VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Header directories
include_directories(include)

# Output build files
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# ==========================================
# 1. CORE LIBRARY (Shared between targets)
# ==========================================
add_library(wifi_core STATIC
    src/core/WifiScanner.cpp
)

# Platform-specific configurations for the core library
if(WIN32)
    target_compile_definitions(wifi_core PRIVATE SYSTEM_WINDOWS)
    target_link_libraries(wifi_core PRIVATE Wlanapi.lib)
elseif(APPLE)
    target_compile_definitions(wifi_core PRIVATE SYSTEM_MACOS)
    find_library(COREWLAN_FRAMEWORK CoreWLAN REQUIRED)
    target_link_libraries(wifi_core PRIVATE ${COREWLAN_FRAMEWORK})
    # Enable Objective-C++ compilation for files that need CoreWLAN bridging
    set_source_files_properties(src/core/WifiScanner.cpp PROPERTIES COMPILE_FLAGS "-x objective-c++")
else()
    target_compile_definitions(wifi_core PRIVATE SYSTEM_LINUX)
    target_link_libraries(wifi_core PRIVATE pthread rt)
endif()

# ==========================================
# 2. CLI TARGET (Lightweight JSON stream)
# ==========================================
add_executable(wifi_scanner_cli
    src/cli_main.cpp
)
target_link_libraries(wifi_scanner_cli PRIVATE wifi_core)

# ==========================================
# 3. NATIVE VISUALIZER TARGET (OpenGL/GLFW)
# ==========================================
add_executable(AetherSense
    src/main.cpp
    src/visualization/RenderEngine.cpp
)
target_link_libraries(AetherSense PRIVATE wifi_core)

if(WIN32)
    target_compile_definitions(AetherSense PRIVATE SYSTEM_WINDOWS)
    find_package(glfw3 CONFIG QUIET)
    if(glfw3_FOUND)
        target_link_libraries(AetherSense PRIVATE glfw)
    else()
        target_link_libraries(AetherSense PRIVATE glfw3)
    endif()
    target_link_libraries(AetherSense PRIVATE opengl32.lib User32.lib Gdi32.lib Shell32.lib)

elseif(APPLE)
    target_compile_definitions(AetherSense PRIVATE SYSTEM_MACOS)
    find_package(glfw3 CONFIG QUIET)
    if(NOT glfw3_FOUND)
        find_package(glfw3 QUIET)
    endif()
    
    find_library(OPENGL_FRAMEWORK OpenGL REQUIRED)
    find_library(COCOA_FRAMEWORK Cocoa REQUIRED)
    find_library(IOKIT_FRAMEWORK IOKit REQUIRED)
    find_library(COREVIDEO_FRAMEWORK CoreVideo REQUIRED)
    
    target_link_libraries(AetherSense PRIVATE 
        ${OPENGL_FRAMEWORK} 
        ${COCOA_FRAMEWORK}
        ${IOKIT_FRAMEWORK}
        ${COREVIDEO_FRAMEWORK}
    )
    
    if(glfw3_FOUND)
        target_link_libraries(AetherSense PRIVATE glfw)
    else()
        target_link_libraries(AetherSense PRIVATE "-lglfw")
    endif()

else()
    target_compile_definitions(AetherSense PRIVATE SYSTEM_LINUX)
    find_package(PkgConfig QUIET)
    if(PKG_CONFIG_FOUND)
        pkg_check_modules(GLFW glfw3)
    endif()
    
    if(GLFW_FOUND)
        target_link_libraries(AetherSense PRIVATE 
            GL 
            dl
            ${GLFW_LIBRARIES}
        )
        target_include_directories(AetherSense PRIVATE ${GLFW_INCLUDE_DIRS})
    else()
        # Fallback raw links
        target_link_libraries(AetherSense PRIVATE GL dl glfw)
    endif()
endif()
