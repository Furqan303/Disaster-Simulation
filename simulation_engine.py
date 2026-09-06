import pyproj
from shapely.geometry import Point
from shapely.ops import transform
from shapely.affinity import scale, rotate, translate

def generate_plume_polygons(lon, lat, wind_speed_m_min, wind_dir_deg, max_time_min, step_min):
    """Generates time-series polygons for a chemical spill."""
    
    # 1. Create a dynamic Azimuthal Equidistant projection centered on the spill.
    # This guarantees 1 unit = 1 physical meter anywhere on Earth.
    aeqd_proj = f"+proj=aeqd +lat_0={lat} +lon_0={lon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
    
    project_to_meters = pyproj.Transformer.from_crs("EPSG:4326", aeqd_proj, always_xy=True).transform
    project_to_latlon = pyproj.Transformer.from_crs(aeqd_proj, "EPSG:4326", always_xy=True).transform
    
    features = []
    
    diffusion_rate = wind_speed_m_min * 0.3 # Cloud widens at 30% of wind speed
    
    # Generate a polygon for every time step
    for t in range(step_min, max_time_min + step_min, step_min):
        length = wind_speed_m_min * t
        width = diffusion_rate * t
        
        # 2. Create a base circle (1m radius)
        base_circle = Point(0, 0).buffer(1)
        
        # 3. Stretch it into an ellipse based on wind speed and diffusion
        ellipse = scale(base_circle, xfact=width/2, yfact=length/2)
        
        # 4. Shift the ellipse so the origin point is at the bottom (the spill source)
        shifted_ellipse = translate(ellipse, yoff=length/2)

        # 5. Rotate it to match the wind direction
        # NOTE: If wind_dir_deg is meteorological (where wind comes FROM), use: -(wind_dir_deg + 180)
        # Assuming wind_dir_deg is where the wind is going TO:
        rotated_plume = rotate(shifted_ellipse, -wind_dir_deg, origin=(0, 0))
        
        # Because our custom projection is perfectly centered on our origin, 
        # (0,0) in meters is exactly our lat/lon. No need to translate again!
        plume_m = rotated_plume
        
        # 6. Convert back to Lat/Lon degrees for the web map
        plume_latlon = transform(project_to_latlon, plume_m)
        
        # Append as a GeoJSON Feature
        features.append({
            "type": "Feature",
            "properties": {
                "time_interval": t,
                "hazard_type": "chemical_gas",
                "wind_dir": wind_dir_deg
            },
            "geometry": plume_latlon.__geo_interface__
        })
        
    return features