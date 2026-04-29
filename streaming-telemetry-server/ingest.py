import asyncio
import serial_asyncio
import serial
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
import argparse
import random
import json
import logging
import sys
from datetime import datetime, timezone

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global queue for broadcasting messages
message_queue = asyncio.Queue()

async def broadcast_data(data: str):
    await broadcaster.publish(data)

class Broadcaster:
    def __init__(self):
        self.subscribers = set()

    async def publish(self, message):
        for queue in self.subscribers:
            await queue.put(message)

    async def subscribe(self):
        queue = asyncio.Queue()
        self.subscribers.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self.subscribers.remove(queue)

broadcaster = Broadcaster()

class BinaryParser:
    """Scaffold for VBox Binary Protocol Parser."""
    def __init__(self):
        self.buffer = bytearray()

    def parse(self, data: bytes):
        """
        Ingest bytes and yield valid packets.
        TODO: Implement specific VBox binary structure here once sample is provided.
        For now, this just passes through hex representation for debugging.
        """
        # In a real implementation:
        # self.buffer.extend(data)
        # Check for sync bytes, length, checksum, etc.
        # yield packet
        
        # Placeholder: yield hex string of chunk
        if data:
            yield {
                "class": "BINARY",
                "data": data.hex().upper()
            }


# Global settings for mock mode
mock_settings = {
    "enabled": True,
    "track_data": [],
    "track_index": 0
}

from pydantic import BaseModel
import csv
import re
import os

def parse_vbox_coord(coord_str: str) -> float:
    """
    Parses VBOX coordinate string like "38°9.631176 N" or "122°27.228036 W"
    to decimal degrees.
    """
    try:
        # Regex to split degrees, minutes and direction
        match = re.match(r"(\d+)°([\d\.]+)\s+([NSEW])", coord_str.strip())
        if not match:
            return 0.0
        
        degrees = int(match.group(1))
        minutes = float(match.group(2))
        direction = match.group(3)
        
        decimal_degrees = degrees + (minutes / 60.0)
        
        if direction in ['S', 'W']:
            decimal_degrees = -decimal_degrees
            
        return decimal_degrees
    except Exception as e:
        logger.error(f"Error parsing coordinate {coord_str}: {e}")
        return 0.0

def load_track_data(filepath: str):
    """Loads track data from VBOX CSV."""
    data = []
    try:
        # Resolve path relative to this script if needed, or assume absolute/cwd
        # The user said SampleStream2024.csv is in the root, so one level up from backend/
        if not os.path.exists(filepath):
             # Try determining path relative to script location
             script_dir = os.path.dirname(os.path.abspath(__file__))
             filepath = os.path.join(script_dir, "..", "SampleStream2024.csv")

        if not os.path.exists(filepath):
            logger.error(f"CSV file not found at {filepath}")
            return []

        logger.info(f"Loading track data from {filepath}...")
        
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            # Skip first line if it's not header (VBOX csv active file seems to have header on line 1)
            # Based on view_file, line 1 is header.
            reader = csv.DictReader(f)
            count = 0
            for row in reader:
                try:
                    lat = parse_vbox_coord(row["Latitude"])
                    lon = parse_vbox_coord(row["Longitude"])
                    speed_kmh = float(row["Speed (km/h)"] or 0)
                    heading = float(row["Heading (Degrees)"] or 0)
                    elapsed_time = float(row.get("Elapsed time (s)", 0) or 0)
                    
                    # ET-1 & ET-4 Extra Fields
                    gLat = float(row.get("Lateral acceleration (g)", 0) or 0)
                    gLong = float(row.get("Longitudinal acceleration (g)", 0) or 0)
                    throttle = float(row.get("Throttle Position (%)", 0) or 0)
                    brake = float(row.get("Brake Position (%)", 0) or 0)
                    rpm = float(row.get("Engine Speed (rpm)", 0) or 0)
                    steering = float(row.get("Steering Angle (Degrees)", 0) or 0)
                    try:
                        gear_val = int(row.get("Gear ((null))", 0) or 0)
                        gear = 0 if gear_val == 255 else gear_val
                    except Exception:
                        gear = 0
                    
                    data.append({
                        "time": elapsed_time,
                        "lat": lat,
                        "lon": lon,
                        "speed_kmh": speed_kmh,
                        "heading": heading,
                        "gLat": gLat,
                        "gLong": gLong,
                        "throttle": throttle,
                        "brake": brake,
                        "rpm": rpm,
                        "gear": gear,
                        "steering": steering
                    })
                    count += 1
                except (ValueError, KeyError) as e:
                    continue # Skip malformed rows
            
            logger.info(f"Loaded {count} track points.")
            return data

    except Exception as e:
        logger.error(f"Failed to load track data: {e}")
        return []

class MockUpdate(BaseModel):
    enabled: bool

@app.get("/state")
async def get_state():
    return {"mock_enabled": mock_settings["enabled"]}

@app.post("/mock")
async def update_mock_state(update: MockUpdate):
    mock_settings["enabled"] = update.enabled
    
    # Reset values if disabled
    if not update.enabled:
         mock_settings["track_index"] = 0
         logger.info("Mock Data Disabled & Reset")
    else:
        logger.info("Mock Data Enabled")
        
    return {"status": "ok", "mock_enabled": mock_settings["enabled"]}

async def mock_gps_generator(mode: str = "nmea", rate: float = 1.0):
    """Generates mock GPS data from VBOX CSV with interpolation and rate splitting."""
    logger.info(f"Starting Mock GPS Generator in {mode} mode at {rate}x speed")
    
    # Load data once
    mock_settings["track_data"] = load_track_data("SampleStream2024.csv")
    
    if not mock_settings["track_data"]:
        logger.warning("No track data loaded. Falling back to static point.")
        fallback = {"time": 0.0, "lat": 37.7749, "lon": -122.4194, "speed_kmh": 0, "heading": 0, "gLat": 0, "gLong": 0, "throttle": 0, "brake": 0, "rpm": 0, "gear": 0, "steering": 0}
        mock_settings["track_data"] = [fallback]

    track_data = mock_settings["track_data"]
    total_time = track_data[-1]["time"] if len(track_data) > 0 else 0
    sim_time = track_data[0].get("time", 0.0)
    last_obd_time = -1.0
    last_obd_data = {}
    
    TICK_RATE = 25.0
    TICK_DUR = 1.0 / TICK_RATE
    OBD_RATE = 6.0 # 5-8 Hz
    OBD_DUR = 1.0 / OBD_RATE
    
    idx = 0
    
    while True:
        if not mock_settings["enabled"]:
            await asyncio.sleep(0.5)
            continue
        
        sim_time += TICK_DUR * rate
        
        # Loop animation checking
        if sim_time > total_time:
            sim_time = track_data[0].get("time", 0.0)
            idx = 0
            last_obd_time = -1.0
            
        # Find bracketing indices
        while idx < len(track_data) - 1 and track_data[idx+1]["time"] < sim_time:
            idx += 1
            
        p1 = track_data[idx]
        p2 = track_data[idx + 1] if idx + 1 < len(track_data) else p1
        
        dt = p2["time"] - p1["time"]
        if dt > 0:
            ratio = (sim_time - p1["time"]) / dt
        else:
            ratio = 0.0
            
        # Interpolate GPS/IMU at 25Hz
        def lerp(a, b, r): return a + (b - a) * r
        interp_lat = lerp(p1["lat"], p2["lat"], ratio)
        interp_lon = lerp(p1["lon"], p2["lon"], ratio)
        interp_speed = lerp(p1["speed_kmh"], p2["speed_kmh"], ratio) / 3.6
        # Quick heading handle over boundary
        h1, h2 = p1["heading"], p2["heading"]
        if abs(h2 - h1) > 180:
             if h1 < h2: h1 += 360
             else: h2 += 360
        interp_track = lerp(h1, h2, ratio) % 360
        interp_gLat = lerp(p1["gLat"], p2["gLat"], ratio)
        interp_gLong = lerp(p1["gLong"], p2["gLong"], ratio)
        
        # Zero-order hold mapping for OBD at ~6Hz
        if sim_time - last_obd_time >= OBD_DUR * rate:
            last_obd_time = sim_time
            # Pick nearest point for OBD values instead of interpolating strings/discrete values
            nearest = p2 if ratio > 0.5 else p1
            last_obd_data = {
                "throttle": nearest["throttle"],
                "brake": nearest["brake"],
                "rpm": nearest["rpm"],
                "gear": nearest["gear"],
                "steering": nearest["steering"]
            }

        if mode == "binary":
            # Mock binary data
            dummy_bytes = random.randbytes(16)
            data = json.dumps({
               "class": "BINARY",
               "data": dummy_bytes.hex().upper(),
               "device": "/dev/mock"
            })
        else:
             current_time = datetime.now(timezone.utc).isoformat()
             
             # GPSD TPV Object expanded with extra telemetry fields
             tpv = {
                "class": "TPV",
                "device": "/dev/mock",
                "mode": 3,
                "time": current_time,
                "lat": interp_lat,
                "lon": interp_lon,
                "alt": 0,
                "speed": interp_speed,
                "track": interp_track,
                "climb": 0,
                "epx": 0.5,
                "epy": 0.5,
                "epv": 1.0,
                "gLat": interp_gLat,
                "gLong": interp_gLong,
                "throttle": last_obd_data.get("throttle", 0),
                "brake": last_obd_data.get("brake", 0),
                "rpm": last_obd_data.get("rpm", 0),
                "gear": last_obd_data.get("gear", 0),
                "steering": last_obd_data.get("steering", 0)
            }
             data = json.dumps(tpv)
        
        await broadcast_data(data)
        await asyncio.sleep(TICK_DUR) # 25Hz target update

import pynmea2

def parse_nmea_sentence(line: str):
    """Parses an NMEA sentence and returns a structured dict or None."""
    try:
        msg = pynmea2.parse(line)
        if isinstance(msg, (pynmea2.types.talker.RMC, pynmea2.types.talker.GGA)):
            # Extract data
            lat = getattr(msg, 'latitude', 0.0)
            lon = getattr(msg, 'longitude', 0.0)
            speed_knots = getattr(msg, 'spd_over_grnd', 0.0)
            speed_ms = float(speed_knots or 0) * 0.514444
            heading = getattr(msg, 'true_course', 0.0)
            
            current_time = datetime.now(timezone.utc).isoformat()
            
            return {
                "class": "TPV",
                "device": "/dev/serial",
                "mode": 3 if msg.is_valid else 1, # Simplified mode logic
                "time": current_time,
                "lat": lat,
                "lon": lon,
                "alt": getattr(msg, 'altitude', 0.0),
                "speed": speed_ms,
                "track": float(heading or 0),
            }
    except pynmea2.ParseError:
        pass
    except Exception as e:
        logger.error(f"Error parsing NMEA: {e}")
    return None

async def serial_reader(port: str, baud: int, binary_mode: bool = False):
    """Reads data from the serial port and broadcasts it."""
    logger.info(f"Starting Serial Reader on {port} at {baud} baud (Binary: {binary_mode})")
    parser = BinaryParser() if binary_mode else None
    
    try:
        reader, _ = await serial_asyncio.open_serial_connection(url=port, baudrate=baud)
        while True:
            if binary_mode:
                 # Read chunks
                 chunk = await reader.read(1024)
                 if chunk:
                     for packet in parser.parse(chunk):
                         await broadcast_data(json.dumps(packet))
            else:
                line = await reader.readline()
                if line:
                    try:
                        decoded_line = line.decode('utf-8', errors='ignore').strip()
                        if decoded_line:
                            parsed = parse_nmea_sentence(decoded_line)
                            if parsed:
                                await broadcast_data(json.dumps(parsed))
                            else:
                                # Broadcast raw for debug info
                                # Currently we only want TPV, but maybe error logging
                                pass

                    except Exception as e:
                        logger.error(f"Error decoding line: {e}")
    except serial.SerialException as e:
        logger.error(f"Could not open serial port {port}: {e}")
        # Retrying logic or exit could go here. For now we exit to avoid busy loop spam in logs if device missing
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error in serial reader: {e}")

@app.get("/events")
async def message_stream(request: Request):
    """SSE endpoint."""
    async def event_generator():
        async for message in broadcaster.subscribe():
            if await request.is_disconnected():
                break
            yield {"data": message}

    return EventSourceResponse(event_generator())

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VBox Streamer Backend")
    parser.add_argument("--mock", action="store_true", help="Run in mock mode")
    parser.add_argument("--binary", action="store_true", help="Enable binary protocol mode")
    parser.add_argument("--port", type=str, default="/dev/ttyUSB0", help="Serial port")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    parser.add_argument("--rate", type=float, default=1.0, help="Playback speed multiplier for mock mode")
    
    args = parser.parse_args()
    
    import uvicorn
    from dotenv import load_dotenv
    
    load_dotenv()
    
    # Priority: Env Var > Default
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    
    @app.on_event("startup")
    async def startup_event():
        if args.mock:
            mode = "binary" if args.binary else "nmea"
            asyncio.create_task(mock_gps_generator(mode, args.rate))
        else:
            asyncio.create_task(serial_reader(args.port, args.baud, args.binary))
    
    uvicorn.run(app, host=host, port=port)
