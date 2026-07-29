/**
 * OSRM Multi-Waypoint Route Generator, Geocoder & POI Search Engine for Location Simulator v1.0.0
 */

export class RouteEngine {
  constructor() {
    this.osrmBaseUrl = 'https://router.project-osrm.org/route/v1';
    this.nominatimUrl = 'https://nominatim.openstreetmap.org';
    this.overpassUrl = 'https://overpass-api.de/api/interpreter';
  }

  /**
   * Search address via Nominatim API with autocomplete results
   */
  async searchLocation(query) {
    if (!query || query.trim().length < 2) return [];

    try {
      const url = `${this.nominatimUrl}/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`;
      const response = await fetch(url, { headers: { 'User-Agent': 'LocationSimulator/1.0' } });
      if (!response.ok) throw new Error('Search network error');
      const results = await response.json();
      return results.map(item => ({
        displayName: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        type: item.type || 'place'
      }));
    } catch (err) {
      console.error('[RouteEngine] Search failed:', err);
      return [];
    }
  }

  /**
   * Fetch nearby businesses, shops, cafes, and landmarks using Overpass API
   */
  async fetchNearbyPOIs(south, west, north, east) {
    // Restrict bounding box size to prevent heavy payload
    const bbox = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`;
    const queryData = `[out:json][timeout:10];(node["amenity"](${bbox});node["shop"](${bbox});node["tourism"](${bbox}););out body 40;`;

    try {
      const response = await fetch(`${this.overpassUrl}?data=${encodeURIComponent(queryData)}`);
      if (!response.ok) throw new Error('Overpass API network response error');
      const data = await response.json();

      if (!data.elements) return [];

      return data.elements
        .filter(el => el.tags && (el.tags.name || el.tags.amenity || el.tags.shop))
        .map(el => {
          const tags = el.tags || {};
          let icon = '🏢';
          let category = 'Business';

          if (tags.amenity === 'cafe') { icon = '☕'; category = 'Cafe'; }
          else if (tags.amenity === 'restaurant' || tags.amenity === 'fast_food') { icon = '🍔'; category = 'Restaurant'; }
          else if (tags.shop) { icon = '🛒'; category = `Shop (${tags.shop})`; }
          else if (tags.tourism || tags.amenity === 'park') { icon = '🏞️'; category = 'Landmark / Park'; }
          else if (tags.amenity === 'bank' || tags.amenity === 'pharmacy') { icon = '🏦'; category = 'Service'; }

          return {
            id: el.id,
            name: tags.name || `${category} (${tags.amenity || tags.shop})`,
            category,
            icon,
            lat: el.lat,
            lng: el.lon
          };
        });
    } catch (err) {
      console.warn('[RouteEngine] Overpass POI fetch notice:', err);
      return [];
    }
  }

  /**
   * Calculate route polyline between multiple coordinates array [ [lat, lon], [lat, lon], ... ]
   */
  async getRoute(coordinatesArray, profile = 'foot') {
    if (!coordinatesArray || coordinatesArray.length < 2) {
      throw new Error('At least 2 waypoints are required for route calculation.');
    }

    const osrmProfile = profile === 'car' ? 'driving' : 'foot';
    const coordString = coordinatesArray.map(c => `${c[1]},${c[0]}`).join(';');
    const url = `${this.osrmBaseUrl}/${osrmProfile}/${coordString}?overview=full&geometries=geojson`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`OSRM routing request failed: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.routes || data.routes.length === 0) {
        throw new Error('No valid route found between selected waypoints.');
      }

      const primaryRoute = data.routes[0];
      const pathCoordinates = primaryRoute.geometry.coordinates.map(c => [c[1], c[0]]);

      return {
        distanceMeters: primaryRoute.distance,
        durationSeconds: primaryRoute.duration,
        coordinates: pathCoordinates,
        waypoints: coordinatesArray
      };
    } catch (err) {
      console.warn('[RouteEngine] OSRM API failed, generating fallback polyline:', err);
      return this._generateStraightLineRoute(coordinatesArray);
    }
  }

  _generateStraightLineRoute(coords) {
    let totalDist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      totalDist += this.calculateHaversine(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
    }
    return {
      distanceMeters: totalDist,
      durationSeconds: totalDist / 1.388, // ~5 km/h estimate
      coordinates: coords,
      waypoints: coords
    };
  }

  calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371000.0;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  interpolatePosition(coordinates, targetDistanceMeters) {
    if (!coordinates || coordinates.length === 0) return null;
    if (coordinates.length === 1 || targetDistanceMeters <= 0) {
      return { lat: coordinates[0][0], lng: coordinates[0][1] };
    }

    let accumulatedDistance = 0;

    for (let i = 0; i < coordinates.length - 1; i++) {
      const p1 = coordinates[i];
      const p2 = coordinates[i + 1];
      const segDistance = this.calculateHaversine(p1[0], p1[1], p2[0], p2[1]);

      if (accumulatedDistance + segDistance >= targetDistanceMeters) {
        const remaining = targetDistanceMeters - accumulatedDistance;
        const ratio = segDistance > 0 ? remaining / segDistance : 0;
        const lat = p1[0] + (p2[0] - p1[0]) * ratio;
        const lng = p1[1] + (p2[1] - p1[1]) * ratio;
        return { lat, lng };
      }

      accumulatedDistance += segDistance;
    }

    const last = coordinates[coordinates.length - 1];
    return { lat: last[0], lng: last[1] };
  }
}
