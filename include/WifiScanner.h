#pragma once

#include <string>
#include <thread>
#include <atomic>
#include "ThreadSafeBuffer.h"

struct WifiMetrics {
    int rssi = -100;                // Signal strength in dBm (e.g. -30 to -100)
    float linkQuality = 0.0f;       // Link Quality fraction (0.0 to 1.0)
    float noise = -100.0f;          // Noise level in dBm (if supported, else -100.0)
    int channel = 1;                // Channel number
    std::string ssid = "Unknown";   // SSID of the connected network
    std::string bssid = "00:00:00:00:00:00"; // BSSID of the router
    std::string interfaceName = "None"; // Interface name (e.g. wlan0, en0)
};

class WifiScanner {
public:
    WifiScanner();
    ~WifiScanner();

    // Disable copy
    WifiScanner(const WifiScanner&) = delete;
    WifiScanner& operator=(const WifiScanner&) = delete;

    void start(ThreadSafeBuffer<WifiMetrics>& buffer, int intervalMs = 100);
    void stop();
    bool isRunning() const;

private:
    void scanLoop();
    WifiMetrics captureMetrics();

    // Platform-specific scanning implementation methods
    WifiMetrics captureLinux();
    WifiMetrics captureWindows();
    WifiMetrics captureMac();

    std::thread m_thread;
    std::atomic<bool> m_running;
    ThreadSafeBuffer<WifiMetrics>* m_buffer = nullptr;
    int m_intervalMs = 100;
};
