import { useEffect, useState } from 'react'
import { ArrowLeft, History } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

function AdminActivityLogs() {
  const token = useStore((state) => state.token)
  const [logs, setLogs] = useState([])
  const [admins, setAdmins] = useState([])
  const [actions, setActions] = useState([])
  const [filters, setFilters] = useState({ admin_id: '', action: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchLogs = async (nextFilters = filters) => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (nextFilters.admin_id) params.set('admin_id', nextFilters.admin_id)
      if (nextFilters.action) params.set('action', nextFilters.action)
      const query = params.toString()

      const res = await fetch(`${API_BASE_URL}/admin/activity-logs${query ? `?${query}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load activity logs')
        setLogs([])
      } else {
        setLogs(data.logs || [])
        setAdmins(data.admins || [])
        setActions(data.actions || [])
      }
    } catch (e) {
      setError('Failed to load activity logs')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [token])

  const applyFilters = (e) => {
    e.preventDefault()
    fetchLogs(filters)
  }

  return (
    <div className="py-6 flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="p-2 hover:bg-white/40 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <History className="w-6 h-6 text-primary" />
          Activity Logs
        </h1>
      </div>

      <form onSubmit={applyFilters} className="glass-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <select
          value={filters.admin_id}
          onChange={(e) => setFilters((prev) => ({ ...prev, admin_id: e.target.value }))}
          className="p-3 rounded-lg border border-gray-200"
        >
          <option value="">All Admins</option>
          {admins.map((admin) => (
            <option key={admin.admin_id} value={admin.admin_id}>
              {admin.email}
            </option>
          ))}
        </select>

        <select
          value={filters.action}
          onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
          className="p-3 rounded-lg border border-gray-200"
        >
          <option value="">All Actions</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>

        <button type="submit" className="btn-primary px-4 py-3 text-sm">
          Apply Filters
        </button>
      </form>

      {loading ? (
        <div className="glass-card p-6 text-center text-gray-500">Loading activity logs...</div>
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-600">{error}</div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-white/50 border-b border-gray-100">
              <tr>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Admin</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Action</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Entity</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Entity ID</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-5 py-3 text-sm text-gray-700">{log.admin_email || log.admin_id}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-primary">{log.action}</td>
                  <td className="px-5 py-3 text-sm text-gray-700">{log.entity_type}</td>
                  <td className="px-5 py-3 text-sm text-gray-700">{log.entity_id ?? '-'}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-5 text-sm text-gray-500">No activity logs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AdminActivityLogs
