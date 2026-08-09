import { useEffect, useState } from 'react'
import { ArrowLeft, Database, Download, HardDriveDownload, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

function AdminBackups() {
  const token = useStore((state) => state.adminToken || state.token)
  const user = useStore((state) => state.user)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super_admin'

  const loadBackups = async () => {
    if (!token || !isSuperAdmin) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/admin/backups`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load backups')
        setItems([])
      } else {
        setItems(data.items || [])
      }
    } catch (e) {
      setError('Failed to load backups')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBackups()
  }, [token, isSuperAdmin])

  const triggerBackup = async (mode = 'full') => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/backup/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to create backup')
        return
      }
      await loadBackups()
    } catch (e) {
      alert('Failed to create backup')
    }
  }

  const handleDownload = async (relativePath, fileName) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/admin/backups/download?path=${encodeURIComponent(relativePath)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to download backup')
        return
      }

      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName || 'backup.zip'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      alert('Failed to download backup')
    }
  }

  return (
    <div className="py-6 flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="p-2 hover:bg-white/40 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          System Backups
        </h1>
      </div>

      {!isSuperAdmin && (
        <div className="glass-card p-4 text-sm text-amber-700 bg-amber-50/80 border border-amber-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          Only super_admin can trigger or download backups.
        </div>
      )}

      {isSuperAdmin && (
        <div className="glass-card p-4 flex flex-wrap gap-3">
          <button
            onClick={() => triggerBackup('database')}
            className="btn-primary px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            <Database className="w-4 h-4" /> Create DB Backup
          </button>
          <button
            onClick={() => triggerBackup('full')}
            className="px-4 py-2 text-sm rounded-xl bg-gray-900 text-white inline-flex items-center gap-2 hover:opacity-90"
          >
            <HardDriveDownload className="w-4 h-4" /> Create Full Backup
          </button>
        </div>
      )}

      {loading ? (
        <div className="glass-card p-6 text-center text-gray-500">Loading backups...</div>
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-600">{error}</div>
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-white/50 border-b border-gray-100">
              <tr>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">File</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Type</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Size</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Modified</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                    No backups found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={`${item.category}-${item.name}`}>
                    <td className="px-5 py-3 text-sm font-semibold text-gray-800">{item.name}</td>
                    <td className="px-5 py-3 text-xs font-bold uppercase text-primary">{item.category}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{Math.round((item.size || 0) / 1024)} KB</td>
                    <td className="px-5 py-3 text-xs text-gray-500">{new Date(item.modified_at).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right">
                      {isSuperAdmin ? (
                        <button
                          onClick={() => handleDownload(item.relative_path, item.name)}
                          className="px-3 py-1 text-xs font-bold text-blue-700 bg-blue-100 rounded-lg hover:bg-blue-200 inline-flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" /> Download
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AdminBackups
