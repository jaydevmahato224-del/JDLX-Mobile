import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Suspense, lazy, useEffect, useLayoutEffect } from 'react'
import Home from './pages/user/Home'
import Login from './pages/user/Login'
import Cart from './pages/user/Cart'
import ProductDetails from './pages/user/ProductDetails'
import SearchPage from './pages/user/SearchPage'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import TopLoader from './components/TopLoader'
import PageLoader from './components/PageLoader'
import { useStore } from './store/useStore'
import { useLoadingStore } from './store/useLoadingStore'
import { API_BASE_URL } from './config'

// ─── Global fetch interceptor ─────────────────────────────────────────────────
// Mirrors admin panel: every fetch call triggers the TopLoader amber bar.
const _originalFetch = window.fetch;
window.fetch = async (...args) => {
  const { startLoading, stopLoading } = useLoadingStore.getState();
  startLoading();
  try {
    const response = await _originalFetch(...args);
    const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

    // Auto-logout user on 401 from user API routes
    if (
      response.status === 401 &&
      requestUrl.includes('/api/') &&
      !requestUrl.includes('/api/admin/') &&
      !window.location.pathname.startsWith('/login')
    ) {
      useStore.getState().logout();
    }

    return response;
  } finally {
    stopLoading();
  }
};

// ─── Lazy-loaded routes ───────────────────────────────────────────────────────
const Checkout = lazy(() => import('./pages/user/Checkout'))
const OrderTracking = lazy(() => import('./pages/user/OrderTracking'))
const Profile = lazy(() => import('./pages/user/Profile'))
const ProfileSettings = lazy(() => import('./pages/user/ProfileSettings'))
const MyOrders = lazy(() => import('./pages/user/MyOrders'))
const Wishlist = lazy(() => import('./pages/user/Wishlist'))
const Addresses = lazy(() => import('./pages/user/Addresses'))
const Payments = lazy(() => import('./pages/user/Payments'))
const Wallet = lazy(() => import('./pages/user/Wallet'))
const Notifications = lazy(() => import('./pages/user/Notifications'))
const Security = lazy(() => import('./pages/user/Security'))
const Support = lazy(() => import('./pages/user/Support'))
const Coupons = lazy(() => import('./pages/user/Coupons'))
const AboutSite = lazy(() => import('./pages/user/AboutSite'))
const TermsAndConditions = lazy(() => import('./pages/user/TermsAndConditions'))


// ─── Route-change loader ──────────────────────────────────────────────────────
// Triggers TopLoader on every navigation — same pattern as admin panel.
function RouteChangeTracker() {
  const location = useLocation()
  const startLoading = useLoadingStore((state) => state.startLoading)
  const stopLoading = useLoadingStore((state) => state.stopLoading)

  // Disable automatic browser scroll restoration
  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    startLoading()
    const timer = setTimeout(() => {
      stopLoading()
    }, 350)
    return () => {
      clearTimeout(timer)
      stopLoading()
    }
  }, [location.pathname, location.search, startLoading, stopLoading])

  return null
}

// ─── OAuth callback handler ───────────────────────────────────────────────────
function OAuthCallbackBridge() {
  const location = useLocation()
  const navigate = useNavigate()
  const setUser = useStore((state) => state.setUser)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const oauthToken = params.get('oauth_token')
    const oauthUser = params.get('oauth_user')

    if (!oauthToken || !oauthUser) {
      return
    }

    try {
      const user = JSON.parse(decodeURIComponent(oauthUser))
      setUser(user, oauthToken)
    } catch (error) {
      console.error('OAuth callback parsing failed:', error)
    }

    navigate('/', { replace: true })
  }, [location.search, navigate, setUser])

  return null
}

// ─── Operational redirect (Admin & Warehouse) ───────────────────────────────
function OperationalRedirect() {
  const location = useLocation()

  useEffect(() => {
    let port = '5174' // Default Store
    if (location.pathname.startsWith('/warehouse')) {
      port = '5175'
    } else if (location.pathname.startsWith('/admin')) {
      port = '5174'
    }
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    const hostname = window.location.hostname
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''
    const isAndroid = /Android/i.test(userAgent)
    const resolvedHost =
      isAndroid && (hostname === 'localhost' || hostname === '127.0.0.1')
        ? '10.0.2.2'
        : hostname
    const target = `${protocol}//${resolvedHost}:${port}${location.pathname}${location.search}${location.hash}`
    window.location.replace(target)
  }, [location.hash, location.pathname, location.search])

  return <PageLoader />
}

// ─── Dynamic Theme Loader ─────────────────────────────────────────────────────
function ThemeLoader() {
  useEffect(() => {
    const hexToRgb = (hex) => {
      // Remove '#' if present
      hex = hex.replace(/^#/, '');
      if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
      }
      if (hex.length !== 6) return null;
      const bigint = parseInt(hex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `${r}, ${g}, ${b}`;
    };

    fetch(`${API_BASE_URL}/settings`)
      .then(res => res.json())
      .then(json => {
        if (json?.data) {
          const root = document.documentElement;
          if (json.data.theme_primary_color) {
            root.style.setProperty('--color-primary', json.data.theme_primary_color);
            const rgb = hexToRgb(json.data.theme_primary_color);
            if (rgb) root.style.setProperty('--color-primary-rgb', rgb);
          }
          if (json.data.theme_secondary_color) {
            root.style.setProperty('--color-secondary', json.data.theme_secondary_color);
            const rgb = hexToRgb(json.data.theme_secondary_color);
            if (rgb) root.style.setProperty('--color-secondary-rgb', rgb);
          }
          if (json.data.theme_tertiary_color) {
            root.style.setProperty('--color-tertiary', json.data.theme_tertiary_color);
            const rgb = hexToRgb(json.data.theme_tertiary_color);
            if (rgb) root.style.setProperty('--color-tertiary-rgb', rgb);
          }
        }
      })
      .catch(err => console.error('Failed to load theme settings:', err));
  }, []);
  
  return null;
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  return (
    <ErrorBoundary>
      <ThemeLoader />
      {/* Amber top progress bar — shows on every fetch + route change */}
      <TopLoader />
      <Toaster position="top-center" reverseOrder={false} />
      <Router>
        <RouteChangeTracker />
        <Suspense fallback={<PageLoader />}>
          <Routes>

            {/* ── Main app (inside layout) ── */}
            <Route path="/*" element={
              <>
                <OAuthCallbackBridge />
                <Layout>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/cart" element={<Cart />} />
                    <Route path="/product/:id" element={<ProductDetails />} />
                    <Route path="/checkout" element={<Checkout />} />
                    <Route path="/admin/*" element={<OperationalRedirect />} />
                    <Route path="/warehouse/*" element={<OperationalRedirect />} />
                    <Route path="/track/:orderId" element={<OrderTracking />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/profile/settings" element={<ProfileSettings />} />
                    <Route path="/profile/orders" element={<MyOrders />} />
                    <Route path="/profile/wishlist" element={<Wishlist />} />
                    <Route path="/profile/addresses" element={<Addresses />} />
                    <Route path="/profile/payments" element={<Payments />} />
                    <Route path="/profile/wallet" element={<Wallet />} />
                    <Route path="/profile/notifications" element={<Notifications />} />
                    <Route path="/profile/security" element={<Security />} />
                    <Route path="/profile/support" element={<Support />} />
                    <Route path="/profile/coupons" element={<Coupons />} />
                    <Route path="/profile/about-site" element={<AboutSite />} />
                    <Route path="/profile/terms" element={<TermsAndConditions />} />
                  </Routes>
                </Layout>
              </>
            } />
          </Routes>
        </Suspense>
      </Router>
    </ErrorBoundary>
  )
}

export default App
