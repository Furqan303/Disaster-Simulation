/* ════════════════════════════════════════════════════
   app.js — Main Application Orchestrator
   ════════════════════════════════════════════════════
   Initialises the map, wires up all modules, and
   handles evacuation route computation.
   ════════════════════════════════════════════════════ */

window.DisasterSim = window.DisasterSim || {};

/** Global activity-log helper used by all modules. */
DisasterSim.log = function (msg) {
  const log = document.getElementById('activity-log');
  if (!log) return;
  const now = new Date();
  const ts  = now.toTimeString().slice(0, 5);
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${ts}</span><span class="log-msg">${msg}</span>`;
  log.prepend(entry);          // newest on top
  // Keep max 50 entries
  while (log.children.length > 50) log.removeChild(log.lastChild);
};

/* ── Boot ────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────── */
  let map           = null;
  let originCoords  = null;   
  let destCoords    = null;   
  let pickingMode   = null;   
  let originMarker  = null;
  let destMarker    = null;
  let routeLayerAdded = false;

  /* ── Map Initialisation ────────────────────────── */
const ISLAMABAD = [73.0479, 33.6844];
const MAPTILER_KEY = 'T8mvh81XAiQoh2dBJMXV'; 

 map = new maplibregl.Map({
  container: 'map',
  // Replaces the massive object with a single URL pointing to a dark vector style
  style: `https://api.maptiler.com/maps/basic-v2-dark/style.json?key=${MAPTILER_KEY}`,
  center: ISLAMABAD,
  zoom: 12,
  maxZoom: 18,
  minZoom: 5
});

  /* ── When map ready ────────────────────────────── */
  map.on('load', () => {
    // Init all modules
    DisasterSim.Timeline.init();
    DisasterSim.HazardLayer.init(map);
    DisasterSim.DrawTools.init(map);
    DisasterSim.Analytics.init();

    // Init geocoder with destination callback
    DisasterSim.Geocoder.init(function (coords, label) {
      destCoords = coords;
      setPickMarker('destination', coords);
      document.getElementById('dest-display').textContent = 'Dest: ' + label;
      map.flyTo({ center: coords, zoom: 15, duration: 1500 });
    });

    // Wire up controls
    bindSimControls();
    bindEvacControls();
    bindMapStatus();

    // Auto-run initial simulation
    runSimulation();

    DisasterSim.log('Dashboard initialised — Islamabad, Pakistan');
  });

  /* ── Simulation Controls ───────────────────────── */
  function bindSimControls () {
    document.getElementById('run-sim-btn').addEventListener('click', runSimulation);
  }

  async function runSimulation () {
    const btn = document.getElementById('run-sim-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    const lon   = parseFloat(document.getElementById('spill-lon').value)   || ISLAMABAD[0];
    const lat   = parseFloat(document.getElementById('spill-lat').value)   || ISLAMABAD[1];
    const speed = parseFloat(document.getElementById('wind-speed').value)  || 50;
    const dir   = parseFloat(document.getElementById('wind-dir').value)    || 45;

    DisasterSim.log(`Running simulation: wind ${speed} m/min @ ${dir}°`);

    try {
      const features = await DisasterSim.HazardLayer.loadSimulation(lon, lat, speed, dir);
      DisasterSim.log(`Simulation complete: ${features.length} plume polygons generated`);

      // Reset timeline to 0 and let user play
      DisasterSim.Timeline.setTime(0);

      // Fly to spill location
      map.flyTo({ center: [lon, lat], zoom: 13, duration: 1500 });
    } catch (err) {
      DisasterSim.log(`Simulation error: ${err.message}`);
      console.error(err);
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  /* ── Evacuation Route Controls ─────────────────── */
  function bindEvacControls () {
    document.getElementById('set-origin-btn').addEventListener('click', () => {
      pickingMode = 'origin';
      document.getElementById('set-origin-btn').classList.add('active');
      document.getElementById('set-dest-btn').classList.remove('active');
      document.getElementById('draw-hint').textContent = 'Click map to set evacuation origin';
      map.getCanvas().style.cursor = 'crosshair';
    });

    document.getElementById('set-dest-btn').addEventListener('click', () => {
      pickingMode = 'destination';
      document.getElementById('set-dest-btn').classList.add('active');
      document.getElementById('set-origin-btn').classList.remove('active');
      document.getElementById('draw-hint').textContent = 'Click map to set evacuation destination';
      map.getCanvas().style.cursor = 'crosshair';
    });

    document.getElementById('compute-route-btn').addEventListener('click', computeRoute);

    // Map click for origin/dest picking
    map.on('click', (e) => {
      if (!pickingMode) return;

      const lngLat = [e.lngLat.lng, e.lngLat.lat];

      if (pickingMode === 'origin') {
        originCoords = lngLat;
        setPickMarker('origin', lngLat);
        document.getElementById('origin-display').textContent =
          `Origin: ${lngLat[1].toFixed(4)}, ${lngLat[0].toFixed(4)}`;
        DisasterSim.log(`Origin set: ${lngLat[1].toFixed(4)}°N, ${lngLat[0].toFixed(4)}°E`);
      } else {
        destCoords = lngLat;
        setPickMarker('destination', lngLat);
        document.getElementById('dest-display').textContent =
          `Dest: ${lngLat[1].toFixed(4)}, ${lngLat[0].toFixed(4)}`;
        DisasterSim.log(`Destination set: ${lngLat[1].toFixed(4)}°N, ${lngLat[0].toFixed(4)}°E`);
      }

      pickingMode = null;
      document.getElementById('set-origin-btn').classList.remove('active');
      document.getElementById('set-dest-btn').classList.remove('active');
      document.getElementById('draw-hint').textContent = '';
      map.getCanvas().style.cursor = '';
    });
  }

  function setPickMarker (type, coords) {
    const isOrigin = type === 'origin';
    const marker   = isOrigin ? originMarker : destMarker;
    if (marker) marker.remove();

    const el = document.createElement('div');
    el.className = isOrigin ? 'origin-marker' : 'dest-marker';

    const newMarker = new maplibregl.Marker({ element: el })
      .setLngLat(coords)
      .addTo(map);

    if (isOrigin) originMarker = newMarker;
    else          destMarker   = newMarker;
  }

  async function computeRoute () {
    if (!originCoords || !destCoords) {
      DisasterSim.log('⚠ Set both origin and destination first');
      return;
    }

    const btn = document.getElementById('compute-route-btn');
    btn.classList.add('loading');
    btn.disabled = true;
    DisasterSim.Analytics.setRouteStatus('Computing');

    const roadblockCoords = DisasterSim.DrawTools.getRoadblockCoords();

    // Get spill location for hazard proximity delays
    const spillLon = parseFloat(document.getElementById('spill-lon').value) || ISLAMABAD[0];
    const spillLat = parseFloat(document.getElementById('spill-lat').value) || ISLAMABAD[1];

    const body = {
      origin:            originCoords,
      destination:       destCoords,
      roadblocks:        roadblockCoords,
      enable_congestion: true,
      congestion_level:  'moderate',
      hazard_origin:     [spillLon, spillLat]
    };

    DisasterSim.log(`Computing route with ${roadblockCoords.length} roadblock points…`);

    try {
      const res  = await fetch('/api/route/evacuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (data.status === 'blocked') {
        DisasterSim.Analytics.setRouteStatus('Blocked');
        DisasterSim.Analytics.setClearanceTime(null);
        DisasterSim.log('⚠ Route BLOCKED — no viable path found');
        removeRouteLayer();
      } else {
        DisasterSim.Analytics.setRouteStatus('Ready');
        DisasterSim.Analytics.setClearanceTime(data.travel_time_minutes);
        DisasterSim.log(`Route found: ${data.travel_time_minutes} min (free-flow: ${data.raw_travel_time_minutes} min)`);

        renderRoute(data.geojson);
      }
    } catch (err) {
      DisasterSim.Analytics.setRouteStatus('Error');
      DisasterSim.log(`Route error: ${err.message}`);
      console.error(err);
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  /* ── Route Rendering ───────────────────────────── */
  function renderRoute (geojson) {
    removeRouteLayer();

    map.addSource('evac-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [geojson] }
    });

    // Glow effect (wider, semi-transparent)
    map.addLayer({
      id: 'evac-route-glow',
      type: 'line',
      source: 'evac-route',
      paint: {
        'line-color': '#10b981',
        'line-width': 8,
        'line-opacity': 0.3,
        'line-blur': 3
      }
    });

    // Main route line
    map.addLayer({
      id: 'evac-route-line',
      type: 'line',
      source: 'evac-route',
      paint: {
        'line-color': '#10b981',
        'line-width': 3,
        'line-opacity': 0.9
      }
    });

    routeLayerAdded = true;

    // Fit bounds to route
    try {
      const coords = geojson.geometry.coordinates;
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 80, duration: 1000 });
    } catch {}
  }

  function removeRouteLayer () {
    if (!routeLayerAdded) return;
    ['evac-route-glow', 'evac-route-line'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('evac-route')) map.removeSource('evac-route');
    routeLayerAdded = false;
  }

  /* ── Map Status Bar ────────────────────────────── */
  function bindMapStatus () {
    const $coords = document.getElementById('map-coords');
    const $zoom   = document.getElementById('map-zoom');

    map.on('mousemove', (e) => {
      $coords.textContent = `${e.lngLat.lat.toFixed(4)}°N, ${e.lngLat.lng.toFixed(4)}°E`;
    });

    map.on('zoomend', () => {
      $zoom.textContent = `Z: ${map.getZoom().toFixed(1)}`;
    });
  }

})();
