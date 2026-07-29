/**
 * Humanized Speed Variance & Pause State Machine for Location Simulator v1.0.0
 * Provides organic, non-robotic movement for Pokémon GO & Pikmin Bloom.
 */

export const SimulationState = {
  STOPPED: 'STOPPED',
  CRUISING: 'CRUISING',
  DECELERATING: 'DECELERATING',
  PAUSED: 'PAUSED',
  ACCELERATING: 'ACCELERATING'
};

export class SpeedVarianceEngine {
  constructor(config = {}) {
    this.targetSpeedKmh = config.targetSpeedKmh || 4.0;
    this.enableVariance = config.enableVariance !== undefined ? config.enableVariance : true;
    this.varianceRangePct = config.varianceRangePct || 0.20; // ±20% noise
    
    // Auto Pause configuration
    this.enableAutoPause = config.enableAutoPause !== undefined ? config.enableAutoPause : true;
    this.minPauseIntervalSec = config.minPauseIntervalSec || 60;  // Every 1-2 minutes
    this.maxPauseIntervalSec = config.maxPauseIntervalSec || 120;
    this.stopDurationSec = config.stopDurationSec || 5.0;         // Stop for 5 sec

    // State internal tracking
    this.currentState = SimulationState.STOPPED;
    this.currentSpeedKmh = 0.0;
    
    // Smooth target noise interpolation (changes target every 5-8 seconds)
    this.noiseTargetSpeedKmh = this.targetSpeedKmh;
    this.timeSinceLastNoiseChangeSec = 0.0;
    this.noiseIntervalSec = 6.0;

    // Pause state tracking
    this.timeSinceLastPauseSec = 0.0;
    this.nextPauseTimeSec = this._getRandomPauseInterval();
    this.pauseElapsedSec = 0.0;
    this.rampTimeSec = 3.0; // 3 seconds smooth deceleration/acceleration
    this.rampElapsedSec = 0.0;
    this.rampStartSpeedKmh = 0.0;
  }

  setTargetSpeed(speedKmh) {
    this.targetSpeedKmh = Math.max(0.5, parseFloat(speedKmh) || 4.0);
    this.noiseTargetSpeedKmh = this.targetSpeedKmh;
    if (this.currentState === SimulationState.CRUISING) {
      this.currentSpeedKmh = this.targetSpeedKmh;
    }
  }

  _getRandomPauseInterval() {
    return Math.random() * (this.maxPauseIntervalSec - this.minPauseIntervalSec) + this.minPauseIntervalSec;
  }

  _pickNewNoiseTarget() {
    if (!this.enableVariance) {
      this.noiseTargetSpeedKmh = this.targetSpeedKmh;
      return;
    }
    // Random factor between -varianceRangePct and +varianceRangePct
    const factor = 1.0 + (Math.random() * 2 - 1) * this.varianceRangePct;
    this.noiseTargetSpeedKmh = Math.max(0.5, this.targetSpeedKmh * factor);
  }

  start() {
    this.currentState = SimulationState.CRUISING;
    this.currentSpeedKmh = this.targetSpeedKmh;
    this.noiseTargetSpeedKmh = this.targetSpeedKmh;
    this.timeSinceLastNoiseChangeSec = 0.0;
    this.timeSinceLastPauseSec = 0.0;
    this.nextPauseTimeSec = this._getRandomPauseInterval();
  }

  stop() {
    this.currentState = SimulationState.STOPPED;
    this.currentSpeedKmh = 0.0;
  }

  tick(deltaSeconds) {
    if (this.currentState === SimulationState.STOPPED) {
      this.currentSpeedKmh = 0.0;
      return { speedKmh: 0.0, state: this.currentState };
    }

    if (this.enableAutoPause) {
      this.timeSinceLastPauseSec += deltaSeconds;
    }

    switch (this.currentState) {
      case SimulationState.CRUISING:
        // 1. Periodically pick a new noise target every ~6 seconds
        this.timeSinceLastNoiseChangeSec += deltaSeconds;
        if (this.timeSinceLastNoiseChangeSec >= this.noiseIntervalSec) {
          this.timeSinceLastNoiseChangeSec = 0.0;
          this._pickNewNoiseTarget();
        }

        // 2. Smooth exponential lerp towards noiseTargetSpeedKmh (smooth speed changes)
        const lerpFactor = Math.min(1.0, deltaSeconds * 1.5);
        this.currentSpeedKmh += (this.noiseTargetSpeedKmh - this.currentSpeedKmh) * lerpFactor;

        // Check if it's time for a natural human pause/stop
        if (this.enableAutoPause && this.timeSinceLastPauseSec >= this.nextPauseTimeSec) {
          this.currentState = SimulationState.DECELERATING;
          this.rampStartSpeedKmh = this.currentSpeedKmh;
          this.rampElapsedSec = 0.0;
        }
        break;

      case SimulationState.DECELERATING:
        this.rampElapsedSec += deltaSeconds;
        const decelRatio = Math.min(1.0, this.rampElapsedSec / this.rampTimeSec);
        // Smooth ease-out deceleration curve
        const easeDecel = 1.0 - Math.pow(decelRatio, 2);
        this.currentSpeedKmh = this.rampStartSpeedKmh * easeDecel;

        if (decelRatio >= 1.0) {
          this.currentSpeedKmh = 0.0;
          this.currentState = SimulationState.PAUSED;
          this.pauseElapsedSec = 0.0;
        }
        break;

      case SimulationState.PAUSED:
        this.currentSpeedKmh = 0.0;
        this.pauseElapsedSec += deltaSeconds;
        if (this.pauseElapsedSec >= this.stopDurationSec) {
          this.currentState = SimulationState.ACCELERATING;
          this.rampElapsedSec = 0.0;
        }
        break;

      case SimulationState.ACCELERATING:
        this.rampElapsedSec += deltaSeconds;
        const accelRatio = Math.min(1.0, this.rampElapsedSec / this.rampTimeSec);
        // Smooth ease-in acceleration curve
        const easeAccel = Math.pow(accelRatio, 2);
        this.currentSpeedKmh = this.targetSpeedKmh * easeAccel;

        if (accelRatio >= 1.0) {
          this.currentSpeedKmh = this.targetSpeedKmh;
          this.currentState = SimulationState.CRUISING;
          this.timeSinceLastPauseSec = 0.0;
          this.nextPauseTimeSec = this._getRandomPauseInterval();
        }
        break;
    }

    return {
      speedKmh: this.currentSpeedKmh,
      state: this.currentState
    };
  }
}
