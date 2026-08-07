import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Outlet, Navigate } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Toaster } from 'react-hot-toast'
import ErrorBoundary from './components/ErrorBoundary'
import { GlobalErrorOverlay } from './components/ErrorScreens'
import WarehouseRoute from './components/WarehouseRoute'
import WarehouseLayout from './components/WarehouseLayout'
const WarehouseLogin = lazy(() => import('./pages/warehouse/WarehouseLogin'))
import { useStore } from './store/useStore'
import TopLoader from './components/TopLoader'
import { useLoadingStore } from './store/useLoadingStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Global fetch interceptor
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const { startLoading, stopLoading } = useLoadingStore.getState();
  const { setGlobalError } = useStore.getState();
  const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

  const isBackground = requestUrl.includes('/api/report-issue');
  if (!isBackground) startLoading();

  // Helper to identify if request is to our backend
  const isBackendUrl = requestUrl.includes('localhost:5000') || 
                       requestUrl.includes('10.0.2.2:5000') || 
                       requestUrl.includes('jdlx-mobile.onrender.com') ||
                       requestUrl.startsWith('/api/') ||
                       (typeof API_BASE_URL === 'string' && requestUrl.includes(API_BASE_URL));

  try {
    const response = await originalFetch(...args);

    if (
      response.status === 401 &&
      requestUrl.includes('/api/') &&
      !window.location.pathname.startsWith('/warehouse/login')
    ) {
      useStore.getState().warehouseLogout();
      window.location.replace('/warehouse/login?reason=session_expired');
    }

    // Detection Logic for Server Errors - ONLY for our backend
    if (isBackendUrl && response.status >= 500 && response.status <= 504 && !isBackground) {
      setGlobalError('server');
    }

    return response;
  } catch (error) {
    console.error("Fetch Error:", error);

    // ONLY trigger global error screens for our backend API failures
    if (isBackendUrl && !isBackground) {
      if (!navigator.onLine || error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        setGlobalError('network');
      } else {
        setGlobalError('server');
      }
    }
    throw error;
  } finally {
    if (!isBackground) stopLoading();
  }
};

// Lazy Loading
const WarehouseDashboard = lazy(() => import('./pages/warehouse/WarehouseDashboard'))
import WarehouseRequest from './pages/warehouse/WarehouseRequest'
const WarehouseInventory = lazy(() => import('./pages/warehouse/WarehouseInventory'))
const WarehouseAnalytics = lazy(() => import('./pages/warehouse/WarehouseAnalytics'))
const WarehouseProfile = lazy(() => import('./pages/warehouse/WarehouseProfile'))
const DeliveryRequest = lazy(() => import('./pages/warehouse/DeliveryRequest'))
const WarehouseRiderApplications = lazy(() => import('./pages/warehouse/WarehouseRiderApplications'))
const ManageRiders = lazy(() => import('./pages/warehouse/ManageRiders'))
const WarehouseOrders = lazy(() => import('./pages/warehouse/WarehouseOrders'))
const WarehouseProcurement = lazy(() => import('./pages/warehouse/WarehouseProcurement'))
const WarehouseOffers = lazy(() => import('./pages/warehouse/WarehouseOffers'))
const StaffBilling = lazy(() => import('./pages/warehouse/StaffBilling'))
const StaffSetupPassword = lazy(() => import('./pages/warehouse/StaffSetupPassword'))

const LoadingSpinner = () => (
  <div className="min-h-[60vh] flex items-center justify-center bg-[#020617]">
    <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
  </div>
)

/**
 * Dedicated OAuth Callback component to handle secure login processing for warehouse partners.
 */
function OAuthCallback() {
  const location = useLocation()
  const navigate = useNavigate()
  const setWarehouseUser = useStore((state) => state.setWarehouseUser)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const oauthToken = params.get('oauth_token')
    const oauthUser = params.get('oauth_user')

    if (!oauthToken || !oauthUser) {
      navigate('/warehouse/login', { replace: true })
      return
    }

    try {
      const user = JSON.parse(decodeURIComponent(oauthUser))
      const warehouseRoles = ['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']
      const lowerRole = (user.role || '').toLowerCase()

      if (warehouseRoles.includes(lowerRole)) {
        // Set state synchronously before navigation
        setWarehouseUser(user, oauthToken)
        navigate('/warehouse/dashboard', { replace: true })
      } else {
        alert('Unauthorized: You do not have warehouse partner permissions.')
        navigate('/warehouse/login', { replace: true })
      }
    } catch (error) {
      console.error('OAuth callback parsing failed:', error)
      navigate('/warehouse/login', { replace: true })
    }
  }, [location.search, navigate, setWarehouseUser])

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />
        <p className="text-amber-500/70 font-medium animate-pulse">Establishing secure partner session...</p>
      </div>
    </div>
  )
}

function RouteChangeTracker() {
  const location = useLocation()
  const startLoading = useLoadingStore((state) => state.startLoading)
  const stopLoading = useLoadingStore((state) => state.stopLoading)

  useEffect(() => {
    startLoading()
    const timer = setTimeout(() => {
      stopLoading()
    }, 400)
    return () => {
      clearTimeout(timer)
      stopLoading()
    }
  }, [location.pathname, location.search, startLoading, stopLoading])

  return null
}

const WarehouseLayoutWrapper = () => (
  <Suspense fallback={<LoadingSpinner />}>
    <WarehouseLayout />
  </Suspense>
);

function App() {
  return (
    <ErrorBoundary>
      <Toaster position="top-center" reverseOrder={false} />
      <GlobalErrorOverlay />
      <TopLoader />
      <Router>
        <RouteChangeTracker />
        <Routes>
          {/* Unprotected Routes */}
          <Route path="/" element={<WarehouseLogin />} />
          <Route path="/warehouse/login" element={<WarehouseLogin />} />
          <Route path="/warehouse/staff/setup" element={
            <Suspense fallback={<LoadingSpinner />}>
              <StaffSetupPassword />
            </Suspense>
          } />
          <Route path="/warehouse/request" element={<WarehouseRequest />} />
          <Route path="/warehouse/request-delivery" element={
            <Suspense fallback={<LoadingSpinner />}>
              <DeliveryRequest />
            </Suspense>
          } />
          <Route path="/oauth/callback" element={<OAuthCallback />} />

          {/* Protected Warehouse Routes */}
          <Route element={<WarehouseLayoutWrapper />}>
            <Route path="/warehouse/dashboard" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']}>
                <WarehouseDashboard />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/billing" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin', 'billing', 'staff']}>
                <StaffBilling />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/inventory" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']}>
                <WarehouseInventory />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/analytics" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']}>
                <WarehouseAnalytics />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/profile" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']}>
                <WarehouseProfile />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/rider-requests" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'admin', 'super_admin']}>
                <WarehouseRiderApplications />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/manage-riders" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'admin', 'super_admin']}>
                <ManageRiders />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/orders" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']}>
                <WarehouseOrders />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/procurement" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'admin', 'super_admin']}>
                <WarehouseProcurement />
              </WarehouseRoute>
            } />
            <Route path="/warehouse/offers" element={
              <WarehouseRoute allowedRoles={['owner', 'warehouse_partner', 'admin', 'super_admin']}>
                <WarehouseOffers />
              </WarehouseRoute>
            } />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  )
}

export default App
