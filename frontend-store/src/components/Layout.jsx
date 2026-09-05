import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { User, ChevronLeft, Heart as HeartIcon, Wallet } from 'lucide-react'
import { useStore } from '../store/useStore'
import { API_BASE_URL, resolveMediaUrl } from '../config'
import NotificationBell from './NotificationBell'
import PushPermissionBanner from './PushPermissionBanner'
import LiquidBottomNav from './LiquidBottomNav'
import PWAInstallBanner from './PWAInstallBanner'
import LocationManager from './LocationManager'
import TermsGate from './TermsGate'
import Footer from './Footer'
import { apiFetch } from '../utils/apiFetch'

function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const hasBackButton = location.pathname !== '/'
  
  const cartItemCount = useStore((state) => 
    state.cart.reduce((acc, item) => acc + Number(item.qty || 0), 0))
  const wishlistCount = useStore((state) => state.wishlist.length)
  const user = useStore((state) => state.user)
  const theme = useStore((state) => state.theme)

  // Ticker banner was removed earlier; the setter is kept so the settings
  // fetch below still works, but the value itself is no longer rendered.
  const [, setTickerText] = useState('PREMIUM SHOPPING EXPERIENCE • SAFE & TRUSTED ORDER FULFILLMENT')
  const [, setLoadingSettings] = useState(true)
  const [walletBalance, setWalletBalance] = useState(0)

  // Profile-picture fallback: if the avatar fails to load, drop back to the
  // plain User icon (and re-try as soon as the user/profile image changes).
  const [avatarFailed, setAvatarFailed] = useState(false)
  useEffect(() => {
    setAvatarFailed(false)
  }, [user?.id, user?.profile_image])

  // Floating back button visibility: hide while scrolling down, slide back in
  // with the reverse animation as soon as the user scrolls up again (and always
  // visible while at the top of the page).
  const [backButtonVisible, setBackButtonVisible] = useState(true)
  const lastScrollYRef = useRef(0)

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY
      const delta = currentY - lastScrollYRef.current
      lastScrollYRef.current = currentY
      if (Math.abs(delta) < 4) return
      if (currentY <= 4) {
        setBackButtonVisible(true)
      } else if (delta > 0) {
        setBackButtonVisible(false)
      } else {
        setBackButtonVisible(true)
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const fetchWallet = async () => {
      if (!user) return;
      try {
        const res = await apiFetch('/wallet/balance')
        if (res.ok) {
          const data = await res.json()
          setWalletBalance(data.balance)
        }
      } catch (err) {
        console.error('Failed to load wallet balance:', err)
      }
    }
    fetchWallet()
  }, [user])

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await apiFetch('/settings')
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
          <div className="container-standard flex h-[var(--app-header-height)] items-center gap-2 md:gap-4">
            {/* Left: main branding — always fully visible on every page. The
                back button now floats over the page below the header, so it
                never steals header space from the brand. */}
            <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
              <Link to="/" className="group flex min-w-0 items-center gap-2 md:gap-3 transition-all" aria-label="JDLX Mobile home">
                <img 
                  src="/logo192.png" 
                  alt="JDLX Logo" 
                  className="h-8 w-8 md:h-10 md:w-10 shrink-0 object-contain transition-transform duration-500 group-hover:scale-110" 
                  fetchPriority="high"
                />
                {/* Brand wordmark — always visible. The back button now floats
                    over the page, so it never steals header space from the
                    branding on sub-pages. */}
                <div className="flex min-w-0 max-w-[300px] flex-col items-start leading-none overflow-hidden whitespace-nowrap transition-all duration-500">
                  <div className="truncate text-base md:text-2xl font-black tracking-tighter transition-all duration-500 group-hover:tracking-normal">
                    <span className="text-[var(--color-on-surface)]">JDLX</span> <span className="text-primary">MOBILE</span>
                  </div>
                  <div className="hidden min-[420px]:block truncate text-[9px] font-bold tracking-[0.3em] text-[var(--color-on-surface-variant)] uppercase mt-0.5">
                    Premium Mobile Store
                  </div>
                </div>
              </Link>
            </div>

            {/* Right: Functional actions — shrink-0 keeps every icon at its
                fixed size so the header can never squeeze them together. */}
            <div className="flex shrink-0 items-center justify-end gap-3 px-1">
              <Link
                to="/profile/wishlist"
                className="relative h-10 w-10 shrink-0 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-low)] transition-all active:scale-90"
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
                  className="flex shrink-0 items-center gap-1.5 bg-[#F5A623]/10 text-[#D48A12] px-2.5 py-1.5 rounded-xl border border-[#F5A623]/20 shadow-sm"
                  aria-label="Wallet"
                >
                  <Wallet size={16} />
                  <span className="text-xs font-black">₹{walletBalance.toFixed(0)}</span>
                </Link>
              )}

              <div className="shrink-0"><NotificationBell /></div>

              {/* Account lives ONLY here (top-right corner) — never in the
                  floating bottom dock. Visible on every screen size so mobile
                  users keep account access; the label collapses to an icon on
                  the narrowest phones. */}
              <Link
                to={user ? '/profile' : '/login'}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--color-outline-variant)] px-3 sm:px-4 text-sm font-black text-[var(--color-on-surface)] hover:bg-[var(--color-surface-low)] dark:hover:bg-white/5 transition-all hover:shadow-sm active:scale-95"
                aria-label="Account"
              >
                {user?.profile_image && !avatarFailed ? (
                  <img
                    src={resolveMediaUrl(user.profile_image)}
                    onError={() => setAvatarFailed(true)}
                    className="h-6 w-6 rounded-full object-cover ring-1 ring-[var(--color-outline-variant)]"
                    alt=""
                  />
                ) : (
                  <User className="h-4 w-4" />
                )}
                <span className="hidden min-[420px]:inline">{user ? 'Account' : 'Login'}</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Push-permission banner — shows in the header whenever notification
            permission is off/denied, with an Allow button that re-triggers the
            native permission popup. Auto-hides once permission is granted. */}
        <PushPermissionBanner />
      </div>

      {/* Floating Back Button — sits over the page below the header, fades and
          slides away on scroll down, and returns with the opposite animation
          on scroll up. Only rendered on sub-pages (never on the home page). */}
      {hasBackButton && (
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className={`fixed left-4 z-40 grid h-11 w-11 place-items-center rounded-2xl border border-[var(--color-surface-high)] bg-[var(--color-surface-white)]/95 text-[var(--color-on-surface)] shadow-lg shadow-black/5 backdrop-blur-md transition-all duration-300 ease-out hover:bg-[var(--color-surface-low)] dark:hover:bg-white/5 active:scale-90 ${
            backButtonVisible
              ? 'translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none -translate-y-4 scale-95 opacity-0'
          }`}
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + var(--app-header-height) + 12px)' }}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      <main className="container-standard py-8 pb-28 md:pb-8">
        {children}
      </main>

      <Footer />

      {/* Bottom Navigation (Mobile) */}
      <LiquidBottomNav cartItemCount={cartItemCount} user={user} />

      <TermsGate />
      <PWAInstallBanner />
      <LocationManager />
    </div>
  )
}

export default Layout
