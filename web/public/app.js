// Global Application Variables
let scene, camera, renderer, controls;
let frustumLines, warningPlane;
let walkerMarker, trajLine, trajTubeMesh;
let particleSystem, particleGeometry;

// Dynamic 3D Signal Elements
let routerGroup;
let signalWaves = [];
const maxWaves = 4;
let distanceSphere;

// 3D Multipath Ray Elements
let multipathRayLines = [];
const numMultipathRays = 3;

// 3D DensePose-Style Motion Ghost Human Model
let motionGhostGroup;
let ghostBasePos = new THREE.Vector3(3, 0.9, -2); // Default ghost location behind a wall

// Interactive App State
let activeMode = 2; // 2 = Warwalking Point Cloud
let activePalette = 'ironbow'; // Default FLIR color profile
let dataSource = 'emulated'; // 'hardware' or 'emulated'
let walkingModel = 'autopilot'; // 'manual', 'autopilot', 'lidar'
let latestWifi = {
  rssi: -60,
  linkQuality: 0.57,
  noise: -95,
  channel: 6,
  ssid: "Connecting...",
  bssid: "00:00:00:00:00:00",
  interfaceName: "Searching..."
};
let lastDroppedPos = new THREE.Vector3();
let walkerPos = new THREE.Vector3(0, 0.5, 0); // Walk position begins on top of floor grid
let steerAngle = -Math.PI / 2; // Scanner angle (pointing North towards router at -6)
let walkNodes = []; // Accumulated 3D points
let trajVertices = []; // Coordinates of path line
let nodeHistory = []; // Metadata history: { pos, rssi }
let walls = []; // Generated 3D wall meshes
let collisionWalls = []; // List for Raycast occlusion tracking
let virtualWallMeshes = []; // Background virtual partitions for emulated raycasting
let elapsedTime = 0.0; // Recording timer clock
let emuUpdateTimer = 0.0; // Timer to throttle emulation updates
let rssiBaseline = -65; // Rolling average baseline for relative classification

// Classified Structures Count Stats
let wallsCount = 0;
let objectsCount = 0;
let spacesCount = 0;

// Predefined Auto-Pilot survey waypoints (loops through virtual rooms)
const autopilotWaypoints = [
  new THREE.Vector3(-5, 0.5, -3), // Living Room corner
  new THREE.Vector3(-5, 0.5, 3),  // Living Room south
  new THREE.Vector3(2, 0.5, 0),   // Corridor
  new THREE.Vector3(5, 0.5, -5),  // Bedroom bed
  new THREE.Vector3(5, 0.5, 4),   // Kitchen
  new THREE.Vector3(2, 0.5, 3)    // Bottom Corridor
];
let currentWaypointIndex = 0;
let autopilotLerpFactor = 0.0;

// RF Countermeasure State
let txPowerMultiplier = 1.0; // Transmit power slider (10% to 100%)
let shieldingLoss = 0.0; // Obstacle attenuation
let frequencyBand = '5.0'; // GHz band

// Advanced Spatial & Signal Settings (Calibration & Walker)
let pathLossN = 2.0; // Path loss exponent (N)
let refSignalA = -40; // Reference RSSI at 1m (A)
let autopilotSpeedMultiplier = 1.0; // Multiplies autopilot walk speeds
let walkerElevationY = 0.5; // Walker height Y position
let voxelResolutionSize = 0.8; // Voxel grid resolution interval size
let fpsLimit = 60; // Max FPS ceiling throttler
let lastFrameTime = 0; // Epoch for FPS loop

// Geiger Sound Locator State
let audioGeigerActive = false;
let audioCtx = null;
let geigerTimeout = null;

// Target Triangulation Locate Predictor
let predictedRouterMesh = null;
let triangulationConfidence = 100;

// Rolling signal history queue
let rssiHistory = [];
const maxRssiHistory = 60;

// Nearby available networks list
let nearbyAPs = [
  { ssid: "sudonishant_5G_Secured", bssid: "00:DE:AD:BE:EF:88", channel: 36, frequency: 5.18, signal: -45, isConnected: true },
  { ssid: "Airport_Free_WiFi", bssid: "AA:BB:CC:DD:EE:11", channel: 6, frequency: 2.437, signal: -72, isConnected: false },
  { ssid: "Backup_LTE_Gate", bssid: "12:34:56:78:90:AB", channel: 1, frequency: 2.412, signal: -81, isConnected: false },
  { ssid: "Smart_Fridge_Iot", bssid: "DE:AD:BE:EF:00:FF", channel: 11, frequency: 2.462, signal: -88, isConnected: false },
  { ssid: "Neighbor_Private_Net", bssid: "34:8A:12:F0:CD:67", channel: 149, frequency: 5.745, signal: -91, isConnected: false }
];

// CSI Subcarrier & Waterfall State
let csiSubcarriers = [];
let waterfallRows = [];
const maxWaterfallRows = 65;
let breathingHistory = [];
let breathingTimer = 0.0;

// Particle System State
const maxParticles = 120;
let particlePositions = new Float32Array(maxParticles * 3);
let particleColors = new Float32Array(maxParticles * 4);
let particleVelocities = [];
let particleLifetimes = new Float32Array(maxParticles);
let particleMaxLifetimes = new Float32Array(maxParticles);

// 1. WebSocket Client Initialization
let ws;
function connectWebSocket() {
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WebSocket] Connection established to localhost daemon.");
    document.getElementById("connection-status").classList.add("active");
    logConsole("Connected to C++ backend daemon stream.");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'history') {
        // Load database scan history
        clearVoxelNodesLocal();
        msg.data.forEach((node) => {
          drawVoxelNodeLocal(node.position, node.signalStrength, node.rssi);
        });
        logConsole(`Restored ${msg.data.length} scanning points from server db.`);
      } else if (msg.type === 'drop_broadcast') {
        // Voxel dropped from another terminal tab
        drawVoxelNodeLocal(msg.node.position, msg.node.signalStrength, msg.node.rssi);
      } else if (msg.type === 'clear_broadcast') {
        // Point cloud cleared from another client
        clearVoxelNodesLocal();
      } else if (msg.type === 'wifi') {
        // Incoming live hardware packet (only use if source is set to hardware)
        if (dataSource === 'hardware') {
          let processedMetrics = { ...msg.data };
          processedMetrics.rssi = Math.round(processedMetrics.rssi * txPowerMultiplier - shieldingLoss);
          processedMetrics.linkQuality = Math.max(0.0, Math.min(1.0, (processedMetrics.rssi + 100.0) / 70.0));
          
          if (rssiBaseline === -65) {
            rssiBaseline = processedMetrics.rssi;
          } else {
            rssiBaseline = rssiBaseline * 0.96 + processedMetrics.rssi * 0.04;
          }

          latestWifi = processedMetrics;
          updateHUD(processedMetrics);
          triggerDynamicVisuals(processedMetrics);
        }
      }
    } catch (e) {
      console.error("[WebSocket] Error decoding JSON payload: ", e);
    }
  };

  ws.onclose = () => {
    console.log("[WebSocket] Connection lost. Reconnecting in 2 seconds...");
    document.getElementById("connection-status").classList.remove("active");
    logConsole("Connection lost. Trying to reconnect...");
    setTimeout(connectWebSocket, 2000);
  };
}

function estimateDistance(rssi) {
  const distance = Math.pow(10, (refSignalA - rssi) / (10 * pathLossN));
  // Clamp distance so that the walker stays within the visible Floor Grid boundaries
  return Math.max(1.0, Math.min(12.5, distance));
}

// 3. Initialize Three.js Viewport
function initGraphics() {
  const container = document.getElementById("canvas-container");
  
  try {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08080a); // Matches Apple Space Gray theme
    scene.fog = new THREE.FogExp2(0x08080a, 0.035);

    // Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 16);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
  } catch (error) {
    console.error("WebGL Initialization failed:", error);
    container.innerHTML = `
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; font-family: sans-serif; padding: 20px; background: rgba(255,59,48,0.15); border: 1px solid #ff3b30; border-radius: 12px; color: #ff453a; max-width: 400px; z-index: 99999;">
        <h3 style="margin-bottom: 10px;">WebGL Unresolved</h3>
        <p style="font-size: 13px; line-height: 1.5; color: rgba(255,255,255,0.7);">Please ensure hardware acceleration is enabled in browser settings or try a different modern browser.</p>
      </div>
    `;
    return;
  }

  // Orbit controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.01;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x0d152b);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0x00f2fe, 1.2);
  dirLight.position.set(5, 15, 5);
  scene.add(dirLight);

  // Holographic Floor Grid
  const gridHelper = new THREE.GridHelper(30, 30, 0x00f2fe, 0x08152e);
  gridHelper.position.y = 0;
  gridHelper.material.opacity = 0.25;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);

  // Set up geometrical components
  setupRadarGeometry();
  setupWalkerMarker();
  setupParticleSystem();
  
  // Build Router & Signal waves
  setupRouterModel();
  setupSignalWaves();

  // Create Holographic Multipath Ray Lines
  setupMultipathRayLines();

  // Create DensePose Humanoid Motion Ghost
  setupMotionGhostModel();

  // Initialize CSI subcarrier dataset
  initCsiSubcarriers();

  // Load virtual room partitioning walls for simulated obstruction scans
  setupVirtualRoomLayout();

  // Handle window resizing
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function setupVirtualRoomLayout() {
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x0a84ff, // Apple Blue structural highlights
    wireframe: true,
    transparent: true,
    opacity: 0.18, // Visible translucent architecture layout!
    depthWrite: false
  });

  // Create virtual division walls to raycast against in Emulation mode
  // Wall 1: Center Horizontal Divider (X = -7 to 7, Z = -1)
  const w1Geo = new THREE.BoxGeometry(14, 1.8, 0.08);
  const w1 = new THREE.Mesh(w1Geo, wallMat);
  w1.position.set(-1, 0.9, -1);
  scene.add(w1); // Render wall visually on screen!
  collisionWalls.push(w1);
  virtualWallMeshes.push(w1);

  // Wall 2: Left Room Vertical Divider (X = -4, Z = -1 to 7)
  const w2Geo = new THREE.BoxGeometry(0.08, 1.8, 8);
  const w2 = new THREE.Mesh(w2Geo, wallMat);
  w2.position.set(-4, 0.9, 3);
  scene.add(w2); // Render wall visually on screen!
  collisionWalls.push(w2);
  virtualWallMeshes.push(w2);

  // Wall 3: Right Room Divider (X = 4, Z = -1 to 5)
  const w3Geo = new THREE.BoxGeometry(0.08, 1.8, 6);
  const w3 = new THREE.Mesh(w3Geo, wallMat);
  w3.position.set(4, 0.9, 2);
  scene.add(w3); // Render wall visually on screen!
  collisionWalls.push(w3);
  virtualWallMeshes.push(w3);
}

// 4. Soft Blurred Thermal Sprite Generator (Creates fuzzy heat-camera cloud textures)
function createThermalTexture(colorStr) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0.0, colorStr);
  grad.addColorStop(0.3, colorStr);
  
  const color = new THREE.Color(colorStr);
  const rgbaMiddle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 0.45)`;
  grad.addColorStop(0.6, rgbaMiddle);
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  
  return new THREE.CanvasTexture(canvas);
}

// 5. 3D Raycasting Wall Intersections (Obstructed Line-of-Sight)
function countWallIntersections(p1, p2) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const length = dir.length();
  dir.normalize();

  const raycaster = new THREE.Raycaster(p1, dir, 0.01, length);
  const intersects = raycaster.intersectObjects(collisionWalls);

  const hits = new Set();
  intersects.forEach(item => hits.add(item.object));

  return hits.size;
}

// 6. Virtual RF Emulation Engine math (with TX Power & Shielding attenuations)
function getEmulatedWifiMetrics() {
  const rx = routerGroup ? routerGroup.position.x : 0;
  const rz = routerGroup ? routerGroup.position.z : -6;
  const routerPos = new THREE.Vector3(rx, 0.5, rz);

  const dist = walkerPos.distanceTo(routerPos);
  const safeDist = Math.max(0.1, dist);

  const wallIntersections = countWallIntersections(walkerPos, routerPos);
  const wallLoss = wallIntersections * 12.0;

  // Subtract TX power decays and physical shield losses
  const txPower = -38 - (1.0 - txPowerMultiplier) * 25.0; 
  const n = 2.8;
  let rssi = txPower - (10 * n * Math.log10(safeDist)) - wallLoss - shieldingLoss;

  rssi += (Math.random() - 0.5) * 0.8;

  rssi = Math.round(Math.max(-100, Math.min(-30, rssi)));
  const quality = Math.max(0.0, Math.min(1.0, (rssi + 100.0) / 70.0));

  return {
    rssi: rssi,
    linkQuality: quality,
    noise: -95,
    channel: latestWifi.channel || 6,
    ssid: "EMULATED_RF_PORTAL",
    bssid: "AA:BB:CC:DD:EE:FF",
    interfaceName: "virtual_rf_0"
  };
}

// 7. Math Thermal Shader LUT with Palette Switchers
function getThermalColor(value) {
  const val = Math.max(0.0, Math.min(1.0, value));
  
  if (activePalette === 'ironbow') {
    const c0 = new THREE.Color(0x130040); // Dark Purple
    const c1 = new THREE.Color(0xaf0040); // Magenta Red
    const c2 = new THREE.Color(0xff6600); // Orange
    const c3 = new THREE.Color(0xffd700); // Gold Yellow
    const c4 = new THREE.Color(0xffffff); // White
    
    if (val < 0.25) return c0.clone().lerp(c1, val / 0.25);
    else if (val < 0.5) return c1.clone().lerp(c2, (val - 0.25) / 0.25);
    else if (val < 0.75) return c2.clone().lerp(c3, (val - 0.5) / 0.25);
    else return c3.clone().lerp(c4, (val - 0.75) / 0.25);
    
  } else if (activePalette === 'rainbow') {
    const c0 = new THREE.Color(0x0000cc); // Deep Blue
    const c1 = new THREE.Color(0x00cc33); // Green
    const c2 = new THREE.Color(0xe6e600); // Yellow
    const c3 = new THREE.Color(0xff6600); // Orange
    const c4 = new THREE.Color(0xff001a); // Crimson Red
    
    if (val < 0.25) return c4.clone().lerp(c3, val / 0.25);
    else if (val < 0.5) return c3.clone().lerp(c2, (val - 0.25) / 0.25);
    else if (val < 0.75) return c2.clone().lerp(c1, (val - 0.5) / 0.25);
    else return c1.clone().lerp(c0, (val - 0.75) / 0.25);
    
  } else if (activePalette === 'whitehot') {
    return new THREE.Color().setScalar(val);
    
  } else if (activePalette === 'blackhot') {
    return new THREE.Color().setScalar(1.0 - val);
  }
  
  return new THREE.Color(0xffffff);
}

// 8. Setup Mode 1 (Stationary Radar Cone/Frustum)
function setupRadarGeometry() {
  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.8
  });

  const geometry = new THREE.BufferGeometry();
  
  const positions = new Float32Array(18 * 3);
  const colors = new Float32Array(18 * 3);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  frustumLines = new THREE.LineSegments(geometry, lineMaterial);
  scene.add(frustumLines);

  const planeGeo = new THREE.PlaneGeometry(3.6, 2.7);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0xff0033,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  warningPlane = new THREE.Mesh(planeGeo, planeMat);
  warningPlane.position.set(0, 0, -3);
  scene.add(warningPlane);
}

function updateRadarFrustum(quality) {
  if (!frustumLines) return;

  const positionsAttr = frustumLines.geometry.attributes.position;
  const colorsAttr = frustumLines.geometry.attributes.color;
  const col = getThermalColor(quality);

  const rx = routerGroup ? routerGroup.position.x : 0;
  const rz = routerGroup ? routerGroup.position.z : -6;

  const vertices = [
    0, 0, 0,  rx, 0, rz,
    0, 0, 0,  rx - 3, 2, rz,
    0, 0, 0,  rx + 3, 2, rz,
    0, 0, 0,  rx + 3, -2, rz,
    0, 0, 0,  rx - 3, -2, rz,
    rx - 3, 2, rz,  rx + 3, 2, rz,
    rx + 3, 2, rz,  rx + 3, -2, rz,
    rx + 3, -2, rz, rx - 3, -2, rz,
    rx - 3, -2, rz, rx - 3, 2, rz
  ];

  for (let i = 0; i < vertices.length; i++) {
    positionsAttr.array[i] = vertices[i];
  }

  for (let i = 0; i < 18; i++) {
    colorsAttr.array[i * 3] = col.r;
    colorsAttr.array[i * 3 + 1] = col.g;
    colorsAttr.array[i * 3 + 2] = col.b;
  }

  positionsAttr.needsUpdate = true;
  colorsAttr.needsUpdate = true;

  if (warningPlane) {
    warningPlane.position.set(rx / 2, 0, rz / 2);
    warningPlane.lookAt(rx, 0, rz);
  }
}

// 9. Setup 3D Holographic Router
function setupRouterModel() {
  routerGroup = new THREE.Group();
  routerGroup.position.set(0, 0, -6);

  const baseGeo = new THREE.CylinderGeometry(0.4, 0.45, 0.08, 16);
  const baseMat = new THREE.MeshPhongMaterial({
    color: 0x07112b,
    emissive: 0x00f2fe,
    emissiveIntensity: 0.15,
    shininess: 90
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.04;
  routerGroup.add(base);

  const antGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.8, 8);
  const antMat = new THREE.MeshPhongMaterial({
    color: 0x0b1f47,
    emissive: 0x00f2fe,
    emissiveIntensity: 0.2
  });
  const antenna = new THREE.Mesh(antGeo, antMat);
  antenna.position.set(0, 0.44, 0);
  routerGroup.add(antenna);

  const tipGeo = new THREE.SphereGeometry(0.04, 8, 8);
  const tipMat = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.set(0, 0.84, 0);
  routerGroup.add(tip);

  scene.add(routerGroup);
}

// 10. Setup expanding Signal Wavefronts
function setupSignalWaves() {
  for (let i = 0; i < maxWaves; i++) {
    const ringGeo = new THREE.RingGeometry(0.1, 0.16, 32);
    ringGeo.rotateX(-Math.PI / 2);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(routerGroup.position.x, 0.02, routerGroup.position.z);
    
    scene.add(ring);
    signalWaves.push({
      mesh: ring,
      radius: 0.1,
      speed: 1.4 + i * 0.15,
      delay: i * 1.4,
      activeTime: 0.0
    });
  }
}

function updateSignalWaves(dt) {
  const rx = routerGroup ? routerGroup.position.x : 0;
  const rz = routerGroup ? routerGroup.position.z : -6;

  signalWaves.forEach((wave) => {
    wave.mesh.position.set(rx, 0.02, rz);
    wave.activeTime += dt;
    
    if (activeMode === 1 && wave.activeTime > wave.delay) {
      wave.radius += wave.speed * dt;
      if (wave.radius > 9.0) {
        wave.radius = 0.1;
        wave.activeTime = 0.0;
      }

      wave.mesh.scale.set(wave.radius * 6, wave.radius * 6, 1);
      
      const opacity = Math.max(0.0, 0.35 * (1.0 - (wave.radius / 9.0)));
      wave.mesh.material.opacity = opacity;

      const relQuality = 1.0 - (wave.radius / 9.0);
      wave.mesh.material.color.copy(getThermalColor(relQuality));
    } else {
      wave.mesh.material.opacity = 0.0;
    }
  });
}

// 11. Setup 3D Multipath Ray-Traced lines
function setupMultipathRayLines() {
  const rayMat = new THREE.LineDashedMaterial({
    color: 0x00ffaa,
    dashSize: 0.3,
    gapSize: 0.2,
    transparent: true,
    opacity: 0.5,
    linewidth: 1
  });

  for (let i = 0; i < numMultipathRays; i++) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(4 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const line = new THREE.Line(geo, rayMat);
    line.computeLineDistances();
    scene.add(line);
    multipathRayLines.push(line);
  }
}

function updateMultipathRays() {
  const rx = routerGroup ? routerGroup.position.x : 0;
  const rz = routerGroup ? routerGroup.position.z : -6;

  multipathRayLines.forEach((line, index) => {
    if (shieldingLoss >= 30) {
      line.visible = false;
      return;
    }
    line.visible = (activeMode === 2);

    const positionsAttr = line.geometry.attributes.position;
    
    let bx = 0;
    let bz = 0;
    if (index === 0) {
      bx = -8; bz = (walkerPos.z + rz) / 2;
    } else if (index === 1) {
      bx = 8; bz = (walkerPos.z + rz) / 2;
    } else {
      bx = ghostBasePos.x;
      bz = ghostBasePos.z;
    }

    positionsAttr.array[0] = rx;
    positionsAttr.array[1] = 0.5;
    positionsAttr.array[2] = rz;

    positionsAttr.array[3] = bx;
    positionsAttr.array[4] = 0.5;
    positionsAttr.array[5] = bz;

    positionsAttr.array[6] = walkerPos.x;
    positionsAttr.array[7] = 0.5;
    positionsAttr.array[8] = walkerPos.z;

    positionsAttr.needsUpdate = true;
    line.computeLineDistances();
    
    line.material.dashSize = 0.2 + 0.1 * Math.sin(Date.now() * 0.005 + index);
  });
}

// 12. Setup DensePose-Style Holographic Motion Ghost Humanoid Model
function setupMotionGhostModel() {
  motionGhostGroup = new THREE.Group();
  motionGhostGroup.position.copy(ghostBasePos);

  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0xff0044,
    wireframe: true,
    transparent: true,
    opacity: 0.35
  });

  const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const head = new THREE.Mesh(headGeo, ghostMat);
  head.position.set(0, 1.4, 0);
  motionGhostGroup.add(head);

  const torsoGeo = new THREE.CylinderGeometry(0.12, 0.08, 0.7, 6);
  const torso = new THREE.Mesh(torsoGeo, ghostMat);
  torso.position.set(0, 0.95, 0);
  motionGhostGroup.add(torso);

  const legGeo = new THREE.CylinderGeometry(0.04, 0.03, 0.6, 4);
  const legL = new THREE.Mesh(legGeo, ghostMat);
  legL.position.set(-0.08, 0.3, 0);
  motionGhostGroup.add(legL);

  const legR = legL.clone();
  legR.position.x = 0.08;
  motionGhostGroup.add(legR);

  const armGeo = new THREE.CylinderGeometry(0.03, 0.02, 0.55, 4);
  const armL = new THREE.Mesh(armGeo, ghostMat);
  armL.position.set(-0.16, 1.0, 0);
  armL.rotation.z = Math.PI / 12;
  motionGhostGroup.add(armL);

  const armR = armL.clone();
  armR.position.x = 0.16;
  armR.rotation.z = -Math.PI / 12;
  motionGhostGroup.add(armR);

  scene.add(motionGhostGroup);
}

function updateMotionGhost(dt) {
  if (!motionGhostGroup) return;

  const time = Date.now() * 0.0008;
  motionGhostGroup.position.x = ghostBasePos.x + 1.2 * Math.sin(time);
  motionGhostGroup.position.z = ghostBasePos.z + 0.6 * Math.sin(time * 2);

  const breatheScale = 1.0 + 0.04 * Math.sin(Date.now() * 0.0025);
  motionGhostGroup.scale.set(breatheScale, 1.0, breatheScale);

  const badge = document.getElementById("csi-status-badge");
  
  if (shieldingLoss >= 30) {
    motionGhostGroup.visible = false;
    badge.textContent = "SIGNAL BLOCKED";
    badge.className = "badge csi-intrusion";
    return;
  }
  
  motionGhostGroup.visible = (activeMode === 2);

  const isMoving = walkerPos.distanceTo(lastDroppedPos) > 0.1;
  
  if (isMoving) {
    motionGhostGroup.material.color.setHex(0xffaa00);
    badge.textContent = "HUMAN MOTION DETECTED";
    badge.className = "badge csi-motion";
  } else {
    motionGhostGroup.material.color.setHex(0x00ffaa);
    badge.textContent = "BREATHING LOCK ON";
    badge.className = "badge csi-stationary";
  }

  if (frequencyBand === '6.0') {
    motionGhostGroup.material.opacity = 0.7;
    motionGhostGroup.material.color.setHex(0x00f2fe);
  } else if (frequencyBand === '2.4') {
    motionGhostGroup.material.opacity = 0.18;
  } else {
    motionGhostGroup.material.opacity = 0.38;
  }
}

// 13. Initialize CSI subcarrier datasets
function initCsiSubcarriers() {
  for (let i = 0; i < 30; i++) {
    csiSubcarriers.push({
      amplitude: 0.5 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      freq: 1.0 + i * 0.08
    });
  }

  for (let i = 0; i < maxWaterfallRows; i++) {
    const row = new Uint8Array(30);
    for (let j = 0; j < 30; j++) row[j] = 40 + Math.random() * 80;
    waterfallRows.push(row);
  }

  for (let i = 0; i < 100; i++) breathingHistory.push(0);
}

// Draw the 30 subcarrier sine waves
function drawCsiWaves(isMoving) {
  const canvas = document.getElementById("canvas-csi-waves");
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const numcarriers = 30;
  const time = Date.now() * 0.003;

  ctx.lineWidth = 1.0;

  for (let i = 0; i < numcarriers; i++) {
    ctx.beginPath();
    const r = Math.round(100 + 155 * (i / numcarriers));
    const g = Math.round(180 - 80 * (i / numcarriers));
    const b = Math.round(255 - 100 * (i / numcarriers));
    
    if (shieldingLoss >= 30) {
      ctx.strokeStyle = "rgba(100, 100, 100, 0.08)";
    } else {
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.25)`;
    }

    let jitter = 0.0;
    if (shieldingLoss >= 30) {
      jitter = 0.0;
    } else if (isMoving) {
      jitter = 1.2 * Math.sin(time * 2.5 + i);
    } else {
      jitter = 0.15 * Math.cos(time * 0.8 + i);
    }

    for (let x = 0; x < w; x++) {
      const angle = (x / w) * Math.PI * 4 + time + i * 0.2 + jitter;
      const amp = (csiSubcarriers[i].amplitude * (h / 3)) * txPowerMultiplier;
      const y = h / 2 + amp * Math.sin(angle);
      
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Dynamic CSI Spectrogram Waterfall drawing
function drawCsiWaterfall(isMoving) {
  const canvas = document.getElementById("canvas-csi-waterfall");
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  const newRow = new Uint8Array(30);
  const time = Date.now();

  for (let j = 0; j < 30; j++) {
    let val = 80 + Math.sin(time * 0.002 + j * 0.2) * 40;
    
    if (shieldingLoss >= 30) {
      val = 10;
    } else if (isMoving) {
      val += (Math.random() - 0.5) * 80;
    } else {
      val += Math.sin(time * 0.004) * 12;
    }
    newRow[j] = Math.max(0, Math.min(255, val));
  }

  waterfallRows.unshift(newRow);
  if (waterfallRows.length > maxWaterfallRows) {
    waterfallRows.pop();
  }

  const cellW = w / 30;
  const cellH = h / maxWaterfallRows;

  for (let r = 0; r < waterfallRows.length; r++) {
    const row = waterfallRows[r];
    for (let c = 0; c < 30; c++) {
      const val = row[c] / 255;
      ctx.fillStyle = getThermalColor(val).getStyle();
      ctx.fillRect(c * cellW, r * cellH, cellW + 1, cellH + 1);
    }
  }
}

// Extracted Breathing Waveform ECG plotter
function drawBreathingWave(dt, isMoving) {
  const canvas = document.getElementById("canvas-breathing-wave");
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  breathingTimer += dt;
  
  const bpm = isMoving ? 24 : 14;
  document.getElementById("csi-breathing-rate").textContent = `${bpm} BPM`;

  let currentVal = 0.0;
  if (shieldingLoss >= 30) {
    currentVal = 0.0;
  } else if (isMoving) {
    currentVal = 0.6 * Math.sin(breathingTimer * 2.8) + (Math.random() - 0.5) * 0.5;
  } else {
    currentVal = 0.7 * Math.sin(breathingTimer * (bpm * Math.PI * 2 / 60));
  }

  breathingHistory.push(currentVal);
  if (breathingHistory.length > w) {
    breathingHistory.shift();
  }

  ctx.beginPath();
  ctx.lineWidth = 1.8;
  
  if (shieldingLoss >= 30) {
    ctx.strokeStyle = "rgba(100, 100, 100, 0.4)";
  } else if (isMoving) {
    ctx.strokeStyle = "var(--neon-orange)";
  } else {
    ctx.strokeStyle = "var(--neon-green)";
  }

  for (let i = 0; i < breathingHistory.length; i++) {
    const val = breathingHistory[i];
    const x = i;
    const y = h / 2 - val * (h / 2.5);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// 14. Setup Mode 2 (Volumetric walker & Trail)
function setupWalkerMarker() {
  const markerGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0x00f2fe,
    wireframe: true,
    transparent: true,
    opacity: 0.8
  });
  
  walkerMarker = new THREE.Mesh(markerGeo, markerMat);
  walkerMarker.position.copy(walkerPos);
  scene.add(walkerMarker);

  const sphereGeo = new THREE.SphereGeometry(1.0, 24, 24);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0x00f2fe,
    wireframe: true,
    transparent: true,
    opacity: 0.04,
    depthWrite: false
  });
  distanceSphere = new THREE.Mesh(sphereGeo, sphereMat);
  distanceSphere.position.copy(walkerPos);
  scene.add(distanceSphere);

  const trajGeo = new THREE.BufferGeometry();
  const trajMat = new THREE.LineBasicMaterial({
    color: 0x00f2fe,
    transparent: true,
    opacity: 0.35
  });
  trajLine = new THREE.Line(trajGeo, trajMat);
  scene.add(trajLine);

  const tubeMat = new THREE.MeshPhongMaterial({
    color: 0x00ffcc,
    emissive: 0x00ffcc,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.85,
    shininess: 120
  });
  trajTubeMesh = new THREE.Mesh(new THREE.BufferGeometry(), tubeMat);
  scene.add(trajTubeMesh);
}

function updateWalkerMarker() {
  if (walkerMarker) {
    walkerMarker.position.copy(walkerPos);
  }
  
  if (distanceSphere) {
    distanceSphere.position.copy(walkerPos);
    const sigDist = estimateDistance(latestWifi.rssi);
    distanceSphere.scale.set(sigDist, sigDist, sigDist);
    distanceSphere.material.color.copy(getThermalColor(latestWifi.linkQuality));
  }

  const sigDist = estimateDistance(latestWifi.rssi);
  const deg = Math.round((steerAngle * 180 / Math.PI) % 360);
  const degNormalized = deg < 0 ? deg + 360 : deg;
  document.getElementById("hud-walk-pos").textContent = 
    `RNG: ${sigDist.toFixed(1)}m | BEARING: ${degNormalized}°`;
}

// Drop voxel node: triggers websocket save event to server
function dropVoxelNode() {
  // Proximity guard: prevent duplicate stacked nodes at the same location!
  const minProximity = 0.65;
  for (let i = 0; i < walkNodes.length; i++) {
    const nodePos = walkNodes[i].position;
    if (nodePos.distanceTo(walkerPos) < minProximity) {
      return; // Skip dropping if there is already a voxel here
    }
  }

  const signalVal = latestWifi.linkQuality;
  const currentPos = walkerPos.clone();
  const currentRssi = latestWifi.rssi;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'drop',
      node: {
        position: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
        signalStrength: signalVal,
        rssi: currentRssi
      }
    }));
  }

  drawVoxelNodeLocal(currentPos, signalVal, currentRssi);
}

// Draw scanning points
function drawVoxelNodeLocal(posVec, signalVal, currentRssi) {
  const pos = new THREE.Vector3(posVec.x, posVec.y, posVec.z);
  const col = getThermalColor(signalVal);

  const nodeGroup = new THREE.Group();
  nodeGroup.position.copy(pos);
  nodeGroup.userData = { signalStrength: signalVal, rssi: currentRssi };

  // Background thermal glow sprite
  const hexColor = "#" + col.getHexString();
  const texture = createThermalTexture(hexColor);
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const thermalSprite = new THREE.Sprite(spriteMat);
  thermalSprite.scale.set(1.5, 1.5, 1.5);
  nodeGroup.add(thermalSprite);

  // Voxel Classifier: Walls vs Objects vs Free Space (Calculated relatively to avoid false positives)
  const devDrop = rssiBaseline - currentRssi;

  if (devDrop >= 6.5) {
    // Classify: WALL (Red Box)
    const boxGeo = new THREE.BoxGeometry(0.7, 1.8, 0.7);
    const boxMat = new THREE.MeshBasicMaterial({
      color: 0xff3838,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.position.y = 0.4;
    nodeGroup.add(boxMesh);
    wallsCount++;
  } else if (devDrop >= 2.5 && devDrop < 6.5) {
    // Classify: OBJECT / FURNITURE (Orange Box)
    const boxGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const boxMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    nodeGroup.add(boxMesh);
    objectsCount++;
  } else {
    // Classify: FREE SPACE
    spacesCount++;
  }

  // Update HUD counts
  const wallEl = document.getElementById("count-walls");
  const objEl = document.getElementById("count-objects");
  const spaceEl = document.getElementById("count-spaces");
  if (wallEl) wallEl.textContent = wallsCount;
  if (objEl) objEl.textContent = objectsCount;
  if (spaceEl) spaceEl.textContent = spacesCount;

  scene.add(nodeGroup);
  walkNodes.push(nodeGroup);

  if (dataSource === 'hardware' && nodeHistory.length > 0) {
    const prevNode = nodeHistory[nodeHistory.length - 1];
    const distance = pos.distanceTo(prevNode.pos);
    const rssiDrop = prevNode.rssi - currentRssi;

    if (rssiDrop >= 8 && distance <= 2.5) {
      spawnWallBarrier(prevNode.pos, pos, rssiDrop);
    }
  }

  nodeHistory.push({ pos: pos, rssi: currentRssi });

  trajVertices.push(pos.x, pos.y, pos.z);
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(trajVertices, 3));
  trajLine.geometry.dispose();
  trajLine.geometry = newGeo;

  rebuildTubeGeometry();
}

function rebuildTubeGeometry() {
  if (nodeHistory.length < 2) return;
  
  const points = [];
  nodeHistory.forEach(item => points.push(item.pos));

  const curve = new THREE.CatmullRomCurve3(points);
  
  if (trajTubeMesh.geometry) {
    trajTubeMesh.geometry.dispose();
  }

  const tubeGeo = new THREE.TubeGeometry(curve, Math.min(240, points.length * 4), 0.08, 8, false);
  trajTubeMesh.geometry = tubeGeo;
  trajTubeMesh.visible = true;
}

// Spawns a physical red transparent barrier wall inside the 3D grid
function spawnWallBarrier(p1, p2, dropVal) {
  const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const dist = p1.distanceTo(p2);

  const wallGeo = new THREE.BoxGeometry(dist, 1.8, 0.08);
  const wallMat = new THREE.MeshPhongMaterial({
    color: 0xff003b,
    transparent: true,
    opacity: 0.6,
    shininess: 40,
    emissive: 0xcc0000,
    emissiveIntensity: 0.25
  });
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  
  wallMesh.position.copy(mid);
  wallMesh.position.y = 0.9;
  
  wallMesh.geometry.computeBoundingBox();

  const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
  const angle = Math.atan2(dir.x, dir.z);
  wallMesh.rotation.y = angle + Math.PI / 2;

  scene.add(wallMesh);
  walls.push(wallMesh);
  collisionWalls.push(wallMesh);

  logConsole(`⚠️ Wall Mapped at coordinates! (Loss: -${dropVal} dBm)`);
  
  const feedText = document.getElementById("hud-console");
  feedText.style.color = "var(--neon-red)";
  setTimeout(() => {
    feedText.style.color = "var(--neon-cyan)";
  }, 1500);
}

// Send clear request to server
function clearVoxelNodes() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }));
  }
  clearVoxelNodesLocal();
}

function clearVoxelNodesLocal() {
  walkNodes.forEach(node => scene.remove(node));
  walkNodes = [];
  
  walls.forEach((wall) => {
    scene.remove(wall);
    const idx = collisionWalls.indexOf(wall);
    if (idx > -1) collisionWalls.splice(idx, 1);
  });
  walls = [];
  
  nodeHistory = [];
  trajVertices = [];
  trajLine.geometry.dispose();
  trajLine.geometry = new THREE.BufferGeometry();

  if (trajTubeMesh) {
    if (trajTubeMesh.geometry) trajTubeMesh.geometry.dispose();
    trajTubeMesh.geometry = new THREE.BufferGeometry();
  }

  // Reset classification counters
  wallsCount = 0;
  objectsCount = 0;
  spacesCount = 0;
  const wallEl = document.getElementById("count-walls");
  const objEl = document.getElementById("count-objects");
  const spaceEl = document.getElementById("count-spaces");
  if (wallEl) wallEl.textContent = "0";
  if (objEl) objEl.textContent = "0";
  if (spaceEl) spaceEl.textContent = "0";

  logConsole("Volumetric point clouds and walls cleared.");
}

// Setup Particles Sparks
function setupParticleSystem() {
  particleGeometry = new THREE.BufferGeometry();
  
  for (let i = 0; i < maxParticles; i++) {
    particleLifetimes[i] = 999.0;
    particleVelocities.push(new THREE.Vector3());
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 4));

  const pSize = window.devicePixelRatio > 1 ? 8 : 12;
  const particleMaterial = new THREE.PointsMaterial({
    size: pSize,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particleSystem);
}

function spawnSparks(origin, count) {
  let spawned = 0;
  for (let i = 0; i < maxParticles; i++) {
    if (particleLifetimes[i] >= particleMaxLifetimes[i]) {
      particleLifetimes[i] = 0.0;
      particleMaxLifetimes[i] = 0.4 + Math.random() * 0.6;
      
      particlePositions[i * 3] = origin.x;
      particlePositions[i * 3 + 1] = origin.y;
      particlePositions[i * 3 + 2] = origin.z;
      
      particleVelocities[i].set(
        (Math.random() - 0.5) * 4.0,
        (Math.random() - 0.3) * 3.0 + 1.0,
        (Math.random() - 0.5) * 4.0
      );

      particleColors[i * 4] = 1.0;
      particleColors[i * 4 + 1] = 0.1;
      particleColors[i * 4 + 2] = 0.0;
      particleColors[i * 4 + 3] = 1.0;

      spawned++;
      if (spawned >= count) break;
    }
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.color.needsUpdate = true;
}

function updateParticles(dt) {
  const posAttr = particleGeometry.attributes.position;
  const colAttr = particleGeometry.attributes.color;

  for (let i = 0; i < maxParticles; i++) {
    if (particleLifetimes[i] < particleMaxLifetimes[i]) {
      particleLifetimes[i] += dt;
      
      particlePositions[i * 3] += particleVelocities[i].x * dt;
      particlePositions[i * 3 + 1] += particleVelocities[i].y * dt;
      particlePositions[i * 3 + 2] += particleVelocities[i].z * dt;

      particleVelocities[i].y -= 4.0;

      const ratio = particleLifetimes[i] / particleMaxLifetimes[i];
      colAttr.array[i * 4 + 1] = 0.8 * ratio;
      colAttr.array[i * 4 + 3] = 1.0 - ratio;
    } else {
      particlePositions[i * 3] = 9999.0;
      colAttr.array[i * 4 + 3] = 0.0;
    }
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

// Telemetry HUD Updates
function updateHUD(metrics) {
  document.getElementById("rssi-value").textContent = metrics.rssi;
  document.getElementById("tel-ssid").textContent = metrics.ssid;
  document.getElementById("tel-bssid").textContent = metrics.bssid;
  document.getElementById("tel-channel").textContent = metrics.channel;
  document.getElementById("tel-noise").textContent = `${metrics.noise} dBm`;
  document.getElementById("hud-interface").textContent = metrics.interfaceName;

  const qualPercent = Math.round(metrics.linkQuality * 100);
  document.getElementById("rssi-bar-fill").style.width = `${qualPercent}%`;

  document.getElementById("quality-percent").textContent = qualPercent;
  const circleOffset = 263.89 * (1 - metrics.linkQuality);
  document.getElementById("quality-ring-fill").style.strokeDashoffset = circleOffset;

  const rssiEl = document.getElementById("rssi-value");
  rssiEl.className = "";
  if (metrics.rssi >= -60) {
    rssiEl.classList.add("thermal-strong");
  } else if (metrics.rssi >= -78) {
    rssiEl.classList.add("thermal-medium");
  } else {
    rssiEl.classList.add("thermal-weak");
  }

  // Update WiFi performance rating
  const ratingBadge = document.getElementById("perf-rating");
  if (ratingBadge) {
    const rateText = getWifiPerformanceRating(metrics.rssi);
    ratingBadge.textContent = rateText;
    if (metrics.rssi >= -55) {
      ratingBadge.style.background = "rgba(48,209,88,0.15)";
      ratingBadge.style.borderColor = "#30d158";
      ratingBadge.style.color = "#30d158";
    } else if (metrics.rssi >= -72) {
      ratingBadge.style.background = "rgba(255,159,10,0.15)";
      ratingBadge.style.borderColor = "#ff9f0a";
      ratingBadge.style.color = "#ff9f0a";
    } else {
      ratingBadge.style.background = "rgba(255,69,58,0.15)";
      ratingBadge.style.borderColor = "#ff453a";
      ratingBadge.style.color = "#ff453a";
    }
  }

  const sigDist = estimateDistance(metrics.rssi);
  document.getElementById("val-signal-dist").textContent = sigDist.toFixed(1);

  document.getElementById("vf-rssi").textContent = `${metrics.rssi} dBm`;
  document.getElementById("vf-dist").textContent = `${sigDist.toFixed(1)}m`;

  let geomDist = 0;
  let obstruction = 0;

  const rx = routerGroup ? routerGroup.position.x : 0;
  const rz = routerGroup ? routerGroup.position.z : -6;
  const routerPos = new THREE.Vector3(rx, 0.5, rz);

  if (activeMode === 2) {
    geomDist = walkerPos.distanceTo(routerPos);
    document.getElementById("val-geom-dist").textContent = geomDist.toFixed(1);

    if (sigDist > geomDist) {
      obstruction = ((sigDist - geomDist) / sigDist) * 100;
      obstruction = Math.max(0, Math.min(100, Math.round(obstruction)));
    }
  } else {
    geomDist = new THREE.Vector3(0, 0.5, 0).distanceTo(routerPos);
    document.getElementById("val-geom-dist").textContent = geomDist.toFixed(1);
    if (sigDist > geomDist) {
      obstruction = ((sigDist - geomDist) / sigDist) * 100;
      obstruction = Math.max(0, Math.min(100, Math.round(obstruction)));
    }
  }

  document.getElementById("txt-obstruction-percent").textContent = `${obstruction}%`;
  const obstructionFill = document.getElementById("obstruction-bar-fill");
  obstructionFill.style.width = `${obstruction}%`;

  const statusText = document.getElementById("txt-obstruction-status");
  statusText.className = "font-mono";
  if (obstruction < 30) {
    statusText.textContent = "CLEAR";
    statusText.style.color = "#30d158";
  } else if (obstruction < 75) {
    statusText.textContent = "ATTENUATED";
    statusText.style.color = "#ff9f0a";
  } else {
    statusText.textContent = "CRITICAL PATH OBST.";
    statusText.style.color = "#ff453a";
  }
}

function triggerDynamicVisuals(metrics) {
  updateRadarFrustum(metrics.linkQuality);

  const alertEl = document.getElementById("occlusion-alert");
  if (metrics.rssi <= -82) {
    alertEl.classList.remove("hidden");
    if (warningPlane) {
      warningPlane.material.opacity = 0.35 + 0.15 * Math.sin(Date.now() * 0.01);
    }
    
    const rx = routerGroup ? routerGroup.position.x : 0;
    const rz = routerGroup ? routerGroup.position.z : -6;
    spawnSparks(new THREE.Vector3(rx / 2, 0.5, rz / 2), 2);
  } else {
    alertEl.classList.add("hidden");
    if (warningPlane) {
      warningPlane.material.opacity = 0.0;
    }
  }
}

function logConsole(text) {
  document.getElementById("hud-console").textContent = text;
}

// 14. Event Bindings
function setupEvents() {
  const btn1 = document.getElementById("btn-mode-1");
  const btn2 = document.getElementById("btn-mode-2");

  btn1.addEventListener("click", () => setMode(1));
  btn2.addEventListener("click", () => setMode(2));

  document.getElementById("btn-clear-nodes").addEventListener("click", clearVoxelNodes);
  
  // Walker Trail Clearer
  document.getElementById("btn-clear-trail").addEventListener("click", () => {
    trajVertices = [];
    if (trajLine) {
      scene.remove(trajLine);
      trajLine = null;
    }
    logConsole("Walker path trajectory line cleared from viewport.");
  });

  document.getElementById("btn-reset-cam").addEventListener("click", () => {
    controls.reset();
    camera.position.set(0, 10, 16);
  });

  // Slider controls to shift Router X Z coordinates
  document.getElementById("slide-router-x").addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById("txt-router-x").textContent = `${val.toFixed(1)}m`;
    if (routerGroup) {
      routerGroup.position.x = val;
      if (dataSource === 'emulated') {
        const sim = getEmulatedWifiMetrics();
        latestWifi = sim;
        updateHUD(sim);
        triggerDynamicVisuals(sim);
      } else {
        updateRadarFrustum(latestWifi.linkQuality);
      }
      updateWalkerMarker();
    }
  });

  document.getElementById("slide-router-z").addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById("txt-router-z").textContent = `${val.toFixed(1)}m`;
    if (routerGroup) {
      routerGroup.position.z = val;
      if (dataSource === 'emulated') {
        const sim = getEmulatedWifiMetrics();
        latestWifi = sim;
        updateHUD(sim);
        triggerDynamicVisuals(sim);
      } else {
        updateRadarFrustum(latestWifi.linkQuality);
      }
      updateWalkerMarker();
    }
  });

  // Dynamic Path Loss calibration inputs
  document.getElementById("slide-path-loss").addEventListener("input", (e) => {
    pathLossN = parseFloat(e.target.value);
    document.getElementById("txt-path-loss").textContent = pathLossN.toFixed(1);
    updateNearbyNetworksTable();
    updateRouterTriangulation();
  });

  document.getElementById("slide-ref-rssi").addEventListener("input", (e) => {
    refSignalA = parseInt(e.target.value);
    document.getElementById("txt-ref-rssi").textContent = `${refSignalA}dBm`;
    updateNearbyNetworksTable();
    updateRouterTriangulation();
  });

  // Walker settings
  document.getElementById("slide-walk-speed").addEventListener("input", (e) => {
    autopilotSpeedMultiplier = parseFloat(e.target.value);
    document.getElementById("txt-walk-speed").textContent = `${autopilotSpeedMultiplier.toFixed(1)}x`;
  });

  document.getElementById("slide-walk-elevation").addEventListener("input", (e) => {
    walkerElevationY = parseFloat(e.target.value);
    document.getElementById("txt-walk-elevation").textContent = `${walkerElevationY.toFixed(1)}m`;
    walkerPos.y = walkerElevationY;
    updateWalkerMarker();
  });

  // Voxel Resolution
  document.getElementById("slide-voxel-size").addEventListener("input", (e) => {
    voxelResolutionSize = parseFloat(e.target.value);
    document.getElementById("txt-voxel-size").textContent = `${voxelResolutionSize.toFixed(1)}m`;
  });

  // FPS mode
  document.getElementById("select-fps-limit").addEventListener("change", (e) => {
    fpsLimit = parseInt(e.target.value);
    logConsole(`Eco framerate mode: limit rendering to ${fpsLimit} FPS.`);
  });

  // Geiger sonar sonification
  const btnGeiger = document.getElementById("btn-audio-geiger");
  btnGeiger.addEventListener("click", () => {
    audioGeigerActive = !audioGeigerActive;
    if (audioGeigerActive) {
      btnGeiger.textContent = "🔊 Sonar On";
      btnGeiger.style.background = "rgba(10,132,255,0.2)";
      btnGeiger.style.borderColor = "var(--neon-cyan)";
      logConsole("Audio Sonification Geiger counter: ON.");
      startGeigerLoop();
    } else {
      btnGeiger.textContent = "🔊 Sonar Off";
      btnGeiger.style.background = "rgba(255,255,255,0.06)";
      btnGeiger.style.borderColor = "rgba(255,255,255,0.12)";
      logConsole("Audio Geiger counter: OFF.");
      if (geigerTimeout) clearTimeout(geigerTimeout);
    }
  });

  // Search filter
  document.getElementById("nearby-search").addEventListener("input", updateNearbyNetworksTable);

  // File Exports & Imports
  document.getElementById("btn-export-json").addEventListener("click", exportMappingData);
  const btnImportTrigger = document.getElementById("btn-import-trigger");
  const inputImportFile = document.getElementById("input-import-file");
  btnImportTrigger.addEventListener("click", () => inputImportFile.click());
  inputImportFile.addEventListener("change", importMappingData);

  // Palette Shift Dropdown selector
  document.getElementById("select-palette").addEventListener("change", (e) => {
    activePalette = e.target.value;

    updateRadarFrustum(latestWifi.linkQuality);
    updateWalkerMarker();

    walkNodes.forEach((nodeGroup) => {
      const sprite = nodeGroup.children[0];
      const sig = nodeGroup.userData.signalStrength;
      const col = getThermalColor(sig);
      const hexColor = "#" + col.getHexString();
      const texture = createThermalTexture(hexColor);
      if (sprite) {
        sprite.material.map.dispose();
        sprite.material.map = texture;
        sprite.material.needsUpdate = true;
      }
    });

    const scaleBar = document.querySelector(".scale-bar");
    if (scaleBar) {
      if (activePalette === 'ironbow') {
        scaleBar.style.background = 'linear-gradient(90deg, #1a0066, #b3003b, #ff6600, #ffd700, #ffffff)';
      } else if (activePalette === 'rainbow') {
        scaleBar.style.background = 'linear-gradient(90deg, #ff001a, #ff6600, #e6e600, #00cc33, #0000cc)';
      } else if (activePalette === 'whitehot') {
        scaleBar.style.background = 'linear-gradient(90deg, #000000, #888888, #ffffff)';
      } else if (activePalette === 'blackhot') {
        scaleBar.style.background = 'linear-gradient(90deg, #ffffff, #888888, #000000)';
      }
    }

    logConsole(`Thermal spectrum shifted to: ${activePalette.toUpperCase()}`);
  });

  // Data Source Selector bindings
  const btnHw = document.getElementById("btn-source-hw");
  const btnEmu = document.getElementById("btn-source-emu");

  btnHw.addEventListener("click", () => setDataSource('hardware'));
  btnEmu.addEventListener("click", () => setDataSource('emulated'));

  // RF Countermeasures Bindings
  document.getElementById("slide-tx-power").addEventListener("input", (e) => {
    const power = parseInt(e.target.value);
    txPowerMultiplier = power / 100.0;
    document.getElementById("txt-tx-power").textContent = `${power}%`;
    logConsole(`Router RF TX Power restricted to ${power}% (reduces range/leakage).`);

    if (dataSource === 'emulated') {
      const sim = getEmulatedWifiMetrics();
      latestWifi = sim;
      updateHUD(sim);
      triggerDynamicVisuals(sim);
    }
  });

  document.getElementById("select-shielding").addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === 'air') {
      shieldingLoss = 0.0;
      logConsole("RF Shielding barrier: Open Air.");
    } else if (val === 'concrete') {
      shieldingLoss = 12.0;
      logConsole("RF Shielding: Concrete barrier applied (+12dBm attenuation).");
    } else if (val === 'faraday') {
      shieldingLoss = 35.0;
      logConsole("RF Shielding: Faraday metal mesh cage active (+35dBm complete blockage).");
    }

    if (dataSource === 'emulated') {
      const sim = getEmulatedWifiMetrics();
      latestWifi = sim;
      updateHUD(sim);
      triggerDynamicVisuals(sim);
    }
  });

  document.getElementById("select-freq-band").addEventListener("change", (e) => {
    frequencyBand = e.target.value;
    logConsole(`Wi-Fi scanning band configured to ${frequencyBand} GHz.`);
  });

  // Walking Model Button Bindings
  const btnManual = document.getElementById("btn-walk-manual");
  const btnAuto = document.getElementById("btn-walk-auto");
  const btnLidar = document.getElementById("btn-walk-lidar");

  btnManual.addEventListener("click", () => setWalkingModel('manual'));
  btnAuto.addEventListener("click", () => setWalkingModel('autopilot'));
  btnLidar.addEventListener("click", () => setWalkingModel('lidar'));
}

function setDataSource(source) {
  dataSource = source;
  const btnHw = document.getElementById("btn-source-hw");
  const btnEmu = document.getElementById("btn-source-emu");
  const badgeSource = document.getElementById("badge-source");

  if (!btnHw || !btnEmu || !badgeSource) return;

  if (source === 'hardware') {
    btnHw.classList.add("active");
    btnEmu.classList.remove("active");
    badgeSource.textContent = "REAL HARDWARE";
    badgeSource.className = "badge source-hardware";
    logConsole("Data Source shifted to Real WiFi Card.");
  } else {
    btnEmu.classList.add("active");
    btnHw.classList.remove("active");
    badgeSource.textContent = "VIRTUAL EMU";
    badgeSource.className = "badge source-emulated";
    logConsole("Data Source shifted to Virtual RF Emulator.");
    
    const simulatedMetrics = getEmulatedWifiMetrics();
    latestWifi = simulatedMetrics;
    updateHUD(simulatedMetrics);
    triggerDynamicVisuals(simulatedMetrics);
  }
}

function setWalkingModel(model) {
  walkingModel = model;
  const btnManual = document.getElementById("btn-walk-manual");
  const btnAuto = document.getElementById("btn-walk-auto");
  const btnLidar = document.getElementById("btn-walk-lidar");

  if (!btnManual || !btnAuto || !btnLidar) return;

  btnManual.classList.remove("active");
  btnAuto.classList.remove("active");
  btnLidar.classList.remove("active");

  if (model === 'manual') {
    btnManual.classList.add("active");
    logConsole("Walking model set to Manual Arrow Steering.");
  } else if (model === 'autopilot') {
    btnAuto.classList.add("active");
    autopilotLerpFactor = 0.0;
    walkerPos.copy(autopilotWaypoints[currentWaypointIndex]);
    updateWalkerMarker();
    logConsole("Auto-Pilot active. Site Survey Surveying paths...");
  } else if (model === 'lidar') {
    btnLidar.classList.add("active");
    logConsole("LiDAR Sweep active. Radar auto-rotating 360°...");
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === '1') setMode(1);
    if (e.key === '2') setMode(2);

    if (e.key === ' ' && activeMode === 2) {
      dropVoxelNode();
    }

    if (activeMode === 2) {
      if (walkingModel === 'manual') {
        const turnSpeed = 0.08;
        if (e.key === 'ArrowLeft')  steerAngle -= turnSpeed;
        if (e.key === 'ArrowRight') steerAngle += turnSpeed;

        const rx = routerGroup ? routerGroup.position.x : 0;
        const rz = routerGroup ? routerGroup.position.z : -6;
        const d = estimateDistance(latestWifi.rssi);
        
        walkerPos.x = rx + d * Math.cos(steerAngle);
        walkerPos.z = rz + d * Math.sin(steerAngle);
        walkerPos.y = walkerElevationY;

        walkerPos.x = Math.max(-14, Math.min(14, walkerPos.x));
        walkerPos.z = Math.max(-14, Math.min(14, walkerPos.z));

        updateWalkerMarker();
      }

      if (dataSource === 'emulated') {
        const sim = getEmulatedWifiMetrics();
        latestWifi = sim;
        updateHUD(sim);
        triggerDynamicVisuals(sim);
      }
    }
  });

  // Preset Button bindings
  const btnPresetMapping = document.getElementById("btn-preset-mapping");
  const btnPresetTracking = document.getElementById("btn-preset-tracking");
  const btnPresetSecurity = document.getElementById("btn-preset-security");
  const btnPresetSonar = document.getElementById("btn-preset-sonar");

  btnPresetMapping.addEventListener("click", () => triggerPreset('mapping'));
  btnPresetTracking.addEventListener("click", () => triggerPreset('tracking'));
  btnPresetSecurity.addEventListener("click", () => triggerPreset('security'));
  btnPresetSonar.addEventListener("click", () => triggerPreset('sonar'));
}

function triggerPreset(presetName) {
  const btnPresetMapping = document.getElementById("btn-preset-mapping");
  const btnPresetTracking = document.getElementById("btn-preset-tracking");
  const btnPresetSecurity = document.getElementById("btn-preset-security");
  const btnPresetSonar = document.getElementById("btn-preset-sonar");

  if (!btnPresetMapping || !btnPresetTracking || !btnPresetSecurity || !btnPresetSonar) return;

  btnPresetMapping.classList.remove("active");
  btnPresetTracking.classList.remove("active");
  btnPresetSecurity.classList.remove("active");
  btnPresetSonar.classList.remove("active");

  if (presetName === 'mapping') {
    btnPresetMapping.classList.add("active");
    setMode(2);
    setWalkingModel('autopilot');
    logConsole("Preset: 3D Mapping Active. Patrolling and plotting voxels...");
  } else if (presetName === 'tracking') {
    btnPresetTracking.classList.add("active");
    setMode(2);
    setWalkingModel('lidar');
    logConsole("Preset: Location Trace Active. 360 degree sweeps active...");
  } else if (presetName === 'security') {
    btnPresetSecurity.classList.add("active");
    setMode(2);
    setWalkingModel('autopilot');
    // Change palette to rainbow for visual security analysis
    document.getElementById("select-palette").value = "rainbow";
    document.getElementById("select-palette").dispatchEvent(new Event("change"));
    logConsole("Preset: Security Sweep Active. Mapping channel interferences...");
  } else if (presetName === 'sonar') {
    btnPresetSonar.classList.add("active");
    // Auto-trigger Geiger counter audio sonar
    const btnGeiger = document.getElementById("btn-audio-geiger");
    if (btnGeiger && !audioGeigerActive) {
      btnGeiger.click();
    }
    logConsole("Preset: Signal Sonar Active. Geiger counter beeps enabled...");
  }
}

function setMode(mode) {
  activeMode = mode;
  const btn1 = document.getElementById("btn-mode-1");
  const btn2 = document.getElementById("btn-mode-2");

  if (mode === 1) {
    btn1.classList.add("active");
    btn2.classList.remove("active");
    if (frustumLines) frustumLines.visible = true;
    if (warningPlane) warningPlane.visible = true;
    if (walkerMarker) walkerMarker.visible = false;
    if (distanceSphere) distanceSphere.visible = false;
    if (trajLine) trajLine.visible = false;
    logConsole("Switched to Stationary Radar Mode.");
  } else {
    btn2.classList.add("active");
    btn1.classList.remove("active");
    if (frustumLines) frustumLines.visible = false;
    if (warningPlane) warningPlane.visible = false;
    if (walkerMarker) walkerMarker.visible = true;
    if (distanceSphere) distanceSphere.visible = true;
    if (trajLine) trajLine.visible = true;
    logConsole("Switched to Warwalking Grid Mode. Distance auto-driven.");
    
    const rx = routerGroup ? routerGroup.position.x : 0;
    const rz = routerGroup ? routerGroup.position.z : -6;
    const d = estimateDistance(latestWifi.rssi);
    
    if (walkingModel !== 'autopilot') {
      walkerPos.x = rx + d * Math.cos(steerAngle);
      walkerPos.z = rz + d * Math.sin(steerAngle);
      updateWalkerMarker();
    }
  }
}

// 2-Second Liveness Fallback Loop (ensures periodic logging even if stationary)
setInterval(() => {
  if (activeMode === 2) {
    const rx = routerGroup ? routerGroup.position.x : 0;
    const rz = routerGroup ? routerGroup.position.z : -6;
    const d = estimateDistance(latestWifi.rssi);
    
    if (walkingModel === 'manual') {
      walkerPos.x = rx + d * Math.cos(steerAngle);
      walkerPos.z = rz + d * Math.sin(steerAngle);
    } else if (walkingModel === 'lidar') {
      walkerPos.x = rx + d * Math.cos(steerAngle);
      walkerPos.z = rz + d * Math.sin(steerAngle);
    }
    
    walkerPos.y = 0.5;
    updateWalkerMarker();

    // Only drop if there is a minor displacement from last node to prevent redundancy
    const dist = walkerPos.distanceTo(lastDroppedPos);
    if (dist >= 0.05 || nodeHistory.length === 0) {
      dropVoxelNode();
      lastDroppedPos.copy(walkerPos);
    }
  }
}, 2000);

// 17. Frame Render Loop
let clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);

  // FPS ceiling limit throttler (Feature 11)
  const now = performance.now();
  const interval = 1000 / fpsLimit;
  if (now - lastFrameTime < interval) {
    return;
  }
  // Adjust lastFrameTime to lock rate
  lastFrameTime = now - ((now - lastFrameTime) % interval);

  const dt = clock.getDelta();

  controls.update();

  if (activeMode === 1) {
    if (frustumLines) {
      frustumLines.rotation.y = Math.sin(Date.now() * 0.0003) * 0.05;
    }
  }

  // Smooth walker updates for active walking models (accelerated to build maps in 15-20 seconds!)
  if (activeMode === 2) {
    if (walkingModel === 'autopilot') {
      autopilotLerpFactor += dt * 0.32 * autopilotSpeedMultiplier; // Custom walk speed multiplier (Feature 9)
      if (autopilotLerpFactor >= 1.0) {
        autopilotLerpFactor = 0.0;
        currentWaypointIndex = (currentWaypointIndex + 1) % autopilotWaypoints.length;
      }
      const startWp = autopilotWaypoints[currentWaypointIndex];
      const endWp = autopilotWaypoints[(currentWaypointIndex + 1) % autopilotWaypoints.length];
      
      // Interpolate walkerPos along waypoints
      walkerPos.lerpVectors(startWp, endWp, autopilotLerpFactor);
      walkerPos.y = walkerElevationY; // Custom walker Y elevation (Feature 17)
      updateWalkerMarker();
    } else if (walkingModel === 'lidar') {
      // Rotate sweep angle continuously (completes full circle in 6.6 seconds)
      steerAngle += dt * 0.95;
      const rx = routerGroup ? routerGroup.position.x : 0;
      const rz = routerGroup ? routerGroup.position.z : -6;
      const d = estimateDistance(latestWifi.rssi);
      
      walkerPos.x = rx + d * Math.cos(steerAngle);
      walkerPos.z = rz + d * Math.sin(steerAngle);
      walkerPos.y = walkerElevationY; // Custom walker Y elevation (Feature 17)
      updateWalkerMarker();
    }

    // High frequency displacement checking (realtime microsecond level accuracy updates)
    const distSinceLastDrop = walkerPos.distanceTo(lastDroppedPos);
    if (distSinceLastDrop >= voxelResolutionSize) {
      dropVoxelNode();
      lastDroppedPos.copy(walkerPos);
    }
  }

  // Update elapsed camera timer
  elapsedTime += dt;
  const hrs = Math.floor(elapsedTime / 3600).toString().padStart(2, '0');
  const mins = Math.floor((elapsedTime % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(elapsedTime % 60).toString().padStart(2, '0');
  const ms = Math.floor((elapsedTime % 1) * 100).toString().padStart(2, '0');
  
  const timerEl = document.getElementById("vf-timestamp");
  if (timerEl) {
    timerEl.textContent = `${hrs}:${mins}:${secs}.${ms}`;
  }

  const batteryPercent = Math.max(0, 89 - Math.floor(elapsedTime / 180));
  const batItem = document.querySelector(".vf-status-item");
  if (batItem) {
    batItem.textContent = `BAT: ${batteryPercent}%`;
  }

  // Emulation updates
  if (dataSource === 'emulated') {
    emuUpdateTimer += dt;
    if (emuUpdateTimer >= 0.1) {
      emuUpdateTimer = 0.0;
      const sim = getEmulatedWifiMetrics();
      
      if (rssiBaseline === -65) {
        rssiBaseline = sim.rssi;
      } else {
        rssiBaseline = rssiBaseline * 0.96 + sim.rssi * 0.04;
      }

      latestWifi = sim;
      updateHUD(sim);
      triggerDynamicVisuals(sim);
      
      // Update charts & simulation metrics
      drawSignalTrendChart();
      updateNearbyAPsSimulation();
      updateRouterTriangulation();
    }
  } else {
    // Hardware mode periodic updates
    emuUpdateTimer += dt;
    if (emuUpdateTimer >= 0.1) {
      emuUpdateTimer = 0.0;
      drawSignalTrendChart();
      updateNearbyAPsSimulation();
      updateRouterTriangulation();
    }
  }

  // Update Haptic warning outline border (Feature 15)
  const alertEl = document.getElementById("occlusion-alert");
  if (alertEl && !alertEl.classList.contains("hidden")) {
    document.body.classList.add("haptic-warning");
  } else {
    document.body.classList.remove("haptic-warning");
  }

  // Check if walker cursor is moving
  const isMoving = walkerPos.distanceTo(lastDroppedPos) > 0.1;

  // Update CSI graphics plots
  drawCsiWaves(isMoving);
  drawCsiWaterfall(isMoving);
  drawBreathingWave(dt, isMoving);

  // Update Multipath Reflections
  updateMultipathRays();

  // Update Humanoid Motion Ghost position & chest breathing
  updateMotionGhost(dt);

  updateSignalWaves(dt);
  updateParticles(dt);

  renderer.render(scene, camera);
}

// Initialize App Setup
window.onload = () => {
  initGraphics();
  setupEvents();
  
  // Set default data source to virtual emulated loop
  setDataSource('emulated');

  // Trigger the master 3D Mapping preset out-of-the-box!
  triggerPreset('mapping');

  setupLogoEditor();
  connectWebSocket();
  animate();
  logConsole("System operational. Quick Preset: 3D Mapping loaded.");
};

// 18. Helper Functions for New Advanced Features

function triggerGeigerAudio(rssi) {
  if (!audioGeigerActive) return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  try {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.type = 'sine';
    // Frequency increases (higher pitched beeps) as signal gets stronger
    const beepFreq = 500 + ((rssi + 100) * 10); // range e.g. 500Hz to 1200Hz
    osc.frequency.setValueAtTime(beepFreq, audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.045);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  } catch (e) {
    console.warn("Audio Context playback warning:", e);
  }
}

function startGeigerLoop() {
  if (geigerTimeout) clearTimeout(geigerTimeout);
  if (!audioGeigerActive) return;
  
  const rssi = latestWifi ? latestWifi.rssi : -65;
  const normalized = Math.max(0.0, Math.min(1.0, (rssi + 95) / 65)); // 0.0 is weak (-95), 1.0 is strong (-30)
  const delay = 80 + (1 - normalized) * 920; // beeps every 80ms to 1000ms
  
  triggerGeigerAudio(rssi);
  
  geigerTimeout = setTimeout(startGeigerLoop, delay);
}

function drawSignalTrendChart() {
  const canvas = document.getElementById("canvas-signal-trend");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  
  ctx.clearRect(0, 0, w, h);
  
  // Add current metric
  rssiHistory.push(latestWifi.rssi);
  if (rssiHistory.length > maxRssiHistory) {
    rssiHistory.shift();
  }
  
  // Draw grid lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let db = -40; db >= -90; db -= 15) {
    const y = h * (db - -30) / (-100 - -30);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  
  // Plot line
  if (rssiHistory.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(10, 132, 255, 0.85)"; // Apple Blue line
  ctx.lineWidth = 1.5;
  
  const sliceWidth = w / (maxRssiHistory - 1);
  for (let i = 0; i < rssiHistory.length; i++) {
    const db = rssiHistory[i];
    const y = h * (db - -30) / (-100 - -30);
    const x = i * sliceWidth;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function getWifiPerformanceRating(rssi) {
  if (rssi >= -55) return "EXCELLENT (4K STREAMING)";
  if (rssi >= -68) return "GOOD (HD CHAT)";
  if (rssi >= -78) return "FAIR (BROWSING)";
  return "UNSTABLE (PACKET DROPS)";
}

function updateRouterTriangulation() {
  if (walkNodes.length < 3) {
    // Locator fallback: show active settings
    const rx = routerGroup ? routerGroup.position.x : 0;
    const rz = routerGroup ? routerGroup.position.z : -6;
    updateEstimatedRouterMesh(rx, 0.5, rz, 100);
    return;
  }
  
  let sumX = 0, sumZ = 0, sumW = 0;
  walkNodes.forEach((node) => {
    const rssi = node.userData.rssi || -65;
    // Weighted centering base power
    const weight = Math.pow(10, (rssi + 100) / 10);
    sumX += node.position.x * weight;
    sumZ += node.position.z * weight;
    sumW += weight;
  });
  
  if (sumW > 0) {
    const estX = sumX / sumW;
    const estZ = sumZ / sumW;
    const confidence = Math.min(100, Math.round(35 + (walkNodes.length / 40) * 65));
    
    updateEstimatedRouterMesh(estX, walkerElevationY, estZ, confidence);
  }
}

function updateEstimatedRouterMesh(x, y, z, confidence) {
  const estEl = document.getElementById("router-est-pos");
  if (estEl) {
    estEl.textContent = `X: ${x.toFixed(2)} | Y: ${y.toFixed(2)} | Z: ${z.toFixed(2)}`;
  }
  const confEl = document.getElementById("router-confidence");
  if (confEl) {
    confEl.textContent = `${confidence}%`;
    if (confidence > 80) {
      confEl.style.color = "#30d158";
    } else if (confidence > 55) {
      confEl.style.color = "#ff9f0a";
    } else {
      confEl.style.color = "#ff453a";
    }
  }
  
  // Render predicted router coordinate in Three.js Scene
  if (!predictedRouterMesh) {
    const geo = new THREE.SphereGeometry(0.35, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0a84ff, // Apple Blue glow
      transparent: true,
      opacity: 0.65,
      wireframe: true
    });
    predictedRouterMesh = new THREE.Mesh(geo, mat);
    scene.add(predictedRouterMesh);
  }
  
  predictedRouterMesh.position.set(x, y, z);
  // Pulse predicted marker
  const pulse = 1.0 + Math.sin(Date.now() * 0.004) * 0.12;
  predictedRouterMesh.scale.set(pulse, pulse, pulse);
}

function setupLogoEditor() {
  const el = document.getElementById("logo-title-editable");
  if (!el) return;
  el.addEventListener("blur", () => {
    customTitle = el.innerText.trim();
    logConsole(`Custom dashboard brand set to: ${customTitle}`);
  });
  el.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    }
  });
}

function exportMappingData() {
  if (walkNodes.length === 0) {
    alert("No voxel mapping data collected yet! Walk around to log points.");
    return;
  }
  
  const data = walkNodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    z: node.position.z,
    rssi: node.userData.rssi,
    linkQuality: node.userData.signalStrength
  }));
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spatial_voxels_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  logConsole(`Exported ${walkNodes.length} mapping nodes to JSON file.`);
}

function importMappingData(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = JSON.parse(evt.target.result);
      if (!Array.isArray(data)) throw new Error("File formatting must be a JSON array.");
      
      clearVoxelNodes();
      data.forEach((item) => {
        drawVoxelNodeLocal(new THREE.Vector3(item.x, item.y, item.z), item.linkQuality, item.rssi);
      });
      logConsole(`Imported ${data.length} spatial nodes successfully from file!`);
    } catch (err) {
      logConsole(`JSON Import error: ${err.message}`);
      alert("Error parsing file. Ensure it is a valid exported mapper JSON file.");
    }
  };
  reader.readAsText(file);
}

function updateNearbyNetworksTable() {
  const tbody = document.getElementById("table-body-networks");
  if (!tbody) return;
  
  const filterInput = document.getElementById("nearby-search");
  const filter = filterInput ? filterInput.value.toLowerCase() : "";
  tbody.innerHTML = "";
  
  const sorted = [...nearbyAPs].sort((a, b) => (b.isConnected ? 1 : 0) - (a.isConnected ? 1 : 0));
  
  sorted.forEach((ap) => {
    if (filter && !ap.ssid.toLowerCase().includes(filter)) return;
    
    const tr = document.createElement("tr");
    
    // connected
    const connTd = document.createElement("td");
    if (ap.isConnected) {
      connTd.className = "connected-row";
      connTd.innerHTML = `<span class="status-indicator-dot active"></span>CONN`;
    } else {
      connTd.innerHTML = `<span class="status-indicator-dot inactive"></span>SCAN`;
    }
    tr.appendChild(connTd);
    
    // ssid
    const ssidTd = document.createElement("td");
    ssidTd.textContent = ap.ssid;
    if (ap.isConnected) ssidTd.style.fontWeight = "600";
    tr.appendChild(ssidTd);
    
    // MAC (bssid)
    const macTd = document.createElement("td");
    macTd.className = "font-mono";
    macTd.textContent = ap.bssid;
    tr.appendChild(macTd);
    
    // Signal
    const sigTd = document.createElement("td");
    sigTd.className = "font-mono";
    sigTd.textContent = `${ap.signal} dBm`;
    if (ap.signal >= -55) {
      sigTd.style.color = "#30d158";
    } else if (ap.signal >= -75) {
      sigTd.style.color = "#ff9f0a";
    } else {
      sigTd.style.color = "#ff453a";
    }
    tr.appendChild(sigTd);
    
    // Chan
    const chanTd = document.createElement("td");
    chanTd.className = "font-mono";
    chanTd.textContent = ap.channel;
    tr.appendChild(chanTd);
    
    // Freq
    const freqTd = document.createElement("td");
    freqTd.className = "font-mono";
    freqTd.textContent = `${ap.frequency.toFixed(3)} G`;
    tr.appendChild(freqTd);
    
    // Computed Distance
    const distTd = document.createElement("td");
    distTd.className = "font-mono";
    const dist = Math.pow(10, (refSignalA - ap.signal) / (10 * pathLossN));
    distTd.textContent = `${dist.toFixed(1)} m`;
    tr.appendChild(distTd);
    
    tbody.appendChild(tr);
  });
}

function updateNearbyAPsSimulation() {
  nearbyAPs.forEach((ap) => {
    if (ap.isConnected) {
      ap.ssid = latestWifi.ssid;
      ap.bssid = latestWifi.bssid;
      ap.channel = latestWifi.channel;
      ap.signal = latestWifi.rssi;
      ap.frequency = parseFloat(frequencyBand);
    } else {
      ap.signal += Math.round((Math.random() - 0.5) * 2);
      ap.signal = Math.max(-95, Math.min(-35, ap.signal));
    }
  });
  
  // Calculate spatial density analytics (Feature 14)
  if (walkNodes.length > 0) {
    let sumS = 0;
    walkNodes.forEach(n => sumS += n.userData.rssi || -60);
    const avg = sumS / walkNodes.length;
    let sqSum = 0;
    walkNodes.forEach(n => sqSum += Math.pow((n.userData.rssi || -60) - avg, 2));
    const stdDev = Math.sqrt(sqSum / walkNodes.length);
    
    const densityBox = document.getElementById("density-analytics-box");
    if (densityBox) {
      densityBox.textContent = `Avg Signal: ${avg.toFixed(1)} dBm | Std Dev: ${stdDev.toFixed(1)} dB`;
    }
  }
  
  updateNearbyNetworksTable();
}
