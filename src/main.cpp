#include <iostream>
#include "ThreadSafeBuffer.h"
#include "WifiScanner.h"
#include "RenderEngine.h"

int main() {
    std::cout << "==================================================" << std::endl;
    std::cout << "  WiFi-Thermal-Spatial-Mapper Starting...         " << std::endl;
    std::cout << "  Role: C++ Volumetric Spatial Radar visualizer   " << std::endl;
    std::cout << "==================================================" << std::endl;

    // 1. Initialize Thread-safe sharing buffer
    ThreadSafeBuffer<WifiMetrics> wifiBuffer;

    // 2. Setup low-level OS Wifi background scanner thread
    WifiScanner scanner;
    std::cout << "[Core] Initializing Wifi background scanner thread (100ms polling rate)..." << std::endl;
    scanner.start(wifiBuffer, 100);

    // 3. Setup Render Engine window
    RenderEngine engine;
    std::cout << "[Visualization] Launching OpenGL Renderer window (1024x768)..." << std::endl;
    
    if (!engine.initialize(1024, 768, "WiFi-Thermal-Spatial-Mapper | C++ Volumetric Radar")) {
        std::cerr << "[Critical] RenderEngine failed to initialize. Shutting down." << std::endl;
        scanner.stop();
        return -1;
    }

    // 4. Run main loop (visualizer runs on main thread due to platform UI restrictions)
    std::cout << "[Main] System operational. Running visualizer event loops." << std::endl;
    std::cout << "       Controls:" << std::endl;
    std::cout << "       - Press '1' for Stationary Radar View (Frustum)" << std::endl;
    std::cout << "       - Press '2' for Warwalking Point Cloud View" << std::endl;
    std::cout << "       - Use WASD + Mouse Drag to navigate camera" << std::endl;
    std::cout << "       - Use Arrow keys + E/Q to walk in volumetric 3D space" << std::endl;
    std::cout << "       - Press SPACE to drop a new node in Point Cloud mode" << std::endl;
    std::cout << "       - Press ESC to exit" << std::endl;

    engine.run(wifiBuffer);

    // 5. Cleanup
    std::cout << "[Core] Stopping scanner thread..." << std::endl;
    scanner.stop();

    std::cout << "[Main] System shutdown completed gracefully." << std::endl;
    std::cout << "==================================================" << std::endl;
    return 0;
}
