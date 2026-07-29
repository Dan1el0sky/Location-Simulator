import { SpeedVarianceEngine, SimulationState } from './speedVariance.js';
import { RouteEngine } from './routeEngine.js';

class LocationSimulatorApp {
  constructor() {
    this.ws = null;
    this.map = null;
    this.routeEngine = new RouteEngine();
    this.speedEngine = new SpeedVarianceEngine();

    // Map markers & polylines
    this.startMarker = null;
    this.endMarker = null;
    this.userMarker = null;
    this.routePolyline = null;
    
    // Route state
    this.routeData = null; // { distanceMeters, durationSeconds, coordinates }
    this.traversedDistanceMeters = 0.0;
    this.isSimulating = false;
    this.isPaused = false;
    this.animationTimer = null;
    this.lastTickTimestamp = 0;

    // Default map center (London fallback before IP location fetch)
    this.currentCenter = { lat: 51.505, lng: -0.09 };

    this.init();
  }

  async init() {
    console.log('[App] Initializing Location Simulator v1.0.0...');
    
    this.initMap();
    this.initWebSocket();
    this.bindEvents();
    await this.fetchInitialLocation();
  }

  /* --------------------------------------------------------------------------
     WebSocket Communication with Python Sidecar Bridge
     -------------------------------------------------------------------------- */
  initWebSocket() {
    try {
      this.ws = new WebSocket('ws://127.0.0.1:8765');

      this.ws.onopen = () => {
        console.log('[WS] Connected to Python iOS bridge server.');
        this.updateDeviceStatus('Connected to Bridge', 'connected');
        // Request device scan
        this.ws.send(jsonStr({ type: 'SCAN_DEVICES' }));
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this.handleWSMessage(msg);
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] Bridge connection error:', err);
        this.updateDeviceStatus('Simulation Mode (No Bridge)', 'disconnected');
      };

      this.ws.onclose = () => {
        console.warn('[WS] Bridge disconnected. Reconnecting in 3s...');
        this.updateDeviceStatus('Disconnected', 'disconnected');
        setTimeout(() => this.initWebSocket(), 3000);
      };
    } catch (e) {
      console.warn('[WS] Could not establish websocket:', e);
      this.updateDeviceStatus('Simulation Mode', 'disconnected');
    }
  }

  handleWSMessage(msg) {
    switch (msg.type) {
      case 'INIT_STATUS':
      case 'DEVICE_STATUS':
        if (msg.device && msg.device.connected) {
          this.updateDeviceStatus(`🟢 ${msg.device.name} (${msg.device.ios_version})`, 'connected');
        } else if (msg.device) {
          this.updateDeviceStatus(`📱 ${msg.device.name}`, 'disconnected');
        }
        break;

      case 'STEP_UPDATE':
        const stepsElement = document.getElementById('telemetry-steps');
        if (stepsElement) {
          stepsElement.innerText = `${msg.total_steps.toLocaleString()} steps`;
        }
        break;
    }
  }

  updateDeviceStatus(text, stateClass) {
    const textEl = document.getElementById('device-status-text');
    const dotEl = document.getElementById('status-indicator-dot');
    if (textEl) textEl.innerText = text;
    if (dotEl) {
      dotEl.className = 'status-dot';
      if (stateClass === 'connected') dotEl.classList.add('connected');
      if (stateClass === 'simulating') dotEl.classList.add('simulating');
    }
  }

  /* --------------------------------------------------------------------------
     Leaflet Map Setup & IP Geolocation Fallback
     -------------------------------------------------------------------------- */
  initMap() {
    this.map = L.map('map-viewport', {
      center: [this.currentCenter.lat, this.currentCenter.lng],
      zoom: 15,
      zoomControl: false
    });

    // Custom dark mode tiles (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Click to add Start / End markers
    this.map.on('click', (e) => this.handleMapClick(e));
  }

  async fetchInitialLocation() {
    // 1. Try Browser Geolocation API
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          this.map.setView([this.currentCenter.lat, this.currentCenter.lng], 15);
          this.setStartMarker(this.currentCenter.lat, this.currentCenter.lng);
        },
        async () => {
          console.log('[Geolocation] Denied/Disabled. Falling back to IP Geolocation...');
          await this.fetchIPLocation();
        },
        { timeout: 5000 }
      );
    } else {
      await this.fetchIPLocation();
    }
  }

  async fetchIPLocation() {
    try {
      const res = await fetch('https://ipapi.co/json/');
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          console.log(`[IP Geolocation] Estimated location: ${data.city}, ${data.country_name}`);
          this.currentCenter = { lat: data.latitude, lng: data.longitude };
          this.map.setView([this.currentCenter.lat, this.currentCenter.lng], 14);
          this.setStartMarker(this.currentCenter.lat, this.currentCenter.lng);
          return;
        }
      }
    } catch (e) {
      console.warn('[IP Geolocation] Failed:', e);
    }
  }

  /* --------------------------------------------------------------------------
     Marker & Route Management
     -------------------------------------------------------------------------- */
  handleMapClick(e) {
    if (this.isSimulating) return;

    const { lat, lng } = e.latlng;

    if (!this.startMarker) {
      this.setStartMarker(lat, lng);
    } else if (!this.endMarker) {
      this.setEndMarker(lat, lng);
      this.calculateAndDrawRoute();
    } else {
      // Reset & set new start
      this.clearRoute();
      this.setStartMarker(lat, lng);
    }
  }

  setStartMarker(lat, lng) {
    if (this.startMarker) this.map.removeLayer(this.startMarker);
    const startIcon = L.divIcon({
      className: 'custom-pin-start',
      html: '<div style="background:#10b981; width:16px; height:16px; border-radius:50%; border:3px solid #fff; box-shadow: 0 0 10px #10b981;"></div>',
      iconSize: [16, 16]
    });
    this.startMarker = L.marker([lat, lng], { icon: startIcon }).addTo(this.map);
    this.startMarker.bindPopup('<b>Start Point</b>').openPopup();
  }

  setEndMarker(lat, lng) {
    if (this.endMarker) this.map.removeLayer(this.endMarker);
    const endIcon = L.divIcon({
      className: 'custom-pin-end',
      html: '<div style="background:#f43f5e; width:16px; height:16px; border-radius:50%; border:3px solid #fff; box-shadow: 0 0 10px #f43f5e;"></div>',
      iconSize: [16, 16]
    });
    this.endMarker = L.marker([lat, lng], { icon: endIcon }).addTo(this.map);
    this.endMarker.bindPopup('<b>End Point</b>').openPopup();
  }

  async calculateAndDrawRoute() {
    if (!this.startMarker || !this.endMarker) return;

    const start = this.startMarker.getLatLng();
    const end = this.endMarker.getLatLng();
    const profile = document.getElementById('route-profile-select').value;

    try {
      this.routeData = await this.routeEngine.getRoute([
        [start.lat, start.lng],
        [end.lat, end.lng]
      ], profile);

      if (this.routePolyline) this.map.removeLayer(this.routePolyline);

      this.routePolyline = L.polyline(this.routeData.coordinates, {
        color: '#06b6d4',
        weight: 5,
        opacity: 0.8,
        dashArray: '10, 10'
      }).addTo(this.map);

      this.map.fitBounds(this.routePolyline.getBounds(), { padding: [40, 40] });

      console.log(`[Route] Found path distance: ${(this.routeData.distanceMeters / 1000).toFixed(2)} km`);
    } catch (e) {
      alert(`Route Calculation Error: ${e.message}`);
    }
  }

  clearRoute() {
    if (this.startMarker) { this.map.removeLayer(this.startMarker); this.startMarker = null; }
    if (this.endMarker) { this.map.removeLayer(this.endMarker); this.endMarker = null; }
    if (this.userMarker) { this.map.removeLayer(this.userMarker); this.userMarker = null; }
    if (this.routePolyline) { this.map.removeLayer(this.routePolyline); this.routePolyline = null; }
    this.routeData = null;
    this.traversedDistanceMeters = 0.0;
  }

  /* --------------------------------------------------------------------------
     Simulation Engine Loop
     -------------------------------------------------------------------------- */
  startSimulation() {
    if (!this.routeData) {
      alert('Please select both a Start and End point on the map to create a route first.');
      return;
    }

    this.isSimulating = true;
    this.isPaused = false;
    this.traversedDistanceMeters = 0.0;
    this.speedEngine.start();

    // Spawn animated user position pin
    if (this.userMarker) this.map.removeLayer(this.userMarker);
    const pulseIcon = L.divIcon({
      className: 'user-pulse-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    const startCoord = this.routeData.coordinates[0];
    this.userMarker = L.marker([startCoord[0], startCoord[1]], { icon: pulseIcon }).addTo(this.map);

    this.updateDeviceStatus('Spoofing Active', 'simulating');
    this.updateControlsUI();

    // Reset step counter in Python
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(jsonStr({ type: 'RESET_STEP_MATH' }));
    }

    this.lastTickTimestamp = performance.now();
    this.animationTimer = requestAnimationFrame((ts) => this.simulationTick(ts));
  }

  simulationTick(timestamp) {
    if (!this.isSimulating) return;

    const deltaSec = Math.min((timestamp - this.lastTickTimestamp) / 1000.0, 0.5);
    this.lastTickTimestamp = timestamp;

    if (!this.isPaused) {
      // 1. Tick speed engine to get current speed (km/h) accounting for variance & auto pause
      const { speedKmh, state } = this.speedEngine.tick(deltaSec);

      // 2. Convert speed (km/h) to meters traversed in deltaSec
      const speedMs = (speedKmh * 1000.0) / 3600.0;
      const distDelta = speedMs * deltaSec;

      const prevPos = this.routeEngine.interpolatePosition(this.routeData.coordinates, this.traversedDistanceMeters);
      this.traversedDistanceMeters += distDelta;
      const currPos = this.routeEngine.interpolatePosition(this.routeData.coordinates, this.traversedDistanceMeters);

      // 3. Update map marker
      if (currPos && this.userMarker) {
        this.userMarker.setLatLng([currPos.lat, currPos.lng]);
        this.map.panTo([currPos.lat, currPos.lng], { animate: true, duration: 0.2 });

        // Push position update to iOS USB backend
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(jsonStr({
            type: 'SET_LOCATION',
            lat: currPos.lat,
            lng: currPos.lng
          }));

          // Send step math update
          if (prevPos) {
            this.ws.send(jsonStr({
              type: 'UPDATE_STEP_MATH',
              prev_lat: prevPos.lat,
              prev_lng: prevPos.lng,
              curr_lat: currPos.lat,
              curr_lng: currPos.lng
            }));
          }
        }
      }

      // 4. Update Telemetry UI
      this.updateTelemetryUI(speedKmh, state);

      // Check route completion
      if (this.traversedDistanceMeters >= this.routeData.distanceMeters) {
        console.log('[Simulation] Route completed!');
        this.stopSimulation();
        alert('🎉 Route Simulation Completed!');
        return;
      }
    }

    this.animationTimer = requestAnimationFrame((ts) => this.simulationTick(ts));
  }

  pauseSimulation() {
    this.isPaused = !this.isPaused;
    const btn = document.getElementById('btn-pause-simulation');
    if (btn) {
      btn.innerHTML = this.isPaused ? '<span>▶</span> <span>Resume</span>' : '<span>⏸</span> <span>Pause</span>';
    }
  }

  stopSimulation() {
    this.isSimulating = false;
    this.isPaused = false;
    this.speedEngine.stop();
    if (this.animationTimer) cancelAnimationFrame(this.animationTimer);

    this.updateDeviceStatus('Connected to Bridge', 'connected');
    this.updateControlsUI();
    this.updateTelemetryUI(0.0, SimulationState.STOPPED);
  }

  /* --------------------------------------------------------------------------
     UI Bindings & Event Listeners
     -------------------------------------------------------------------------- */
  bindEvents() {
    // Preset speed buttons
    const presetBtns = document.querySelectorAll('.preset-btn');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        presetBtns.forEach(b => b.classList.remove('active'));
        const targetBtn = e.currentTarget;
        targetBtn.classList.add('active');
        const speed = parseFloat(targetBtn.dataset.speed);
        document.getElementById('manual-speed-input').value = speed;
        document.getElementById('speed-val-display').innerText = `${speed.toFixed(1)} km/h`;
        this.speedEngine.setTargetSpeed(speed);
      });
    });

    // Manual speed input
    const speedInput = document.getElementById('manual-speed-input');
    speedInput.addEventListener('input', (e) => {
      const speed = parseFloat(e.target.value) || 4.0;
      document.getElementById('speed-val-display').innerText = `${speed.toFixed(1)} km/h`;
      this.speedEngine.setTargetSpeed(speed);
    });

    // Humanizer Toggles & Sliders
    document.getElementById('speed-variance-toggle').addEventListener('change', (e) => {
      this.speedEngine.enableVariance = e.target.checked;
    });

    document.getElementById('auto-pause-toggle').addEventListener('change', (e) => {
      this.speedEngine.enableAutoPause = e.target.checked;
      const panel = document.getElementById('pause-settings-panel');
      if (panel) panel.style.display = e.target.checked ? 'block' : 'none';
    });

    document.getElementById('pause-interval-slider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      this.speedEngine.minPauseIntervalSec = val;
      this.speedEngine.maxPauseIntervalSec = val + 30;
      document.getElementById('pause-interval-val').innerText = `${Math.round(val/60)} - ${Math.round((val+30)/60)} min`;
    });

    document.getElementById('stop-duration-slider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      this.speedEngine.stopDurationSec = val;
      document.getElementById('stop-duration-val').innerText = `${val} sec`;
    });

    // Search bar input
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
          const results = await this.routeEngine.searchLocation(query);
          if (results.length > 0) {
            const loc = results[0];
            this.map.setView([loc.lat, loc.lng], 15);
            this.setStartMarker(loc.lat, loc.lng);
          } else {
            alert('Location not found.');
          }
        }
      }
    });

    // Action Buttons
    document.getElementById('btn-start-simulation').addEventListener('click', () => this.startSimulation());
    document.getElementById('btn-pause-simulation').addEventListener('click', () => this.pauseSimulation());
    document.getElementById('btn-stop-simulation').addEventListener('click', () => this.stopSimulation());
  }

  updateControlsUI() {
    const btnStart = document.getElementById('btn-start-simulation');
    const btnPause = document.getElementById('btn-pause-simulation');
    const btnStop = document.getElementById('btn-stop-simulation');

    if (this.isSimulating) {
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
    } else {
      btnStart.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      btnPause.innerHTML = '<span>⏸</span> <span>Pause</span>';
    }
  }

  updateTelemetryUI(speedKmh, state) {
    const elSpeed = document.getElementById('telemetry-speed');
    const elDist = document.getElementById('telemetry-distance');

    if (elSpeed) {
      const stateLabel = state === SimulationState.PAUSED ? ' (PAUSED)' : state === SimulationState.DECELERATING ? ' (SLOWING)' : '';
      elSpeed.innerText = `${speedKmh.toFixed(1)} km/h${stateLabel}`;
    }
    if (elDist) {
      elDist.innerText = `${(this.traversedDistanceMeters / 1000.0).toFixed(2)} km`;
    }
  }
}

function jsonStr(obj) {
  return JSON.stringify(obj);
}

// Instantiate App when DOM loads
window.addEventListener('DOMContentLoaded', () => {
  window.app = new LocationSimulatorApp();
});
