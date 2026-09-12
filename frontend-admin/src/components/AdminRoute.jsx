import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import AccessDenied from './AccessDenied'
import { apiFetch } from '../utils/apiFetch'
import { Loader2 } from 'lucide-react'

// Rebuild the admin session when the local snapshot is missing but a valid
// session cookie still exists (e.g. localStorage cleared, browser tab
// restore). verify-token echoes the JWT's role, so a non-admin can never
// manufacture access this way — the server is the source of truth.
async function fetchAdminSession() {
  const res = await apiFetch('/auth/verify-token')
  if (!res.ok) return null
  const data = await res.json()
  const ADMIN_ROLES = ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin']
  const role = (data.role || '').toLowerCase()
  if (!data.valid || !ADMIN_ROLES.includes(role)) return null
  return {
    id: data.user_id,
    email: data.email,
    role,
    name: data.email,
  }
}

// Default fallback if no specific roles are required (any valid admin)
const DEFAULT_ROLES = ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin']

// Cache to avoid re-verifying on every route change within the same session
let _lastVerifiedAt = 0
const VERIFY_INTERVAL_MS = 5 * 60 * 1000 // Re-verify every 5 minutes

function AdminRoute({ children, allowedRoles = DEFAULT_ROLES }) {
  const user = useStore((state) => state.adminUser)
  const adminLogout = useStore((state) => state.adminLogout)
  const validateAdminSession = useStore((state) => state.validateAdminSession)
  const role = (user?.role || 'user').toLowerCase()

  const [verifying, setVerifying] = useState(false)
  const [restoring, setRestoring] = useState(false)
  // If we verified this session within the last interval, we're already good
  // (module-level cache survives route changes) — computed lazily at mount so
  // the effect never needs to set this synchronously.
  const [verified, setVerified] = useState(() => {
    const now = Date.now()
    return now - _lastVerifiedAt < VERIFY_INTERVAL_MS
  })

  useEffect(() => {
    if (!user) {
      // Session snapshot lost but the HttpOnly cookie may still be valid —
      // try to rebuild before bouncing to login. (This was the second half of
      // the login loop: cookie OK, adminUser null → instant redirect to
      // /admin/login with no recovery attempt.)
      let cancelled = false
      const restore = async () => {
        try {
          const sessionUser = await fetchAdminSession()
          if (cancelled) return
          if (sessionUser) {
            useStore.getState().setAdminUser(sessionUser)
            setVerified(true)
            _lastVerifiedAt = Date.now()
          }
        } catch {
          // cookie absent/invalid — fall through to the login redirect below
        } finally {
          if (!cancelled) setRestoring(false)
        }
      }
      setRestoring(true)
      restore()
      return () => { cancelled = true }
    }

    // Client-side validation first (fast — checks fingerprint)
    if (!validateAdminSession()) {
      return // validateAdminSession already calls adminLogout
    }

    // Server-side verification (debounced — only every 5 minutes)
    const now = Date.now()
    if (now - _lastVerifiedAt < VERIFY_INTERVAL_MS) {
      return
    }

    let cancelled = false

    const verifyWithServer = async () => {
      setVerifying(true)
      try {
        const res = await apiFetch('/auth/verify-token')
        if (cancelled) return
        if (res.status === 401) {
          useStore.getState().setReauthenticating(true)
          // adminLogout()
          // window.location.replace('/admin/login?reason=session_expired')
        } else {
          _lastVerifiedAt = Date.now()
          setVerified(true)
        }
      } catch {
        // Network error — allow access with client-side validation only
        if (!cancelled) setVerified(true)
      } finally {
        if (!cancelled) setVerifying(false)
      }
    }
    verifyWithServer()

    return () => { cancelled = true }
  }, [user, adminLogout, validateAdminSession])

  if (!user) {
    // Still attempting to rebuild the session from the cookie — wait instead
    // of bouncing to /admin/login (which previously looped).
    if (restoring) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )
    }
    return <Navigate to="/admin/login" replace />
  }

  // Show brief loading while verifying with backend
  if (verifying && !verified) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  // Check if the current user's role is in the allowed whitelist
  if (!allowedRoles.includes(role)) {
    return <AccessDenied />
  }

  return children
}

export default AdminRoute
