# Disaster Simulator & Evacuation Routing Engine

A spatial tool and web application designed to simulate environmental disasters (such as chemical spills or avoiding further expansion), estimate at-risk populations, and compute optimal evacuation routes in real-time. This project is specifically configured for Islamabad, Pakistan, utilizing geographic road network data and demographic boundaries.

## Purpose

The primary goal of this project is to provide a decision-support system for emergency response and disaster management. By combining hazard modeling (plume simulation) with spatial demographic data and intelligent routing, the system can answer critical questions during an emergency:
- Where is the hazardous material spreading?
- How many people are in the affected area?
- What are the fastest safe evacuation routes considering traffic congestion and roadblocks?

## Features & How It Works

### 1. Hazard Simulation (Chemical Plumes)
The simulation engine (`simulation_engine.py`) models the spread of a chemical spill or gas leak based on wind speed and wind direction. It generates time-series polygons (GeoJSON) indicating the projected spread of the plume over time, projected accurately onto the map.

### 2. Demographic Analysis & Population at Risk
The tool calculates the population within the hazard zone by intersecting the generated plume polygons with demographic boundary data stored in a PostGIS spatial database. It returns total population counts and density per administrative boundary to assess the scale of the emergency.

### 3. Intelligent Evacuation Routing
The routing engine (`routing_engine.py`) relies on OpenStreetMap (OSMnx) road network graph data. It goes beyond simple shortest-path routing by introducing:
- **Dynamic Roadblocks:** Roads intersecting with designated roadblock points are severed from the routing graph.
- **Congestion Modeling:** Realistic traffic congestion delays are applied based on road types (motorway, residential, etc.) and hazard proximity (cars slow down closer to the hazard). Congestion levels can be adjusted (Moderate, Heavy, Gridlock).

### 4. Interactive Web Interface
A FastAPI backend serves a static frontend application (HTML/JS/CSS) providing a map-based UI for users to place hazards, visualize plumes, block roads, and request evacuation routes dynamically.

## Project Structure

```text
disaster_sim/
├── main.py                          # FastAPI application and API endpoint definitions
├── simulation_engine.py             # Logic for generating time-series disaster plume polygons
├── routing_engine.py                # Graph-based route calculation, handling congestion and roadblocks
├── ingest_demographics.py           # Script to ingest demographic data into the PostGIS database
├── ingest_infrastructure.py         # Script to ingest infrastructure data into the PostGIS database
├── frontend/                        # Static assets (HTML, CSS, JS) for the web application
│   └── index.html                   # Main user interface
├── Islamabad_Pakistan_drive.graphml # Cached OSMnx road network graph for fast routing
├── kontur_boundaries_PK_20230628.gpkg # Geospatial dataset containing demographic population boundaries
└── DEM.tif                          # Digital Elevation Model (Topography) data
```

## Setup and Usage

### Prerequisites
- Python 3.8+
- PostgreSQL with the PostGIS extension installed and running.
- Necessary Python packages (FastAPI, OSMnx, NetworkX, Shapely, SQLAlchemy, psycopg2, pyproj, uvicorn, etc.).

### Installation & Execution

1. **Install Dependencies:**
   Make sure you have all required python packages installed in your environment.

2. **Database Setup:**
   Ensure your PostgreSQL instance is running. The default connection string in `main.py` is `postgresql+psycopg2://postgres:12345@localhost:5432/disaster_sim`. Adjust this via the `DATABASE_URL` environment variable if needed. Use the `ingest_demographics.py` and `ingest_infrastructure.py` scripts to populate the database tables initially.

3. **Run the Application:**
   Start the FastAPI server using Uvicorn:
   ```bash
   uvicorn main:app --reload
   ```

4. **Access the UI:**
   Open a web browser and navigate to `http://localhost:8000` to interact with the map interface.

## API Endpoints Overview

- `POST /api/route/evacuate`: Computes the optimal evacuation route given an origin, destination, roadblocks, and congestion level.
- `GET /api/simulate/chemical-spill`: Generates the time-series polygon GeoJSON for a chemical spill.
- `GET /api/demographics`: Fetches demographic boundary polygons within a specified bounding box.
- `POST /api/demographics/at-risk`: Calculates the population currently at risk within a provided hazard polygon.
