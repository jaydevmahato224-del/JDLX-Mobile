import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home as HomeIcon, Search, ShoppingCart, User, ChevronLeft, RefreshCw, Heart as HeartIcon, Zap, Clock } from 'lucide-react'
import { useStore } from '../store/useStore'
import { API_BASE_URL } from '../config'
import NotificationBell from './NotificationBell'
import LiquidBottomNav from './LiquidBottomNav'
import PWAInstallBanner from './PWAInstallBanner'
import LocationManager from './LocationManager'
import TermsGate from './TermsGate'
import Footer from './Footer'

function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  
  const cartItemCount = useStore((state) => 
    state.cart.reduce((acc, item) => acc + Number(item.qty || 0), 0))
  const wishlistCount = useStore((state) => state.wishlist.length)
  const user = useStore((state) => state.user)
  const theme = useStore((state) => state.theme)
  const deliveryMode = useStore((state) => state.deliveryMode)
  const isCheckingLocation = useStore((state) => state.isCheckingLocation)

  const [tickerText, setTickerText] = useState('PREMIUM SHOPPING EXPERIENCE • SAFE & TRUSTED ORDER FULFILLMENT')
  const [loadingSettings, setLoadingSettings] = useState(true)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`)
        const json = await res.json()
        if (res.ok && json.data?.ticker_text) {
          setTickerText(json.data.ticker_text)
        }
      } catch (err) {
        console.error('Failed to load layout settings:', err)
      } finally {
        setLoadingSettings(false)
      }
    }
    fetchSettings()
  }, [])

  return (
    <div className={`min-h-[100dvh] bg-[var(--color-surface)] text-[var(--color-on-surface)] transition-all duration-500 ${theme}`}>
      {/* Top chrome (no fixed overlays) */}
      <div className="sticky top-0 z-50">
        {/* Ticker Banner Removed */}

        <header className="border-b border-[var(--color-surface-high)] bg-[var(--color-surface-white)]/90 backdrop-blur transition-all duration-500">
          <div className="container-standard grid grid-cols-3 h-[var(--app-header-height)] items-center gap-4">
            {/* Left side empty for balance or secondary actions */}
            <div className="flex items-center">
              {location.pathname !== '/' ? (
                <button
                  onClick={() => navigate(-1)}
                  className="grid h-10 w-10 place-items-center rounded-xl hover:bg-[var(--color-surface-low)] dark:hover:bg-white/5 transition-all active:scale-90 group -ml-2"
                  aria-label="Go back"
                >
                  <ChevronLeft className="h-6 w-6 text-[var(--color-on-surface)] group-hover:-translate-x-0.5 transition-transform" />
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <Link to="/" className="flex items-center gap-2 group transition-all">
                    <img 
                      src="/logo192.png" 
                      alt="JDLX Logo" 
                      className="h-8 w-8 object-contain transition-all group-hover:scale-110" 
                      fetchpriority="high"
                    />
                  </Link>
                  
                  {/* Delivery Mode Badge */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all duration-500 shadow-sm ${
                    isCheckingLocation
                    ? 'bg-amber-50 border-amber-200 text-amber-600 animate-pulse'
                    : deliveryMode === 'quick' 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                    : 'bg-[var(--color-surface-low)] border-[var(--color-surface-high)] text-[var(--color-on-surface-variant)]'
                  }`}>
                    {isCheckingLocation ? (
                      <RefreshCw size={10} className="animate-spin" />
                    ) : deliveryMode === 'quick' ? (
                      <Zap size={10} fill="currentColor" />
                    ) : (
                      <Clock size={10} />
                    )}
                    <span className="text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                      {isCheckingLocation ? 'Checking...' : deliveryMode === 'quick' ? 'Quick' : 'Sched.'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Center: Main Branding */}
            <div className="flex justify-center">
              <Link to="/" className="flex items-center gap-2 md:gap-3 group transition-all">
                <img 
                  src="/logo192.png" 
                  alt="Logo" 
                  className="h-8 w-8 md:h-10 md:w-10 object-contain transition-transform duration-500 group-hover:scale-110" 
                />
                <div className="flex flex-col items-start leading-none">
                  <div className="text-lg md:text-2xl font-black tracking-tighter transition-all duration-500 group-hover:tracking-normal whitespace-nowrap text-[var(--color-on-surface)]">
                    JDLX MOBILE
                  </div>
                  <div className="text-[9px] font-bold tracking-[0.3em] text-[var(--color-on-surface-variant)] uppercase mt-0.5 whitespace-nowrap">
                    {deliveryMode === 'quick' ? 'Hyperlocal Quick Commerce' : 'Premium Mobile Store'}
                  </div>
                </div>
              </Link>
            </div>

            {/* Right: Functional actions */}
            <div className="flex items-center justify-end gap-3 px-1">
              <Link
                to="/profile/wishlist"
                className="relative h-10 w-10 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-low)] transition-all active:scale-90"
                aria-label="Wishlist"
              >
                <HeartIcon size={20} className={wishlistCount > 0 ? "text-red-500" : "text-[var(--color-on-surface-variant)]"} fill={wishlistCount > 0 ? "currentColor" : "none"} />
                {wishlistCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-4 min-w-[16px] px-1 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                    {wishlistCount}
                  </span>
                )}
              </Link>

              <NotificationBell />

              <Link
                to={user ? '/profile' : '/login'}
                className="hidden sm:inline-flex h-10 items-center gap-2 rounded-full border border-[var(--color-outline-variant)] px-4 text-sm font-black text-[var(--color-on-surface)] hover:bg-[var(--color-surface-low)] dark:hover:bg-white/5 transition-all hover:shadow-sm active:scale-95"
              >
                <User className="h-4 w-4" />
                <span>{user ? 'Account' : 'Login'}</span>
              </Link>
            </div>
          </div>
        </header>
      </div>

      <main className="container-standard py-8">
        {children}
      </main>

      <Footer />

      {/* Bottom Navigation (Mobile) */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <LiquidBottomNav cartItemCount={cartItemCount} user={user} />
      </div>

      <TermsGate />
      <PWAInstallBanner />
      <LocationManager />
    </div>
  )
}

export default Layout
