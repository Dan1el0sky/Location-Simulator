import asyncio
import logging
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.simulate_location import DtSimulateLocation

logging.basicConfig(level=logging.INFO)

async def test_sim():
    print("Connecting lockdown (async)...")
    lockdown = await create_using_usbmux()
    print(f"Device connected! UDID: {lockdown.udid}")
    
    sim = DtSimulateLocation(lockdown)
    print("DtSimulateLocation service created!")
    
    test_coords = [
        (37.370264, -6.081386),
        (37.370260, -6.081385),
        (37.370256, -6.081383),
        (37.370253, -6.081382),
        (37.370249, -6.081380),
    ]
    
    for lat, lng in test_coords:
        print(f"Pushing coordinate via DtSimulateLocation: {lat}, {lng}")
        await sim.set(lat, lng)
        await asyncio.sleep(0.3)

    print("Success! All location coordinates pushed rapidly!")

if __name__ == "__main__":
    asyncio.run(test_sim())
