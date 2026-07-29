import asyncio
import json
import logging
import time
import websockets

from step_calculator import StepCalculator

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("IOSBridge")

WS_PORT = 5001
BRIDGE_VERSION = "2.0.0"

class IOSBridgeServer:
    def __init__(self):
        self.connected_clients = set()
        self.device_connected = False
        self.device_info = {}
        
        # DVT / RSD State
        self._rsd = None
        self._dvt = None
        self._sim = None
        self._is_connecting_dvt = False
        self._last_dvt_push_time = 0.0

        self.current_location = {"lat": 0.0, "lng": 0.0}
        self.step_calc = StepCalculator()

    async def _broadcast_to_clients(self, message_str: str):
        for client in list(self.connected_clients):
            try:
                if not getattr(client, 'closed', False):
                    await client.send(message_str)
            except Exception:
                pass

    async def scan_usb_devices(self):
        try:
            from pymobiledevice3.usbmux import list_devices
            devices = await list_devices()
            if devices:
                dev = devices[0]
                serial = getattr(dev, 'serial', 'iPhone-USB-Device')
                self.device_connected = True
                self.device_info = {
                    "connected": True,
                    "name": f"iPhone ({serial[:8]}...)",
                    "udid": serial,
                }
            else:
                self.device_connected = False
                self.device_info = {
                    "connected": False,
                    "name": "No device connected",
                    "udid": None,
                }
                await self._cleanup_dvt_session()
        except Exception as e:
            logger.debug(f"USB Scan check error: {e}")
            self.device_connected = False
            self.device_info = {
                "connected": False,
                "name": "Connection Error",
                "udid": None,
            }

        return self.device_info

    async def _cleanup_dvt_session(self):
        if self._dvt:
            try:
                await self._dvt.__aexit__(None, None, None)
            except Exception:
                pass
            self._dvt = None

        self._rsd = None
        self._sim = None

    async def _ensure_dvt_session(self):
        if self._sim and self._dvt:
            return True

        if self._is_connecting_dvt:
            return False

        self._is_connecting_dvt = True
        try:
            from pymobiledevice3.remote.userspace_tunnel import establish_userspace_rsd
            from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
            from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

            logger.info("Connecting RSD Tunnel...")
            self._rsd = await establish_userspace_rsd()
            
            logger.info("Initializing DVT Provider...")
            self._dvt = DvtProvider(self._rsd)
            await self._dvt.__aenter__()

            logger.info("Opening LocationSimulation channel...")
            self._sim = LocationSimulation(self._dvt)
            await self._sim.__aenter__()

            logger.info("Native LocationSimulation Ready")
            return True
        except Exception as e:
            logger.error(f"DVT connection failed: {e}")
            await self._cleanup_dvt_session()
            return False
        finally:
            self._is_connecting_dvt = False

    async def set_location(self, lat, lng, is_keepalive=False):
        lat_f, lng_f = float(lat), float(lng)
        if not is_keepalive:
            self.current_location = {"lat": lat_f, "lng": lng_f}

        now = time.time()
        # Rate limit to ~2.5Hz
        if (now - self._last_dvt_push_time) >= 0.4:
            self._last_dvt_push_time = now
            if self.device_connected:
                session_ready = await self._ensure_dvt_session()
                if session_ready and self._sim:
                    try:
                        await self._sim.set(lat_f, lng_f)
                    except Exception as ex:
                        logger.error(f"DVT set location error: {ex}")
                        await self._cleanup_dvt_session()

        await self._broadcast_to_clients(json.dumps({
            "type": "PHONE_LOCATION",
            "lat": lat_f,
            "lng": lng_f
        }))

        return {"status": "ok", "lat": lat_f, "lng": lng_f}

    async def clear_location(self):
        if self._sim:
            try:
                await self._sim.clear()
            except Exception:
                pass
        await self._cleanup_dvt_session()
        self.current_location = {"lat": 0.0, "lng": 0.0}

    async def background_location_keepalive(self):
        while True:
            await asyncio.sleep(5)
            if self.device_connected and (self.current_location["lat"] != 0.0 or self.current_location["lng"] != 0.0):
                now = time.time()
                if (now - self._last_dvt_push_time) >= 10.0:
                    try:
                        await self.set_location(self.current_location["lat"], self.current_location["lng"], is_keepalive=True)
                    except Exception as e:
                        logger.error(f"Keep-alive error: {e}")

    async def background_usb_monitor(self):
        last_status = None
        while True:
            try:
                dev_info = await self.scan_usb_devices()
                current_status = json.dumps(dev_info)
                if current_status != last_status and self.connected_clients:
                    last_status = current_status
                    await self._broadcast_to_clients(json.dumps({
                        "type": "DEVICE_STATUS",
                        "device": dev_info
                    }))
            except Exception as e:
                pass
            await asyncio.sleep(1.5)

    async def handle_client(self, websocket):
        self.connected_clients.add(websocket)
        logger.info(f"Client connected. Active: {len(self.connected_clients)}")

        await websocket.send(json.dumps({
            "type": "INIT_STATUS",
            "version": BRIDGE_VERSION,
            "device": self.device_info,
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
                    res = await self.set_location(data.get("lat"), data.get("lng"))
                    await websocket.send(json.dumps({"type": "LOCATION_UPDATED", "result": res}))

                elif msg_type == "UPDATE_STEP_MATH":
                    new_steps, total_steps, total_dist = self.step_calc.update_location(
                        data.get("prev_lat"), data.get("prev_lng"), data.get("curr_lat"), data.get("curr_lng")
                    )
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
            logger.info("Client connection closed.")
        finally:
            self.connected_clients.discard(websocket)

async def main():
    bridge = IOSBridgeServer()
    logger.info(f"Starting Backend on port {WS_PORT}")
    
    asyncio.create_task(bridge.background_usb_monitor())
    asyncio.create_task(bridge.background_location_keepalive())

    async with websockets.serve(bridge.handle_client, "127.0.0.1", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
