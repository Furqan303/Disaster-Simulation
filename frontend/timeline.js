/* ════════════════════════════════════════════════════
   timeline.js — Vertical Timeline Slider + Playback
   ════════════════════════════════════════════════════ */

window.DisasterSim = window.DisasterSim || {};

DisasterSim.Timeline = (function () {
  'use strict';

  /* ── DOM refs ──────────────────────────────────── */
  const slider     = document.getElementById('timeline-slider');
  const timeValue  = document.getElementById('current-time-value');
  const playBtn    = document.getElementById('play-btn');
  const playIcon   = document.getElementById('play-icon');
  

  /* ── State ─────────────────────────────────────── */
  let currentTime = 0;     
  let isPlaying   = false;
  let speed       = 1;     
  let intervalId  = null;
  const STEP      = 15;    
  const MAX_TIME  = 60;
  const TICK_MS   = 1000;  

  /* ── Public API ────────────────────────────────── */
  function init () {
    slider.addEventListener('input', onSliderInput);
    playBtn.addEventListener('click', togglePlay);
    broadcast(currentTime);
  }

  function getTime () { return currentTime; }

  /* ── Internals ─────────────────────────────────── */
  function onSliderInput () {
    currentTime = Number(slider.value);
    updateUI();
    broadcast(currentTime);
  }

  function togglePlay () {
    isPlaying = !isPlaying;
    playIcon.textContent = isPlaying ? '⏸' : '▶';
    playBtn.classList.toggle('active', isPlaying);

    if (isPlaying) {
      // If at end, restart from 0
      if (currentTime >= MAX_TIME) { setTime(0); }
      startInterval();
    } else {
      stopInterval();
    }
  }

  function startInterval () {
    stopInterval();
    intervalId = setInterval(() => {
      currentTime += 1;
      if (currentTime >= MAX_TIME) {
        currentTime = MAX_TIME;
        stopInterval();
        isPlaying = false;
        playIcon.textContent = '▶';
        playBtn.classList.remove('active');
      }
      slider.value = currentTime;
      updateUI();
      broadcast(currentTime);
    }, TICK_MS / speed);
  }

  function stopInterval () {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }

  function setTime (t) {
    currentTime = Math.max(0, Math.min(MAX_TIME, t));
    slider.value = currentTime;
    updateUI();
    broadcast(currentTime);
  }

  function updateUI () {
    timeValue.textContent = currentTime;
  }

  function broadcast (t) {
    document.dispatchEvent(new CustomEvent('timechange', { detail: { time: t } }));
  }

  /* ── Expose ────────────────────────────────────── */
  return { init, getTime, setTime };
})();
