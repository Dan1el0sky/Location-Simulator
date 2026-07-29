import asyncio
import json
import logging
import os
import sys
import subprocess
import traceback
import websockets

from step_calculator import StepCalculator

logging.basicConfig(level=logging.INFO, format="[iOSBridge] %(asctime)s - %(levelname)s - %(message)s")

BRIDGE_VERSION = "1.0.0"
WS_PORT = 8765

class IOSBridgeServer:
    def __init__(self):
        self.connected_clients = set()
        self.step_calc = StepCalculator()
        self.device_connected = False
        self.device_info = {
            "connected": False,
            "name": "Checking USB...",
            "ios_version": "iOS 12 - 26+",
            "udid": None,
            "status_text": "Connect iPhone via USB cable"
        }
        self.current_location = {"lat": 0.0, "lng": 0.0}
        self._active_sim_proc = None
        self._last_pushed_location = (0.0, 0.0)

    async def scan_usb_devices(self):
        """
        Scans USB usbmuxd bus for connected iOS devices.
        """
        try:
            from pymobiledevice3.usbmux import list_devices
            devices = await list_devices()
            if devices:
                dev = devices[0]
                serial = getattr(dev, 'serial', 'iPhone-USB-Device')
                self.device_connected = True
                self.device_info = {
                    "connected": True,
                    "name": f"iPhone Connected ({serial[:8]}...)",
                    "ios_version": "iOS 12 - 26+",
                    "udid": serial,
                    "status_text": f"🟢 Connected ({serial[:8]}...)"
                }
            else:
                self.device_connected = False
                self.device_info = {
                    "connected": False,
                    "name": "No iPhone Connected",
                    "ios_version": "N/A",
                    "udid": None,
                    "status_text": "Connect iPhone via USB cable"
                }
        except Exception as e:
            logging.debug(f"USB Scan check: {e}")
            self.device_connected = False
            self.device_info = {
                "connected": False,
                "name": "Connect iPhone via USB",
                "ios_version": "N/A",
                "udid": None,
                "status_text": "Connect iPhone via USB cable"
            }

        return self.device_info

    async def set_location(self, lat, lng):
        """
        Sends coordinates (lat, lng) to mounted iOS device via pymobiledevice3.
        """
        lat_f = float(lat)
        lng_f = float(lng)
        self.current_location = {"lat": lat_f, "lng": lng_f}

        if self.device_connected and self.device_info.get("udid"):
            udid = self.device_info["udid"]

            # Only spawn new process if location changed significantly (>0.5m)
            dist_moved = abs(lat_f - self._last_pushed_location[0]) + abs(lng_f - self._last_pushed_location[1])
            if dist_moved > 0.000005 or self._active_sim_proc is None:
                self._last_pushed_location = (lat_f, lng_f)
                
                # Terminate previous location process if active
                if self._active_sim_proc and self._active_sim_proc.returncode is None:
                    try:
                        self._active_sim_proc.terminate()
                    except Exception:
                        pass

                try:
                    cmd = [
                        sys.executable, "-m", "pymobiledevice3",
                        "developer", "dvt", "simulate-location", "set",
                        "--", str(lat_f), str(lng_f)
                    ]
                    self._active_sim_proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True
                    )
                    logging.info(f"🟢 Location Pushed to iPhone ({udid}): {lat_f:.6f}, {lng_f:.6f}")
                except Exception as ex:
                    logging.error(f"Error executing simulate-location: {ex}")

        return {"status": "ok", "lat": lat_f, "lng": lng_f}

    async def clear_location(self):
        """
        Clears location simulation on device.
        """
        if self._active_sim_proc:
            try:
                self._active_sim_proc.terminate()
            except Exception:
                pass
            self._active_sim_proc = None

        if self.device_connected:
            try:
                cmd = [sys.executable, "-m", "pymobiledevice3", "developer", "dvt", "simulate-location", "clear"]
                subprocess.run(cmd, timeout=3)
                logging.info("Location simulation cleared on iPhone.")
            except Exception:
                pass

    async def background_usb_monitor(self):
        """
        Background task that checks USB connection every 1.5 seconds and broadcasts updates.
        """
        last_status = None
        while True:
            try:
                dev_info = await self.scan_usb_devices()
                current_status = json.dumps(dev_info)
                if current_status != last_status and self.connected_clients:
                    last_status = current_status
                    broadcast_msg = json.dumps({
                        "type": "DEVICE_STATUS",
                        "device": dev_info
                    })
                    await asyncio.gather(*[client.send(broadcast_msg) for client in self.connected_clients if client.open])
            except Exception as e:
                logging.debug(f"Background USB monitor exception: {e}")

            await asyncio.sleep(1.5)

    async def handle_client(self, websocket):
        self.connected_clients.add(websocket)
        logging.info(f"Client connected. Active clients: {len(self.connected_clients)}")

        await websocket.send(json.dumps({
            "type": "INIT_STATUS",
            "version": BRIDGE_VERSION,
            "device": self.device_info,
            "py_available": True
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

                elif msg_type == "STOP_SIMULATION":
                    await self.clear_location()

        except websockets.exceptions.ConnectionClosed:
            logging.info("Client connection closed.")
        finally:
            self.connected_clients.remove(websocket)

async def main():
    bridge = IOSBridgeServer()
    logging.info(f"Starting Location Simulator iOS Bridge v{BRIDGE_VERSION} on ws://localhost:{WS_PORT}...")
    
    asyncio.create_task(bridge.background_usb_monitor())

    async with websockets.serve(bridge.handle_client, "127.0.0.1", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Bridge stopped by user.")
