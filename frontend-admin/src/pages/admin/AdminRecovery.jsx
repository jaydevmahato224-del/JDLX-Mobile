import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, LifeBuoy, ShieldAlert, CheckCircle2, Database, FileArchive, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

function AdminRecovery() {
  const token = useStore((state) => state.token)
  const user = useStore((state) => state.user)
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super_admin'

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [selectedDb, setSelectedDb] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [verifyResult, setVerifyResult] = useState(null)

  const backupsByType = useMemo(() => {
    const db = items.filter((i) => i.category === 'database')
    const files = items.filter((i) => i.category === 'files')
    return { db, files }
  }, [items])

  const loadBackups = async () => {
    if (!token || !isSuperAdmin) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/admin/recovery/backups`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load recovery backups')
        setItems([])
      } else {
        const backupItems = data.items || []
        setItems(backupItems)
        if (!selectedDb) {
          const firstDb = backupItems.find((i) => i.category === 'database')
          if (firstDb) setSelectedDb(firstDb.relative_path)
        }
        if (!selectedFile) {
          const firstFile = backupItems.find((i) => i.category === 'files')
          if (firstFile) setSelectedFile(firstFile.relative_path)
        }
      }
    } catch (e) {
      setError('Failed to load recovery backups')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBackups()
  }, [token, isSuperAdmin])

  const verifyBackup = async (path) => {
    if (!path) {
      alert('Select a backup first')
      return
    }
    setVerifyResult(null)
    try {
      const res = await fetch(`${API_BASE_URL}/admin/recovery/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Verification failed')
        return
      }
      setVerifyResult(data)
    } catch (e) {
      alert('Verification failed')
    }
  }

  const restoreDatabase = async () => {
    if (!selectedDb) {
      alert('Select a database backup')
      return
    }
    if (!confirm('Restore database from selected backup? Current state will be snapshotted first.')) return
    try {
      const res = await fetch(`${API_BASE_URL}/admin/recovery/restore/database`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path: selectedDb }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Database restore failed')
        return
      }
      alert('Database restore completed')
      loadBackups()
    } catch (e) {
      alert('Database restore failed')
    }
  }

  const restoreFiles = async () => {
    if (!selectedFile) {
      alert('Select a file backup')
      return
    }
    if (!confirm('Restore files from selected backup? Current state will be snapshotted first.')) return
    try {
      const res = await fetch(`${API_BASE_URL}/admin/recovery/restore/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path: selectedFile }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'File restore failed')
        return
      }
      alert('File restore completed')
      loadBackups()
    } catch (e) {
      alert('File restore failed')
    }
  }

  const restoreFullSystem = async () => {
    if (!selectedDb || !selectedFile) {
      alert('Select both database and file backups')
      return
    }
    if (!confirm('Run FULL system restore? This should be used only for disaster recovery.')) return
    try {
      const res = await fetch(`${API_BASE_URL}/admin/recovery/restore/full`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          database_path: selectedDb,
          file_path: selectedFile,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Full restore failed')
        return
      }
      alert('Full restore completed')
      loadBackups()
    } catch (e) {
      alert('Full restore failed')
    }
  }

  return (
    <div className="py-6 flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="p-2 hover:bg-white/40 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <LifeBuoy className="w-6 h-6 text-primary" />
          Disaster Recovery
        </h1>
      </div>

      {!isSuperAdmin && (
        <div className="glass-card p-4 text-sm text-amber-700 bg-amber-50/80 border border-amber-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          Only super_admin can run recovery operations.
        </div>
      )}

      {isSuperAdmin && (
        <>
          <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-2">Database Backup Version</label>
              <select
                value={selectedDb}
                onChange={(e) => setSelectedDb(e.target.value)}
                className="w-full p-3 rounded-lg border border-gray-200"
              >
                <option value="">Select database backup</option>
                {backupsByType.db.map((item) => (
                  <option key={item.relative_path} value={item.relative_path}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-2">File Backup Version</label>
              <select
                value={selectedFile}
                onChange={(e) => setSelectedFile(e.target.value)}
                className="w-full p-3 rounded-lg border border-gray-200"
              >
                <option value="">Select file backup</option>
                {backupsByType.files.map((item) => (
                  <option key={item.relative_path} value={item.relative_path}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="glass-card p-4 flex flex-wrap gap-3">
            <button
              onClick={() => verifyBackup(selectedDb || selectedFile)}
              className="px-4 py-2 text-sm rounded-xl bg-emerald-600 text-white inline-flex items-center gap-2 hover:opacity-90"
            >
              <CheckCircle2 className="w-4 h-4" /> Verify Backup Health
            </button>
            <button
              onClick={restoreDatabase}
              className="px-4 py-2 text-sm rounded-xl bg-blue-600 text-white inline-flex items-center gap-2 hover:opacity-90"
            >
              <Database className="w-4 h-4" /> Restore Database
            </button>
            <button
              onClick={restoreFiles}
              className="px-4 py-2 text-sm rounded-xl bg-indigo-600 text-white inline-flex items-center gap-2 hover:opacity-90"
            >
              <FileArchive className="w-4 h-4" /> Restore Files
            </button>
            <button
              onClick={restoreFullSystem}
              className="px-4 py-2 text-sm rounded-xl bg-gray-900 text-white inline-flex items-center gap-2 hover:opacity-90"
            >
              <RotateCcw className="w-4 h-4" /> Restore Full System
            </button>
          </div>

          {verifyResult && (
            <div className={`glass-card p-4 text-sm ${verifyResult.valid ? 'text-emerald-700 bg-emerald-50/70' : 'text-red-700 bg-red-50/70'}`}>
              <p className="font-bold">Integrity: {verifyResult.valid ? 'PASS' : 'FAIL'}</p>
              <p>File: {verifyResult.file}</p>
              <p>Details: {verifyResult.details}</p>
            </div>
          )}
        </>
      )}

      {loading ? (
        <div className="glass-card p-6 text-center text-gray-500">Loading backup versions...</div>
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-600">{error}</div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-white/50 border-b border-gray-100">
              <tr>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Backup</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Type</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Size</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wide text-gray-500">Modified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-gray-500">No backup versions available.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.relative_path}>
                    <td className="px-5 py-3 text-sm font-semibold text-gray-800">{item.name}</td>
                    <td className="px-5 py-3 text-xs font-bold uppercase text-primary">{item.category}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{Math.round((item.size || 0) / 1024)} KB</td>
                    <td className="px-5 py-3 text-xs text-gray-500">{new Date(item.modified_at).toLocaleString()}</td>
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

export default AdminRecovery

