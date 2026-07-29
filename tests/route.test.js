import assert from 'assert';
import { RouteEngine } from '../src/renderer/routeEngine.js';

console.log('🧪 Running Test Suite: RouteEngine...');

const engine = new RouteEngine();

// Test 1: Haversine distance calculation
const dist = engine.calculateHaversine(37.7749, -122.4194, 37.3382, -121.8863);
assert(dist > 60000 && dist < 75000, `Expected distance ~67000m, got ${dist}`);

// Test 2: Polyline interpolation
const polyline = [
  [37.7749, -122.4194],
  [37.7759, -122.4194] // ~111 meters North
];

const posStart = engine.interpolatePosition(polyline, 0);
assert.strictEqual(posStart.lat, 37.7749);

const posMid = engine.interpolatePosition(polyline, 55.5);
assert(Math.abs(posMid.lat - 37.7754) < 0.0002);

const posEnd = engine.interpolatePosition(polyline, 200);
assert.strictEqual(posEnd.lat, 37.7759);

console.log('✅ RouteEngine tests passed successfully!');
