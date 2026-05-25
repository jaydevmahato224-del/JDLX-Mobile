/**
 * useFrameRate — Detects device display refresh rate (60/90/120Hz)
 * 
 * Uses rAF timestamp deltas to measure actual frame intervals.
 * Sets a CSS class on <html> for frame-rate-adaptive CSS:
 *   - .fps-60  → standard 60Hz devices
 *   - .fps-90  → mid-tier 90Hz devices  
 *   - .fps-120 → high refresh rate 120Hz+ devices
 * 
 * Also exposes the detected tier for JS-level optimizations.
 * 
 * NO UI CHANGES — purely invisible performance detection.
 */

import { useEffect, useRef, useState } from 'react';

// Frame budget in ms for each tier
const FPS_THRESHOLDS = {
  120: 9.5,   // ~8.33ms per frame, but allow measurement jitter
  90: 12.5,   // ~11.11ms per frame
  60: 18.0,   // ~16.67ms per frame (anything above is 60fps or lower)
};

/**
 * Detect the display refresh rate by measuring rAF intervals.
 * Returns 60, 90, or 120.
 */
function detectFrameRate(callback) {
  const samples = [];
  let lastTimestamp = 0;
  let frameId;
  const SAMPLE_COUNT = 20; // Enough samples for reliable detection

  function measure(timestamp) {
    if (lastTimestamp > 0) {
      const delta = timestamp - lastTimestamp;
      // Ignore outliers from tab switching/background (> 50ms)
      if (delta > 0 && delta < 50) {
        samples.push(delta);
      }
    }
    lastTimestamp = timestamp;

    if (samples.length >= SAMPLE_COUNT) {
      // Sort and take median (more robust than average against jitter)
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      let tier = 60;
      if (median <= FPS_THRESHOLDS[120]) {
        tier = 120;
      } else if (median <= FPS_THRESHOLDS[90]) {
        tier = 90;
      }

      callback(tier);
      return;
    }

    frameId = requestAnimationFrame(measure);
  }

  frameId = requestAnimationFrame(measure);

  // Cleanup function
  return () => {
    if (frameId) cancelAnimationFrame(frameId);
  };
}

/**
 * Apply the FPS tier class to <html> element.
 * Removes previous fps classes before applying new one.
 */
function applyFPSClass(tier) {
  const html = document.documentElement;
  html.classList.remove('fps-60', 'fps-90', 'fps-120');
  html.classList.add(`fps-${tier}`);
}

/**
 * React hook for FPS detection.
 * Returns the detected FPS tier (60, 90, or 120).
 * 
 * Usage:
 *   const fpsTier = useFrameRate();
 *   // fpsTier is 60, 90, or 120
 */
export function useFrameRate() {
  const [fpsTier, setFpsTier] = useState(60);
  const detectedRef = useRef(false);

  useEffect(() => {
    // Only detect once per session
    if (detectedRef.current) return;

    // Check if already cached in sessionStorage
    const cached = sessionStorage.getItem('jdlx_fps_tier');
    if (cached) {
      const tier = Number(cached);
      if ([60, 90, 120].includes(tier)) {
        setFpsTier(tier);
        applyFPSClass(tier);
        detectedRef.current = true;
        return;
      }
    }

    // Run detection after initial paint settles
    const timeoutId = setTimeout(() => {
      const cleanup = detectFrameRate((tier) => {
        setFpsTier(tier);
        applyFPSClass(tier);
        sessionStorage.setItem('jdlx_fps_tier', String(tier));
        detectedRef.current = true;
        
        if (import.meta.env.DEV) {
          console.log(
            `%c JDLX PERF: Display detected as ${tier}Hz`,
            'color: #10b981; font-weight: bold;'
          );
        }
      });

      return cleanup;
    }, 500); // Wait 500ms for initial render to settle

    return () => clearTimeout(timeoutId);
  }, []);

  return fpsTier;
}

/**
 * Standalone initializer (non-hook version).
 * Call once at app startup for immediate CSS class application.
 * This runs outside React lifecycle for earliest possible detection.
 */
export function initFrameRateDetection() {
  // Check cache first
  const cached = sessionStorage.getItem('jdlx_fps_tier');
  if (cached && [60, 90, 120].includes(Number(cached))) {
    applyFPSClass(Number(cached));
    return;
  }

  // Default to 60fps class immediately (safe baseline)
  applyFPSClass(60);

  // Then detect actual rate
  setTimeout(() => {
    detectFrameRate((tier) => {
      applyFPSClass(tier);
      sessionStorage.setItem('jdlx_fps_tier', String(tier));
    });
  }, 300);
}

export default useFrameRate;
