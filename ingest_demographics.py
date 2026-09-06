import os
import pyproj

# ✅ CRITICAL: Set PROJ env vars BEFORE any geo library imports,
# so Python uses its own PROJ instead of PostGIS's conflicting one.
proj_path = pyproj.datadir.get_data_dir()
os.environ["PROJ_LIB"] = proj_path
os.environ["PROJ_DATA"] = proj_path

import geopandas as gpd
from sqlalchemy import create_engine

DB_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://postgres:12345@localhost:5432/disaster_sim")
engine = create_engine(DB_URL)

print("Loading local Pakistan population GeoPackage...")
census_gdf = gpd.read_file("kontur_boundaries_PK_20230628.gpkg")

census_gdf.to_postgis("demographics", engine, if_exists="replace", index=False)
print("Pakistan demographic data successfully ingested!")