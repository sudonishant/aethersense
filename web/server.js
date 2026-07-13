const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Scan History Persistence Database with Debounced Storage
const historyFilePath = path.join(__dirname, 'scan_history.json');
let scanHistory = [];

if (fs.existsSync(historyFilePath)) {
  try {
    scanHistory = JSON.parse(fs.readFileSync(historyFilePath, 'utf8'));
    if (scanHistory.length > 1500) {
      scanHistory = scanHistory.slice(-1500); // keep only 1500 latest entries
      fs.writeFileSync(historyFilePath, JSON.stringify(scanHistory));
      console.log(`[Server] Pruned excessive nodes. Trimmed to ${scanHistory.length} nodes.`);
    } else {
      console.log(`[Server] Loaded ${scanHistory.length} saved scanning nodes from history file.`);
    }
  } catch (e) {
    console.error('[Server] Failed to parse scan history database, resetting:', e);
    scanHistory = [];
  }
} else {
  fs.writeFileSync(historyFilePath, '[]');
}

let saveTimeout = null;
function saveHistoryDebounced() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(historyFilePath, JSON.stringify(scanHistory));
    } catch (e) {
      console.error('[Server] Failed to persist scan history:', e);
    }
    saveTimeout = null;
  }, 2000); // Batch writes every 2 seconds
}

// Client connection event router
wss.on('connection', (ws) => {
  console.log('[Server] Browser client dashboard connected.');
  
  // Immediately stream all saved history to the connecting client
  ws.send(JSON.stringify({
    type: 'history',
    data: scanHistory
  }));

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message);
      if (payload.type === 'drop') {
        // Enforce maximum history size limit (5000 nodes)
        if (scanHistory.length >= 5000) {
          scanHistory.shift();
        }
        scanHistory.push(payload.node);
        saveHistoryDebounced();

        // Sync scan node to other active clients
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'drop_broadcast',
              node: payload.node
            }));
          }
        });
      } else if (payload.type === 'clear') {
        // Clear history database
        scanHistory = [];
        fs.writeFileSync(historyFilePath, '[]');
        
        // Sync clear map to other active clients
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'clear_broadcast'
            }));
          }
        });
        console.log('[Server] Scan history database reset on disk.');
      }
    } catch (err) {
      console.error('[Server] Error handling WS client request:', err);
    }
  });
});

// Broadcast helper to stream WiFi stats to all active browser clients
function broadcast(data) {
  let jsonPacket = data;
  try {
    // If it's already a JSON string from C++ or simulation, send it wrapped or raw
    const parsed = JSON.parse(data);
    jsonPacket = JSON.stringify({
      type: 'wifi',
      data: parsed
    });
  } catch (e) {
    // Not valid JSON, send as raw text
  }

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonPacket);
    }
  });
}


// Search for compiled C++ CLI scanner binary in common locations
const searchPaths = [
  path.join(__dirname, '../build/bin/wifi_scanner_cli'),
  path.join(__dirname, '../build/wifi_scanner_cli'),
  path.join(__dirname, './wifi_scanner_cli'),
  path.join(__dirname, '../wifi_scanner_cli')
];

let cliProcess = null;
let binaryPath = null;

for (const p of searchPaths) {
  if (fs.existsSync(p)) {
    binaryPath = p;
    break;
  }
}

if (binaryPath) {
  console.log(`[Server] Found C++ binary at: ${binaryPath}`);
  startCppProcess(binaryPath);
} else {
  console.log('[Server] Warning: C++ Wifi CLI scanner binary not found.');
  console.log('[Server] Launching in Simulated Web Mode (automatic signal generator).');
  startSimulatedStream();
}

function startCppProcess(binPath) {
  try {
    cliProcess = spawn(binPath, []);
    console.log(`[Server] Spawned C++ child process with PID: ${cliProcess.pid}`);

    let stdoutBuffer = '';

    cliProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // Keep the last partial line

      for (const line of lines) {
        if (line.trim()) {
          // Stream raw JSON lines from C++ directly to the frontend clients
          broadcast(line.trim());
        }
      }
    });

    cliProcess.stderr.on('data', (data) => {
      console.error(`[C++ CLI Stderr]: ${data.toString().trim()}`);
    });

    cliProcess.on('error', (err) => {
      console.error('[Server] Failed to start C++ process. Falling back to simulation.', err);
      startSimulatedStream();
    });

    cliProcess.on('close', (code) => {
      console.log(`[Server] C++ scanner process exited with code ${code}`);
      if (code !== 0) {
        console.log('[Server] Restarting in simulated fallback mode.');
        startSimulatedStream();
      }
    });
  } catch (err) {
    console.error('[Server] Error spawning C++ binary:', err);
    startSimulatedStream();
  }
}

function startSimulatedStream() {
  let simTime = 0.0;
  setInterval(() => {
    simTime += 0.1;
    
    // Generate a varying signal base with a simulated obstacle dip
    let rssi = Math.round(-65 + 25 * Math.sin(simTime * 0.4));
    
    // Simulate concrete obstruction drops
    if (Math.cos(simTime * 1.2) < -0.8) {
      rssi = -92;
    }
    
    const quality = Math.max(0.0, Math.min(1.0, (rssi + 100.0) / 70.0));
    
    const metric = {
      rssi: rssi,
      linkQuality: quality,
      noise: -95,
      channel: 11,
      ssid: "Simulated_WiFi_Server",
      bssid: "00:DE:AD:BE:EF:88",
      interfaceName: "web_sim_0"
    };
    
    broadcast(JSON.stringify(metric));
  }, 100);
}

// Graceful cleanup on process exit
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

function cleanup() {
  console.log('[Server] Shutting down Node.js server...');
  if (cliProcess) {
    console.log('[Server] Killing C++ subprocess...');
    cliProcess.kill('SIGTERM');
  }
  process.exit(0);
}

// Handle startup errors gracefully (e.g. port in use)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[Server Error] Port ${PORT} is already in use by another process!`);
    console.error(`Please kill the conflicting process using port ${PORT} and try again.\n`);
    process.exit(1);
  } else {
    console.error('[Server Error]', err);
  }
});

// Start Listening
server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`         AetherSense Web Portal Ready             `);
  console.log(`  Server Local URL: http://localhost:${PORT}        `);
  console.log(`==================================================`);
});
