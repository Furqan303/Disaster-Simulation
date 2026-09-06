import os
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Tuple
from sqlalchemy import create_engine, text
from simulation_engine import generate_plume_polygons
from routing_engine import EvacuationRouter

# Global dictionary to hold our heavy in-memory objects
app_state = {}

# Database connection
DB_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://postgres:12345@localhost:5432/disaster_sim")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load road network + database engine
    print("Starting up: Loading Evacuation Router into memory...")
    app_state["router"] = EvacuationRouter(place_name="Islamabad, Pakistan")
    try:
        app_state["db_engine"] = create_engine(DB_URL)
        with app_state["db_engine"].connect() as conn:
            conn.execute(text("SELECT 1"))
        print("Database engine connected successfully.")
    except Exception as e:
        print(f"Warning: Database connection failed: {e}")
        app_state["db_engine"] = None
    yield
    # Shutdown: Clean up resources
    print("Shutting down: Clearing resources from memory...")
    if app_state.get("db_engine"):
        app_state["db_engine"].dispose()
    app_state.clear()

# Initialize FastAPI with the lifespan manager
app = FastAPI(title="Disaster Simulator API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class EvacuationRequest(BaseModel):
    origin: Tuple[float, float]
    destination: Tuple[float, float]
    roadblocks: List[Tuple[float, float]] = []
    enable_congestion: bool = True
    congestion_level: str = "moderate"  # moderate | heavy | gridlock
    hazard_origin: Tuple[float, float] = None  # for proximity-based delays

@app.post("/api/route/evacuate")
def compute_evacuation_route(request: EvacuationRequest):
    router = app_state["router"]
    
    coords, clearance_mins, raw_mins = router.calculate_route(
        start_coords=request.origin,
        end_coords=request.destination,
        roadblocks=request.roadblocks,
        enable_congestion=request.enable_congestion,
        congestion_level=request.congestion_level,
        hazard_origin=request.hazard_origin
    )

    if coords is None:
        return {
            "status": "blocked",
            "message": "No viable route found. Roadblocks completely cut off destination.",
            "travel_time_minutes": None,
            "raw_travel_time_minutes": None,
            "geojson": None
        }

    geojson_route = {
        "type": "Feature",
        "properties": {
            "travel_time_minutes": clearance_mins,
            "raw_travel_time_minutes": raw_mins
        },
        "geometry": {
            "type": "LineString",
            "coordinates": coords
        }
    }

    return {
        "status": "success",
        "travel_time_minutes": clearance_mins,
        "raw_travel_time_minutes": raw_mins,
        "congestion_applied": request.enable_congestion,
        "congestion_level": request.congestion_level,
        "geojson": geojson_route
    }

@app.get("/api/simulate/chemical-spill")
def simulate_spill(lon: float = 73.0479, lat: float = 33.6844, wind_speed: float = 50.0, wind_dir: float = 45.0):
    # Default coordinates set to Islamabad, Pakistan
    # wind_speed: meters per minute. wind_dir: degrees (0 is North, 90 is East)
    
    time_series_data = generate_plume_polygons(
        lon=lon, 
        lat=lat, 
        wind_speed_m_min=wind_speed, 
        wind_dir_deg=wind_dir, 
        max_time_min=60,
        step_min=15
    )
    
    return {
        "type": "FeatureCollection",
        "features": time_series_data
    }


# ── Demographics API ──────────────────────────────────────

class AtRiskRequest(BaseModel):
    plume_geojson: dict

@app.get("/api/demographics")
def get_demographics(bbox: str, admin_level: int = None):
    """Return demographic polygons within a bounding box as GeoJSON."""
    engine = app_state.get("db_engine")
    if not engine:
        return {"type": "FeatureCollection", "features": [], "error": "Database not available"}

    try:
        parts = [float(x) for x in bbox.split(",")]
        if len(parts) != 4:
            return {"error": "bbox must be minlon,minlat,maxlon,maxlat"}
        minlon, minlat, maxlon, maxlat = parts
    except ValueError:
        return {"error": "Invalid bbox format"}

    try:
        with engine.connect() as conn:
            # Auto-detect most granular admin level if not specified
            if admin_level is None:
                result = conn.execute(text("""
                    SELECT MAX(admin_level)
                    FROM demographics
                    WHERE ST_Intersects(geometry, ST_MakeEnvelope(:minlon, :minlat, :maxlon, :maxlat, 4326))
                      AND admin_level IS NOT NULL
                """), {"minlon": minlon, "minlat": minlat, "maxlon": maxlon, "maxlat": maxlat})
                admin_level = result.scalar()
                if admin_level is None:
                    return {"type": "FeatureCollection", "features": []}

            result = conn.execute(text("""
                SELECT name, name_en,
                       admin_level,
                       COALESCE(population, 0) AS population,
                       CASE WHEN ST_Area(geometry::geography) > 0
                            THEN COALESCE(population, 0) / (ST_Area(geometry::geography) / 1000000.0)
                            ELSE 0
                       END AS pop_density_km2,
                       ST_AsGeoJSON(geometry) AS geojson
                FROM demographics
                WHERE ST_Intersects(geometry, ST_MakeEnvelope(:minlon, :minlat, :maxlon, :maxlat, 4326))
                  AND admin_level = :admin_level
            """), {"minlon": minlon, "minlat": minlat, "maxlon": maxlon, "maxlat": maxlat, "admin_level": admin_level})

            features = []
            for row in result:
                features.append({
                    "type": "Feature",
                    "properties": {
                        "name": row.name or row.name_en or "Unknown",
                        "admin_level": row.admin_level,
                        "population": float(row.population) if row.population else 0,
                        "pop_density_km2": round(float(row.pop_density_km2), 1) if row.pop_density_km2 else 0
                    },
                    "geometry": json.loads(row.geojson)
                })

            return {"type": "FeatureCollection", "features": features}

    except Exception as e:
        return {"type": "FeatureCollection", "features": [], "error": str(e)}


@app.post("/api/demographics/at-risk")
def get_population_at_risk(request: AtRiskRequest):
    """Spatial intersection: how many people are inside the plume polygon."""
    engine = app_state.get("db_engine")
    if not engine:
        return {"total_population": 0, "polygons_hit": 0, "error": "Database not available"}

    try:
        plume_json = json.dumps(request.plume_geojson)

        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT
                    name, name_en,
                    COALESCE(population, 0) AS population,
                    COALESCE(population, 0) * (
                        ST_Area(ST_Intersection(geometry::geography,
                                ST_SetSRID(ST_GeomFromGeoJSON(:plume), 4326)::geography))
                        / NULLIF(ST_Area(geometry::geography), 0)
                    ) AS affected_population
                FROM demographics
                WHERE ST_Intersects(geometry, ST_SetSRID(ST_GeomFromGeoJSON(:plume), 4326))
                  AND COALESCE(population, 0) > 0
            """), {"plume": plume_json})

            total = 0
            details = []
            for row in result:
                affected = round(float(row.affected_population or 0))
                total += affected
                details.append({
                    "name": row.name or row.name_en or "Unknown",
                    "total_population": float(row.population),
                    "affected_population": affected
                })

            return {
                "total_population": round(total),
                "polygons_hit": len(details),
                "details": details
            }

    except Exception as e:
        return {"total_population": 0, "polygons_hit": 0, "error": str(e)}


app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/")
async def read_index():
    return FileResponse("frontend/index.html")