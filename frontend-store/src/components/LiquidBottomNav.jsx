import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Search, ShoppingBag, Gift } from 'lucide-react';
import { useStore } from '../store/useStore';

const LiquidBottomNav = ({ cartItemCount }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const prevIndexRef = useRef(-1);
  const indicatorRef = useRef(null);
  const cleanupTimerRef = useRef(null);
  const searchInputRef = useRef(null);
  const lastScrollYRef = useRef(0);
  const [collapsed, setCollapsed] = useState(false);

  const globalSearchQuery = useStore(state => state.globalSearchQuery);
  const setGlobalSearchQuery = useStore(state => state.setGlobalSearchQuery);
  const isSearching = useStore(state => state.isSearching);
  const setIsSearching = useStore(state => state.setIsSearching);
  // Must be declared AFTER `isSearching` above (const lives in the temporal
  // dead zone until its declaration runs — referencing it earlier crashes the
  // whole store page on mount).
  const isSearchingRef = useRef(isSearching);

  // Account intentionally lives ONLY in the top-right header — keeping the
  // floating dock to 4 items so it stays uncluttered on small screens.
  const navItems = useMemo(() => [
    { id: 'home', to: '/', icon: Home, label: 'Home' },
    { id: 'search', to: '/search', icon: Search, label: 'Explore' },
    { id: 'cart', to: '/cart', icon: ShoppingBag, label: 'Cart', badge: cartItemCount },
    { id: 'refer', to: '/refer', icon: Gift, label: 'Refer' },
  ], [cartItemCount]);

  const isActive = useCallback((path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }, [location.pathname]);

  const activeIndex = useMemo(() => navItems.findIndex(item => isActive(item.to)), [navItems, isActive]);
  const showHighlight = activeIndex !== -1 && !isSearching;
  const itemWidthPercent = useMemo(() => 100 / navItems.length, [navItems.length]);

  useEffect(() => {
    if (location.pathname !== '/' && location.pathname !== '/search' && isSearching) {
      setIsSearching(false);
    }
  }, [location.pathname, isSearching, setIsSearching]);

  useEffect(() => {
    isSearchingRef.current = isSearching;
  }, [isSearching]);

  useEffect(() => {
    if (isSearching && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearching]);

  // Auto-collapse while scrolling down so the content below stays fully
  // visible — the dock slides completely off-screen (no leftover circle). A
  // small upward scroll brings it back with the same animation in reverse.
  // Disabled while the in-dock search box is open.
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScrollYRef.current;
      // Always keep the baseline fresh (even while searching) so the first
      // scroll after closing search doesn't compute a bogus jump.
      lastScrollYRef.current = y;
      if (isSearchingRef.current) return;
      if (Math.abs(delta) < 6) return;
      if (delta > 0 && y > 120) setCollapsed(true);
      else if (delta < 0) setCollapsed(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const indicator = indicatorRef.current;
    if (!indicator || isSearching) return;

    if (prevIndexRef.current === -1) {
      prevIndexRef.current = activeIndex;
      return;
    }

    if (prevIndexRef.current !== activeIndex && activeIndex !== -1) {
      const direction = activeIndex > prevIndexRef.current ? 'squish-right' : 'squish-left';
      indicator.classList.remove('squish-left', 'squish-right');
      void indicator.offsetWidth;
      indicator.classList.add(direction);
      prevIndexRef.current = activeIndex;

      if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = setTimeout(() => {
        indicator.classList.remove('squish-left', 'squish-right');
      }, 450);
    }
  }, [activeIndex, isSearching]);

  const indicatorLeft = showHighlight ? `calc(${activeIndex * itemWidthPercent}% + 8px)` : '-200px';
  const indicatorWidth = `calc(${itemWidthPercent}% - 16px)`;

  const handleNavClick = (e, item) => {
    if (item.id === 'search') {
      e.preventDefault();
      e.stopPropagation();
      setCollapsed(false);
      setIsSearching(true);
      if (location.pathname !== '/' && location.pathname !== '/search') {
        navigate('/search');
      }
    }
  };

  return (
    <div
      className={`concierge-nav-wrapper md:hidden ${collapsed && !isSearching ? 'nav-collapsed' : ''}`}
      style={{ zIndex: 100 }}
    >
      <nav
        className={`concierge-nav-container ${isSearching ? 'searching-mode' : ''}`}
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        {/* Sliding pill indicator */}
        {!isSearching && (
          <div
            ref={indicatorRef}
            className="concierge-nav-indicator"
            style={{
              left: indicatorLeft,
              width: indicatorWidth,
              // Inline opacity (CSS alone can't override it) — hide it too when
              // the dock collapses so the active pill doesn't peek out of the circle.
              opacity: (showHighlight && !collapsed) ? 1 : 0,
              zIndex: 1,
              pointerEvents: 'none'
            }}
          />
        )}

        <div className="flex w-full h-full items-center relative z-20">
          {navItems.map((item) => {
            const active = activeIndex === navItems.indexOf(item);
            const isExplore = item.id === 'search';
            const Icon = item.icon;

            return (
              <div
                key={item.id}
                className="h-full transition-all duration-500 ease-in-out overflow-hidden flex items-center justify-center cursor-pointer"
                style={{ 
                  flex: isSearching && isExplore ? '1 0 100%' : (isSearching ? '0 0 0%' : '1'),
                  opacity: isSearching && !isExplore ? 0 : 1,
                  pointerEvents: isSearching && !isExplore ? 'none' : 'auto'
                }}
                onClick={(e) => handleNavClick(e, item)}
              >
                {!isSearching ? (
                  <Link
                    to={item.to}
                    className={`concierge-nav-item w-full h-full flex flex-col items-center justify-center gap-1 ${active ? 'active' : ''}`}
                    onClick={(e) => {
                      if (isExplore) {
                        e.preventDefault();
                        handleNavClick(e, item);
                      }
                    }}
                  >
                    <div className="concierge-nav-icon-wrapper relative">
                      <Icon
                        size={active ? 24 : 22}
                        strokeWidth={active ? 2.5 : 2}
                        style={{ color: active ? 'var(--color-on-primary)' : 'var(--color-nav-inactive)' }}
                      />
                      {item.badge > 0 && (
                        <span className="concierge-badge">{item.badge}</span>
                      )}
                    </div>
                    <span className="concierge-nav-label">
                      {item.label}
                    </span>
                  </Link>
                ) : (
                  isExplore && (
                    <div className="w-full h-full flex items-center px-4 gap-3 animate-in fade-in slide-in-from-left-4 duration-500">
                      <Search size={20} className="text-[var(--color-on-surface)]" />
                      <input 
                        ref={searchInputRef}
                        type="text"
                        value={globalSearchQuery}
                        onChange={(e) => {
                          setGlobalSearchQuery(e.target.value);
                          if (location.pathname !== '/search' && e.target.value.trim() !== '') {
                            navigate('/search');
                          }
                        }}
                        placeholder="Search products..."
                        className="flex-1 bg-transparent border-none outline-none text-[var(--color-on-surface)] font-bold text-[16px]"
                      />
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSearching(false);
                          setGlobalSearchQuery('');
                        }}
                        className="w-10 h-10 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-[var(--color-on-surface)] active:scale-90 transition-transform"
                      >
                         <div className="text-lg">×</div>
                      </button>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default LiquidBottomNav;
