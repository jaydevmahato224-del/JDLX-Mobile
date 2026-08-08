import { Navigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import AccessDenied from './AccessDenied'

// Default fallback if no specific roles are required (any valid warehouse partner or admin)
const DEFAULT_ROLES = ['owner', 'warehouse_partner', 'delivery_partner', 'admin', 'super_admin']

function WarehouseRoute({ children, allowedRoles = DEFAULT_ROLES }) {
  const token = useStore((state) => state.warehouseToken)
  const user = useStore((state) => state.warehouseUser)

  // Staff users carry role_name (e.g. "Billing Agent") instead of role;
  // normalize it so the billing/staff routes grant access.
  const rawRole = (user?.role || user?.role_name || 'user').toLowerCase()
  const role = rawRole.includes('billing')
    ? 'billing'
    : rawRole.includes('staff')
    ? 'staff'
    : rawRole

  if (!token) {
    return <Navigate to="/warehouse/login" replace />
  }

  // Check if the current user's role is in the allowed whitelist
  if (!allowedRoles.includes(role)) {
    return <AccessDenied />
  }

  return children
}

export default WarehouseRoute
