/* ════════════════════════════════════════════════════
   geocoder.js — Destination Search with Geocoding
   ════════════════════════════════════════════════════
   Provides a search bar in the left sidebar that
   geocodes place names via Nominatim and sets them
   as evacuation destinations on the map.
   ════════════════════════════════════════════════════ */

window.DisasterSim = window.DisasterSim || {};

DisasterSim.Geocoder = (function () {
  'use strict';

  /* ── Config ─────────────────────────────────────── */
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  const DEBOUNCE_MS   = 300;
  const VIEWBOX       = '72.8,33.5,73.3,33.9';  
  const MIN_CHARS     = 3;

  /* ── State ──────────────────────────────────────── */
  let debounceTimer  = null;
  let searchInput    = null;
  let resultsPanel   = null;
  let onSelectCb     = null;  

  /* ── Public API ────────────────────────────────── */
  function init (onDestinationSelect) {
    onSelectCb   = onDestinationSelect;
    searchInput  = document.getElementById('dest-search');
    resultsPanel = document.getElementById('search-results');

    if (!searchInput || !resultsPanel) {
      console.warn('[Geocoder] Search elements not found in DOM');
      return;
    }

    searchInput.addEventListener('input', onInput);
    searchInput.addEventListener('focus', () => {
      if (resultsPanel.children.length > 0) resultsPanel.classList.add('visible');
    });

    // Close results on click outside
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !resultsPanel.contains(e.target)) {
        resultsPanel.classList.remove('visible');
      }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', onKeydown);
  }

  /* ── Event Handlers ────────────────────────────── */
  function onInput () {
    const query = searchInput.value.trim();
    clearTimeout(debounceTimer);

    if (query.length < MIN_CHARS) {
      clearResults();
      return;
    }

    debounceTimer = setTimeout(() => geocode(query), DEBOUNCE_MS);
  }

  function onKeydown (e) {
    const items = resultsPanel.querySelectorAll('.search-result-item');
    if (items.length === 0) return;

    let active = resultsPanel.querySelector('.search-result-item.active');
    let idx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      idx = (idx - 1 + items.length) % items.length;
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) active.click();
      else if (items.length > 0) items[0].click();
    } else if (e.key === 'Escape') {
      clearResults();
      searchInput.blur();
    }
  }

  /* ── Geocoding ─────────────────────────────────── */
  async function geocode (query) {
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        limit: '6',
        viewbox: VIEWBOX,
        bounded: '1',
        countrycodes: 'pk'
      });

      const res = await fetch(`${NOMINATIM_URL}?${params}`, {
        headers: { 'Accept-Language': 'en' }
      });
      const results = await res.json();
      displayResults(results);
    } catch (err) {
      console.error('[Geocoder] Search error:', err);
      clearResults();
    }
  }

  /* ── Results Display ───────────────────────────── */
  function displayResults (results) {
    clearResults();

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-result-empty';
      empty.textContent = 'No results found';
      resultsPanel.appendChild(empty);
      resultsPanel.classList.add('visible');
      return;
    }

    results.forEach((r, i) => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      if (i === 0) item.classList.add('active');

      // Build label
      const name = r.display_name.split(',').slice(0, 3).join(', ');
      const type = r.type ? r.type.replace(/_/g, ' ') : '';

      item.innerHTML = `
        <span class="search-result-name">${name}</span>
        <span class="search-result-type">${type}</span>
      `;

      item.addEventListener('click', () => {
        const coords = [parseFloat(r.lon), parseFloat(r.lat)];
        const label = r.display_name.split(',').slice(0, 2).join(', ');
        selectResult(coords, label);
      });

      item.addEventListener('mouseenter', () => {
        resultsPanel.querySelectorAll('.search-result-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
      });

      resultsPanel.appendChild(item);
    });

    resultsPanel.classList.add('visible');
  }

  function selectResult (coords, label) {
    searchInput.value = label;
    clearResults();

    if (onSelectCb) {
      onSelectCb(coords, label);
    }

    DisasterSim.log(`Destination searched: ${label}`);
  }

  function clearResults () {
    resultsPanel.innerHTML = '';
    resultsPanel.classList.remove('visible');
  }

  /* ── Expose ────────────────────────────────────── */
  return { init };
})();
