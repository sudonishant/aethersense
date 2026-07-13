#!/usr/bin/env bash

# WiFi-Thermal-Spatial-Mapper Setup Script
# Works on Debian, Ubuntu, macOS, and Fedora

set -e

# Color helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   SUDONISHANT // SPATIAL MAPPER SYSTEM INITIALIZER   ${NC}"
echo -e "${CYAN}====================================================${NC}"

# Detect OS
OS="$(uname -s)"
echo -e "System OS detected: ${BLUE}$OS${NC}"

# Install dependencies if root/sudo is available
install_deps() {
    if [ "$OS" = "Linux" ]; then
        if [ -f /etc/debian_version ]; then
            echo -e "Installing dependencies via ${GREEN}apt${NC}..."
            sudo apt-get update -y
            sudo apt-get install -y build-essential cmake libglfw3-dev libgl1-mesa-dev nodejs npm
        elif [ -f /etc/redhat-release ]; then
            echo -e "Installing dependencies via ${GREEN}dnf${NC}..."
            sudo dnf groupinstall -y "Development Tools"
            sudo dnf install -y cmake glfw-devel mesa-libGL-devel nodejs
        elif [ -f /etc/arch-release ]; then
            echo -e "Installing dependencies via ${GREEN}pacman${NC}..."
            sudo pacman -Syu --needed --noconfirm base-devel cmake glfw-x11 mesa nodejs npm
        else
            echo -e "${RED}Unsupported Linux distribution.${NC} Please make sure you have cmake, g++, glfw3, and nodejs installed."
        fi
    elif [ "$OS" = "Darwin" ]; then
        if command -v brew >/dev/null 2>&1; then
            echo -e "Installing dependencies via ${GREEN}homebrew${NC}..."
            brew install cmake glfw node
        else
            echo -e "${RED}Homebrew not found.${NC} Please install Homebrew or manually setup cmake, glfw, and nodejs."
            exit 1
        fi
    else
        echo -e "${RED}Unsupported Operating System: $OS${NC}"
        exit 1
    fi
}

# Ask user if they want to install system dependencies
echo -n "Do you want to install system dependencies (requires sudo/root)? [y/N]: "
read -r answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
    install_deps
fi

# Step 1: Build the C++ CLI Scanner
echo -e "\n${BLUE}[1/3] Preparing C++ Spatial Scanner Daemon...${NC}"

if command -v cmake >/dev/null 2>&1; then
    if [ -d "build" ]; then
        echo "Clean build directory..."
        rm -rf build
    fi
    cmake -B build -DCMAKE_BUILD_TYPE=Release
    cmake --build build

    # Verify build
    if [ -f "build/wifi_scanner_cli" ]; then
        echo -e "${GREEN}C++ Scanner compiled successfully!${NC}"
        cp build/wifi_scanner_cli .
        cp build/wifi_scanner_cli web/
    elif [ -f "build/bin/wifi_scanner_cli" ]; then
        echo -e "${GREEN}C++ Scanner compiled successfully!${NC}"
        cp build/bin/wifi_scanner_cli .
        cp build/bin/wifi_scanner_cli web/
    else
        echo -e "${RED}Error: Compiled binary not found after build.${NC}"
        exit 1
    fi
else
    echo -e "${RED}CMake tool not found on system path.${NC}"
    if [ -f "./wifi_scanner_cli" ]; then
        echo -e "${GREEN}Found precompiled C++ binary in workspace root. Copying for local execution...${NC}"
        cp ./wifi_scanner_cli web/
    else
        echo -e "${RED}No precompiled binary found in workspace root.${NC}"
        echo -e "Please install CMake or manually place compiled 'wifi_scanner_cli' in this directory."
        exit 1
    fi
fi

# Step 2: Install Node.js Web Dashboard dependencies
echo -e "\n${BLUE}[2/3] Preparing Web Interface environment...${NC}"
cd web
npm install --no-audit --no-fund
cd ..

# Step 3: Setup Completed
echo -e "\n${GREEN}[3/3] System Setup Finished Successfully!${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "To start the application daemon and dashboard:"
echo -e "  ${BLUE}npm --prefix web start${NC}"
echo -e "Or simply run:"
echo -e "  ${BLUE}node web/server.js${NC}"
echo -e "Then navigate to: ${GREEN}http://localhost:8080${NC} in your browser."
echo -e "${CYAN}====================================================${NC}"
