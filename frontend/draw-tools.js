/* ════════════════════════════════════════════════════
   draw-tools.js — Spatial Drawing (Geoman + fallback)
   ════════════════════════════════════════════════════

   Tries to use MapLibre-Geoman if the CDN loaded it.
   Falls back to a lightweight custom drawing engine
   built on native MapLibre GL events.
   ════════════════════════════════════════════════════ */

window.DisasterSim = window.DisasterSim || {};

DisasterSim.DrawTools = (function () {
  'use strict';

  /* ── State ─────────────────────────────────────── */
  let map = null;
  let currentTool = null;          
  let geomanInstance = null;

  // Feature stores
  const evacuationZones = [];     
  const triagePins      = [];      
  const roadblocks      = [];      

  let featureIdCounter = 0;

  // Temp state for multi-click drawing
  let drawBuffer     = [];        
  let tempLineSource = null;
  let activePopup    = null;

  /* ── Public API ────────────────────────────────── */
  function init (mapInstance) {
    map = mapInstance;
    setupSources();
    bindToolbar();
    bindMapEvents();

    // Try Geoman
    if (typeof Geoman === 'function') {
      try {
        geomanInstance = new Geoman(map);
        console.log('[DrawTools] Geoman initialised');
        map.on('gm:loaded', () => {
          console.log('[DrawTools] Geoman fully loaded');
        });
      } catch (err) {
        console.warn('[DrawTools] Geoman init failed, using custom tools', err);
        geomanInstance = null;
      }
    } else {
      console.log('[DrawTools] Geoman not available — custom draw tools active');
    }
  }

  function getEvacuationZones () { return evacuationZones; }
  function getTriagePins      () { return triagePins; }
  function getRoadblocks      () { return roadblocks; }

  /** Returns all roadblock vertex coordinates as [lon, lat] pairs for the routing API. */
  function getRoadblockCoords () {
    const coords = [];
    roadblocks.forEach(rb => {
      const geom = rb.geojson.geometry;
      if (geom.type === 'LineString') {
        geom.coordinates.forEach(c => coords.push(c));
      }
    });
    return coords;
  }

  /* ── GeoJSON Sources ───────────────────────────── */
  function setupSources () {
    // Evacuation zones (polygons)
    map.addSource('evac-zones', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'evac-zones-fill', type: 'fill', source: 'evac-zones',
      paint: { 'fill-color': 'rgba(59,130,246,0.2)', 'fill-outline-color': '#3b82f6' }
    });
    map.addLayer({
      id: 'evac-zones-line', type: 'line', source: 'evac-zones',
      paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [4, 2] }
    });

    // Roadblock lines
    map.addSource('roadblocks', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'roadblocks-line', type: 'line', source: 'roadblocks',
      paint: { 'line-color': '#ef4444', 'line-width': 4, 'line-dasharray': [2, 2] }
    });
    map.addLayer({
      id: 'roadblocks-symbol', type: 'circle', source: 'roadblocks',
      paint: { 'circle-radius': 4, 'circle-color': '#ef4444', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
      filter: ['==', '$type', 'Point']  
    });

    // Temp draw line (preview while drawing)
    map.addSource('draw-temp', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'draw-temp-line', type: 'line', source: 'draw-temp',
      paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [3, 3] }
    });
  }

  /* ── Toolbar ───────────────────────────────────── */
  function bindToolbar () {
    document.querySelectorAll('#draw-toolbar .tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;

        if (tool === 'clear') {
          clearAll();
          return;
        }

        // Toggle tool
        if (currentTool === tool) {
          deactivateTool();
        } else {
          activateTool(tool);
        }
      });
    });
  }

  function activateTool (tool) {
    deactivateTool();
    currentTool = tool;

    // Highlight button
    document.querySelectorAll('#draw-toolbar .tool-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === tool)
    );

    // Set cursor
    map.getCanvas().style.cursor = tool === 'delete' ? 'not-allowed' : 'crosshair';

    // Hint text
    const hints = {
      polygon: 'Click to place vertices. Double-click to finish polygon.',
      point:   'Click to place a triage pin.',
      line:    'Click to start line. Double-click to finish roadblock.',
      delete:  'Click a drawn feature to delete it.'
    };
    document.getElementById('draw-hint').textContent = hints[tool] || '';
  }

  function deactivateTool () {
    currentTool = null;
    drawBuffer = [];
    updateTempLine([]);
    map.getCanvas().style.cursor = '';
    document.querySelectorAll('#draw-toolbar .tool-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('draw-hint').textContent = '';
  }

  /* ── Map Events ────────────────────────────────── */
  function bindMapEvents () {

    map.on('click', (e) => {
      if (!currentTool) return;
      const lngLat = [e.lngLat.lng, e.lngLat.lat];

      switch (currentTool) {
        case 'point':
          placeTriagePin(e.lngLat);
          break;

        case 'polygon':
        case 'line':
          drawBuffer.push(lngLat);
          updateTempLine(drawBuffer);
          break;

        case 'delete':
          tryDeleteFeature(e);
          break;
      }
    });

    map.on('dblclick', (e) => {
      if (!currentTool) return;
      e.preventDefault();

      if (currentTool === 'polygon' && drawBuffer.length >= 3) {
        finishPolygon();
      } else if (currentTool === 'line' && drawBuffer.length >= 2) {
        finishLine();
      }
    });

    map.on('mousemove', (e) => {
      if (!currentTool || (currentTool !== 'polygon' && currentTool !== 'line')) return;
      if (drawBuffer.length === 0) return;

      // Live preview: temp line from last vertex to cursor
      const preview = [...drawBuffer, [e.lngLat.lng, e.lngLat.lat]];
      updateTempLine(preview);
    });

    // Keyboard shortcut: Escape to cancel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        deactivateTool();
      }
    });
  }

  /* ── Drawing Actions ───────────────────────────── */

  function finishPolygon () {
    const coords = [...drawBuffer, drawBuffer[0]]; 
    const id = `evac-${++featureIdCounter}`;
    const geojson = {
      type: 'Feature',
      properties: { id, featureType: 'evacuation-zone' },
      geometry: { type: 'Polygon', coordinates: [coords] }
    };
    evacuationZones.push({ id, geojson });
    refreshEvacSource();
    drawBuffer = [];
    updateTempLine([]);
    broadcast();
    DisasterSim.log('Evacuation zone drawn');
  }

  function finishLine () {
    const id = `rb-${++featureIdCounter}`;
    const geojson = {
      type: 'Feature',
      properties: { id, featureType: 'roadblock' },
      geometry: { type: 'LineString', coordinates: [...drawBuffer] }
    };
    roadblocks.push({ id, geojson });
    refreshRoadblockSource();
    drawBuffer = [];
    updateTempLine([]);
    broadcast();
    DisasterSim.log('Roadblock placed');
  }

  function placeTriagePin (lngLat) {
    const id = `tp-${++featureIdCounter}`;

    // Create marker element
    const el = document.createElement('div');
    el.style.cssText = 'width:24px;height:24px;border-radius:50%;border:2px solid #fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;';
    el.style.background = '#94a3b8';
    el.textContent = '?';

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(lngLat)
      .addTo(map);

    const pin = { id, lngLat: [lngLat.lng, lngLat.lat], category: null, marker };
    triagePins.push(pin);

    // Show category picker popup
    showTriagePopup(lngLat, pin, el);
    broadcast();
    DisasterSim.log('Triage pin placed — select category');
  }

  function showTriagePopup (lngLat, pin, markerEl) {
    if (activePopup) activePopup.remove();

    const html = `
      <div class="triage-popup-title">Triage Category</div>
      <div class="triage-popup-btns">
        <button class="triage-popup-btn cat-red"    data-cat="red">🔴 Immediate (Critical)</button>
        <button class="triage-popup-btn cat-yellow" data-cat="yellow">🟡 Delayed (Urgent)</button>
        <button class="triage-popup-btn cat-green"  data-cat="green">🟢 Minor (Walking)</button>
      </div>`;

    activePopup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '220px' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);

    const colors = { red: '#ef4444', yellow: '#f59e0b', green: '#10b981' };
    const labels = { red: '!', yellow: '?', green: '✓' };

    // Bind buttons inside popup
    setTimeout(() => {
      activePopup.getElement().querySelectorAll('.triage-popup-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const cat = btn.dataset.cat;
          pin.category = cat;
          markerEl.style.background = colors[cat];
          markerEl.textContent = labels[cat];
          activePopup.remove();
          activePopup = null;
          broadcast();
          DisasterSim.log(`Triage pin set: ${cat.toUpperCase()}`);
        });
      });
    }, 50);
  }

  /* ── Delete ────────────────────────────────────── */
  function tryDeleteFeature (e) {
    const point = e.point;

    // Check evacuation zone layers
    const evacHits = map.queryRenderedFeatures(point, { layers: ['evac-zones-fill'] });
    if (evacHits.length > 0) {
      const hitId = evacHits[0].properties.id;
      const idx = evacuationZones.findIndex(z => z.id === hitId);
      if (idx !== -1) { evacuationZones.splice(idx, 1); refreshEvacSource(); }
      broadcast();
      DisasterSim.log('Evacuation zone deleted');
      return;
    }

    // Check roadblock layers
    const rbHits = map.queryRenderedFeatures(
      [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]],
      { layers: ['roadblocks-line'] }
    );
    if (rbHits.length > 0) {
      const hitId = rbHits[0].properties.id;
      const idx = roadblocks.findIndex(r => r.id === hitId);
      if (idx !== -1) { roadblocks.splice(idx, 1); refreshRoadblockSource(); }
      broadcast();
      DisasterSim.log('Roadblock deleted');
      return;
    }

    // Check triage pins (markers — need to check proximity)
    const clickLng = e.lngLat.lng;
    const clickLat = e.lngLat.lat;
    let closestIdx = -1;
    let closestDist = Infinity;
    triagePins.forEach((pin, i) => {
      const d = Math.hypot(pin.lngLat[0] - clickLng, pin.lngLat[1] - clickLat);
      if (d < closestDist) { closestDist = d; closestIdx = i; }
    });
    // ~0.0005 degrees ≈ ~50 m at Islamabad latitude — close enough for a click
    if (closestIdx >= 0 && closestDist < 0.0005) {
      triagePins[closestIdx].marker.remove();
      triagePins.splice(closestIdx, 1);
      broadcast();
      DisasterSim.log('Triage pin deleted');
    }
  }

  function clearAll () {
    evacuationZones.length = 0;
    roadblocks.length = 0;
    triagePins.forEach(p => p.marker.remove());
    triagePins.length = 0;
    refreshEvacSource();
    refreshRoadblockSource();
    drawBuffer = [];
    updateTempLine([]);
    broadcast();
    DisasterSim.log('All drawn features cleared');
    deactivateTool();
  }

  /* ── Source Refresh ────────────────────────────── */
  function refreshEvacSource () {
    const src = map.getSource('evac-zones');
    if (src) src.setData({ type: 'FeatureCollection', features: evacuationZones.map(z => z.geojson) });
  }

  function refreshRoadblockSource () {
    const src = map.getSource('roadblocks');
    if (src) src.setData({ type: 'FeatureCollection', features: roadblocks.map(r => r.geojson) });
  }

  function updateTempLine (coords) {
    const src = map.getSource('draw-temp');
    if (!src) return;
    if (coords.length < 2) {
      src.setData(emptyFC());
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: coords }
      }]
    });
  }

  /* ── Helpers ───────────────────────────────────── */
  function emptyFC () {
    return { type: 'FeatureCollection', features: [] };
  }

  function broadcast () {
    document.dispatchEvent(new CustomEvent('drawupdate', {
      detail: {
        evacuationZones: evacuationZones.length,
        triagePins:      triagePins.length,
        roadblocks:      roadblocks.length
      }
    }));
  }

  /* ── Expose ────────────────────────────────────── */
  return {
    init,
    getEvacuationZones,
    getTriagePins,
    getRoadblocks,
    getRoadblockCoords,
    clearAll
  };
})();
