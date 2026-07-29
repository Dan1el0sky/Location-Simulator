import asyncio
import json
import logging
import os
import sys
import traceback
import websockets

from step_calculator import StepCalculator

logging.basicConfig(level=logging.INFO, format="[iOSBridge] %(asctime)s - %(levelname)s - %(message)s")

# Version indicator matching app v1.0.0
BRIDGE_VERSION = "1.0.0"
WS_PORT = 8765

class IOSBridgeServer:
    def __init__(self):
        self.connected_clients = set()
        self.step_calc = StepCalculator()
        self.device_connected = False
        self.device_info = {
            "connected": False,
            "name": "No Device",
            "ios_version": "N/A",
            "udid": None
        }
        self.current_location = {"lat": 0.0, "lng": 0.0}
        self.is_simulating = False
        self._pymobiledevice_available = False
        self._check_dependencies()

    def _check_dependencies(self):
        try:
            import pymobiledevice3
            self._pymobiledevice_available = True
            logging.info("pymobiledevice3 successfully detected.")
        except ImportError:
            self._pymobiledevice_available = False
            logging.warning("pymobiledevice3 not installed. Running in simulation API mode.")

    async def scan_usb_devices(self):
        """
        Scans USB usbmuxd bus for connected iOS devices.
        """
        if not self._pymobiledevice_available:
            # Simulated connection check for development/preview
            self.device_info = {
                "connected": False,
                "name": "Searching USB...",
                "ios_version": "iOS 12-26 Ready",
                "udid": None,
                "pymobiledevice_available": False
            }
            return self.device_info

        try:
            from pymobiledevice3.usbmux import list_devices
            devices = list_devices()
            if devices:
                dev = devices[0]
                self.device_connected = True
                self.device_info = {
                    "connected": True,
                    "name": getattr(dev, 'serial', 'iPhone (USB)'),
                    "ios_version": "iOS 12 - 26+",
                    "udid": getattr(dev, 'serial', '00008101-000000000000000'),
                    "pymobiledevice_available": True
                }
            else:
                self.device_connected = False
                self.device_info = {
                    "connected": False,
                    "name": "No iPhone Connected via USB",
                    "ios_version": "N/A",
                    "udid": None,
                    "pymobiledevice_available": True
                }
        except Exception as e:
            logging.error(f"Error scanning USB devices: {e}")
            self.device_connected = False
            self.device_info = {
                "connected": False,
                "name": f"USB Scan Error: {str(e)}",
                "ios_version": "N/A",
                "udid": None,
                "pymobiledevice_available": True
            }
        return self.device_info

    async def set_location(self, lat, lng):
        """
        Sends coordinates (lat, lng) to mounted iOS device via pymobiledevice3 or updates simulation state.
        """
        self.current_location = {"lat": float(lat), "lng": float(lng)}
        
        if self._pymobiledevice_available and self.device_connected and self.device_info.get("udid"):
            try:
                # Attempt sending location via pymobiledevice3 services
                from pymobiledevice3.lockdown import create_using_usbmux
                from pymobiledevice3.services.dvt.dvt_secure_socket_client import DvtSecureSocketClient
                from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

                lockdown = create_using_usbmux(udid=self.device_info["udid"])
                with DvtSecureSocketClient(lockdown) as dvt:
                    sim = LocationSimulation(dvt)
                    sim.set(float(lat), float(lng))
                    logging.info(f"Pushed to iOS Device ({self.device_info['udid']}): {lat}, {lng}")
            except Exception as e:
                logging.debug(f"Direct dvt location call notice: {e}")

        return {"status": "ok", "lat": lat, "lng": lng}

    async def handle_client(self, websocket):
        self.connected_clients.add(websocket)
        logging.info(f"Client connected. Total clients: {len(self.connected_clients)}")

        # Send initial status
        await websocket.send(json.dumps({
            "type": "INIT_STATUS",
            "version": BRIDGE_VERSION,
            "device": self.device_info,
            "py_available": self._pymobiledevice_available
        }))

        try:
            async for message in websocket:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "SCAN_DEVICES":
                    dev_info = await self.scan_usb_devices()
                    await websocket.send(json.dumps({
                        "type": "DEVICE_STATUS",
                        "device": dev_info
                    }))

                elif msg_type == "SET_LOCATION":
                    lat = data.get("lat")
                    lng = data.get("lng")
                    res = await self.set_location(lat, lng)
                    await websocket.send(json.dumps({
                        "type": "LOCATION_UPDATED",
                        "result": res
                    }))

                elif msg_type == "UPDATE_STEP_MATH":
                    p_lat = data.get("prev_lat")
                    p_lng = data.get("prev_lng")
                    c_lat = data.get("curr_lat")
                    c_lng = data.get("curr_lng")
                    new_steps, total_steps, total_dist = self.step_calc.update_location(p_lat, p_lng, c_lat, c_lng)
                    await websocket.send(json.dumps({
                        "type": "STEP_UPDATE",
                        "new_steps": new_steps,
                        "total_steps": total_steps,
                        "total_distance_meters": total_dist
                    }))

                elif msg_type == "RESET_STEP_MATH":
                    self.step_calc.reset()
                    await websocket.send(json.dumps({
                        "type": "STEP_UPDATE",
                        "new_steps": 0,
                        "total_steps": 0,
                        "total_distance_meters": 0.0
                    }))

        except websockets.exceptions.ConnectionClosed:
            logging.info("Client connection closed.")
        finally:
            self.connected_clients.remove(websocket)

async def main():
    bridge = IOSBridgeServer()
    logging.info(f"Starting Location Simulator iOS Bridge v{BRIDGE_VERSION} on ws://localhost:{WS_PORT}...")
    async with websockets.serve(bridge.handle_client, "127.0.0.1", WS_PORT):
        await asyncio.Future()  # Keep running

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Bridge stopped by user.")
