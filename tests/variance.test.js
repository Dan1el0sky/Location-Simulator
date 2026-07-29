import assert from 'assert';
import { SpeedVarianceEngine, SimulationState } from '../src/renderer/speedVariance.js';

console.log('🧪 Running Test Suite: SpeedVarianceEngine...');

// Test 1: Baseline initialization
const engine = new SpeedVarianceEngine({
  targetSpeedKmh: 5.0,
  enableVariance: false,
  enableAutoPause: false
});

assert.strictEqual(engine.currentState, SimulationState.STOPPED);
engine.start();
assert.strictEqual(engine.currentState, SimulationState.CRUISING);

// Test 2: Tick calculation without variance
const res1 = engine.tick(1.0);
assert.strictEqual(res1.speedKmh, 5.0);

// Test 3: Tick calculation with variance enabled (boundary check)
engine.enableVariance = true;
engine.varianceRangePct = 0.20; // ±20%
for (let i = 0; i < 50; i++) {
  const res = engine.tick(0.1);
  assert(res.speedKmh >= 4.0 && res.speedKmh <= 6.0, `Speed ${res.speedKmh} out of range [4.0, 6.0]`);
}

// Test 4: Deceleration state machine transition
engine.enableAutoPause = true;
engine.nextPauseTimeSec = 2.0;
engine.timeSinceLastPauseSec = 1.9;

engine.tick(0.2); // Cross threshold -> DECELERATING
assert.strictEqual(engine.currentState, SimulationState.DECELERATING);

console.log('✅ SpeedVarianceEngine tests passed successfully!');
