import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, Navigation, AlertTriangle, Save, List, Play, Square, Settings, RefreshCw, X, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Bookmark, MapPin } from 'lucide-react';
import polyline from '@mapbox/polyline';

const WEBSOCKET_URL = 'ws://127.0.0.1:5001';

// Fix leaflet icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const customIcon = L.divIcon({
  className: 'custom-marker',
  iconSize: [20, 20],
});

interface SavedLocation {
  lat: number;
  lng: number;
  name: string;
}

export default function App() {
  const [position, setPosition] = useState<[number, number]>([40.7128, -74.0060]);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceName, setDeviceName] = useState('Checking connection...');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Teleport Warning Modal
  const [pendingTeleport, setPendingTeleport] = useState<[number, number] | null>(null);

  // Saved Locations
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [showSavedList, setShowSavedList] = useState(false);

  // Movement Settings
  const [speed, setSpeed] = useState(15); // km/h
  const [isLooping, setIsLooping] = useState(false);

  // Map zoom override trigger
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  // Routing State
  const [routeWaypoints, setRouteWaypoints] = useState<[number, number][]>([]);
  const [routeLine, setRouteLine] = useState<[number, number][]>([]);
  const [redoStack, setRedoStack] = useState<[number, number][]>([]);
  const [isSimulatingRoute, setIsSimulatingRoute] = useState(false);
  const routeIntervalRef = useRef<number | null>(null);
  const currentRouteIndex = useRef(0);

  // Socket
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Load Saved Locations from Electron main process
    if (window.electronAPI) {
       window.electronAPI.readSavedLocations().then((data) => {
          setSavedLocations(data || []);
       });
    }

    const connectWs = () => {
      const ws = new WebSocket(WEBSOCKET_URL);
      ws.onopen = () => console.log("Connected to Python backend");
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'DEVICE_STATUS' || data.type === 'INIT_STATUS') {
            if (data.device) {
              setDeviceConnected(data.device.connected);
              setDeviceName(data.device.name || 'No device');
            }
          }
          if (data.type === 'PHONE_LOCATION' && !isSimulatingRoute) {
             setPosition([data.lat, data.lng]);
          }
        } catch (e) {}
      };
      ws.onclose = () => setTimeout(connectWs, 2000);
      wsRef.current = ws;
    };

    connectWs();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [isSimulatingRoute]);

  const setBackendLocation = useCallback((lat: number, lng: number) => {
     if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
         wsRef.current.send(JSON.stringify({ type: "SET_LOCATION", lat, lng }));
     }
     setPosition([lat, lng]);
  }, []);

  const undoPoint = useCallback(() => {
    if (isSimulatingRoute || routeWaypoints.length === 0) return;
    const newWaypoints = [...routeWaypoints];
    const popped = newWaypoints.pop();
    if (popped) {
      setRouteWaypoints(newWaypoints);
      setRedoStack(prev => [...prev, popped]);
      setRouteLine([]);
    }
  }, [isSimulatingRoute, routeWaypoints]);

  const redoPoint = useCallback(() => {
    if (isSimulatingRoute || redoStack.length === 0) return;
    const newRedo = [...redoStack];
    const popped = newRedo.pop();
    if (popped) {
      setRedoStack(newRedo);
      setRouteWaypoints(prev => [...prev, popped]);
      setRouteLine([]);
    }
  }, [isSimulatingRoute, redoStack]);

  useEffect(() => {
    const handleUndoRedoKeys = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (window.getSelection()?.toString()) return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta) {
        if (e.key.toLowerCase() === 'c') {
          e.preventDefault();
          undoPoint();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          redoPoint();
        }
      }
    };
    window.addEventListener('keydown', handleUndoRedoKeys);
    return () => window.removeEventListener('keydown', handleUndoRedoKeys);
  }, [undoPoint, redoPoint]);

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(await res.json());
    } catch (error) {}
  };

  const selectSearchResult = (result: any) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    if (getDistance(position[0], position[1], lat, lon) > 10) {
       setPendingTeleport([lat, lon]);
    } else {
       setBackendLocation(lat, lon);
       setMapCenter([lat, lon]);
    }
    setSearchResults([]);
    setSearchQuery('');
  };

  const confirmTeleport = () => {
    if (pendingTeleport) {
       setBackendLocation(pendingTeleport[0], pendingTeleport[1]);
       setMapCenter([pendingTeleport[0], pendingTeleport[1]]);
       setPendingTeleport(null);
    }
  };

  const saveCurrentLocation = async () => {
     if (window.electronAPI) {
        const name = prompt("Enter a name for this location:") || `Location ${Date.now().toString().slice(-4)}`;
        const newData = await window.electronAPI.saveLocation({ lat: position[0], lng: position[1], name });
        if (newData) setSavedLocations(newData);
     }
  };

  // WASD Movement
  useEffect(() => {
    if (isSimulatingRoute) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      const offset = 0.0001 * (speed / 15);
      let newLat = position[0];
      let newLng = position[1];
      switch(e.key.toLowerCase()) {
         case 'w': newLat += offset; break;
         case 's': newLat -= offset; break;
         case 'a': newLng -= offset; break;
         case 'd': newLng += offset; break;
         default: return;
      }
      setBackendLocation(newLat, newLng);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [position, speed, setBackendLocation, isSimulatingRoute]);

  const moveManual = (dir: 'N'|'S'|'E'|'W') => {
      if (isSimulatingRoute) return;
      const offset = 0.0001 * (speed / 15);
      let newLat = position[0];
      let newLng = position[1];
      if(dir === 'N') newLat += offset;
      if(dir === 'S') newLat -= offset;
      if(dir === 'E') newLng += offset;
      if(dir === 'W') newLng -= offset;
      setBackendLocation(newLat, newLng);
  };

  // Routing Logic
  const handleMapClick = (lat: number, lng: number) => {
    if (isSimulatingRoute) return;
    setRouteWaypoints(prev => [...prev, [lat, lng]]);
    setRedoStack([]);
  };

  const generateRoute = async () => {
    if (routeWaypoints.length < 2) return;
    const coords = routeWaypoints.map(wp => `${wp[1]},${wp[0]}`).join(';');
    try {
      const res = await fetch(`http://router.project-osrm.org/route/v1/driving/${coords}?overview=full`);
      const data = await res.json();
      if (data.routes && data.routes[0]) {
        const decoded = polyline.decode(data.routes[0].geometry);
        setRouteLine(decoded as [number, number][]);
      }
    } catch (e) {
      console.error("OSRM Route Error", e);
    }
  };

  const startRouteSimulation = () => {
    if (routeLine.length === 0) return;
    setIsSimulatingRoute(true);
    currentRouteIndex.current = 0;

    const tickRateMs = 1000;

    routeIntervalRef.current = window.setInterval(() => {
      if (currentRouteIndex.current >= routeLine.length - 1) {
        if (isLooping) {
           currentRouteIndex.current = 0;
        } else {
           stopRouteSimulation();
           return;
        }
      }

      const p1 = routeLine[currentRouteIndex.current];
      const p2 = routeLine[currentRouteIndex.current + 1];

      // Interpolate based on speed (simple linear interpolation for demo)
      // distance in km
      const dist = getDistance(p1[0], p1[1], p2[0], p2[1]);
      const speedKmS = speed / 3600;

      // if point is close enough based on speed, just jump to it
      if (dist < speedKmS) {
         currentRouteIndex.current++;
         setBackendLocation(p2[0], p2[1]);
      } else {
         // Interpolate point
         const ratio = speedKmS / dist;
         const newLat = p1[0] + (p2[0] - p1[0]) * ratio;
         const newLng = p1[1] + (p2[1] - p1[1]) * ratio;

         // Update line array to represent current position for next tick
         routeLine[currentRouteIndex.current] = [newLat, newLng];
         setBackendLocation(newLat, newLng);
      }

    }, tickRateMs);
  };

  const stopRouteSimulation = () => {
    setIsSimulatingRoute(false);
    if (routeIntervalRef.current) clearInterval(routeIntervalRef.current);
    routeIntervalRef.current = null;
  };

  const clearRoute = () => {
    stopRouteSimulation();
    setRouteWaypoints([]);
    setRouteLine([]);
    setRedoStack([]);
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">

      {/* Top Bar - Status & Search */}
      <div className="absolute top-4 left-4 right-4 z-[1000] flex justify-between items-start pointer-events-none">

        {/* Status Panel */}
        <div className="bg-gray-800/95 backdrop-blur-md p-4 rounded-xl shadow-lg border border-gray-700 pointer-events-auto w-72">
          <h1 className="text-xl font-bold mb-2 flex items-center gap-2">
            <Navigation className="text-blue-400" size={24} />
            Location Sim
          </h1>

          <div className="flex items-center gap-2 text-sm mt-3">
            <div className={`w-3 h-3 rounded-full ${deviceConnected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`}></div>
            <span className="font-mono truncate">{deviceName}</span>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between items-center">
             <div>
               <div className="text-xs text-gray-400 mb-1">Current Coordinates</div>
               <div className="font-mono text-sm">{position[0].toFixed(5)}, {position[1].toFixed(5)}</div>
             </div>
             <button onClick={saveCurrentLocation} className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-blue-400 transition" title="Save Location">
               <Bookmark size={18} />
             </button>
          </div>
        </div>

        {/* Search Bar & Toolbar */}
        <div className="flex flex-col gap-2 w-80 pointer-events-auto relative">
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text" placeholder="Search locations..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-800/95 backdrop-blur-md border border-gray-700 text-white rounded-xl px-4 py-3 pl-11 shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search className="absolute left-3 top-3.5 text-gray-400" size={18} />
          </form>
          {searchResults.length > 0 && (
            <div className="absolute top-14 left-0 right-0 bg-gray-800/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-xl max-h-60 overflow-y-auto z-[1001]">
              {searchResults.map((res, i) => (
                <div key={i} className="p-3 hover:bg-gray-700 cursor-pointer border-b border-gray-700/50 text-sm truncate" onClick={() => selectSearchResult(res)}>
                  {res.display_name}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end mt-2">
             <button onClick={() => setShowSavedList(!showSavedList)} className="bg-gray-800/90 border border-gray-700 p-2 rounded-lg hover:bg-gray-700 transition flex items-center gap-2">
                <List size={18} /> Saved
             </button>
          </div>
          {/* Saved Locations List */}
          {showSavedList && (
            <div className="absolute top-24 right-0 w-80 bg-gray-800/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-xl max-h-80 overflow-y-auto z-[1001] p-2">
              <h3 className="font-bold mb-2 text-sm text-gray-400 px-2">Saved Locations</h3>
              {savedLocations.map((loc, i) => (
                 <div key={i} className="flex justify-between items-center p-2 hover:bg-gray-700 rounded-lg group cursor-pointer" onClick={() => {
                     if (getDistance(position[0], position[1], loc.lat, loc.lng) > 10) setPendingTeleport([loc.lat, loc.lng]);
                     else { setBackendLocation(loc.lat, loc.lng); setMapCenter([loc.lat, loc.lng]); }
                     setShowSavedList(false);
                 }}>
                    <div className="truncate text-sm flex-1">{loc.name}</div>
                    <button onClick={(e) => { e.stopPropagation(); window.electronAPI?.deleteLocation(loc).then(setSavedLocations); }} className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300">
                       <X size={14} />
                    </button>
                 </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Movement & Routing Controls Panel */}
      <div className="absolute bottom-6 left-6 z-[1000] bg-gray-800/95 backdrop-blur-md p-4 rounded-xl shadow-lg border border-gray-700 pointer-events-auto flex gap-6 items-center flex-wrap max-w-2xl">
         {/* Speed */}
         <div className="flex flex-col gap-2">
            <span className="text-xs text-gray-400 font-bold uppercase">Movement Speed</span>
            <div className="flex items-center gap-3">
               <input type="range" min="1" max="100" value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-24 accent-blue-500" />
               <span className="font-mono text-sm w-12">{speed} km/h</span>
            </div>
         </div>
         <div className="h-10 w-px bg-gray-700"></div>

         {/* Route Tools */}
         <div className="flex flex-col gap-2 flex-1">
            <div className="flex justify-between items-center w-full">
               <span className="text-xs text-gray-400 font-bold uppercase">Routing (Click map to add points)</span>
               <span className="text-xs font-mono text-blue-400">{routeWaypoints.length} points</span>
            </div>
            <div className="flex items-center gap-2">
               <button onClick={generateRoute} disabled={routeWaypoints.length < 2 || isSimulatingRoute} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition">
                  Calculate Route
               </button>
               {!isSimulatingRoute ? (
                  <button onClick={startRouteSimulation} disabled={routeLine.length === 0} className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-medium flex items-center gap-1 transition">
                     <Play size={14}/> Start
                  </button>
               ) : (
                  <button onClick={stopRouteSimulation} className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 rounded text-sm font-medium flex items-center gap-1 transition">
                     <Square size={14}/> Pause
                  </button>
               )}
               <button onClick={clearRoute} className="px-3 py-1 bg-red-600/80 hover:bg-red-500 disabled:opacity-50 rounded text-sm font-medium transition">Clear</button>

               <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold ml-4">
                 <input type="checkbox" checked={isLooping} onChange={e => setIsLooping(e.target.checked)} className="rounded border-gray-600 bg-gray-700 text-blue-500" />
                 Loop
               </label>
            </div>
         </div>
      </div>

      {/* Joystick */}
      <div className="absolute bottom-6 right-6 z-[1000] pointer-events-auto flex flex-col items-center gap-1">
         <div className="text-xs text-gray-500 mb-1 font-bold">WASD / Controls</div>
         <button className="bg-gray-800/80 hover:bg-gray-700 border border-gray-600 p-3 rounded-lg" onMouseDown={() => moveManual('N')}><ArrowUp size={20}/></button>
         <div className="flex gap-1">
            <button className="bg-gray-800/80 hover:bg-gray-700 border border-gray-600 p-3 rounded-lg" onMouseDown={() => moveManual('W')}><ArrowLeft size={20}/></button>
            <button className="bg-gray-800/80 hover:bg-gray-700 border border-gray-600 p-3 rounded-lg" onMouseDown={() => moveManual('S')}><ArrowDown size={20}/></button>
            <button className="bg-gray-800/80 hover:bg-gray-700 border border-gray-600 p-3 rounded-lg" onMouseDown={() => moveManual('E')}><ArrowRight size={20}/></button>
         </div>
      </div>

      {pendingTeleport && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center pointer-events-auto">
           <div className="bg-gray-800 p-6 rounded-xl border border-red-500/50 shadow-2xl max-w-sm">
              <div className="flex items-center gap-3 text-red-400 mb-4">
                 <AlertTriangle size={28} />
                 <h2 className="text-xl font-bold text-white">Teleport Warning</h2>
              </div>
              <p className="text-gray-300 text-sm mb-6">You are about to teleport a long distance. Rapidly changing locations can trigger soft-bans. Continue?</p>
              <div className="flex justify-end gap-3">
                 <button onClick={() => setPendingTeleport(null)} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium">Cancel</button>
                 <button onClick={confirmTeleport} className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium">Teleport</button>
              </div>
           </div>
        </div>
      )}

      {/* Map Layer */}
      <MapContainer center={position} zoom={16} zoomControl={false} className="w-full h-full">
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles"
        />
        <MapEvents onClick={handleMapClick} />
        <MapController position={position} mapCenter={mapCenter} />

        {routeWaypoints.map((wp, i) => (
           <Marker key={i} position={wp} />
        ))}
        {routeLine.length > 0 && <Polyline positions={routeLine} color="#3b82f6" weight={4} opacity={0.7} />}

        <Marker position={position} icon={customIcon} />
      </MapContainer>

      <style>{`.map-tiles { filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7); }`}</style>
    </div>
  );
}

function MapEvents({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapController({ position, mapCenter }: { position: [number, number], mapCenter: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (mapCenter) map.setView(mapCenter, map.getZoom(), { animate: true }); }, [mapCenter, map]);
  useEffect(() => {
     if (!map.getBounds().contains(L.latLng(position[0], position[1]))) {
         map.panTo(position, { animate: true });
     }
  }, [position, map]);
  return null;
}
