import { useEffect, useState } from 'react'
import { ArrowLeft, ShieldAlert, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'

function AdminAuditLogs() {
  const user = useStore((state) => state.user)
  const [logs, setLogs] = useState([])
  const [admins, setAdmins] = useState([])
  const [actionTypes, setActionTypes] = useState([])
  const [filters, setFilters] = useState({ admin: '', action_type: '', date: '', q: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super_admin'

  const fetchLogs = async (nextFilters = filters) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (nextFilters.admin) params.set('admin', nextFilters.admin)
      if (nextFilters.action_type) params.set('action_type', nextFilters.action_type)
      if (nextFilters.date) params.set('date', nextFilters.date)
      if (nextFilters.q) params.set('q', nextFilters.q)
      const query = params.toString()

      const res = await apiFetch(`/admin/audit-logs${query ? `?${query}` : ''}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load audit logs')
        setLogs([])
      } else {
        setLogs(data.logs || [])
        setAdmins(data.admins || [])
        setActionTypes(data.action_types || [])
      }
    } catch {
      setError('Failed to load audit logs')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
  }, [])

  const applyFilters = (e) => {
    e.preventDefault()
    fetchLogs(filters)
  }

  const clearLogs = async () => {
    if (!window.confirm('Clear all audit logs? This action cannot be undone.')) return
    try {
      const res = await apiFetch('/admin/audit-logs/clear', {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to clear logs')
        return
      }
      fetchLogs()
    } catch {
      alert('Failed to clear logs')
    }
  }

  return (
    <div className="py-6 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/admin" className="p-2 hover:bg-white/40 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-primary" />
            Admin Audit Logs
          </h1>
        </div>
        {isSuperAdmin && (
          <button onClick={clearLogs} className="px-4 py-2 rounded-lg bg-red-100 text-red-700 font-bold text-sm flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Clear Logs
          </button>
        )}
      </div>

      <form onSubmit={applyFilters} className="glass-card p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <select
          value={filters.admin}
          onChange={(e) => setFilters((prev) => ({ ...prev, admin: e.target.value }))}
          className="p-3 rounded-lg border border-gray-200"
        >
          <option value="">All Admins</option>
          {admins.map((admin) => (
            <option key={admin.admin_id} value={admin.admin_id}>{admin.email}</option>
          ))}
        </select>

        <select
          value={filters.action_type}
          onChange={(e) => setFilters((prev) => ({ ...prev, action_type: e.target.value }))}
          className="p-3 rounded-lg border border-gray-200"
        >
          <option value="">All Actions</option>
          {actionTypes.map((actionType) => (
            <option key={actionType} value={actionType}>{actionType}</option>
          ))}
        </select>

        <input
          type="date"
          value={filters.date}
          onChange={(e) => setFilters((prev) => ({ ...prev, date: e.target.value }))}
          className="p-3 rounded-lg border border-gray-200"
        />

        <input
          type="text"
          placeholder="Search description/entity"
          value={filters.q}
          onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
          className="p-3 rounded-lg border border-gray-200"
        />

        <button type="submit" className="btn-primary px-4 py-3 text-sm">Apply</button>
      </form>

      {loading ? (
        <div className="glass-card p-6 text-center text-gray-500">Loading audit logs...</div>
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-600">{error}</div>
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-white/50 border-b border-gray-100">
              <tr>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Admin</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Action</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Entity</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Description</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">IP</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-5 py-3 text-sm text-gray-700">{log.admin_email || log.admin_id}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-primary">{log.action_type}</td>
                  <td className="px-5 py-3 text-sm text-gray-700">{log.target_entity} #{log.target_id ?? '-'}</td>
                  <td className="px-5 py-3 text-sm text-gray-700">{log.description || '-'}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{log.ip_address || '-'}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-5 text-sm text-gray-500">No audit logs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AdminAuditLogs
