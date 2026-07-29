import math
import random

class StepCalculator:
    """
    Step Calculator & Distance Math Engine for Location Simulator v1.0.0
    Translates GPS movements into accurate human step metrics (Adventure Sync / Pedometer compatibility).
    """
    DEFAULT_STRIDE_METERS = 0.75  # Average human stride length ~0.75m (75cm)

    def __init__(self, stride_length_meters=DEFAULT_STRIDE_METERS):
        self.stride_length_meters = stride_length_meters
        self.total_distance_meters = 0.0
        self.total_steps = 0

    @staticmethod
    def haversine_distance(lat1, lon1, lat2, lon2):
        """
        Calculate distance between two coordinates in meters using Haversine formula.
        """
        R = 6371000.0  # Earth radius in meters
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = (math.sin(delta_phi / 2.0) ** 2 +
             math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        return R * c

    def update_location(self, prev_lat, prev_lon, curr_lat, curr_lon):
        """
        Calculates distance delta and updates step count with subtle stride noise.
        """
        dist = self.haversine_distance(prev_lat, prev_lon, curr_lat, curr_lon)
        if dist <= 0:
            return 0, self.total_steps, self.total_distance_meters

        self.total_distance_meters += dist

        # Add subtle human variance to stride length per tick (+/- 5%)
        effective_stride = self.stride_length_meters * random.uniform(0.95, 1.05)
        new_steps = int(round(dist / effective_stride))
        self.total_steps += new_steps

        return new_steps, self.total_steps, self.total_distance_meters

    def reset(self):
        self.total_distance_meters = 0.0
        self.total_steps = 0


if __name__ == "__main__":
    calc = StepCalculator()
    # Test sample 100 meter walk
    steps, total_s, total_d = calc.update_location(37.7749, -122.4194, 37.7758, -122.4194)
    print(f"Distance: {total_d:.2f}m, Steps: {total_s}")
