/* ════════════════════════════════════════════════════
   demographics-layer.js — Real Population Choropleth
   ════════════════════════════════════════════════════
   Fetches Kontur population polygons from PostGIS and
   renders a density-based choropleth on the map.
   Also provides getPopulationAtRisk() for the analytics
   panel to query real spatial intersections.
   ════════════════════════════════════════════════════ */

window.DisasterSim = window.DisasterSim || {};

DisasterSim.DemographicsLayer = (function () {
  'use strict';

  /* ── State ─────────────────────────────────────── */
  let map        = null;
  let layerAdded = false;
  let visible    = true;
  let moveTimer  = null;

  /* ── Colour ramp (population density per km²) ──── */
  const FILL_COLORS = [
    'interpolate', ['linear'], ['get', 'pop_density_km2'],
    0,     'rgba(44, 123, 182, 0.25)',   // sparse — cool blue
    500,   'rgba(171, 217, 233, 0.35)',  // low
    1500,  'rgba(255, 255, 191, 0.40)',  // medium — pale yellow
    3000,  'rgba(253, 174, 97,  0.50)',  // high — orange
    6000,  'rgba(215, 48,  39,  0.55)'   // very dense — red
  ];

  /* ── Public API ────────────────────────────────── */
  function init (mapInstance) {
    map = mapInstance;
    loadDemographics();
    map.on('moveend', function () {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(loadDemographics, 600);
    });
  }

  async function loadDemographics () {
    if (!map) return;
    var b = map.getBounds();
    var bbox = b.getWest() + ',' + b.getSouth() + ',' + b.getEast() + ',' + b.getNorth();

    try {
      var res  = await fetch('/api/demographics?bbox=' + bbox);
      var data = await res.json();
      if (data.error) { console.warn('Demographics API:', data.error); return; }
      renderChoropleth(data);
    } catch (err) {
      console.error('Demographics load error:', err);
    }
  }

  /* ── Render / update choropleth ────────────────── */
  function renderChoropleth (geojson) {
    // If source already exists, just swap data — preserves layer ordering
    if (layerAdded) {
      var src = map.getSource('demographics-src');
      if (src) src.setData(geojson);
      return;
    }

    map.addSource('demographics-src', { type: 'geojson', data: geojson });

    // Insert below the first plume layer so the hazard always renders on top
    var beforeId;
    var steps = [15, 30, 45, 60];
    for (var i = 0; i < steps.length; i++) {
      if (map.getLayer('plume-fill-' + steps[i])) { beforeId = 'plume-fill-' + steps[i]; break; }
    }

    map.addLayer({
      id:     'demographics-fill',
      type:   'fill',
      source: 'demographics-src',
      paint:  { 'fill-color': FILL_COLORS, 'fill-opacity': 0.6 }
    }, beforeId);

    map.addLayer({
      id:     'demographics-outline',
      type:   'line',
      source: 'demographics-src',
      paint:  { 'line-color': 'rgba(255,255,255,0.25)', 'line-width': 0.5 }
    }, beforeId);

    layerAdded = true;
    DisasterSim.log('Demographics overlay loaded from PostGIS');
  }

  /* ── Spatial query: real population inside a plume */
  async function getPopulationAtRisk (plumeFeature) {
    var geom = plumeFeature.geometry || plumeFeature;
    try {
      var res = await fetch('/api/demographics/at-risk', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plume_geojson: geom })
      });
      return await res.json();
    } catch (err) {
      console.error('At-risk query error:', err);
      return { total_population: 0, polygons_hit: 0 };
    }
  }

  /* ── Visibility toggle ────────────────────────── */
  function toggle (show) {
    visible = show;
    if (!layerAdded) return;
    var vis = show ? 'visible' : 'none';
    map.setLayoutProperty('demographics-fill',    'visibility', vis);
    map.setLayoutProperty('demographics-outline',  'visibility', vis);
  }

  function isVisible () { return visible; }

  /* ── Expose ────────────────────────────────────── */
  return { init: init, loadDemographics: loadDemographics, getPopulationAtRisk: getPopulationAtRisk, toggle: toggle, isVisible: isVisible };
})();
