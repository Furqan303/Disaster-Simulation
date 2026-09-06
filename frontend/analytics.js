

window.DisasterSim = window.DisasterSim || {};

DisasterSim.Analytics = (function () {
  'use strict';

  /* ── Constants ─────────────────────────────────── */
  const MAX_POP_FOR_BAR     = 100000; // 100% bar at 100k citizens

  /* ── DOM refs ──────────────────────────────────── */
  const $popAtRisk      = document.getElementById('pop-at-risk');
  const $popTrend       = document.getElementById('pop-trend');
  const $popBar         = document.getElementById('pop-bar');
  const $clearanceTime  = document.getElementById('clearance-time');
  const $roadblockCount = document.getElementById('roadblock-count');
  const $evacZoneCount  = document.getElementById('evac-zone-count');
  const $evacZoneArea   = document.getElementById('evac-zone-area');
  const $triageTotal    = document.getElementById('triage-total');
  const $triageRed      = document.getElementById('triage-red');
  const $triageYellow   = document.getElementById('triage-yellow');
  const $triageGreen    = document.getElementById('triage-green');
  const $routeStatus    = document.getElementById('route-status');
  const $routeCard      = document.getElementById('route-card');
  const popCard         = $popAtRisk ? $popAtRisk.closest('.metric-card') : null;

  /* ── State ─────────────────────────────────────── */
  let lastPop        = 0;
  let currentClearance = null;
  let atRiskTimer      = null;

  /* ── Public API ────────────────────────────────── */
  function init () {
    document.addEventListener('timechange', onTimeChange);
    document.addEventListener('drawupdate', onDrawUpdate);
  }

  function setClearanceTime (minutes) {
    currentClearance = minutes;
    if (minutes === null || minutes === undefined) {
      $clearanceTime.textContent = '— min';
    } else {
      animateValue($clearanceTime, parseFloat(minutes), ' min');
    }
  }

  function setRouteStatus (status) {
    $routeStatus.textContent = status;
    $routeCard.style.borderLeftColor =
      status === 'Blocked'   ? 'var(--danger)' :
      status === 'Ready'     ? 'var(--success)' :
      status === 'Computing' ? 'var(--warning)' :
      'var(--border)';
  }

  /* ── Event Handlers ────────────────────────────── */
  function onTimeChange (e) {
    const t = e.detail.time;
    updatePopulationEstimate(t);
  }

  function onDrawUpdate () {
    updateDrawMetrics();
  }

  /* ── Population At-Risk (Real PostGIS Data) ───── */
  function updatePopulationEstimate (time) {
    var plume = DisasterSim.HazardLayer.getPlumeAtTime(time);

    if (!plume) {
      applyPopulation(0);
      return;
    }

    // Debounce API calls during rapid timeline scrubbing / playback
    clearTimeout(atRiskTimer);
    atRiskTimer = setTimeout(async function () {
      try {
        var result = await DisasterSim.DemographicsLayer.getPopulationAtRisk(plume);
        applyPopulation(Math.round(result.total_population || 0));
      } catch (e) {
        applyPopulation(0);
      }
    }, 300);
  }

  function applyPopulation (pop) {
    // Trend indicator
    if (pop > lastPop) {
      $popTrend.textContent = '▲ ' + (pop - lastPop).toLocaleString();
      $popTrend.className = 'metric-trend up';
    } else if (pop < lastPop) {
      $popTrend.textContent = '▼ ' + (lastPop - pop).toLocaleString();
      $popTrend.className = 'metric-trend down';
    } else {
      $popTrend.textContent = '';
      $popTrend.className = 'metric-trend';
    }
    lastPop = pop;

    // Animated counter
    animateValue($popAtRisk, pop);

    // Progress bar
    var pct = Math.min(100, (pop / MAX_POP_FOR_BAR) * 100);
    $popBar.style.width = pct + '%';

    // Pulse animation on high risk
    if (popCard) {
      popCard.classList.toggle('pulsing', pop > 5000);
    }
  }

  /* ── Draw Metrics ──────────────────────────────── */
  function updateDrawMetrics () {
    const zones  = DisasterSim.DrawTools.getEvacuationZones();
    const pins   = DisasterSim.DrawTools.getTriagePins();
    const blocks = DisasterSim.DrawTools.getRoadblocks();

    // Evacuation zones
    $evacZoneCount.textContent = zones.length;
    let totalArea = 0;
    zones.forEach(z => {
      try { totalArea += turf.area(z.geojson) / 1_000_000; } catch {}
    });
    $evacZoneArea.textContent = totalArea.toFixed(2) + ' km²';

    // Roadblocks
    $roadblockCount.textContent = blocks.length;

    // Triage breakdown
    const cats = { red: 0, yellow: 0, green: 0 };
    pins.forEach(p => { if (p.category && cats.hasOwnProperty(p.category)) cats[p.category]++; });
    $triageTotal.textContent  = pins.length;
    $triageRed.textContent    = cats.red;
    $triageYellow.textContent = cats.yellow;
    $triageGreen.textContent  = cats.green;
  }

  /* ── Helpers ───────────────────────────────────── */

  /** Smooth number animation for a DOM element */
  function animateValue (el, target, suffix) {
    suffix = suffix || '';
    const start   = parseInt(el.textContent.replace(/[^0-9.-]/g, '')) || 0;
    const diff    = target - start;
    if (diff === 0) { el.textContent = target.toLocaleString() + suffix; return; }

    const duration = 400;
    const startTs  = performance.now();

    el.classList.add('updating');

    function step (now) {
      const elapsed = now - startTs;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      const current = Math.round(start + diff * eased);
      el.textContent = current.toLocaleString() + suffix;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = target.toLocaleString() + suffix;
        el.classList.remove('updating');
      }
    }

    requestAnimationFrame(step);
  }

  /* ── Expose ────────────────────────────────────── */
  return { init, setClearanceTime, setRouteStatus };
})();
