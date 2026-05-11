import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
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

// ─── Global Fetch Interceptor ─────────────────────────────────────────────────
const _originalFetch = window.fetch;
window.fetch = async (...args) => {
  const { startLoading, stopLoading } = useLoadingStore.getState();
  const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
  
  // Only show loader for significant API calls
  const isBackgroundRequest = requestUrl.includes('/interactions') || requestUrl.includes('/logs');
  if (!isBackgroundRequest) startLoading();

  try {
    const response = await _originalFetch(...args);
    
    if (response.status === 401 && requestUrl.includes('/api/') && !window.location.pathname.startsWith('/login')) {
      useStore.getState().logout();
    }
    return response;
  } finally {
    if (!isBackgroundRequest) stopLoading();
  }
};

// ─── Lazy Loaded Components ──────────────────────────────────────────────────
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

// ─── Protected Route Wrapper ──────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const token = useStore((state) => state.token)
  const location = useLocation()
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

// ─── Route Change & Scroll Manager ────────────────────────────────────────────
function RouteChangeTracker() {
  const location = useLocation()
  const { startLoading, stopLoading } = useLoadingStore()

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  }, [])

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    startLoading()
    const timer = setTimeout(stopLoading, 300)
    return () => { clearTimeout(timer); stopLoading(); }
  }, [location.pathname, location.search])

  return null
}

// ─── OAuth Callback Bridge ───────────────────────────────────────────────────
function OAuthCallbackBridge() {
  const location = useLocation()
  const navigate = useNavigate()
  const setUser = useStore((state) => state.setUser)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const oauthToken = params.get('oauth_token')
    const oauthUser = params.get('oauth_user')

    if (oauthToken && oauthUser) {
      try {
        const user = JSON.parse(decodeURIComponent(oauthUser))
        setUser(user, oauthToken)
        navigate('/', { replace: true })
      } catch (error) {
        console.error('OAuth parsing failed:', error)
      }
    }
  }, [location.search, navigate, setUser])

  return null
}

// ─── Operational Redirects (Admin/Warehouse Port Logic) ────────────────────────
function OperationalRedirect() {
  const location = useLocation()
  useEffect(() => {
    const hostname = window.location.hostname
    const isProduction = hostname === 'jdlxmobile.in' || hostname === 'www.jdlxmobile.in'
    const isWarehouse = location.pathname.startsWith('/warehouse')
    
    let target = ''
    if (isProduction) {
      // PROD: Use subdomains or specific Vercel URLs
      const targetDomain = isWarehouse ? 'jdlx-mobile-warehouse.vercel.app' : 'jdlx-official-admin.vercel.app'
      target = `https://${targetDomain}${location.pathname}${location.search}${location.hash}`
    } else {
      // LOCAL: Use port-based redirection
      const port = isWarehouse ? '5175' : '5174'
      const protocol = window.location.protocol
      const resolvedHost = (hostname === 'localhost' || hostname === '127.0.0.1') ? ( /Android/i.test(navigator.userAgent) ? '10.0.2.2' : hostname) : hostname
      target = `${protocol}//${resolvedHost}:${port}${location.pathname}${location.search}${location.hash}`
    }
    
    window.location.replace(target)
  }, [location])
  return <PageLoader />
}

function App() {
  const { token, fetchCart, fetchWishlist } = useStore()

  useEffect(() => {
    if (token) {
      fetchCart()
      fetchWishlist()
    }
  }, [token, fetchCart, fetchWishlist])

  return (
    <ErrorBoundary>
      <TopLoader />
      <Toaster position="top-center" toastOptions={{ duration: 3000, className: 'glass-card text-sm font-bold rounded-2xl border-white/10' }} />
      <Router>
        <RouteChangeTracker />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/*" element={
              <>
                <OAuthCallbackBridge />
                <Layout>
                  <Routes>
                    {/* Public Routes */}
                    <Route path="/" element={<Home />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/cart" element={<Cart />} />
                    <Route path="/product/:id" element={<ProductDetails />} />
                    <Route path="/admin/*" element={<OperationalRedirect />} />
                    <Route path="/warehouse/*" element={<OperationalRedirect />} />
                    
                    {/* Protected User Routes */}
                    <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
                    <Route path="/track/:orderId" element={<ProtectedRoute><OrderTracking /></ProtectedRoute>} />
                    <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                    <Route path="/profile/settings" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
                    <Route path="/profile/orders" element={<ProtectedRoute><MyOrders /></ProtectedRoute>} />
                    <Route path="/profile/wishlist" element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
                    <Route path="/profile/addresses" element={<ProtectedRoute><Addresses /></ProtectedRoute>} />
                    <Route path="/profile/payments" element={<ProtectedRoute><Payments /></ProtectedRoute>} />
                    <Route path="/profile/wallet" element={<ProtectedRoute><Wallet /></ProtectedRoute>} />
                    <Route path="/profile/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
                    <Route path="/profile/security" element={<ProtectedRoute><Security /></ProtectedRoute>} />
                    <Route path="/profile/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
                    <Route path="/profile/coupons" element={<ProtectedRoute><Coupons /></ProtectedRoute>} />
                    <Route path="/profile/about-site" element={<AboutSite />} />
                    <Route path="/profile/terms" element={<TermsAndConditions />} />
                    
                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/" replace />} />
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
