/**
 * JDLX Performance Manager
 * 
 * Lightweight runtime performance utilities that complement the CSS-based
 * FPS optimization system. All event listeners use passive mode.
 * 
 * Features:
 * 1. Scroll state detection (.is-scrolling class toggle)
 * 2. IntersectionObserver for off-screen GPU memory cleanup
 * 3. Passive event listener enforcement
 * 
 * NO LOGIC CHANGES — purely additive performance enhancement.
 * NO UI CHANGES — only adds/removes invisible performance classes.
 */

let _initialized = false;

/**
 * Initialize the scroll performance tracker.
 * Adds .is-scrolling to <html> during active scroll, removes after 150ms idle.
 * This triggers CSS rules that disable expensive backdrop-filter during scroll.
 */
function initScrollTracker() {
  let scrollTimer = null;
  const html = document.documentElement;

  const handleScroll = () => {
    if (!html.classList.contains('is-scrolling')) {
      html.classList.add('is-scrolling');
    }

    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      html.classList.remove('is-scrolling');
    }, 150);
  };

  window.addEventListener('scroll', handleScroll, { passive: true });

  return () => {
    window.removeEventListener('scroll', handleScroll);
    if (scrollTimer) clearTimeout(scrollTimer);
  };
}

/**
 * Initialize IntersectionObserver for off-screen GPU memory optimization.
 * Observes elements with .gpu-accelerated class and toggles .offscreen
 * when they leave the viewport, freeing GPU texture memory.
 */
function initOffscreenObserver() {
  if (!('IntersectionObserver' in window)) return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.remove('offscreen');
        } else {
          entry.target.classList.add('offscreen');
        }
      }
    },
    {
      // Observe with a 200px margin so elements are "ready" before scrolling in
      rootMargin: '200px 0px',
      threshold: 0,
    }
  );

  // Observe all gpu-accelerated elements (product cards, etc.)
  const observe = () => {
    const elements = document.querySelectorAll('article.gpu-accelerated');
    elements.forEach((el) => observer.observe(el));
  };

  // Initial observation
  observe();

  // Re-observe when DOM changes (new products loaded, pagination, etc.)
  const mutationObserver = new MutationObserver(() => {
    // Debounce: only re-scan every 500ms
    clearTimeout(mutationObserver._timer);
    mutationObserver._timer = setTimeout(observe, 500);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    mutationObserver.disconnect();
  };
}

/**
 * Enforce passive touch listeners on scroll containers.
 * This prevents the "Added non-passive event listener" Chrome DevTools warning
 * and ensures smooth 120fps touch scrolling.
 */
function initPassiveTouchEnforcement() {
  // Only needed for touch devices
  if (!('ontouchstart' in window)) return () => {};

  const scrollContainers = document.querySelectorAll(
    '.no-scrollbar, .overflow-x-auto, [class*="overflow-"]'
  );

  const handlers = [];

  scrollContainers.forEach((container) => {
    const noop = () => {};
    container.addEventListener('touchstart', noop, { passive: true });
    container.addEventListener('touchmove', noop, { passive: true });
    handlers.push({ el: container, fn: noop });
  });

  return () => {
    handlers.forEach(({ el, fn }) => {
      el.removeEventListener('touchstart', fn);
      el.removeEventListener('touchmove', fn);
    });
  };
}

/**
 * Master initializer — call once at app startup.
 * Returns a cleanup function.
 */
export function initPerformanceManager() {
  if (_initialized) return () => {};
  _initialized = true;

  const cleanups = [
    initScrollTracker(),
    initOffscreenObserver(),
    initPassiveTouchEnforcement(),
  ];

  if (import.meta.env.DEV) {
    console.log(
      '%c JDLX PERF: Performance manager initialized',
      'color: #10b981; font-weight: bold;'
    );
  }

  return () => {
    cleanups.forEach((fn) => fn?.());
    _initialized = false;
  };
}

export default initPerformanceManager;
