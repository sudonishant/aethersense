#include <iostream>
#include <csignal>
#include <atomic>
#include <chrono>
#include <thread>
#include "ThreadSafeBuffer.h"
#include "WifiScanner.h"

std::atomic<bool> keep_running(true);

void handle_signal(int signal) {
    if (signal == SIGINT || signal == SIGTERM) {
        keep_running = false;
    }
}

// Escape JSON strings to prevent syntax errors
std::string json_escape(const std::string& input) {
    std::string output = "";
    for (char c : input) {
        switch (c) {
            case '"':  output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\b': output += "\\b";  break;
            case '\f': output += "\\f";  break;
            case '\n': output += "\\n";  break;
            case '\r': output += "\\r";  break;
            case '\t': output += "\\t";  break;
            default:
                if (c >= 0 && c <= 31) {
                    // Control characters
                } else {
                    output += c;
                }
        }
    }
    return output;
}

int main() {
    // Setup signal hooks
    std::signal(SIGINT, handle_signal);
    std::signal(SIGTERM, handle_signal);

    // Disable stdout buffering for real-time IPC stream
    std::cout << std::unitbuf;

    ThreadSafeBuffer<WifiMetrics> wifiBuffer;
    WifiScanner scanner;

    scanner.start(wifiBuffer, 50);

    // Wait briefly for the scanner to populate the first value
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    while (keep_running) {
        WifiMetrics m;
        if (wifiBuffer.get_latest(m)) {
            // Write JSON line directly to stdout
            std::cout << "{"
                      << "\"rssi\":" << m.rssi << ","
                      << "\"linkQuality\":" << m.linkQuality << ","
                      << "\"noise\":" << m.noise << ","
                      << "\"channel\":" << m.channel << ","
                      << "\"ssid\":\"" << json_escape(m.ssid) << "\","
                      << "\"bssid\":\"" << json_escape(m.bssid) << "\","
                      << "\"interfaceName\":\"" << json_escape(m.interfaceName) << "\""
                      << "}" << std::endl;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    scanner.stop();
    return 0;
}
