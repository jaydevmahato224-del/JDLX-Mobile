import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home as HomeIcon, Search, ShoppingCart, User, ChevronLeft, Heart as HeartIcon, Clock, Wallet } from 'lucide-react'
import { useStore } from '../store/useStore'
import { API_BASE_URL } from '../config'
import NotificationBell from './NotificationBell'
import LiquidBottomNav from './LiquidBottomNav'
import PWAInstallBanner from './PWAInstallBanner'
import LocationManager from './LocationManager'
import TermsGate from './TermsGate'
import Footer from './Footer'
import ReleaseUpdateModal from './ReleaseUpdateModal'

function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  
  const cartItemCount = useStore((state) => 
    state.cart.reduce((acc, item) => acc + Number(item.qty || 0), 0))
  const wishlistCount = useStore((state) => state.wishlist.length)
  const user = useStore((state) => state.user)
  const theme = useStore((state) => state.theme)
  const token = useStore((state) => state.token)

  const [tickerText, setTickerText] = useState('PREMIUM SHOPPING EXPERIENCE • SAFE & TRUSTED ORDER FULFILLMENT')
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [walletBalance, setWalletBalance] = useState(0)

  useEffect(() => {
    const fetchWallet = async () => {
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE_URL}/wallet/balance`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setWalletBalance(data.balance)
        }
      } catch (err) {
        console.error('Failed to load wallet balance:', err)
      }
    }
    fetchWallet()
  }, [token])

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
      <div className="sticky top-0 z-50 safe-area-top bg-[var(--color-surface-white)]/90 backdrop-blur border-b border-[var(--color-surface-high)] transition-all duration-500">
        {/* Ticker Banner Removed */}

        <header className="transition-all duration-500">
          <div className="container-standard grid grid-cols-3 h-[var(--app-header-height)] items-center gap-2 md:gap-4">
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
                      fetchPriority="high"
                    />
                  </Link>
                  
                  {/* Delivery Mode Badge */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all duration-500 shadow-sm bg-[var(--color-surface-low)] border-[var(--color-surface-high)] text-[var(--color-on-surface-variant)]">
                    <Clock size={10} />
                    <span className="hidden min-[420px]:inline text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                      Standard
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
                  <div className="text-base md:text-2xl font-black tracking-tighter transition-all duration-500 group-hover:tracking-normal whitespace-nowrap">
                    <span className="text-[var(--color-on-surface)]">JDLX</span> <span className="text-primary">MOBILE</span>
                  </div>
                  <div className="text-[9px] font-bold tracking-[0.3em] text-[var(--color-on-surface-variant)] uppercase mt-0.5 whitespace-nowrap">
                    Premium Mobile Store
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

              {walletBalance > 0 && (
                <Link
                  to="/wallet"
                  className="flex items-center gap-1.5 bg-[#F5A623]/10 text-[#D48A12] px-2.5 py-1.5 rounded-xl border border-[#F5A623]/20 shadow-sm"
                  aria-label="Wallet"
                >
                  <Wallet size={16} />
                  <span className="text-xs font-black">₹{walletBalance.toFixed(0)}</span>
                </Link>
              )}

              <NotificationBell />

              {/* Account lives ONLY here (top-right corner) — never in the
                  floating bottom dock. Visible on every screen size so mobile
                  users keep account access; the label collapses to an icon on
                  the narrowest phones. */}
              <Link
                to={user ? '/profile' : '/login'}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--color-outline-variant)] px-3 sm:px-4 text-sm font-black text-[var(--color-on-surface)] hover:bg-[var(--color-surface-low)] dark:hover:bg-white/5 transition-all hover:shadow-sm active:scale-95"
                aria-label="Account"
              >
                <User className="h-4 w-4" />
                <span className="hidden min-[420px]:inline">{user ? 'Account' : 'Login'}</span>
              </Link>
            </div>
          </div>
        </header>
      </div>

      <main className="container-standard py-8 pb-28 md:pb-8">
        {children}
      </main>

      <Footer />

      {/* Bottom Navigation (Mobile) */}
      <LiquidBottomNav cartItemCount={cartItemCount} user={user} />

      <TermsGate />
      <ReleaseUpdateModal />
      <PWAInstallBanner />
      <LocationManager />
    </div>
  )
}

export default Layout
