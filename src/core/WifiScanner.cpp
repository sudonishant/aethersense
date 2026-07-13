#include "WifiScanner.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <chrono>
#include <algorithm>
#include <cmath>

#ifdef SYSTEM_WINDOWS
    #include <windows.h>
    #include <wlanapi.h>
    #pragma comment(lib, "wlanapi.lib")
#elif defined(SYSTEM_MACOS)
    #import <Foundation/Foundation.h>
    #import <CoreWLAN/CoreWLAN.h>
#else
    // Linux / Unix headers
    #include <dirent.h>
    #include <unistd.h>
#endif

// Utility to trim whitespace
static std::string trim(const std::string& str) {
    size_t first = str.find_first_not_of(" \t\r\n");
    if (std::string::npos == first) {
        return str;
    }
    size_t last = str.find_last_not_of(" \t\r\n");
    return str.substr(first, (last - first + 1));
}

WifiScanner::WifiScanner() : m_running(false) {}

WifiScanner::~WifiScanner() {
    stop();
}

void WifiScanner::start(ThreadSafeBuffer<WifiMetrics>& buffer, int intervalMs) {
    if (m_running) return;

    m_buffer = &buffer;
    m_intervalMs = intervalMs;
    m_running = true;
    m_thread = std::thread(&WifiScanner::scanLoop, this);
}

void WifiScanner::stop() {
    if (!m_running) return;

    m_running = false;
    if (m_thread.joinable()) {
        m_thread.join();
    }
}

bool WifiScanner::isRunning() const {
    return m_running;
}

void WifiScanner::scanLoop() {
    while (m_running) {
        WifiMetrics metrics = captureMetrics();
        if (m_buffer) {
            m_buffer->set_latest(metrics);
            m_buffer->push_history(metrics);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(m_intervalMs));
    }
}

WifiMetrics WifiScanner::captureMetrics() {
#if defined(SYSTEM_WINDOWS)
    return captureWindows();
#elif defined(SYSTEM_MACOS)
    return captureMac();
#elif defined(SYSTEM_LINUX)
    return captureLinux();
#else
    // Fallback simulated metrics
    WifiMetrics m;
    m.interfaceName = "Simulated";
    m.ssid = "Simulated_Router_5G";
    m.bssid = "0A:1B:2C:3D:4E:5F";
    m.rssi = -60;
    m.linkQuality = 0.8f;
    m.channel = 36;
    return m;
#endif
}

WifiMetrics WifiScanner::captureLinux() {
    WifiMetrics m;
    m.interfaceName = "None";
    m.ssid = "Disconnected";
    m.bssid = "00:00:00:00:00:00";
    m.rssi = -100;
    m.linkQuality = 0.0f;
    m.noise = -100.0f;
    m.channel = 1;

    std::ifstream file("/proc/net/wireless");
    if (!file.is_open()) {
        // Fallback to simulated values if file doesn't exist (e.g. VM or no wifi card)
        static float time = 0.0f;
        time += 0.1f;
        m.interfaceName = "wlan_sim";
        m.ssid = "Simulated_WiFi_Network";
        m.bssid = "AA:BB:CC:DD:EE:FF";
        m.channel = 6;
        
        // Simulating walls: add some sine waves to make it fluctuate
        float signalBase = -65.0f + 25.0f * std::sin(time * 0.5f);
        // Occasionally drop signal completely to simulate concrete barrier
        if (std::sin(time * 1.5f) < -0.85f) {
            m.rssi = -95;
            m.linkQuality = 0.05f;
        } else {
            m.rssi = static_cast<int>(signalBase);
            m.linkQuality = (m.rssi + 100.0f) / 70.0f;
            m.linkQuality = std::clamp(m.linkQuality, 0.0f, 1.0f);
        }
        m.noise = -95.0f;
        return m;
    }

    std::string line;
    // Skip the first two header lines
    std::getline(file, line);
    std::getline(file, line);

    bool found = false;
    while (std::getline(file, line)) {
        size_t colonPos = line.find(':');
        if (colonPos != std::string::npos) {
            std::string iface = trim(line.substr(0, colonPos));
            std::stringstream ss(line.substr(colonPos + 1));
            
            int status;
            float link, level, noise;
            ss >> status >> link >> level >> noise;

            m.interfaceName = iface;
            m.rssi = static_cast<int>(level);
            // The level in /proc/net/wireless is usually dBm directly.
            // Sometimes it has a dot or is positive if represented differently, but usually negative dBm.
            if (m.rssi > 0) {
                m.rssi = m.rssi - 256; // Standard mapping for some drivers
            }
            // Clamp RSSI to realistic boundaries
            m.rssi = std::clamp(m.rssi, -100, -30);

            // Link quality out of 70 is standard for wireless extensions
            m.linkQuality = link / 70.0f;
            m.linkQuality = std::clamp(m.linkQuality, 0.0f, 1.0f);
            
            m.noise = noise > 0 ? noise - 256 : noise;
            found = true;
            break; // Grab the first active interface
        }
    }
    file.close();

    if (!found) {
        // Fallback simulator if file exists but empty (no card connected)
        static float time = 0.0f;
        time += 0.1f;
        m.interfaceName = "wlan_sim_empty";
        m.ssid = "Simulated_WiFi_Network";
        m.bssid = "00:11:22:33:44:55";
        m.channel = 11;
        float signalBase = -60.0f + 30.0f * std::cos(time * 0.3f);
        m.rssi = static_cast<int>(signalBase);
        m.linkQuality = (m.rssi + 100.0f) / 70.0f;
        m.linkQuality = std::clamp(m.linkQuality, 0.0f, 1.0f);
    } else {
        // Attempt to read actual SSID using standard net link or falling back to default SSID
        // To be safe and avoid permissions, we check /sys/class/net/[iface]/uevent or similar, 
        // but finding SSID programmatically on Linux requires iwlib or nl80211 which require root/caps.
        // Thus, we read standard system configs or set a placeholders, or fetch SSID from active network
        m.ssid = "Active_Linux_WiFi";
        m.bssid = "00:DE:AD:BE:EF:00";
        m.channel = 1;
    }

    return m;
}

#ifdef SYSTEM_WINDOWS
WifiMetrics WifiScanner::captureWindows() {
    WifiMetrics m;
    m.interfaceName = "Windows_Wireless";
    
    HANDLE hClient = NULL;
    DWORD dwMaxClient = 2;
    DWORD dwCurVersion = 0;
    
    if (WlanOpenHandle(dwMaxClient, NULL, &dwCurVersion, &hClient) != ERROR_SUCCESS) {
        m.ssid = "Wlan API Error";
        return m;
    }

    PWLAN_INTERFACE_INFO_LIST pIfList = NULL;
    if (WlanEnumInterfaces(hClient, NULL, &pIfList) != ERROR_SUCCESS) {
        WlanCloseHandle(hClient, NULL);
        m.ssid = "No Interfaces Found";
        return m;
    }

    bool found = false;
    for (DWORD i = 0; i < pIfList->dwNumberOfItems; ++i) {
        WLAN_INTERFACE_INFO ifInfo = pIfList->InterfaceInfo[i];
        
        // Convert Wide string Interface Description to std::string
        char desc[256] = {0};
        wcstombs(desc, ifInfo.strInterfaceDescription, sizeof(desc) - 1);
        m.interfaceName = desc;

        if (ifInfo.isState == wlan_interface_state_connected) {
            PWLAN_CONNECTION_ATTRIBUTES pConnectInfo = NULL;
            DWORD dwDataSize = 0;
            WLAN_OPCODE_VALUE_TYPE opValType;
            
            DWORD dwResult = WlanQueryInterface(
                hClient, 
                &ifInfo.InterfaceGuid, 
                wlan_intf_opcode_current_connection, 
                NULL, 
                &dwDataSize, 
                (PVOID*)&pConnectInfo, 
                &opValType
            );

            if (dwResult == ERROR_SUCCESS && pConnectInfo) {
                // Get SSID
                std::string ssidStr = "";
                if (pConnectInfo->wlanAssociationAttributes.dot11Ssid.uSSIDLength > 0) {
                    ssidStr = std::string(
                        (char*)pConnectInfo->wlanAssociationAttributes.dot11Ssid.ucSSID,
                        pConnectInfo->wlanAssociationAttributes.dot11Ssid.uSSIDLength
                    );
                }
                m.ssid = ssidStr.empty() ? "Connected" : ssidStr;

                // Get BSSID
                char bssidStr[32] = {0};
                DOT11_MAC_ADDRESS* mac = &pConnectInfo->wlanAssociationAttributes.dot11Bssid;
                snprintf(bssidStr, sizeof(bssidStr), "%02X:%02X:%02X:%02X:%02X:%02X",
                         (*mac)[0], (*mac)[1], (*mac)[2], (*mac)[3], (*mac)[4], (*mac)[5]);
                m.bssid = bssidStr;

                // Get Signal Quality
                ULONG quality = pConnectInfo->wlanAssociationAttributes.wlanSignalQuality; // 0 to 100
                m.linkQuality = quality / 100.0f;
                
                // Map link quality to standard RSSI in dBm (roughly -100 to -30)
                m.rssi = static_cast<int>(quality) / 2 - 100; // 0% -> -100dBm, 100% -> -50dBm
                
                // Set default channel (querying actual channel is complex via OIDs, fallback to common)
                m.channel = 6; 
                
                WlanFreeMemory(pConnectInfo);
                found = true;
                break;
            }
        }
    }

    if (pIfList) WlanFreeMemory(pIfList);
    WlanCloseHandle(hClient, NULL);

    if (!found) {
        m.ssid = "Disconnected";
        m.rssi = -100;
        m.linkQuality = 0.0f;
    }

    return m;
}
#else
WifiMetrics WifiScanner::captureWindows() {
    return {};
}
#endif

#ifdef SYSTEM_MACOS
WifiMetrics WifiScanner::captureMac() {
    WifiMetrics m;
    @autoreleasepool {
        CWWiFiClient *wifiClient = [CWWiFiClient sharedWiFiClient];
        CWInterface *interface = [wifiClient interface];
        if (interface) {
            m.interfaceName = [[interface interfaceName] UTF8String] ? [[interface interfaceName] UTF8String] : "en0";
            m.rssi = (int)[interface rssiValue];
            
            // Map RSSI (typically -100 to -30) to [0, 1] link quality
            float qual = (m.rssi + 100.0f) / 70.0f;
            m.linkQuality = std::clamp(qual, 0.0f, 1.0f);
            m.noise = (float)[interface noiseMeasurement];
            
            NSString *ssidName = [interface ssid];
            m.ssid = ssidName ? [ssidName UTF8String] : "Disconnected";
            
            NSString *bssidName = [interface bssid];
            m.bssid = bssidName ? [bssidName UTF8String] : "00:00:00:00:00:00";
            
            m.channel = (int)[[interface wlanChannel] channelNumber];
            if (m.channel <= 0) m.channel = 1;
        } else {
            m.ssid = "No Interface";
            m.rssi = -100;
            m.linkQuality = 0.0f;
        }
    }
    return m;
}
#else
WifiMetrics WifiScanner::captureMac() {
    return {};
}
#endif
