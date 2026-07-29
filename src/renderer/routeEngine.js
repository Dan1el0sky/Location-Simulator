/**
 * OSRM Multi-Waypoint Route Generator & Search Engine for Location Simulator v1.0.0
 */

export class RouteEngine {
  constructor() {
    this.osrmBaseUrl = 'https://router.project-osrm.org/route/v1';
    this.nominatimUrl = 'https://nominatim.openstreetmap.org';
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
   * Calculate route polyline between multiple coordinates array [ [lat, lon], [lat, lon], ... ]
   * @param {Array} coordinatesArray Array of [lat, lon] waypoints
   * @param {string} profile 'foot' or 'car'
   */
  async getRoute(coordinatesArray, profile = 'foot') {
    if (!coordinatesArray || coordinatesArray.length < 2) {
      throw new Error('At least 2 waypoints are required for route calculation.');
    }

    const osrmProfile = profile === 'car' ? 'driving' : 'foot';
    // OSRM expects coordinates in lon,lat format separated by semicolons
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
      // Convert OSRM GeoJSON [lon, lat] coordinates back to [lat, lon]
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

  /**
   * Interpolate exact position along polyline at distance targetDistanceMeters
   */
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
