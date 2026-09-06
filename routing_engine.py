import os
import osmnx as ox
import networkx as nx
import pyproj
from shapely.geometry import Point, LineString
from shapely.ops import transform

class CongestionModel:
    """Applies realistic traffic congestion delays to road network edges."""
    
    CONGESTION_PROFILES = {
        "moderate": {
            "base_multiplier": 1.8,
            "residential_multiplier": 2.5,
            "trunk_multiplier": 1.4,
            "motorway_multiplier": 1.2,
            "hazard_proximity_bonus": 1.5,
            "intersection_delay_sec": 30,
        },
        "heavy": {
            "base_multiplier": 2.5,
            "residential_multiplier": 3.5,
            "trunk_multiplier": 2.0,
            "motorway_multiplier": 1.5,
            "hazard_proximity_bonus": 2.0,
            "intersection_delay_sec": 60,
        },
        "gridlock": {
            "base_multiplier": 4.0,
            "residential_multiplier": 5.0,
            "trunk_multiplier": 3.0,
            "motorway_multiplier": 2.0,
            "hazard_proximity_bonus": 2.5,
            "intersection_delay_sec": 90,
        },
    }
    
    HAZARD_PROXIMITY_RADIUS_M = 2000  # meters
    
    def __init__(self, level="moderate", hazard_origin=None):
        self.profile = self.CONGESTION_PROFILES.get(level, self.CONGESTION_PROFILES["moderate"])
        self.hazard_origin = hazard_origin  # (lon, lat) or None
    
    def apply(self, G, hazard_origin=None):
        """Apply congestion weights to all edges in graph G in-place."""
        origin = hazard_origin or self.hazard_origin
        
        for u, v, k, data in G.edges(keys=True, data=True):
            raw_time = data.get('travel_time', 0)
            highway_type = data.get('highway', 'unclassified')
            
            # Handle list-type highway tags
            if isinstance(highway_type, list):
                highway_type = highway_type[0] if highway_type else 'unclassified'
            
            # Select multiplier based on road type
            if highway_type in ('motorway', 'motorway_link'):
                multiplier = self.profile['motorway_multiplier']
            elif highway_type in ('trunk', 'trunk_link', 'primary', 'primary_link'):
                multiplier = self.profile['trunk_multiplier']
            elif highway_type in ('residential', 'living_street', 'service'):
                multiplier = self.profile['residential_multiplier']
            else:
                multiplier = self.profile['base_multiplier']
            
            # Add hazard proximity bonus
            if origin:
                edge_mid = self._edge_midpoint(G, u, v, data)
                dist = self._haversine_m(origin[0], origin[1], edge_mid[0], edge_mid[1])
                if dist < self.HAZARD_PROXIMITY_RADIUS_M:
                    proximity_factor = 1.0 + (self.profile['hazard_proximity_bonus'] - 1.0) * (
                        1.0 - dist / self.HAZARD_PROXIMITY_RADIUS_M
                    )
                    multiplier *= proximity_factor
            
            # Apply congested travel time
            congested_time = raw_time * multiplier + self.profile['intersection_delay_sec']
            data['congested_travel_time'] = congested_time
    
    def _edge_midpoint(self, G, u, v, data):
        """Get approximate midpoint of an edge as (lon, lat)."""
        if 'geometry' in data:
            coords = list(data['geometry'].coords)
            mid = coords[len(coords) // 2]
            return mid  # (lon, lat)
        node_u = G.nodes[u]
        node_v = G.nodes[v]
        return ((node_u['x'] + node_v['x']) / 2, (node_u['y'] + node_v['y']) / 2)
    
    @staticmethod
    def _haversine_m(lon1, lat1, lon2, lat2):
        """Fast haversine distance in meters."""
        import math
        R = 6371000
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat/2)**2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
             math.sin(dlon/2)**2)
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

class EvacuationRouter:
    def __init__(self, place_name="Islamabad, Pakistan"):
        print(f"Loading road network graph for {place_name}...")
        graph_file = f"{place_name.replace(', ', '_').replace(' ', '_')}_drive.graphml"
        
        if os.path.exists(graph_file):
            print(f"Loading cached graph from {graph_file}...")
            self.graph = ox.load_graphml(graph_file)
        else:
            print("Downloading from OSM...")
            self.graph = ox.graph_from_place(place_name, network_type='drive')
            self.graph = ox.add_edge_speeds(self.graph)
            self.graph = ox.add_edge_travel_times(self.graph)
            ox.save_graphml(self.graph, graph_file)
            
        print("Road network loaded successfully.")

    def calculate_route(self, start_coords, end_coords, roadblocks=None,
                        enable_congestion=True, congestion_level="moderate",
                        hazard_origin=None):
        G = self.graph.copy()

        # 1. Apply roadblock penalties with True-Scale buffers
        if roadblocks:
            roadblock_buffers = []
            for lon, lat in roadblocks:
                # Dynamic projection centered perfectly on this specific roadblock
                aeqd_proj = f"+proj=aeqd +lat_0={lat} +lon_0={lon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
                project_to_latlon = pyproj.Transformer.from_crs(aeqd_proj, "EPSG:4326", always_xy=True).transform
                
                # Because the projection is centered on the roadblock, (0,0) IS the roadblock
                buf_m = Point(0, 0).buffer(100) # 100 True Meters
                buf_latlon = transform(project_to_latlon, buf_m)
                roadblock_buffers.append(buf_latlon)
                
            edges_to_remove = []
            
            for u, v, k, data in G.edges(keys=True, data=True):
                # Construct geometry for edge
                if 'geometry' in data:
                    edge_geom = data['geometry']
                else:
                    node_u = G.nodes[u]
                    node_v = G.nodes[v]
                    edge_geom = LineString([(node_u['x'], node_u['y']), (node_v['x'], node_v['y'])])

                # Check intersection
                for rb in roadblock_buffers:
                    if edge_geom.intersects(rb):
                        edges_to_remove.append((u, v, k))
                        break # Move to next edge once marked for removal

            for u, v, k in edges_to_remove:
                G.remove_edge(u, v, key=k)

        # 1b. Apply congestion model
        raw_weight = 'travel_time'
        weight_key = 'travel_time'
        if enable_congestion:
            congestion = CongestionModel(level=congestion_level, hazard_origin=hazard_origin)
            congestion.apply(G, hazard_origin=hazard_origin)
            weight_key = 'congested_travel_time'

        # 2. Find nearest graph nodes
        orig_node = ox.distance.nearest_nodes(G, X=start_coords[0], Y=start_coords[1])
        dest_node = ox.distance.nearest_nodes(G, X=end_coords[0], Y=end_coords[1])

        # 3. Compute shortest path
        try:
            route_nodes = nx.shortest_path(G, source=orig_node, target=dest_node, weight=weight_key)
        except nx.NetworkXNoPath:
            return None, 0.0, 0.0

        total_time_seconds = nx.shortest_path_length(G, source=orig_node, target=dest_node, weight=weight_key)
        
        # Also compute raw (free-flow) time for comparison
        if enable_congestion:
            try:
                raw_time_seconds = nx.shortest_path_length(G, source=orig_node, target=dest_node, weight='travel_time')
            except nx.NetworkXNoPath:
                raw_time_seconds = total_time_seconds
        else:
            raw_time_seconds = total_time_seconds

        # 4. Extract highly-accurate route coordinates (including road curves)
        route_coords = []
        for i in range(len(route_nodes) - 1):
            u = route_nodes[i]
            v = route_nodes[i + 1]
            
            # MultiDiGraphs can have parallel edges between nodes; pick the fastest one
            edge_data_dict = G.get_edge_data(u, v)
            best_edge = min(edge_data_dict.values(), key=lambda x: x.get(weight_key, float('inf')))
            
            if 'geometry' in best_edge:
                # Extract LineString coordinates for curved roads
                coords = list(best_edge['geometry'].coords)
                if i > 0: 
                    coords = coords[1:] # Drop first coordinate to prevent duplicates at intersections
                route_coords.extend(coords)
            else:
                # Fallback to straight line if no curve geometry exists
                if i == 0: 
                    route_coords.append((G.nodes[u]['x'], G.nodes[u]['y']))
                route_coords.append((G.nodes[v]['x'], G.nodes[v]['y']))

        # Ensure the route starts at the exact origin and ends at the exact destination
        if route_coords:
            start_pt = (start_coords[0], start_coords[1])
            end_pt = (end_coords[0], end_coords[1])
            if route_coords[0] != start_pt:
                route_coords.insert(0, start_pt)
            if route_coords[-1] != end_pt:
                route_coords.append(end_pt)

        return route_coords, round(total_time_seconds / 60.0, 2), round(raw_time_seconds / 60.0, 2)