import asyncio
import logging
from pymobiledevice3.remote.userspace_tunnel import establish_userspace_rsd
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

logging.basicConfig(level=logging.INFO)

async def test_native():
    print("Establishing userspace RSD connection directly (async)...")
    rsd = await establish_userspace_rsd()
    print(f"RSD service provider acquired: {rsd}")
    
    print("Opening persistent DvtProvider and LocationSimulation connection...")
    async with DvtProvider(rsd) as dvt, LocationSimulation(dvt) as sim:
        print("Connected to DVT LocationSimulation! Pushing test coordinates...")
        
        test_coords = [
            (37.370264, -6.081386),
            (37.370260, -6.081385),
            (37.370256, -6.081383),
            (37.370253, -6.081382),
            (37.370249, -6.081380),
        ]
        
        for lat, lng in test_coords:
            print(f"Pushing coordinate live over active DVT tunnel: {lat}, {lng}")
            await sim.set(lat, lng)
            await asyncio.sleep(0.3)

    print("Success! All location coordinates pushed rapidly over active RSD/DVT tunnel!")

if __name__ == "__main__":
    asyncio.run(test_native())
