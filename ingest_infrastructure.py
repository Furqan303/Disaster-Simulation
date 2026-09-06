import os
import pyproj
proj_path = r"D:\VS-file\disaster_sim\env\Lib\site-packages\pyproj\proj_dir\share\proj"
os.environ["PROJ_LIB"] = proj_path
os.environ["PROJ_DATA"] = proj_path 
pyproj.datadir.set_data_dir(proj_path)
import osmnx as ox
from sqlalchemy import create_engine
# Explicit import just to remind us geoalchemy2 is required in the environment
from geoalchemy2 import Geometry

# 1. Connect to PostGIS
DB_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://postgres:12345@localhost:5432/disaster_sim")
engine = create_engine(DB_URL)

# 2. Define the Target Area
place = "Islamabad, Pakistan"

# 3. Fetch Critical Infrastructure (Hospitals & Fire Stations)
tags = {'amenity': ['hospital', 'fire_station']} 
facilities_gdf = ox.features.features_from_place(place, tags)

# 4. Fetch the Road Network (Drivable Roads)
roads_graph = ox.graph_from_place(place, network_type='drive')
_, roads_gdf = ox.graph_to_gdfs(roads_graph)


# 5. Clean Data
# Reset index for BOTH to flatten the MultiIndex for SQL
facilities_gdf = facilities_gdf.reset_index()
roads_gdf = roads_gdf.reset_index()

# Convert list/dict columns to strings, keeping Nulls as true Nulls
for col in facilities_gdf.columns:
    if facilities_gdf[col].dtype == 'object' and col != 'geometry':
        # Create a mask of rows that are NOT null
        mask = facilities_gdf[col].notna()
        # Apply string conversion only to those specific rows
        facilities_gdf.loc[mask, col] = facilities_gdf.loc[mask, col].astype(str)
        
for col in roads_gdf.columns:
    if roads_gdf[col].dtype == 'object' and col != 'geometry':
        mask = roads_gdf[col].notna()
        roads_gdf.loc[mask, col] = roads_gdf.loc[mask, col].astype(str)
        
# 6. Push to PostGIS
# Use geometry_type="GEOMETRY" for facilities to handle both Points and Polygons
facilities_gdf.to_postgis(
    "critical_facilities", 
    engine, 
    if_exists="replace",
    index=False,
    dtype={'geometry': Geometry('GEOMETRY', srid=4326)} 
)

roads_gdf.to_postgis(
    "road_network", 
    engine, 
    if_exists="replace",
    index=False
)

print("Infrastructure data successfully ingested!")