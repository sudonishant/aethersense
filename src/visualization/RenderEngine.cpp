#include "RenderEngine.h"
#include <iostream>
#include <vector>
#include <cmath>
#include <random>

// Shader Source Code
static const char* vertexShaderSource = R"glsl(
#version 330 core
layout (location = 0) in vec3 aPos;
layout (location = 1) in float aSignal;

out float vSignal;

uniform mat4 model;
uniform mat4 view;
uniform mat4 projection;

void main() {
    gl_Position = projection * view * model * vec4(aPos, 1.0);
    vSignal = aSignal;
}
)glsl";

static const char* fragmentShaderSource = R"glsl(
#version 330 core
in float vSignal;
out vec4 FragColor;

uniform int useLUT;
uniform vec3 uniformColor;

vec3 getThermalColor(float value) {
    float val = clamp(value, 0.0, 1.0);
    
    // Custom High-Contrast Thermal LUT mapping (Red = Obstacle/Weak, Blue = Clear/Strong)
    // Blue (Strong Signal, clear space): val = 1.0
    // Green (Medium-strong): val = 0.75
    // Yellow (Medium): val = 0.5
    // Orange (Medium-weak): val = 0.25
    // Crimson Red (Weak Signal/Abrupt Drop/Obstacle): val = 0.0
    
    vec3 c0 = vec3(0.0, 0.0, 0.8); // Deep blue (Strong)
    vec3 c1 = vec3(0.0, 0.8, 0.3); // Green (Medium-Strong)
    vec3 c2 = vec3(0.9, 0.9, 0.0); // Yellow (Medium)
    vec3 c3 = vec3(1.0, 0.5, 0.0); // Orange (Medium-Weak)
    vec3 c4 = vec3(1.0, 0.0, 0.1); // Crimson Red (Weak / Obstacle)

    if (val < 0.25) {
        float t = val / 0.25;
        return mix(c4, c3, t);
    } else if (val < 0.5) {
        float t = (val - 0.25) / 0.25;
        return mix(c3, c2, t);
    } else if (val < 0.75) {
        float t = (val - 0.5) / 0.25;
        return mix(c2, c1, t);
    } else {
        float t = (val - 0.75) / 0.25;
        return mix(c1, c0, t);
    }
}

void main() {
    if (useLUT == 1) {
        FragColor = vec4(getThermalColor(vSignal), 0.85);
    } else {
        FragColor = vec4(uniformColor, 0.8);
    }
}
)glsl";

static const char* particleVertexShaderSource = R"glsl(
#version 330 core
layout (location = 0) in vec3 aPos;
layout (location = 1) in vec4 aColor;

out vec4 vColor;

uniform mat4 view;
uniform mat4 projection;

void main() {
    gl_Position = projection * view * vec4(aPos, 1.0);
    vColor = aColor;
}
)glsl";

static const char* particleFragmentShaderSource = R"glsl(
#version 330 core
in vec4 vColor;
out vec4 FragColor;

void main() {
    // Render circular soft points
    vec2 circ = gl_PointCoord - vec2(0.5);
    if (dot(circ, circ) > 0.25) {
        discard;
    }
    FragColor = vColor;
}
)glsl";

RenderEngine::RenderEngine() 
    : m_cameraPos(0.0f, 3.0f, 8.0f),
      m_cameraFront(0.0f, -0.2f, -1.0f),
      m_cameraUp(0.0f, 1.0f, 0.0f),
      m_walkPos(0.0f, 0.0f, 0.0f) {}

RenderEngine::~RenderEngine() {
    shutdown();
}

bool RenderEngine::initialize(int width, int height, const std::string& title) {
    m_width = width;
    m_height = height;

    if (!glfwInit()) {
        std::cerr << "Failed to initialize GLFW" << std::endl;
        return false;
    }

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
#endif

    m_window = glfwCreateWindow(m_width, m_height, title.c_str(), nullptr, nullptr);
    if (!m_window) {
        std::cerr << "Failed to create GLFW window" << std::endl;
        glfwTerminate();
        return false;
    }

    glfwMakeContextCurrent(m_window);
    glfwSwapInterval(1); // Enable VSync

    // Initialize custom OpenGL function loader
    if (!init_gl_loader()) {
        std::cerr << "Failed to load OpenGL functions!" << std::endl;
        return false;
    }

    // Set callbacks using window user pointer pattern
    glfwSetWindowUserPointer(m_window, this);

    glfwSetFramebufferSizeCallback(m_window, [](GLFWwindow* w, int width, int height) {
        auto* engine = static_cast<RenderEngine*>(glfwGetWindowUserPointer(w));
        if (engine) engine->onWindowResize(width, height);
    });

    glfwSetCursorPosCallback(m_window, [](GLFWwindow* w, double xpos, double ypos) {
        auto* engine = static_cast<RenderEngine*>(glfwGetWindowUserPointer(w));
        if (engine) engine->onMouseMove(xpos, ypos);
    });

    glfwSetKeyCallback(m_window, [](GLFWwindow* w, int key, int scancode, int action, int mods) {
        auto* engine = static_cast<RenderEngine*>(glfwGetWindowUserPointer(w));
        if (engine) engine->onKey(key, scancode, action, mods);
    });

    // Configure global OpenGL state
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    
#ifndef __APPLE__
    // Enable point size control in shaders
    glEnable(0x8642); // GL_PROGRAM_POINT_SIZE
#endif

    // Build pipelines and configure buffers
    buildShaders();
    setupGeometry();

    return true;
}

void RenderEngine::buildShaders() {
    auto compileShader = [](GLenum type, const char* src) -> GLuint {
        GLuint shader = glCreateShader(type);
        glShaderSource(shader, 1, &src, nullptr);
        glCompileShader(shader);

        GLint success;
        glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
        if (!success) {
            char log[512];
            glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
            std::cerr << "Shader compile error: " << log << std::endl;
        }
        return shader;
    };

    GLuint vs = compileShader(GL_VERTEX_SHADER, vertexShaderSource);
    GLuint fs = compileShader(GL_FRAGMENT_SHADER, fragmentShaderSource);

    m_shaderProgram = glCreateProgram();
    glAttachShader(m_shaderProgram, vs);
    glAttachShader(m_shaderProgram, fs);
    glLinkProgram(m_shaderProgram);

    GLint linked;
    glGetProgramiv(m_shaderProgram, GL_LINK_STATUS, &linked);
    if (!linked) {
        char log[512];
        glGetProgramInfoLog(m_shaderProgram, sizeof(log), nullptr, log);
        std::cerr << "Shader link error: " << log << std::endl;
    }

    glDeleteShader(vs);
    glDeleteShader(fs);

    // Uniforms caching
    m_modelLoc = glGetUniformLocation(m_shaderProgram, "model");
    m_viewLoc = glGetUniformLocation(m_shaderProgram, "view");
    m_projLoc = glGetUniformLocation(m_shaderProgram, "projection");
    m_useLUTLoc = glGetUniformLocation(m_shaderProgram, "useLUT");

    // Build particle shaders
    GLuint pvs = compileShader(GL_VERTEX_SHADER, particleVertexShaderSource);
    GLuint pfs = compileShader(GL_FRAGMENT_SHADER, particleFragmentShaderSource);

    m_particleShaderProgram = glCreateProgram();
    glAttachShader(m_particleShaderProgram, pvs);
    glAttachShader(m_particleShaderProgram, pfs);
    glLinkProgram(m_particleShaderProgram);

    glDeleteShader(pvs);
    glDeleteShader(pfs);
}

void RenderEngine::setupGeometry() {
    // Frustum buffers setup
    glGenVertexArrays(1, &m_frustumVAO);
    glGenBuffers(1, &m_frustumVBO);

    // Point cloud buffers setup
    glGenVertexArrays(1, &m_pointCloudVAO);
    glGenBuffers(1, &m_pointCloudVBO);

    // Particle buffers setup
    glGenVertexArrays(1, &m_particleVAO);
    glGenBuffers(1, &m_particleVBO);
}

void RenderEngine::updateFrustumGeometry(float signal) {
    // Define 3D Frustum vertex endpoints representing the cone from the laptop (origin) to the router
    // Each line segment holds: position (X, Y, Z) and signal normalized strength
    float data[] = {
        // Core line of sight axis (Origin -> Router target)
        0.0f, 0.0f, 0.0f, signal,
        0.0f, 0.0f, -6.0f, signal,

        // Ray 1: Top-Left
        0.0f, 0.0f, 0.0f, signal,
        -3.0f, 2.0f, -6.0f, signal,

        // Ray 2: Top-Right
        0.0f, 0.0f, 0.0f, signal,
        3.0f, 2.0f, -6.0f, signal,

        // Ray 3: Bottom-Right
        0.0f, 0.0f, 0.0f, signal,
        3.0f, -2.0f, -6.0f, signal,

        // Ray 4: Bottom-Left
        0.0f, 0.0f, 0.0f, signal,
        -3.0f, -2.0f, -6.0f, signal,

        // Outer rectangle boundary links
        -3.0f, 2.0f, -6.0f, signal,
        3.0f, 2.0f, -6.0f, signal,

        3.0f, 2.0f, -6.0f, signal,
        3.0f, -2.0f, -6.0f, signal,

        3.0f, -2.0f, -6.0f, signal,
        -3.0f, -2.0f, -6.0f, signal,

        -3.0f, -2.0f, -6.0f, signal,
        -3.0f, 2.0f, -6.0f, signal
    };

    glBindVertexArray(m_frustumVAO);
    glBindBuffer(GL_ARRAY_BUFFER, m_frustumVBO);
    glBufferData(GL_ARRAY_BUFFER, sizeof(data), data, GL_DYNAMIC_DRAW);

    // Setup attributes
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 1, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)(3 * sizeof(float)));
    glEnableVertexAttribArray(1);
    
    glBindVertexArray(0);
}

void RenderEngine::updatePointCloudBuffer() {
    if (m_pointNodes.empty()) return;

    std::vector<float> data;
    data.reserve(m_pointNodes.size() * 4);
    for (const auto& node : m_pointNodes) {
        data.push_back(node.position.x);
        data.push_back(node.position.y);
        data.push_back(node.position.z);
        data.push_back(node.signalStrength);
    }

    glBindVertexArray(m_pointCloudVAO);
    glBindBuffer(GL_ARRAY_BUFFER, m_pointCloudVBO);
    glBufferData(GL_ARRAY_BUFFER, data.size() * sizeof(float), data.data(), GL_DYNAMIC_DRAW);

    // Attribute pointers
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 1, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)(3 * sizeof(float)));
    glEnableVertexAttribArray(1);

    glBindVertexArray(0);
}

void RenderEngine::spawnScatteringParticles(const Math3D::Vec3& origin, int count) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_real_distribution<float> velDist(-1.5f, 1.5f);
    std::uniform_real_distribution<float> lifeDist(0.5f, 1.2f);

    for (int i = 0; i < count; ++i) {
        Particle p;
        p.pos = origin;
        p.vel = Math3D::Vec3(velDist(gen), std::abs(velDist(gen)) + 0.5f, velDist(gen));
        p.lifetime = 0.0f;
        p.maxLifetime = lifeDist(gen);
        // Fade from glowing infrared red/crimson to invisible orange
        p.color = Math3D::Vec4(1.0f, 0.1f, 0.0f, 1.0f);
        m_particles.push_back(p);
    }
}

void RenderEngine::updateParticles(float dt) {
    for (auto it = m_particles.begin(); it != m_particles.end();) {
        it->lifetime += dt;
        if (it->lifetime >= it->maxLifetime) {
            it = m_particles.erase(it);
        } else {
            // Apply simple physics (gravity pulling particles down, friction slowing velocity)
            it->pos += it->vel * dt;
            it->vel.y -= 0.5f * dt; // Gravity
            
            // Fade alpha over lifespan
            float alpha = 1.0f - (it->lifetime / it->maxLifetime);
            it->color.w = alpha;
            // Transition color from red to yellow
            it->color.y = 0.8f * (it->lifetime / it->maxLifetime);
            ++it;
        }
    }
}

void RenderEngine::renderParticles() {
    if (m_particles.empty()) return;

    std::vector<float> data;
    data.reserve(m_particles.size() * 7);
    for (const auto& p : m_particles) {
        data.push_back(p.pos.x);
        data.push_back(p.pos.y);
        data.push_back(p.pos.z);
        data.push_back(p.color.x);
        data.push_back(p.color.y);
        data.push_back(p.color.z);
        data.push_back(p.color.w);
    }

    glBindVertexArray(m_particleVAO);
    glBindBuffer(GL_ARRAY_BUFFER, m_particleVBO);
    glBufferData(GL_ARRAY_BUFFER, data.size() * sizeof(float), data.data(), GL_DYNAMIC_DRAW);

    // Position attribute
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 7 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    // Color attribute
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, 7 * sizeof(float), (void*)(3 * sizeof(float)));
    glEnableVertexAttribArray(1);

    glUseProgram(m_particleShaderProgram);
    glBindVertexArray(m_particleVAO);
    
    // Pass projection & view
    Math3D::Mat4 proj = Math3D::Mat4::perspective(Math3D::to_radians(45.0f), (float)m_width / m_height, 0.1f, 100.0f);
    Math3D::Mat4 view = Math3D::Mat4::lookAt(m_cameraPos, m_cameraPos + m_cameraFront, m_cameraUp);
    
    GLint viewLoc = glGetUniformLocation(m_particleShaderProgram, "view");
    GLint projLoc = glGetUniformLocation(m_particleShaderProgram, "projection");
    glUniformMatrix4fv(viewLoc, 1, GL_FALSE, view.m);
    glUniformMatrix4fv(projLoc, 1, GL_FALSE, proj.m);

    // Disable depth write to prevent sorting issues with blending
    glDepthMask(GL_FALSE);
#ifdef __APPLE__
    glPointSize(6.0f);
#endif
    glDrawArrays(GL_POINTS, 0, static_cast<GLsizei>(m_particles.size()));
    glDepthMask(GL_TRUE);
    
    glBindVertexArray(0);
}

void RenderEngine::handleInput(float deltaTime) {
    float velocity = m_cameraSpeed * deltaTime;
    
    // Update camera flight position
    if (glfwGetKey(m_window, GLFW_KEY_W) == GLFW_PRESS)
        m_cameraPos += m_cameraFront * velocity;
    if (glfwGetKey(m_window, GLFW_KEY_S) == GLFW_PRESS)
        m_cameraPos -= m_cameraFront * velocity;
    if (glfwGetKey(m_window, GLFW_KEY_A) == GLFW_PRESS) {
        Math3D::Vec3 right = m_cameraFront.cross(m_cameraUp).normalize();
        m_cameraPos -= right * velocity;
    }
    if (glfwGetKey(m_window, GLFW_KEY_D) == GLFW_PRESS) {
        Math3D::Vec3 right = m_cameraFront.cross(m_cameraUp).normalize();
        m_cameraPos += right * velocity;
    }

    // Handle Warwalking keyboard controls to move physical cursor walk position
    float walkVelocity = 2.5f * deltaTime;
    if (glfwGetKey(m_window, GLFW_KEY_UP) == GLFW_PRESS) {
        m_walkPos.z -= walkVelocity;
    }
    if (glfwGetKey(m_window, GLFW_KEY_DOWN) == GLFW_PRESS) {
        m_walkPos.z += walkVelocity;
    }
    if (glfwGetKey(m_window, GLFW_KEY_LEFT) == GLFW_PRESS) {
        m_walkPos.x -= walkVelocity;
    }
    if (glfwGetKey(m_window, GLFW_KEY_RIGHT) == GLFW_PRESS) {
        m_walkPos.x += walkVelocity;
    }
    if (glfwGetKey(m_window, GLFW_KEY_E) == GLFW_PRESS) {
        m_walkPos.y += walkVelocity;
    }
    if (glfwGetKey(m_window, GLFW_KEY_Q) == GLFW_PRESS) {
        m_walkPos.y -= walkVelocity;
    }
}

void RenderEngine::onKey(int key, int scancode, int action, int mods) {
    if (action != GLFW_PRESS) return;

    if (key == GLFW_KEY_ESCAPE) {
        glfwSetWindowShouldClose(m_window, true);
    }
    if (key == GLFW_KEY_1) {
        m_renderMode = 1;
        std::cout << "Switched to Mode 1: Stationary Radar Frustum" << std::endl;
    }
    if (key == GLFW_KEY_2) {
        m_renderMode = 2;
        std::cout << "Switched to Mode 2: Warwalking Volumetric Point Cloud" << std::endl;
    }
    if (key == GLFW_KEY_SPACE) {
        // In Mode 2, manual scan drop
        if (m_renderMode == 2) {
            // We request the latest metrics to drop a node
            // The main loop thread safe buffer will be read
            m_lastScanTime = -100.0f; // Force instant node capturing update
        }
    }
}

void RenderEngine::onMouseMove(double xpos, double ypos) {
    if (glfwGetMouseButton(m_window, GLFW_MOUSE_BUTTON_LEFT) != GLFW_PRESS) {
        m_firstMouse = true;
        return;
    }

    if (m_firstMouse) {
        m_lastX = static_cast<float>(xpos);
        m_lastY = static_cast<float>(ypos);
        m_firstMouse = false;
    }

    float xoffset = static_cast<float>(xpos) - m_lastX;
    float yoffset = m_lastY - static_cast<float>(ypos); // Reversed since y-coordinates go from bottom to top
    m_lastX = static_cast<float>(xpos);
    m_lastY = static_cast<float>(ypos);

    xoffset *= m_mouseSensitivity;
    yoffset *= m_mouseSensitivity;

    m_yaw += xoffset;
    m_pitch += yoffset;

    if (m_pitch > 89.0f) m_pitch = 89.0f;
    if (m_pitch < -89.0f) m_pitch = -89.0f;

    Math3D::Vec3 front;
    front.x = std::cos(Math3D::to_radians(m_yaw)) * std::cos(Math3D::to_radians(m_pitch));
    front.y = std::sin(Math3D::to_radians(m_pitch));
    front.z = std::sin(Math3D::to_radians(m_yaw)) * std::cos(Math3D::to_radians(m_pitch));
    m_cameraFront = front.normalize();
}

void RenderEngine::onWindowResize(int width, int height) {
    m_width = width;
    m_height = height;
    glViewport(0, 0, m_width, m_height);
}

void RenderEngine::updateSimulation(const WifiMetrics& latest, float dt) {
    // 1. Manage obstacle alerts and particles triggers
    float normalizedSignal = (latest.rssi + 100.0f) / 70.0f; // Mapping -100..-30 to 0..1
    normalizedSignal = std::clamp(normalizedSignal, 0.0f, 1.0f);

    if (latest.rssi < -82) {
        m_obstacleDetected = true;
        m_obstacleAlertAlpha = 0.3f + 0.15f * std::sin(glfwGetTime() * 10.0f); // Pulsing alert
        
        // Spawn sparks radiating from obstacle location (z = -3)
        static float particleTimer = 0.0f;
        particleTimer += dt;
        if (particleTimer > 0.08f) {
            spawnScatteringParticles(Math3D::Vec3(0.0f, 0.0f, -3.0f), 4);
            particleTimer = 0.0f;
        }
    } else {
        m_obstacleDetected = false;
        m_obstacleAlertAlpha = std::max(0.0f, m_obstacleAlertAlpha - 2.0f * dt);
    }

    updateParticles(dt);

    // 2. Add node logic in Mode 2
    if (m_renderMode == 2) {
        float time = static_cast<float>(glfwGetTime());
        // Auto drop points periodically when moving, or force drop by spacebar
        if (time - m_lastScanTime > 1.0f || m_lastScanTime < 0.0f) {
            PointNode node;
            node.position = m_walkPos;
            node.signalStrength = normalizedSignal;
            m_pointNodes.push_back(node);
            m_lastScanTime = time;
            updatePointCloudBuffer();
            
            std::cout << "[Scanner] Volumetric Node Dropped at (" 
                      << m_walkPos.x << ", " << m_walkPos.y << ", " << m_walkPos.z 
                      << ") with RSSI: " << latest.rssi << " dBm (" << latest.ssid << ")" << std::endl;
        }
    }

    // Update dynamic frustum points representation
    updateFrustumGeometry(normalizedSignal);

    // Render HUD title updates
    char hudTitle[256];
    snprintf(hudTitle, sizeof(hudTitle),
             "WiFi-Thermal-Spatial-Mapper | Mode: %s | RSSI: %d dBm (%s) | Nodes: %d | WASD: Fly | Arrows: Walk",
             m_renderMode == 1 ? "STATIONARY RADAR" : "SPATIAL POINT CLOUD",
             latest.rssi, latest.ssid.c_str(), static_cast<int>(m_pointNodes.size()));
    glfwSetWindowTitle(m_window, hudTitle);
}

void RenderEngine::renderScene(float time) {
    // Sleek dark holographic radar aesthetic
    glClearColor(0.02f, 0.02f, 0.05f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glUseProgram(m_shaderProgram);

    // Setup uniform projections
    Math3D::Mat4 proj = Math3D::Mat4::perspective(Math3D::to_radians(45.0f), (float)m_width / m_height, 0.1f, 100.0f);
    Math3D::Mat4 view = Math3D::Mat4::lookAt(m_cameraPos, m_cameraPos + m_cameraFront, m_cameraUp);
    Math3D::Mat4 model = Math3D::Mat4::identity();

    glUniformMatrix4fv(m_viewLoc, 1, GL_FALSE, view.m);
    glUniformMatrix4fv(m_projLoc, 1, GL_FALSE, proj.m);
    glUniformMatrix4fv(m_modelLoc, 1, GL_FALSE, model.m);

    // Draw floor grid for Spatial visual referencing
    glUniform1i(m_useLUTLoc, 0); // Flat color
    GLint colorLoc = glGetUniformLocation(m_shaderProgram, "uniformColor");
    
    // Techy grid floor lines
    std::vector<float> gridData;
    for (int i = -15; i <= 15; ++i) {
        // Lines parallel to Z axis
        gridData.push_back(static_cast<float>(i)); gridData.push_back(-0.5f); gridData.push_back(-15.0f); gridData.push_back(0.5f);
        gridData.push_back(static_cast<float>(i)); gridData.push_back(-0.5f); gridData.push_back(15.0f); gridData.push_back(0.5f);
        
        // Lines parallel to X axis
        gridData.push_back(-15.0f); gridData.push_back(-0.5f); gridData.push_back(static_cast<float>(i)); gridData.push_back(0.5f);
        gridData.push_back(15.0f); gridData.push_back(-0.5f); gridData.push_back(static_cast<float>(i)); gridData.push_back(0.5f);
    }
    
    GLuint gridVAO, gridVBO;
    glGenVertexArrays(1, &gridVAO);
    glGenBuffers(1, &gridVBO);
    glBindVertexArray(gridVAO);
    glBindBuffer(GL_ARRAY_BUFFER, gridVBO);
    glBufferData(GL_ARRAY_BUFFER, gridData.size() * sizeof(float), gridData.data(), GL_STATIC_DRAW);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 1, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)(3 * sizeof(float)));
    glEnableVertexAttribArray(1);

    // Grid color: Sleek dark cyan/blue
    glUniform3fv(colorLoc, 1, &Math3D::Vec3(0.05f, 0.15f, 0.25f).x);
    glDrawArrays(GL_LINES, 0, static_cast<GLsizei>(gridData.size() / 4));
    
    glDeleteVertexArrays(1, &gridVAO);
    glDeleteBuffers(1, &gridVBO);

    // DRAW MODES
    if (m_renderMode == 1) {
        // Mode 1: Stationary Radar Frustum
        glUniform1i(m_useLUTLoc, 1); // Use Thermal Shader LUT
        glBindVertexArray(m_frustumVAO);
        
        // Render outline wireframe with double-width lines
#ifndef __APPLE__
        glLineWidth(2.5f);
#endif
        glDrawArrays(GL_LINES, 0, 18);
#ifndef __APPLE__
        glLineWidth(1.0f);
#endif

        // Dynamic Warning Plane representing obstacle presence
        if (m_obstacleAlertAlpha > 0.0f) {
            glUniform1i(m_useLUTLoc, 0); // Flat color
            glUniform3fv(colorLoc, 1, &Math3D::Vec3(1.0f, 0.0f, 0.1f).x);
            
            float warningQuad[] = {
                // Tri 1
                -2.0f, -1.5f, -3.0f, 0.0f,
                 2.0f, -1.5f, -3.0f, 0.0f,
                 2.0f,  1.5f, -3.0f, 0.0f,
                // Tri 2
                -2.0f, -1.5f, -3.0f, 0.0f,
                 2.0f,  1.5f, -3.0f, 0.0f,
                -2.0f,  1.5f, -3.0f, 0.0f
            };
            
            GLuint warnVAO, warnVBO;
            glGenVertexArrays(1, &warnVAO);
            glGenBuffers(1, &warnVBO);
            glBindVertexArray(warnVAO);
            glBindBuffer(GL_ARRAY_BUFFER, warnVBO);
            glBufferData(GL_ARRAY_BUFFER, sizeof(warningQuad), warningQuad, GL_STATIC_DRAW);
            glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)0);
            glEnableVertexAttribArray(0);
            
            // Blending with alert opacity
            glDrawArrays(GL_TRIANGLES, 0, 6);
            glDeleteVertexArrays(1, &warnVAO);
            glDeleteBuffers(1, &warnVBO);
        }
    } else {
        // Mode 2: Spatial Volumetric Point Cloud
        glUniform1i(m_useLUTLoc, 1); // Use thermal shader
        
        if (!m_pointNodes.empty()) {
            glBindVertexArray(m_pointCloudVAO);
            // Draw points as spheres/voxels using shader size control
#ifdef __APPLE__
            glPointSize(12.0f);
#endif
            glDrawArrays(GL_POINTS, 0, static_cast<GLsizei>(m_pointNodes.size()));
            
            // Draw line connections between subsequent points for walker track
#ifndef __APPLE__
            glLineWidth(1.5f);
#endif
            glDrawArrays(GL_LINE_STRIP, 0, static_cast<GLsizei>(m_pointNodes.size()));
#ifndef __APPLE__
            glLineWidth(1.0f);
#endif
        }

        // Draw physical walker's current position pointer
        glUniform1i(m_useLUTLoc, 0);
        glUniform3fv(colorLoc, 1, &Math3D::Vec3(0.0f, 0.8f, 1.0f).x); // Bright cyan indicator

        float walkerMarker[] = {
            m_walkPos.x - 0.2f, m_walkPos.y, m_walkPos.z, 0.0f,
            m_walkPos.x + 0.2f, m_walkPos.y, m_walkPos.z, 0.0f,
            m_walkPos.x, m_walkPos.y - 0.2f, m_walkPos.z, 0.0f,
            m_walkPos.x, m_walkPos.y + 0.2f, m_walkPos.z, 0.0f,
            m_walkPos.x, m_walkPos.y, m_walkPos.z - 0.2f, 0.0f,
            m_walkPos.x, m_walkPos.y, m_walkPos.z + 0.2f, 0.0f,
        };

        GLuint walkerVAO, walkerVBO;
        glGenVertexArrays(1, &walkerVAO);
        glGenBuffers(1, &walkerVBO);
        glBindVertexArray(walkerVAO);
        glBindBuffer(GL_ARRAY_BUFFER, walkerVBO);
        glBufferData(GL_ARRAY_BUFFER, sizeof(walkerMarker), walkerMarker, GL_STATIC_DRAW);
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)0);
        glEnableVertexAttribArray(0);
        glDrawArrays(GL_LINES, 0, 6);
        glDeleteVertexArrays(1, &walkerVAO);
        glDeleteBuffers(1, &walkerVBO);
    }

    glBindVertexArray(0);

    // Draw active particle sparks overlay
    renderParticles();
}

void RenderEngine::run(ThreadSafeBuffer<WifiMetrics>& wifiBuffer) {
    float lastFrameTime = 0.0f;

    while (!glfwWindowShouldClose(m_window)) {
        float currentFrameTime = static_cast<float>(glfwGetTime());
        float deltaTime = currentFrameTime - lastFrameTime;
        lastFrameTime = currentFrameTime;

        // Process inputs
        glfwPollEvents();
        handleInput(deltaTime);

        // Fetch latest metrics
        WifiMetrics latest;
        if (!wifiBuffer.get_latest(latest)) {
            // Default baseline
            latest.rssi = -60;
            latest.ssid = "Scanning...";
        }

        // Update physics, alert levels and geometry configs
        updateSimulation(latest, deltaTime);

        // Frame rendering call
        renderScene(currentFrameTime);

        // Buffer double buffers swap
        glfwSwapBuffers(m_window);
    }
}

void RenderEngine::shutdown() {
    if (m_shaderProgram) {
        glDeleteProgram(m_shaderProgram);
        m_shaderProgram = 0;
    }
    if (m_particleShaderProgram) {
        glDeleteProgram(m_particleShaderProgram);
        m_particleShaderProgram = 0;
    }
    if (m_frustumVBO) {
        glDeleteBuffers(1, &m_frustumVBO);
        glDeleteVertexArrays(1, &m_frustumVAO);
    }
    if (m_pointCloudVBO) {
        glDeleteBuffers(1, &m_pointCloudVBO);
        glDeleteVertexArrays(1, &m_pointCloudVAO);
    }
    if (m_particleVBO) {
        glDeleteBuffers(1, &m_particleVBO);
        glDeleteVertexArrays(1, &m_particleVAO);
    }
    if (m_window) {
        glfwDestroyWindow(m_window);
        m_window = nullptr;
        glfwTerminate();
    }
}
