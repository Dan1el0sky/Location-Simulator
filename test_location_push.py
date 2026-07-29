import asyncio
import sys
import logging
from pymobiledevice3.usbmux import list_devices

logging.basicConfig(level=logging.INFO)

async def test_push():
    devices = await list_devices()
    print("Devices found:", devices)
    if not devices:
        print("No USB devices connected.")
        return

    dev = devices[0]
    print(f"Targeting device: {dev.serial}")

    lat, lng = 40.4168, -3.7038
    print(f"Pushing test coordinates to iPhone: {lat}, {lng}...")
    
    cmd = [
        sys.executable, "-m", "pymobiledevice3",
        "developer", "dvt", "simulate-location", "set",
        "--", str(lat), str(lng)
    ]
    
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    print("Process spawned, waiting 3 seconds...")
    await asyncio.sleep(3.0)
    proc.terminate()
    print("Test complete!")

if __name__ == "__main__":
    asyncio.run(test_push())
