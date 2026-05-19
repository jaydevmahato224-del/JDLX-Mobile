import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Outlet, Navigate } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState } from 'react'
import { Loader2, AlertCircle, Server } from 'lucide-react'
import { Toaster } from 'react-hot-toast'


import ErrorBoundary from './components/ErrorBoundary'
import AdminRoute from './components/AdminRoute'
import AdminLayout from './components/AdminLayout'
import AdminLogin from './pages/admin/AdminLogin'
import { useStore } from './store/useStore'
import TopLoader from './components/TopLoader'
import { useLoadingStore } from './store/useLoadingStore'
import { API_BASE_URL } from './config'

function BackendDownDetector() {
  const [isOffline, setIsOffline] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Don't check if we are already on the server control page or login page
    if (location.pathname.includes('server-control') || location.pathname.includes('login')) {
      setIsOffline(false);
      return;
    }

    const checkBackend = async () => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
        clearTimeout(id);
        if (!res.ok) throw new Error();
        setIsOffline(false);
      } catch (err) {
        setIsOffline(true);
      }
    };

    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, [location.pathname]);

  if (!isOffline) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-6 text-center">
      <div className="max-w-md w-full bg-white rounded-[2rem] p-8 shadow-2xl space-y-6">
        <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto">
          <AlertCircle className="w-10 h-10 text-red-500 animate-pulse" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Main Server Offline</h2>
          <p className="text-gray-500 mt-2">The JDLX backend is currently unreachable. You need to start the server to continue.</p>
        </div>
        <button 
          onClick={() => {
            setIsOffline(false);
            navigate('/admin/server-control');
          }}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
        >
          <Server className="w-5 h-5" />
          Go to Server Control
        </button>
      </div>
    </div>
  );
}


// Global fetch interceptor to trigger TopLoader on API calls
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const { startLoading, stopLoading } = useLoadingStore.getState();
  startLoading();
  try {
    const response = await originalFetch(...args);
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (
      response.status === 401 &&
      requestUrl.includes('/api/admin/') &&
      !window.location.pathname.startsWith('/admin/login')
    ) {
      useStore.getState().adminLogout();
      window.location.replace('/admin/login?reason=session_expired');
    }

    return response;
  } finally {
    stopLoading();
  }
};

// Lazy Loading for admin routes
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminSystemHealth = lazy(() => import('./pages/admin/AdminSystemHealth'))
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders'))
const AdminInventory = lazy(() => import('./pages/admin/AdminInventory'))
const AdminCategories = lazy(() => import('./pages/admin/AdminCategories'))
const AdminDarkStores = lazy(() => import('./pages/admin/AdminDarkStores'))
const AdminRestocking = lazy(() => import('./pages/admin/AdminRestocking'))
const AdminRefunds = lazy(() => import('./pages/admin/AdminRefunds'))
const AdminAdmins = lazy(() => import('./pages/admin/AdminAdmins'))
const AdminPermissions = lazy(() => import('./pages/admin/AdminPermissions'))
const AdminActivityLogs = lazy(() => import('./pages/admin/AdminActivityLogs'))
const AdminAuditLogs = lazy(() => import('./pages/admin/AdminAuditLogs'))
const AdminBackups = lazy(() => import('./pages/admin/AdminBackups'))
const AdminRecovery = lazy(() => import('./pages/admin/AdminRecovery'))
const AdminIntelligence = lazy(() => import('./pages/admin/AdminIntelligence'))
const AdminProducts = lazy(() => import('./pages/admin/AdminProducts'))
const AdminOffers = lazy(() => import('./pages/admin/AdminOffers'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminWarehouseApplications = lazy(() => import('./pages/admin/AdminWarehouseApplications'))
const AdminDeliveryApplications = lazy(() => import('./pages/admin/AdminDeliveryApplications'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'))
const AdminServerControl = lazy(() => import('./pages/admin/AdminServerControl'))
const AdminBanners = lazy(() => import('./pages/admin/AdminBanners'))
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications'))
const AdminReviews = lazy(() => import('./pages/admin/AdminReviews'))
const AdminDeviceModels = lazy(() => import('./pages/admin/AdminDeviceModels'))
const AdminDatabase = lazy(() => import('./pages/admin/AdminDatabase'))


const LoadingSpinner = () => (
  <div className="min-h-[60vh] flex items-center justify-center bg-gray-50/50">
    <Loader2 className="w-10 h-10 text-primary animate-spin" />
  </div>
)

/**
 * Dedicated OAuth Callback component to handle secure login processing.
 * This route is NOT protected, allowing it to process tokens before redirection.
 */
function OAuthCallback() {
  const location = useLocation()
  const navigate = useNavigate()
  const setAdminUser = useStore((state) => state.setAdminUser)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const oauthToken = params.get('oauth_token')
    const oauthUser = params.get('oauth_user')

    if (!oauthToken || !oauthUser) {
      navigate('/admin/login', { replace: true })
      return
    }

    try {
      const user = JSON.parse(decodeURIComponent(oauthUser))
      const adminRoles = ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin']
      const lowerRole = (user.role || '').toLowerCase()

      if (adminRoles.includes(lowerRole)) {
        // Set state synchronously before navigation
        setAdminUser(user, oauthToken)
        navigate('/admin/dashboard', { replace: true })
      } else {
        alert('Unauthorized: You do not have admin permissions.')
        navigate('/admin/login', { replace: true })
      }
    } catch (error) {
      console.error('OAuth callback parsing failed:', error)
      navigate('/admin/login', { replace: true })
    }
  }, [location.search, navigate, setAdminUser])

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
        <p className="text-white/70 font-medium animate-pulse">Establishing secure session...</p>
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

const AdminLayoutWrapper = () => (
  <AdminLayout>
    <Suspense fallback={<LoadingSpinner />}>
      <Outlet />
    </Suspense>
  </AdminLayout>
);

function App() {
  return (
    <ErrorBoundary>
      <TopLoader />
      <Toaster position="top-right" />
      <Router>
        <BackendDownDetector />
        <RouteChangeTracker />

        <Routes>
          {/* Unprotected Routes */}
          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />

          {/* Protected Admin Routes */}
          <Route path="/admin" element={<AdminLayoutWrapper />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin']}>
                <AdminDashboard />
              </AdminRoute>
            } />
            <Route path="system-health" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminSystemHealth />
              </AdminRoute>
            } />
            <Route path="products" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'inventory_admin']}>
                <AdminProducts />
              </AdminRoute>
            } />
            <Route path="offers" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager']}>
                <AdminOffers />
              </AdminRoute>
            } />
            <Route path="orders" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager', 'delivery_admin']}>
                <AdminOrders />
              </AdminRoute>
            } />
            <Route path="inventory" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'inventory_admin']}>
                <AdminInventory />
              </AdminRoute>
            } />
            <Route path="reviews" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'support_admin']}>
                <AdminReviews />
              </AdminRoute>
            } />
            <Route path="analytics" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager']}>
                <AdminDashboard />
              </AdminRoute>
            } />
            <Route path="intelligence" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager', 'inventory_admin']}>
                <AdminIntelligence />
              </AdminRoute>
            } />
            <Route path="users" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager']}>
                <AdminUsers />
              </AdminRoute>
            } />
            <Route path="categories" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'inventory_admin']}>
                <AdminCategories />
              </AdminRoute>
            } />
            <Route path="device-models" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'inventory_admin']}>
                <AdminDeviceModels />
              </AdminRoute>
            } />
            <Route path="stores" element={
              <AdminRoute allowedRoles={['super_admin', 'admin']}>
                <AdminDarkStores />
              </AdminRoute>
            } />
            <Route path="warehouse-applications" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager']}>
                <AdminWarehouseApplications />
              </AdminRoute>
            } />
            <Route path="delivery-applications" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'delivery_admin']}>
                <AdminDeliveryApplications />
              </AdminRoute>
            } />
            <Route path="restocking" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'inventory_admin']}>
                <AdminRestocking />
              </AdminRoute>
            } />
            <Route path="refunds" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'support_admin']}>
                <AdminRefunds />
              </AdminRoute>
            } />
            <Route path="admins" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminAdmins />
              </AdminRoute>
            } />
            <Route path="permissions" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminPermissions />
              </AdminRoute>
            } />
            <Route path="activity-logs" element={
              <AdminRoute allowedRoles={['super_admin', 'admin']}>
                <AdminActivityLogs />
              </AdminRoute>
            } />
            <Route path="audit-logs" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminAuditLogs />
              </AdminRoute>
            } />
            <Route path="backups" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminBackups />
              </AdminRoute>
            } />
            <Route path="recovery" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminRecovery />
              </AdminRoute>
            } />
            <Route path="settings" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminSettings />
              </AdminRoute>
            } />
            <Route path="server-control" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminServerControl />
              </AdminRoute>
            } />
            <Route path="banners" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager']}>
                <AdminBanners />
              </AdminRoute>
            } />
            <Route path="notifications" element={
              <AdminRoute allowedRoles={['super_admin', 'admin', 'manager']}>
                <AdminNotifications />
              </AdminRoute>
            } />
            <Route path="database" element={
              <AdminRoute allowedRoles={['super_admin']}>
                <AdminDatabase />
              </AdminRoute>
            } />

          </Route>

          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  )
}

export default App
