#pragma once

#include <string>
#include <vector>
#include "ThreadSafeBuffer.h"
#include "WifiScanner.h"
#include "Math3D.h"
#include "gl_loader.h"

struct PointNode {
    Math3D::Vec3 position;
    float signalStrength; // 0.0 (weak) to 1.0 (strong)
};

struct Particle {
    Math3D::Vec3 pos;
    Math3D::Vec3 vel;
    float lifetime = 0.0f;
    float maxLifetime = 1.0f;
    Math3D::Vec4 color;
};

class RenderEngine {
public:
    RenderEngine();
    ~RenderEngine();

    // Disable copy
    RenderEngine(const RenderEngine&) = delete;
    RenderEngine& operator=(const RenderEngine&) = delete;

    bool initialize(int width, int height, const std::string& title);
    void run(ThreadSafeBuffer<WifiMetrics>& wifiBuffer);
    void shutdown();

    // Key callbacks handled by static bridges
    void onKey(int key, int scancode, int action, int mods);
    void onMouseMove(double xpos, double ypos);
    void onWindowResize(int width, int height);

private:
    void handleInput(float deltaTime);
    void updateSimulation(const WifiMetrics& latest, float dt);
    void renderScene(float time);

    void buildShaders();
    void setupGeometry();
    void updatePointCloudBuffer();
    void updateFrustumGeometry(float signal);
    void spawnScatteringParticles(const Math3D::Vec3& origin, int count);
    void updateParticles(float dt);
    void renderParticles();

    // Window configuration
    GLFWwindow* m_window = nullptr;
    int m_width = 800;
    int m_height = 600;

    // Shader handles
    GLuint m_shaderProgram = 0;
    GLuint m_particleShaderProgram = 0;
    
    // Shader Uniforms
    GLint m_modelLoc = -1;
    GLint m_viewLoc = -1;
    GLint m_projLoc = -1;
    GLint m_useLUTLoc = -1;

    // Vertex buffer attributes
    GLuint m_frustumVAO = 0, m_frustumVBO = 0;
    GLuint m_pointCloudVAO = 0, m_pointCloudVBO = 0;
    GLuint m_particleVAO = 0, m_particleVBO = 0;

    // Navigation and Camera variables
    Math3D::Vec3 m_cameraPos;
    Math3D::Vec3 m_cameraFront;
    Math3D::Vec3 m_cameraUp;
    float m_yaw = -90.0f;
    float m_pitch = 0.0f;
    float m_lastX = 400.0f;
    float m_lastY = 300.0f;
    bool m_firstMouse = true;
    float m_cameraSpeed = 4.0f;
    float m_mouseSensitivity = 0.15f;

    // Warwalking walk position
    Math3D::Vec3 m_walkPos;
    float m_walkHeading = 0.0f;

    // Application state
    int m_renderMode = 1; // 1 = Stationary Radar frustum, 2 = Warwalking spatial point cloud
    float m_lastScanTime = 0.0f;
    float m_obstacleAlertAlpha = 0.0f;
    bool m_obstacleDetected = false;

    // Collected datasets
    std::vector<PointNode> m_pointNodes;
    std::vector<Particle> m_particles;
};
