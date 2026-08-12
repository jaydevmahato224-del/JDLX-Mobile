import { useEffect } from 'react';

/**
 * useScrollLock — locks the page scroll while `active` is true.
 *
 * Uses a module-level counter so multiple modals/overlays can lock the page
 * at the same time without clobbering each other's saved overflow value:
 * the body stays locked until the LAST active lock is released. This fixes
 * the naive save/restore pattern, where closing one modal could unlock (or
 * permanently lock) the page while another modal is still open.
 */
let lockCount = 0;
let previousOverflow = '';

function applyLock() {
  lockCount += 1;
  if (lockCount === 1) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

function releaseLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
  }
}

export default function useScrollLock(active) {
  useEffect(() => {
    if (!active) return;
    applyLock();
    return () => releaseLock();
  }, [active]);
}
