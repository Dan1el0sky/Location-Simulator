import asyncio
import json
import logging
import time
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
        
        # Native DVT Session handles & throttling
        self._rsd = None
        self._dvt = None
        self._sim = None
        self._is_connecting_dvt = False
        self._last_dvt_push_time = 0.0

    async def _broadcast_to_clients(self, message_str):
        """
        Safely broadcasts JSON message string to all active WebSocket clients.
        """
        for client in list(self.connected_clients):
            try:
                if not getattr(client, 'closed', False):
                    await client.send(message_str)
            except Exception:
                pass

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
                await self._cleanup_dvt_session()
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

    async def _cleanup_dvt_session(self):
        """
        Clean up open DVT / RSD connections.
        """
        if self._dvt:
            try:
                await self._dvt.__aexit__(None, None, None)
            except Exception:
                pass
            self._dvt = None

        self._rsd = None
        self._sim = None

    async def _ensure_dvt_session(self):
        """
        Ensures a single, long-lived native DVT LocationSimulation session is open over userspace RSD tunnel.
        """
        if self._sim and self._dvt:
            return True

        if self._is_connecting_dvt:
            return False

        self._is_connecting_dvt = True
        try:
            from pymobiledevice3.remote.userspace_tunnel import establish_userspace_rsd
            from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
            from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

            logging.info("Connecting native Userspace RSD Tunnel...")
            self._rsd = await establish_userspace_rsd()
            
            logging.info("Initializing persistent DVT Provider...")
            self._dvt = DvtProvider(self._rsd)
            await self._dvt.__aenter__()

            logging.info("Opening DVT LocationSimulation channel...")
            self._sim = LocationSimulation(self._dvt)
            await self._sim.__aenter__()

            logging.info("🟢 Native DVT LocationSimulation Session ACTIVE & READY!")
            return True
        except Exception as e:
            logging.error(f"Failed to establish DVT session: {e}")
            await self._cleanup_dvt_session()
            return False
        finally:
            self._is_connecting_dvt = False

    async def set_location(self, lat, lng, is_keepalive=False):
        """
        Sends coordinates (lat, lng) to mounted iOS device over persistent native DVT channel.
        Rate-limited to 2.5Hz (max once per 0.4s) to prevent iOS locationd packet buffer stalls.
        """
        lat_f = float(lat)
        lng_f = float(lng)
        if not is_keepalive:
            self.current_location = {"lat": lat_f, "lng": lng_f}

        now = time.time()
        if (now - self._last_dvt_push_time) >= 0.4:
            self._last_dvt_push_time = now
            if self.device_connected:
                session_ready = await self._ensure_dvt_session()
                if session_ready and self._sim:
                    try:
                        await self._sim.set(lat_f, lng_f)
                        if not is_keepalive:
                            logging.info(f"🟢 Location Pushed to iPhone ({self.device_info.get('udid', '')[:8]}): {lat_f:.6f}, {lng_f:.6f}")
                    except Exception as ex:
                        logging.error(f"Error setting location via native DVT: {ex}")
                        await self._cleanup_dvt_session()

        # Broadcast live location back to frontend safely
        phone_loc_msg = json.dumps({
            "type": "PHONE_LOCATION",
            "lat": lat_f,
            "lng": lng_f
        })
        await self._broadcast_to_clients(phone_loc_msg)

        return {"status": "ok", "lat": lat_f, "lng": lng_f}

    async def clear_location(self):
        """
        Clears location simulation on device.
        """
        if self._sim:
            try:
                await self._sim.clear()
                logging.info("Location simulation cleared on iPhone.")
            except Exception:
                pass
        await self._cleanup_dvt_session()
        self.current_location = {"lat": 0.0, "lng": 0.0}

    async def background_location_keepalive(self):
        """
        Periodically pushes the last known location to the device to prevent it from reverting
        when idle.
        """
        while True:
            await asyncio.sleep(5)
            if self.device_connected and (self.current_location["lat"] != 0.0 or self.current_location["lng"] != 0.0):
                now = time.time()
                if (now - self._last_dvt_push_time) >= 10.0:
                    logging.info("Sending location keep-alive to iPhone...")
                    try:
                        await self.set_location(self.current_location["lat"], self.current_location["lng"], is_keepalive=True)
                    except Exception as e:
                        logging.error(f"Keep-alive error: {e}")

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
                    await self._broadcast_to_clients(broadcast_msg)
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
            self.connected_clients.discard(websocket)

async def main():
    bridge = IOSBridgeServer()
    logging.info(f"Starting Location Simulator iOS Bridge v{BRIDGE_VERSION} on ws://localhost:{WS_PORT}...")
    
    asyncio.create_task(bridge.background_usb_monitor())
    asyncio.create_task(bridge.background_location_keepalive())

    async with websockets.serve(bridge.handle_client, "127.0.0.1", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Bridge stopped by user.")
