import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Outlet, Navigate } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import ErrorBoundary from './components/ErrorBoundary'
import WarehouseRoute from './components/WarehouseRoute'
import WarehouseLayout from './components/WarehouseLayout'
import WarehouseLogin from './pages/warehouse/WarehouseLogin'
import { useStore } from './store/useStore'
import TopLoader from './components/TopLoader'
import { useLoadingStore } from './store/useLoadingStore'

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
      <TopLoader />
      <Router>
        <RouteChangeTracker />
        <Routes>
          {/* Unprotected Routes */}
          <Route path="/" element={<WarehouseLogin />} />
          <Route path="/warehouse/login" element={<WarehouseLogin />} />
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
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  )
}

export default App
