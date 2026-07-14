<p align="center">
  <img src="screenshots/animated_banner.svg" width="100%" alt="AetherSense Animated Banner" />
</p>

# 📡 AetherSense: WiFi 3D Volumetric Occupancy Radar & Spatial Scanner

<p align="center">
  <a href="https://render.com/deploy?repo=https://github.com/sudonishant/aethersense" target="_blank">
    <img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render"/>
  </a>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT" target="_blank">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"/>
  </a>
  <img src="https://img.shields.io/badge/C%2B%2B-17-00599C?style=flat&logo=c%2B%2B" alt="C++"/>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D%2018.0.0-339933?style=flat&logo=node.js" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Three.js-WebGL-black?style=flat&logo=three.js" alt="Three.js"/>
</p>

An advanced, industry-grade wireless spatial mapping engine and volumetric occupancy radar. **AetherSense** scans real-time Wi-Fi beacon packets and radio frequency (RF) signal metrics, builds high-fidelity 3D occupancy grids, and visualizes RF propagation patterns through a premium, glassmorphic WebGL telemetry dashboard.

```mermaid
graph TD
    A[Raw WiFi Beacon Packets] -->|OS Native API Queries| B(C++ Scanner Daemon)
    B -->|Throttled JSON Stdout| C[Node.js WebSocket Server]
    C -->|Real-time Synchronization| D[Web Client UI Dashboard]
    D -->|Three.js & OrbitControls| E[Holographic 3D Spatial Grid]
    E -->|Interactive Presets| F[Volumetric Map / Location Trace]
```

---

## 🚀 Key Features

*   **Holographic 3D Volumetric Rendering**: A high-performance WebGL (Three.js) viewport that maps wireless signal strength (RSSI/CSI) to a 3D thermal-gradient grid (featuring Ironbow, Rainbow, and Monochromatic presets).
*   **Zero-Latency Native Daemon**: Low-level C++17 engine interfacing directly with OS network stacks:
    *   **Linux**: Direct `/proc/net/wireless` and sockets polling.
    *   **macOS**: Native CoreWLAN framework bridging.
    *   **Windows**: Native Wlanapi service integration.
*   **Dual Mode Telemetry**:
    *   *Real Card Mode*: Active scanner interfacing with hardware for live physical diagnostics.
    *   *Virtual Emu Mode*: Built-in wave propagation algorithm for simulated offline testing and walk-throughs.
*   **Apple-Inspired TUI/GUI HUD**: High-fidelity dark mode styling, frosted-glass panels, segmented dashboard selectors, and interactive telemetry dials.
*   **Diagnostic Overlays**: Real-time respiration/motion detection proxies, classified path counts, and automated threshold alerts.

---

## 🛠️ Tech Stack

| Module | Core Technology | Role |
| --- | --- | --- |
| **Daemon Engine** | C++17 / CMake | Gathers network signal frames with zero-overhead native loops. |
| **Web Server** | Node.js / Express / ws | Manages low-latency WebSocket connection pipes. |
| **3D Rendering** | Three.js / GLSL Shaders | Visualizes volumetric occupancy grids in a responsive viewport. |
| **Theme & UI** | Vanilla CSS3 / HTML5 | Frosted glassmorphism dashboard controls and statistics. |

---

## 📥 Getting Started

### Prerequisites

Ensure you have a modern compiler supporting **C++17**, **CMake (>= 3.15)**, and **Node.js (>= 18.0.0)** installed.

### Automatic Installation & Execution

A unified shell script compiles the native C++ executable and configures the web application automatically.

```bash
# 1. Clone the repository
git clone https://github.com/sudonishant/aethersense.git
cd aethersense

# 2. Grant execute permissions and run setup
chmod +x setup.sh
./setup.sh

# 3. Spin up the server and visualization dashboard
npm --prefix web start
```

Open **[http://localhost:8080](http://localhost:8080)** in your web browser to access the live dashboard controls.

---

## ⌨️ Telemetry Controls

| Shortcut | Description |
| --- | --- |
| **`W` / `A` / `S` / `D`** | Orbit and Pan the 3D camera around the volumetric mapping grid. |
| **`Up` / `Down` / `Left` / `Right`** | Drive the virtual mapping probe through the spatial grid (Virtual Mode). |
| **`SPACEBAR`** | Log and plot a permanent coordinate signal checkpoint. |
| **`Mouse Drag`** | Rotate perspectives in the WebGL viewport. |
| **`3D MAPPING` UI Toggle** | Switch layout to a volumetric 3D thermal matrix. |
| **`LOCATION TRACE` UI Toggle** | Render real-time spatial path tracking maps. |

---

## 📁 Repository Structure

```text
aethersense/
├── CMakeLists.txt         # C++ build orchestrator
├── LICENSE                # MIT License
├── README.md              # Project documentation
├── include/               # C++ Header declarations
│   ├── WifiScanner.h
│   └── RenderEngine.h
├── src/                   # C++ Core source files
│   ├── main.cpp
│   └── core/
├── setup.sh               # Automation compilation script
└── web/                   # Node.js Server & WebGL Front-end
    ├── server.js          # WebSocket server pipeline
    ├── package.json
    └── public/
        ├── index.html     # Glassmorphic HUD template
        └── app.js         # Three.js viewport loop
```

## 🤝 Contributing

Contributions make the open-source community an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## ⭐ Star History

We appreciate your support! If you find this platform helpful, please consider leaving a star to help others discover it.

<p align="center">
  <a href="https://star-history.com/#sudonishant/aethersense&amp;Date" target="_blank">
    <img src="https://api.star-history.com/svg?repos=sudonishant/aethersense&amp;type=Date" width="100%" alt="Star History Chart" />
  </a>
</p>

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more details. Designed & built with 💻 by [sudonishant](https://github.com/sudonishant).
