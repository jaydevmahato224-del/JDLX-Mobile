import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import AccessDenied from './AccessDenied'
import { apiFetch } from '../utils/apiFetch'
import { Loader2 } from 'lucide-react'

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
  // If we verified this session within the last interval, we're already good
  // (module-level cache survives route changes) — computed lazily at mount so
  // the effect never needs to set this synchronously.
  const [verified, setVerified] = useState(() => {
    const now = Date.now()
    return now - _lastVerifiedAt < VERIFY_INTERVAL_MS
  })

  useEffect(() => {
    if (!user) return

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
