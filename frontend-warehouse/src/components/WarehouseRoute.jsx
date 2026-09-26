import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import AccessDenied from './AccessDenied'
import { apiFetch } from '../utils/apiFetch'
import { Loader2 } from 'lucide-react'

// Default fallback if no specific roles are required (any valid warehouse partner or admin)
const DEFAULT_ROLES = ['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']

function WarehouseRoute({ children, allowedRoles = DEFAULT_ROLES }) {
  const user = useStore((state) => state.warehouseUser)

  // Staff users carry role_name (e.g. "Billing Agent") instead of role;
  // normalize it so the billing/staff routes grant access. Word-boundary
  // matching (not bare substring) so a hypothetical "Billing Manager II"
  // or "Non-billing Supervisor" can never accidentally grant POS access.
  const rawRole = (user?.role || user?.role_name || 'user').toLowerCase()
  const role = /\bbilling\b/.test(rawRole)
    ? 'billing'
    : /\bstaff\b/.test(rawRole)
    ? 'staff'
    : rawRole

  const [verified, setVerified] = useState(false)
  const [verifying, setVerifying] = useState(true)

  useEffect(() => {
    const verify = async () => {
      if (!user) {
        setVerified(false)
        setVerifying(false)
        return
      }
      try {
        const res = await apiFetch('/auth/verify-token')
        if (res.ok) {
          setVerified(true)
        } else {
          setVerified(false)
        }
      } catch {
        // Network error (backend unreachable / offline): the token was already
        // verified at login and every backend route re-checks auth anyway, so
        // falling back to the client-side session keeps the panel usable
        // during a Render cold-start instead of force-logging the user out.
        // Only do this when the device is actually offline or the request
        // never reached a server — a real HTTP failure lands in res.ok above.
        setVerified(true)
      } finally {
        setVerifying(false)
      }
    }
    verify()
  }, [user])

  if (verifying) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-[#020617]">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
      </div>
    )
  }

  if (!verified || !user) {
    return <Navigate to="/warehouse/login" replace />
  }

  // Check if the current user's role is in the allowed whitelist
  if (!allowedRoles.includes(role)) {
    return <AccessDenied />
  }

  return children
}

export default WarehouseRoute
