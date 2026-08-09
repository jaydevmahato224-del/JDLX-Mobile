import { useEffect, useState } from 'react'
import { ArrowLeft, KeyRound, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

function AdminPermissions() {
  const token = useStore((state) => state.adminToken || state.token)
  const [admins, setAdmins] = useState([])
  const [selectedAdminId, setSelectedAdminId] = useState('')
  const [permissions, setPermissions] = useState([])
  const [availablePermissions, setAvailablePermissions] = useState([])
  const [newPermission, setNewPermission] = useState('manage_products')
  const [message, setMessage] = useState('')

  const fetchAdmins = async () => {
    const res = await fetch(`${API_BASE_URL}/admin/list`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (res.ok) {
      setAdmins(data)
      if (!selectedAdminId && data.length > 0) {
        setSelectedAdminId(String(data[0].user_id))
      }
    } else {
      setMessage(data.error || 'Failed to load admins')
    }
  }

  const fetchPermissions = async (adminId) => {
    if (!adminId) return
    const res = await fetch(`${API_BASE_URL}/admin/permissions?admin_id=${adminId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (res.ok) {
      setPermissions(data.permissions || [])
      setAvailablePermissions(data.available_permissions || [])
      if ((data.available_permissions || []).length > 0) {
        setNewPermission(data.available_permissions[0])
      }
      setMessage('')
    } else {
      setMessage(data.error || 'Failed to load permissions')
    }
  }

  useEffect(() => {
    if (!token) return
    fetchAdmins()
  }, [token])

  useEffect(() => {
    if (!token || !selectedAdminId) return
    fetchPermissions(selectedAdminId)
  }, [selectedAdminId, token])

  const assignPermission = async () => {
    const res = await fetch(`${API_BASE_URL}/admin/permissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        admin_id: Number(selectedAdminId),
        permission: newPermission,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setMessage(data.error || 'Failed to assign permission')
      return
    }
    setMessage('Permission assigned')
    fetchPermissions(selectedAdminId)
  }

  const removePermission = async (permission) => {
    const res = await fetch(`${API_BASE_URL}/admin/permissions`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        admin_id: Number(selectedAdminId),
        permission,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setMessage(data.error || 'Failed to remove permission')
      return
    }
    setMessage('Permission removed')
    fetchPermissions(selectedAdminId)
  }

  return (
    <div className="py-6 flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="p-2 hover:bg-white/40 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-primary" />
          Permission Management
        </h1>
      </div>

      {message && (
        <div className="glass-card p-3 text-sm text-gray-700">{message}</div>
      )}

      <div className="glass-card p-4 flex flex-col gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Select Admin</label>
          <select
            className="w-full p-3 rounded-lg border border-gray-200"
            value={selectedAdminId}
            onChange={(e) => setSelectedAdminId(e.target.value)}
          >
            {admins.map((admin) => (
              <option key={admin.id} value={admin.user_id}>
                {admin.email} ({admin.role})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Permission</label>
            <select
              className="w-full p-3 rounded-lg border border-gray-200"
              value={newPermission}
              onChange={(e) => setNewPermission(e.target.value)}
            >
              {availablePermissions.map((perm) => (
                <option key={perm} value={perm}>{perm}</option>
              ))}
            </select>
          </div>
          <button
            onClick={assignPermission}
            className="btn-primary px-4 py-3 text-sm inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Assign
          </button>
        </div>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-white/50 border-b border-gray-100">
            <tr>
              <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Assigned Permission</th>
              <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {permissions.map((permission) => (
              <tr key={permission}>
                <td className="px-5 py-3 text-sm font-semibold text-gray-800">{permission}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => removePermission(permission)}
                    className="px-3 py-1 text-xs font-bold text-red-600 bg-red-100 rounded-lg hover:bg-red-200 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Remove
                  </button>
                </td>
              </tr>
            ))}
            {permissions.length === 0 && (
              <tr>
                <td className="px-5 py-4 text-sm text-gray-500" colSpan={2}>No permissions assigned.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default AdminPermissions
