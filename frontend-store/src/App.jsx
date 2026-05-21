import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Suspense, lazy, useEffect, useLayoutEffect, useState } from 'react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import TopLoader from './components/TopLoader'
import PageLoader from './components/PageLoader'
import SplashScreen from './components/SplashScreen'
import AnalyticsTracker from './components/AnalyticsTracker'
import PushNotificationManager from './components/PushNotificationManager'
import { GlobalErrorOverlay } from './components/ErrorScreens'
import { useStore } from './store/useStore'
import { useLoadingStore } from './store/useLoadingStore'
import { API_BASE_URL } from './config'

if (import.meta.env.DEV) {
  console.log("%c JDLX DEBUG: API_BASE_URL is", "color: #f59e0b; font-weight: bold;", API_BASE_URL);
}

// ─── Global Fetch Interceptor ─────────────────────────────────────────────────
// ─── Consecutive Failure Tracker ───────────────────────────────────────────────
// Only show global error overlay after multiple consecutive backend failures.
// This prevents Render cold-start timeouts or transient glitches from blocking the entire UI.
let _consecutiveBackendFailures = 0;
const FAILURE_THRESHOLD = 3; // Number of consecutive failures before showing error overlay

const _originalFetch = window.fetch;
window.fetch = async (...args) => {
  const { startLoading, stopLoading } = useLoadingStore.getState();
  const { setGlobalError, clearGlobalError, globalError } = useStore.getState();
  const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

  if (import.meta.env.DEV) {
    console.log(`%c JDLX FETCH: ${requestUrl}`, "color: #3b82f6;");
  }

  // Only show loader for significant API calls
  const isBackgroundRequest = requestUrl.includes('/interactions') || requestUrl.includes('/logs') || requestUrl.includes('/api/report-issue');
  if (!isBackgroundRequest) startLoading();

  // Helper to identify if request is to our backend
  const isBackendUrl = requestUrl.includes('localhost:5000') || 
                       requestUrl.includes('10.0.2.2:5000') || 
                       requestUrl.includes('jdlx-mobile.onrender.com') ||
                       requestUrl.startsWith('/api/') ||
                       (typeof API_BASE_URL === 'string' && requestUrl.includes(API_BASE_URL));

  try {
    const response = await _originalFetch(...args);

    if (import.meta.env.DEV) {
      console.log(`%c JDLX STATUS: ${response.status} for ${requestUrl}`, "color: #10b981;");
    }

    if (response.status === 401 && requestUrl.includes('/api/') && !window.location.pathname.startsWith('/login')) {
      useStore.getState().logout();
    }

    // Detection Logic for Server Errors - ONLY for our backend
    if (isBackendUrl && response.status >= 500 && response.status <= 504 && !isBackgroundRequest) {
      _consecutiveBackendFailures++;
      if (_consecutiveBackendFailures >= FAILURE_THRESHOLD) {
        setGlobalError('server');
      }
    } else if (isBackendUrl && response.ok) {
      // Successful response — reset failure counter and auto-clear any existing error
      _consecutiveBackendFailures = 0;
      if (globalError) {
        clearGlobalError();
      }
    }

    return response;
  } catch (error) {
    console.error("Fetch Error:", error);

    // ONLY trigger global error screens for our backend API failures
    if (isBackendUrl && !isBackgroundRequest) {
      _consecutiveBackendFailures++;
      if (_consecutiveBackendFailures >= FAILURE_THRESHOLD) {
        if (!navigator.onLine || error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          setGlobalError('network');
        } else {
          setGlobalError('server');
        }
      }
    }
    throw error;
  } finally {
    if (!isBackgroundRequest) stopLoading();
  }
};

// ─── Lazy Loaded Components ──────────────────────────────────────────────────
const HomePage = lazy(() => import('./pages/user/Home'))
const Login = lazy(() => import('./pages/user/Login'))
const Cart = lazy(() => import('./pages/user/Cart'))
const ProductDetails = lazy(() => import('./pages/user/ProductDetails'))
const SearchPage = lazy(() => import('./pages/user/SearchPage'))
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
const SupportPage = lazy(() => import('./pages/user/SupportPage'))
const TicketDetailPage = lazy(() => import('./pages/user/TicketDetailPage'))
const ComplaintPage = lazy(() => import('./pages/user/ComplaintPage'))
const MyRequestsPage = lazy(() => import('./pages/user/MyRequestsPage'))
const OrderReportPage = lazy(() => import('./pages/user/OrderReportPage'))
const MyReportsPage = lazy(() => import('./pages/user/MyReportsPage'))
const RefundRequestPage = lazy(() => import('./pages/user/RefundRequestPage'))
const MyRefundsPage = lazy(() => import('./pages/user/MyRefundsPage'))
const Coupons = lazy(() => import('./pages/user/Coupons'))
const AboutSite = lazy(() => import('./pages/user/AboutSite'))
const TermsAndConditions = lazy(() => import('./pages/user/TermsAndConditions'))
const BugReportPage = lazy(() => import('./pages/user/BugReportPage'))
const MyBugReportsPage = lazy(() => import('./pages/user/MyBugReportsPage'))
const ShareRedirect = lazy(() => import('./pages/user/ShareRedirect'))

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
      const targetDomain = isWarehouse ? 'jdlx-mobile-wearhouse.vercel.app' : 'jdlx-official-admin.vercel.app'
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
  const { token, fetchCart, fetchWishlist, fetchProducts, fetchBanners } = useStore()
  const [showSplash, setShowSplash] = useState(() => {
    // Show splash only if:
    // 1. App is running in standalone (PWA) mode
    // 2. Device is mobile (Phone/Tablet)
    // 3. Not already shown in this session
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    return isStandalone && isMobile && !sessionStorage.getItem('jdlx_splash_shown')
  })

  const [dataReady, setDataReady] = useState(false)
  const [splashFinished, setSplashFinished] = useState(false)

  useEffect(() => {
    // BUG 1 FIX: Only preload in App.jsx if we are showing the splash screen.
    // Otherwise, let individual pages (like Home.jsx) handle their own loading.
    if (!showSplash) {
      setDataReady(true)
      return
    }

    // Preload everything simultaneously
    const preloadData = async () => {
      try {
        const promises = [
          fetchProducts(),
          fetchBanners(),
          fetchCart()
        ]
        
        if (token) {
          promises.push(fetchWishlist())
        }
        
        await Promise.all(promises)
        console.log("%c JDLX: Preload Complete", "color: #10b981; font-weight: bold;")
      } catch (err) {
        console.error("Preload failed:", err)
      } finally {
        setDataReady(true)
      }
    }

    preloadData()
  }, [showSplash, token, fetchCart, fetchWishlist, fetchProducts, fetchBanners])

  const handleSplashFinish = () => {
    setSplashFinished(true)
  }

  // Effect to hide splash only when BOTH animation is done AND data is ready
  useEffect(() => {
    if (splashFinished && dataReady) {
      sessionStorage.setItem('jdlx_splash_shown', 'true')
      setShowSplash(false)
    }
  }, [splashFinished, dataReady])

  if (showSplash) {
    return <SplashScreen onFinish={handleSplashFinish} dataReady={dataReady} />
  }

  return (
    <ErrorBoundary>
      <GlobalErrorOverlay />
      <PushNotificationManager />
      <TopLoader />
      <Toaster position="top-center" toastOptions={{ duration: 3000, className: 'glass-card text-sm font-bold rounded-2xl border-white/10' }} />
      <Router>
        <AnalyticsTracker />
        <RouteChangeTracker />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/*" element={
              <>
                <OAuthCallbackBridge />
                <Layout>
                  <Routes>
                    {/* Public Routes */}
                    <Route path="/" element={<HomePage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/cart" element={<Cart />} />
                    <Route path="/product/:id" element={<ProductDetails />} />
                    <Route path="/p/:token" element={<ProductDetails />} />
                    <Route path="/p/:slugToken" element={<ProductDetails />} />
                    <Route path="/s/:token" element={<ShareRedirect />} />
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
                    <Route path="/profile/support" element={<ProtectedRoute><SupportPage /></ProtectedRoute>} />
                    <Route path="/profile/support/ticket/:ticket_id" element={<ProtectedRoute><TicketDetailPage /></ProtectedRoute>} />
                    <Route path="/profile/complaint" element={<ProtectedRoute><ComplaintPage /></ProtectedRoute>} />
                    <Route path="/profile/order-report" element={<ProtectedRoute><OrderReportPage /></ProtectedRoute>} />
                    <Route path="/profile/my-reports" element={<ProtectedRoute><MyReportsPage /></ProtectedRoute>} />
                    <Route path="/profile/refund-request" element={<ProtectedRoute><RefundRequestPage /></ProtectedRoute>} />
                    <Route path="/profile/my-refunds" element={<ProtectedRoute><MyRefundsPage /></ProtectedRoute>} />
                    <Route path="/my-requests" element={<ProtectedRoute><MyRequestsPage /></ProtectedRoute>} />
                    <Route path="/profile/coupons" element={<ProtectedRoute><Coupons /></ProtectedRoute>} />
                    <Route path="/profile/about-site" element={<AboutSite />} />
                    <Route path="/profile/terms" element={<TermsAndConditions />} />
                    <Route path="/profile/bug-report" element={<ProtectedRoute><BugReportPage /></ProtectedRoute>} />
                    <Route path="/profile/my-bug-reports" element={<ProtectedRoute><MyBugReportsPage /></ProtectedRoute>} />
                    
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
