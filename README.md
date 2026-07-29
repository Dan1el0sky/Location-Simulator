# Location Simulator (v1.0.0)

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6.svg)
![iOS](https://img.shields.io/badge/iOS-12%20--%2026.x-black.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A premium Windows desktop application for spoofing and simulating GPS locations on iOS devices connected via USB cable. Specifically tailored for location-based mobile applications and AR games like **Pokémon GO**, **Pikmin Bloom**, and **Monster Hunter Now**.

---

## 🌟 Key Features

- 🗺️ **Interactive Modern Map UI**:
  - Dark mode glassmorphic interface with Leaflet.js tiles.
  - Automatic IP Geolocation estimation fallback if Windows location services are disabled.
  - Click-to-set Start and End points with Open Source Routing Machine (OSRM) polyline calculation.

- 🚗 🚶 **Realistic Routing & Speed Modes**:
  - Foot profile (Walking / Running) & Car profile (Driving).
  - Presets: Walking (4 km/h), Running (9 km/h), Cycling (15 km/h), Driving (45 km/h).
  - Custom speed input in km/h.

- 🎲 **Humanized Movement Engine**:
  - **Dynamic Speed Variance**: Fluctuates speed organically (e.g. ±20%) during the trip instead of moving at a robotic constant rate.
  - **Customizable Random Pauses**: Automatically decelerates smoothly to 0 km/h, stops for a customizable duration (e.g., 5 seconds), and resumes walking to mimic real human behavior.
  - **Pause & Resume**: Manual full-control pause/resume at any instant.

- 👟 **Real-Time Step Counter Emulation**:
  - Calculates step metrics based on actual distance traversed and stride length (~0.75m per step).
  - Displays real-time step count matching Pokémon GO Adventure Sync and Pikmin Bloom step tracking algorithms.

- 📱 **iOS Compatibility**:
  - Supports iOS 12 through **iOS 26.x** via standard `usbmuxd` and modern RemoteXPC / RSD `pymobiledevice3` protocols over USB.

---

## 🚀 Getting Started

### Prerequisites

1. **Windows 10 / 11**
2. **iTunes or Apple Mobile Device Support** installed on your PC (provides USB `usbmuxd` drivers).
3. **Node.js** (v18+) and **Python** (3.10+).
4. **Developer Mode** enabled on your iOS device (iOS 16+):
   - `Settings > Privacy & Security > Developer Mode` (Turn ON and restart phone).

### Installation

```bash
# Clone repository
git clone https://github.com/Dan1el0sky/Location-Simulator.git
cd Location-Simulator

# Install Node dependencies
npm install

# Install Python backend dependencies
pip install -r src/backend/requirements.txt
```

### Running the Application

```bash
# Start in development mode
npm run dev
```

---

## 📖 Architecture & Implementation Plan

For technical architecture details, project breakdown, and implementation plan, see [docs/implementation_plan.md](docs/implementation_plan.md).

---

## 📄 License

MIT License © 2026 Dan1el0sky
