import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home, Search, ShoppingCart, User, ChevronLeft, RefreshCw, Heart, Zap, Clock } from 'lucide-react'
import { useStore } from '../store/useStore'
import { API_BASE_URL } from '../config'
import NotificationBell from './NotificationBell'
import LiquidBottomNav from './LiquidBottomNav'
import PWAInstallBanner from './PWAInstallBanner'
import LocationManager from './LocationManager'
import TermsGate from './TermsGate'

function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const cart = useStore((state) => state.cart)
  const wishlist = useStore((state) => state.wishlist)
  const user = useStore((state) => state.user)
  const theme = useStore((state) => state.theme)
  const deliveryMode = useStore((state) => state.deliveryMode)

  const isCheckingLocation = useStore((state) => state.isCheckingLocation)

  const cartItemCount = useMemo(() => cart.reduce((acc, item) => acc + item.qty, 0), [cart])

  const [tickerText, setTickerText] = useState('Free delivery on orders above ₹499 • Better experience with fast delivery')
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
        <div className="h-[var(--app-ticker-height)] bg-slate-900 text-white">
          <div className="container-standard flex h-full items-center justify-center">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[10px] font-black uppercase tracking-[0.25em] text-white/80">
               {tickerText.split('•').map((part, i) => (
                 <React.Fragment key={i}>
                   <span>{part.trim()}</span>
                   {i < tickerText.split('•').length - 1 && <span className="hidden sm:inline">•</span>}
                 </React.Fragment>
               ))}
            </div>
          </div>
        </div>

        <header className="border-b border-slate-200/70 bg-[var(--color-surface-white)]/90 backdrop-blur transition-all duration-500">
          <div className="container-standard grid grid-cols-3 h-[var(--app-header-height)] items-center gap-4">
            {/* Left side empty for balance or secondary actions */}
            <div className="flex items-center">
              {location.pathname !== '/' ? (
                <button
                  onClick={() => navigate(-1)}
                  className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-all active:scale-90 group -ml-2"
                  aria-label="Go back"
                >
                  <ChevronLeft className="h-6 w-6 text-[var(--color-on-surface)] group-hover:-translate-x-0.5 transition-transform" />
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <Link to="/" className="flex items-center gap-2 group transition-all">
                    <div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--color-primary)] text-[var(--color-on-primary)] font-black transition-all group-hover:scale-110">
                      JX
                    </div>
                  </Link>
                  
                  {/* Delivery Mode Badge */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all duration-500 shadow-sm ${
                    isCheckingLocation
                    ? 'bg-amber-50 border-amber-200 text-amber-600 animate-pulse'
                    : deliveryMode === 'quick' 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                    : 'bg-slate-50 border-slate-200 text-slate-500'
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
              <Link to="/" className="flex flex-col items-center leading-none group text-center">
                <div className="text-lg md:text-2xl font-black tracking-tighter transition-all duration-500 group-hover:tracking-normal whitespace-nowrap text-[var(--color-on-surface)]">
                  JDLX MOBILE
                </div>
                <div className="text-[9px] font-bold tracking-[0.3em] text-[var(--color-on-surface-variant)] uppercase mt-0.5 whitespace-nowrap">
                  Hyperlocal Quick Commerce
                </div>
              </Link>
            </div>

            {/* Right: Functional actions */}
            <div className="flex items-center justify-end gap-3 px-1">
              <Link
                to="/profile/wishlist"
                className="relative h-10 w-10 flex items-center justify-center rounded-full hover:bg-slate-50 transition-all active:scale-90"
                aria-label="Wishlist"
              >
                <Heart size={20} className={wishlist.length > 0 ? "text-red-500" : "text-slate-400"} fill={wishlist.length > 0 ? "currentColor" : "none"} />
                {wishlist.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-4 min-w-[16px] px-1 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                    {wishlist.length}
                  </span>
                )}
              </Link>

              <NotificationBell />

              <Link
                to={user ? '/profile' : '/login'}
                className="hidden sm:inline-flex h-10 items-center gap-2 rounded-full border border-[var(--color-outline-variant)] px-4 text-sm font-black text-[var(--color-on-surface)] hover:bg-slate-50 dark:hover:bg-white/5 transition-all hover:shadow-sm active:scale-95"
              >
                <User className="h-4 w-4" />
                <span>{user ? 'Account' : 'Login'}</span>
              </Link>
            </div>
          </div>
        </header>
      </div>

      <main className="container-standard py-8 pb-[calc(var(--app-bottom-nav-height)+32px)]">
        {children}
      </main>

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
