import { Navigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import AccessDenied from './AccessDenied'

// Default fallback if no specific roles are required (any valid admin)
const DEFAULT_ROLES = ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin']

function AdminRoute({ children, allowedRoles = DEFAULT_ROLES }) {
  const token = useStore((state) => state.adminToken)
  const user = useStore((state) => state.adminUser)
  const role = (user?.role || 'user').toLowerCase()

  if (!token) {
    return <Navigate to="/admin/login" replace />
  }

  // Check if the current user's role is in the allowed whitelist
  if (!allowedRoles.includes(role)) {
    return <AccessDenied />
  }

  return children
}

export default AdminRoute
