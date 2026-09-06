/* ════════════════════════════════════════════════════
   hazard-layer.js — Chemical Plume Visualization
   ════════════════════════════════════════════════════ */

window.DisasterSim = window.DisasterSim || {};

DisasterSim.HazardLayer = (function () {
  'use strict';

  let map           = null;
  let features      = [];   
  let sourceAdded   = false;
  let spillMarker   = null;

  /* Plume color ramp: time → color */
  const COLOR_MAP = {
    15: 'rgba(250, 204,  21, 0.45)',   // yellow
    30: 'rgba(251, 146,  60, 0.50)',   // orange
    45: 'rgba(239,  68,  68, 0.55)',   // red
    60: 'rgba(153,  27,  27, 0.60)',   // dark red
  };

  const OUTLINE_MAP = {
    15: 'rgba(250, 204,  21, 0.8)',
    30: 'rgba(251, 146,  60, 0.8)',
    45: 'rgba(239,  68,  68, 0.8)',
    60: 'rgba(153,  27,  27, 0.8)',
  };

  /* ── Public API ────────────────────────────────── */
  function init (mapInstance) {
    map = mapInstance;
    document.addEventListener('timechange', onTimeChange);
  }

  async function loadSimulation (lon, lat, windSpeed, windDir) {
    const url = `/api/simulate/chemical-spill?lon=${lon}&lat=${lat}&wind_speed=${windSpeed}&wind_dir=${windDir}`;

    const res  = await fetch(url);
    const data = await res.json();
    features   = data.features || [];

    addSpillMarker(lon, lat);
    renderLayers();

    return features;
  }

  function getFeatures () { return features; }

  /** Return the plume polygon GeoJSON for a given time (snapped to 15-min step). */
  function getPlumeAtTime (t) {
    const step = snapToStep(t);
    return features.find(f => f.properties.time_interval === step) || null;
  }

  /* ── Internals ─────────────────────────────────── */

  function snapToStep (t) {
    // Snap to nearest 15-min step (0 → no plume, 1-15 → 15, 16-30 → 30, etc.)
    if (t <= 0) return 0;
    return Math.min(60, Math.ceil(t / 15) * 15);
  }

  function addSpillMarker (lon, lat) {
    if (spillMarker) spillMarker.remove();
    const el = document.createElement('div');
    el.className = 'Hazard-marker';
    el.title = 'Hazard Source';
    spillMarker = new maplibregl.Marker({ element: el })
      .setLngLat([lon, lat])
      .addTo(map);
  }

  function renderLayers () {
    // Remove old layers & sources
    [15, 30, 45, 60].forEach(t => {
      const layerFill = `plume-fill-${t}`;
      const layerLine = `plume-outline-${t}`;
      const srcId     = `plume-src-${t}`;
      if (map.getLayer(layerFill))   map.removeLayer(layerFill);
      if (map.getLayer(layerLine))   map.removeLayer(layerLine);
      if (map.getSource(srcId))      map.removeSource(srcId);
    });

    // Add a source + fill + outline layer for each time step
    features.forEach(f => {
      const t     = f.properties.time_interval;
      const srcId = `plume-src-${t}`;

      map.addSource(srcId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [f] }
      });

      map.addLayer({
        id:     `plume-fill-${t}`,
        type:   'fill',
        source: srcId,
        paint: {
          'fill-color':   COLOR_MAP[t]   || 'rgba(239,68,68,0.4)',
          'fill-opacity': 0   
        }
      });

      map.addLayer({
        id:     `plume-outline-${t}`,
        type:   'line',
        source: srcId,
        paint: {
          'line-color':   OUTLINE_MAP[t] || 'rgba(239,68,68,0.8)',
          'line-width':   1.5,
          'line-opacity':  0
        }
      });
    });

    sourceAdded = true;
  }

  function onTimeChange (e) {
    if (!sourceAdded) return;
    const currentTime = e.detail.time;
    const activeStep  = snapToStep(currentTime);

    [15, 30, 45, 60].forEach(t => {
      const show    = (t <= activeStep && activeStep > 0);
      // Older plumes get slightly more transparent
      const ageFade = show ? Math.max(0.3, 1 - (activeStep - t) / 60) : 0;

      if (map.getLayer(`plume-fill-${t}`)) {
        map.setPaintProperty(`plume-fill-${t}`, 'fill-opacity', show ? ageFade : 0);
      }
      if (map.getLayer(`plume-outline-${t}`)) {
        map.setPaintProperty(`plume-outline-${t}`, 'line-opacity', show ? Math.min(1, ageFade + 0.2) : 0);
      }
    });
  }

  /* ── Expose ────────────────────────────────────── */
  return { init, loadSimulation, getFeatures, getPlumeAtTime };
})();
