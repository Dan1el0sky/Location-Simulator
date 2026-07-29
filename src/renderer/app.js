import { SpeedVarianceEngine, SimulationState } from './speedVariance.js';
import { RouteEngine } from './routeEngine.js';

class LocationSimulatorApp {
  constructor() {
    this.ws = null;
    this.map = null;
    this.routeEngine = new RouteEngine();
    this.speedEngine = new SpeedVarianceEngine();

    // Tile layers
    this.tileLayers = {};
    this.currentTileStyle = 'dark';

    // Map markers & polylines
    this.waypointMarkers = []; // Array of L.marker
    this.userMarker = null;
    this.routePolyline = null;
    
    // Multi-waypoint coordinates array [[lat, lng], [lat, lng], ...]
    this.waypoints = [];

    // Route state
    this.routeData = null; // { distanceMeters, durationSeconds, coordinates }
    this.traversedDistanceMeters = 0.0;
    this.calculatedSteps = 0;
    this.isSimulating = false;
    this.isPaused = false;
    this.loopRoute = false;
    this.animationTimer = null;
    this.lastTickTimestamp = 0;

    // UI Damping timer for readable speed display
    this.lastUiSpeedUpdate = 0;

    // Search debouncer
    this.searchDebounceTimer = null;

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
        this.updateDeviceStatus('Checking USB...', 'connected');
        this.ws.send(jsonStr({ type: 'SCAN_DEVICES' }));
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this.handleWSMessage(msg);
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] Bridge connection notice:', err);
        this.updateDeviceStatus('Ready (Simulation Mode)', 'disconnected');
      };

      this.ws.onclose = () => {
        console.warn('[WS] Bridge disconnected. Reconnecting in 3s...');
        this.updateDeviceStatus('Ready (Simulation Mode)', 'disconnected');
        setTimeout(() => this.initWebSocket(), 3000);
      };
    } catch (e) {
      console.warn('[WS] Could not establish websocket:', e);
      this.updateDeviceStatus('Ready (Simulation Mode)', 'disconnected');
    }
  }

  handleWSMessage(msg) {
    switch (msg.type) {
      case 'INIT_STATUS':
      case 'DEVICE_STATUS':
        if (msg.device && msg.device.connected) {
          this.updateDeviceStatus(`🟢 ${msg.device.name} (${msg.device.ios_version})`, 'connected');
        } else if (msg.device) {
          const statusText = msg.device.status_text || 'Ready (Simulation Mode)';
          this.updateDeviceStatus(`📱 ${statusText}`, 'disconnected');
        }
        break;

      case 'STEP_UPDATE':
        if (msg.total_steps && msg.total_steps > this.calculatedSteps) {
          this.calculatedSteps = msg.total_steps;
          this.updateStepsUI();
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
     Leaflet Map Setup & Multiple Tile Layers
     -------------------------------------------------------------------------- */
  initMap() {
    this.map = L.map('map-viewport', {
      center: [this.currentCenter.lat, this.currentCenter.lng],
      zoom: 15,
      zoomControl: false
    });

    // 1. Dark Mode Tile Layer
    this.tileLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    });

    // 2. CartoDB Voyager Detailed Street View
    this.tileLayers.voyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    });

    // 3. Esri World Imagery Satellite View
    this.tileLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 18
    });

    // Set default dark layer
    this.tileLayers.dark.addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Click map to add waypoints
    this.map.on('click', (e) => this.handleMapClick(e));

    // Prevent style switcher bar clicks from adding waypoints on the map!
    const styleBar = document.querySelector('.map-style-bar');
    if (styleBar) {
      L.DomEvent.disableClickPropagation(styleBar);
      L.DomEvent.disableScrollPropagation(styleBar);
    }
  }

  setMapStyle(styleName) {
    if (!this.tileLayers[styleName] || styleName === this.currentTileStyle) return;

    this.map.removeLayer(this.tileLayers[this.currentTileStyle]);
    this.tileLayers[styleName].addTo(this.map);
    this.currentTileStyle = styleName;

    document.querySelectorAll('.map-style-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === styleName);
    });
  }

  async fetchInitialLocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          this.map.setView([this.currentCenter.lat, this.currentCenter.lng], 15);
          this.addWaypoint(this.currentCenter.lat, this.currentCenter.lng);
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
          console.log(`[IP Geolocation] Location: ${data.city}, ${data.country_name}`);
          this.currentCenter = { lat: data.latitude, lng: data.longitude };
          this.map.setView([this.currentCenter.lat, this.currentCenter.lng], 14);
          this.addWaypoint(this.currentCenter.lat, this.currentCenter.lng);
          return;
        }
      }
    } catch (e) {
      console.warn('[IP Geolocation] Failed:', e);
    }
  }

  /* --------------------------------------------------------------------------
     Multi-Waypoint Route Management & Undo (Ctrl+Z)
     -------------------------------------------------------------------------- */
  handleMapClick(e) {
    if (this.isSimulating) return;
    const { lat, lng } = e.latlng;
    this.addWaypoint(lat, lng);
  }

  async addWaypoint(lat, lng) {
    this.waypoints.push([lat, lng]);

    const index = this.waypoints.length;
    const isStart = index === 1;
    const color = isStart ? '#10b981' : '#f43f5e';
    const label = isStart ? 'Start Point' : `Waypoint ${index - 1}`;

    const pinIcon = L.divIcon({
      className: 'custom-pin-waypoint',
      html: `<div style="background:${color}; width:20px; height:20px; border-radius:50%; border:3px solid #fff; box-shadow: 0 0 12px ${color}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:bold;">${index}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(this.map);
    marker.bindPopup(`<b>${label}</b>`);
    this.waypointMarkers.push(marker);

    if (this.waypoints.length >= 2) {
      await this.calculateAndDrawRoute();
    }
  }

  undoLastWaypoint() {
    if (this.isSimulating || this.waypoints.length === 0) return;

    // Remove last waypoint & marker
    this.waypoints.pop();
    const lastMarker = this.waypointMarkers.pop();
    if (lastMarker) this.map.removeLayer(lastMarker);

    if (this.waypoints.length >= 2) {
      this.calculateAndDrawRoute();
    } else {
      if (this.routePolyline) {
        this.map.removeLayer(this.routePolyline);
        this.routePolyline = null;
      }
      this.routeData = null;
      this.updateRouteStatsPreview();
    }
  }

  async calculateAndDrawRoute() {
    if (this.waypoints.length < 2) return;

    const profile = document.getElementById('route-profile-select').value;

    try {
      this.routeData = await this.routeEngine.getRoute(this.waypoints, profile);

      if (this.routePolyline) this.map.removeLayer(this.routePolyline);

      this.routePolyline = L.polyline(this.routeData.coordinates, {
        color: '#06b6d4',
        weight: 6,
        opacity: 0.9,
        dashArray: '8, 8'
      }).addTo(this.map);

      this.map.fitBounds(this.routePolyline.getBounds(), { padding: [40, 40] });

      this.updateRouteStatsPreview();
    } catch (e) {
      console.error('[Route] Calculation error:', e);
    }
  }

  updateRouteStatsPreview() {
    const previewBox = document.getElementById('route-stats-preview');
    if (!this.routeData) {
      if (previewBox) previewBox.style.display = 'none';
      return;
    }

    if (previewBox) previewBox.style.display = 'block';

    const distKm = (this.routeData.distanceMeters / 1000.0).toFixed(2);
    const speedKmh = this.speedEngine.targetSpeedKmh;
    const durationMin = Math.round((this.routeData.distanceMeters / 1000.0 / speedKmh) * 60);

    const elDist = document.getElementById('preview-distance');
    const elDur = document.getElementById('preview-duration');
    const elCount = document.getElementById('preview-waypoints-count');
    const elMode = document.getElementById('preview-mode');

    if (elDist) elDist.innerText = `${distKm} km`;
    if (elDur) elDur.innerText = `${durationMin} min`;
    if (elCount) elCount.innerText = `${this.waypoints.length}`;
    if (elMode) elMode.innerText = this.loopRoute ? 'Loop Active' : 'Loop Off';
  }

  reverseRoute() {
    if (this.waypoints.length < 2 || this.isSimulating) return;
    this.waypoints.reverse();
    this.redrawAllWaypoints();
    this.calculateAndDrawRoute();
  }

  clearRoute() {
    this.waypointMarkers.forEach(m => this.map.removeLayer(m));
    this.waypointMarkers = [];
    this.waypoints = [];
    if (this.userMarker) { this.map.removeLayer(this.userMarker); this.userMarker = null; }
    if (this.routePolyline) { this.map.removeLayer(this.routePolyline); this.routePolyline = null; }
    this.routeData = null;
    this.traversedDistanceMeters = 0.0;
    this.calculatedSteps = 0;
    this.updateRouteStatsPreview();
    this.updateTelemetryUI(0.0, SimulationState.STOPPED);
    this.updateStepsUI();
  }

  redrawAllWaypoints() {
    this.waypointMarkers.forEach(m => this.map.removeLayer(m));
    this.waypointMarkers = [];

    const coords = [...this.waypoints];
    this.waypoints = [];
    coords.forEach(c => this.addWaypoint(c[0], c[1]));
  }

  /* --------------------------------------------------------------------------
     Simulation Engine Loop
     -------------------------------------------------------------------------- */
  startSimulation() {
    if (!this.routeData || this.waypoints.length < 2) {
      alert('Please select at least 2 waypoints on the map to create a route first.');
      return;
    }

    this.isSimulating = true;
    this.isPaused = false;
    this.traversedDistanceMeters = 0.0;
    this.calculatedSteps = 0;
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
    this.updateStepsUI();

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
      const { speedKmh, state } = this.speedEngine.tick(deltaSec);

      const speedMs = (speedKmh * 1000.0) / 3600.0;
      const distDelta = speedMs * deltaSec;

      const prevPos = this.routeEngine.interpolatePosition(this.routeData.coordinates, this.traversedDistanceMeters);
      this.traversedDistanceMeters += distDelta;
      const currPos = this.routeEngine.interpolatePosition(this.routeData.coordinates, this.traversedDistanceMeters);

      if (distDelta > 0) {
        const stepIncrement = distDelta / 0.75;
        this.calculatedSteps += stepIncrement;
        this.updateStepsUI();
      }

      if (currPos && this.userMarker) {
        this.userMarker.setLatLng([currPos.lat, currPos.lng]);
        this.map.panTo([currPos.lat, currPos.lng], { animate: true, duration: 0.1 });

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(jsonStr({
            type: 'SET_LOCATION',
            lat: currPos.lat,
            lng: currPos.lng
          }));

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

      if (timestamp - this.lastUiSpeedUpdate > 400) {
        this.lastUiSpeedUpdate = timestamp;
        this.updateTelemetryUI(speedKmh, state);
      }

      if (this.traversedDistanceMeters >= this.routeData.distanceMeters) {
        if (this.loopRoute) {
          console.log('[Simulation] Loop Route enabled. Reversing route...');
          this.waypoints.reverse();
          this.redrawAllWaypoints();
          this.calculateAndDrawRoute().then(() => {
            this.traversedDistanceMeters = 0.0;
          });
        } else {
          console.log('[Simulation] Route completed!');
          this.stopSimulation();
          alert('🎉 Route Simulation Completed!');
          return;
        }
      }
    }

    this.animationTimer = requestAnimationFrame((ts) => this.simulationTick(ts));
  }

  updateStepsUI() {
    const stepsElement = document.getElementById('telemetry-steps');
    if (stepsElement) {
      stepsElement.innerText = `${Math.floor(this.calculatedSteps).toLocaleString()} steps`;
    }
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
     Search Autocomplete & UI Event Bindings
     -------------------------------------------------------------------------- */
  bindEvents() {
    // Ctrl+Z Undo Waypoint Keyboard Shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undoLastWaypoint();
      }
    });

    // Undo Button Handler
    const undoBtn = document.getElementById('btn-undo-waypoint');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undoLastWaypoint());
    }

    // Map Style Switcher Buttons
    document.querySelectorAll('.map-style-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const style = e.currentTarget.dataset.style;
        this.setMapStyle(style);
      });
    });

    // Speed Preset Buttons
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
        this.updateRouteStatsPreview();
      });
    });

    // Manual speed input
    const speedInput = document.getElementById('manual-speed-input');
    speedInput.addEventListener('input', (e) => {
      const speed = parseFloat(e.target.value) || 4.0;
      document.getElementById('speed-val-display').innerText = `${speed.toFixed(1)} km/h`;
      this.speedEngine.setTargetSpeed(speed);
      this.updateRouteStatsPreview();
    });

    // Route Profile Select
    document.getElementById('route-profile-select').addEventListener('change', () => {
      if (this.waypoints.length >= 2) this.calculateAndDrawRoute();
    });

    // Reverse & Clear Buttons
    document.getElementById('btn-reverse-route').addEventListener('click', () => this.reverseRoute());
    document.getElementById('btn-clear-route').addEventListener('click', () => this.clearRoute());

    // Humanizer Toggles & Sliders
    document.getElementById('speed-variance-toggle').addEventListener('change', (e) => {
      this.speedEngine.enableVariance = e.target.checked;
    });

    document.getElementById('auto-pause-toggle').addEventListener('change', (e) => {
      this.speedEngine.enableAutoPause = e.target.checked;
      const panel = document.getElementById('pause-settings-panel');
      if (panel) panel.style.display = e.target.checked ? 'block' : 'none';
    });

    document.getElementById('loop-route-toggle').addEventListener('change', (e) => {
      this.loopRoute = e.target.checked;
      this.updateRouteStatsPreview();
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

    // Search Autocomplete Input
    const searchInput = document.getElementById('search-input');
    const dropdown = document.getElementById('search-results-dropdown');

    searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounceTimer);
      const query = e.target.value.trim();

      if (query.length < 2) {
        if (dropdown) dropdown.style.display = 'none';
        return;
      }

      this.searchDebounceTimer = setTimeout(async () => {
        const results = await this.routeEngine.searchLocation(query);
        this.renderSearchResults(results);
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-input') && !e.target.closest('#search-results-dropdown')) {
        if (dropdown) dropdown.style.display = 'none';
      }
    });

    // Action Buttons
    document.getElementById('btn-start-simulation').addEventListener('click', () => this.startSimulation());
    document.getElementById('btn-pause-simulation').addEventListener('click', () => this.pauseSimulation());
    document.getElementById('btn-stop-simulation').addEventListener('click', () => this.stopSimulation());
  }

  renderSearchResults(results) {
    const dropdown = document.getElementById('search-results-dropdown');
    if (!dropdown) return;

    if (!results || results.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    dropdown.innerHTML = results.map(item => `
      <div class="search-dropdown-item" data-lat="${item.lat}" data-lng="${item.lng}">
        📍 ${item.displayName}
      </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.search-dropdown-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const lat = parseFloat(e.currentTarget.dataset.lat);
        const lng = parseFloat(e.currentTarget.dataset.lng);
        dropdown.style.display = 'none';
        document.getElementById('search-input').value = '';
        this.map.setView([lat, lng], 16);
        this.addWaypoint(lat, lng);
      });
    });
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

window.addEventListener('DOMContentLoaded', () => {
  window.app = new LocationSimulatorApp();
});
