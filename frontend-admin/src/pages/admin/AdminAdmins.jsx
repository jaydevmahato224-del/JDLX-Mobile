import { useEffect, useState } from 'react'
import { ArrowLeft, Shield, UserPlus, Trash2, Edit, Search, Filter, Power, PowerOff, Loader2, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

function AdminAdmins() {
  const token = useStore((state) => state.adminToken || state.token)
  const user = useStore((state) => state.user)

  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filtering & Search
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedAdmin, setSelectedAdmin] = useState(null)

  // Forms
  const [form, setForm] = useState({ name: '', email: '', role: 'admin' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super_admin'

  const fetchAdmins = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/admin/admins`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load admins')
        setAdmins([])
      } else {
        setAdmins(data)
      }
    } catch (e) {
      setError('Failed to load admins')
      setAdmins([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdmins()
  }, [token])

  // ADD ADMIN
  const handleCreate = async (e) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/admin/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to create admin')
      } else {
        setShowAddModal(false)
        setForm({ name: '', email: '', role: 'admin' })
        fetchAdmins()
      }
    } catch (e) {
      alert('Failed to create admin')
    } finally {
      setIsSubmitting(false)
    }
  }

  // EDIT ADMIN
  const handleUpdate = async (e) => {
    e.preventDefault()
    if (!selectedAdmin) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/admin/admins/${selectedAdmin.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: form.name, role: form.role }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to update admin')
      } else {
        setShowEditModal(false)
        fetchAdmins()
      }
    } catch (e) {
      alert('Failed to update admin')
    } finally {
      setIsSubmitting(false)
    }
  }

  // TOGGLE STATUS
  const handleToggleStatus = async (adminId, currentStatus) => {
    if (!isSuperAdmin) return
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    try {
      const res = await fetch(`${API_BASE_URL}/admin/admins/${adminId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to change status')
      } else {
        fetchAdmins()
      }
    } catch (e) {
      alert('Failed to change status')
    }
  }

  // DELETE ADMIN
  const handleDelete = async () => {
    if (!selectedAdmin) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/admin/admins/${selectedAdmin.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to delete admin')
      } else {
        setShowDeleteConfirm(false)
        fetchAdmins()
      }
    } catch (e) {
      alert('Failed to delete admin')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Filter & Search Logic
  const filteredAdmins = admins.filter(admin => {
    const matchesSearch = (admin.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (admin.email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    const matchesRole = roleFilter === 'All' || admin.role === roleFilter
    return matchesSearch && matchesRole
  })

  // Table Skeleton Loader
  const SkeletonRow = () => (
    <tr className="animate-pulse">
      <td className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-32"></div></td>
      <td className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-48"></div></td>
      <td className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
      <td className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
      <td className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-32"></div></td>
      <td className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-24 ml-auto"></div></td>
    </tr>
  )

  return (
    <div className="py-6 flex flex-col gap-6 relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/admin" className="p-2 hover:bg-white/40 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Admin Management
          </h1>
        </div>

        {isSuperAdmin && (
          <button
            onClick={() => {
              setForm({ name: '', email: '', role: 'admin' })
              setShowAddModal(true)
            }}
            className="btn-primary px-4 py-2.5 text-sm flex items-center gap-2 rounded-xl transition-all shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98]"
          >
            <UserPlus className="w-4 h-4" /> Add Admin
          </button>
        )}
      </div>

      {!isSuperAdmin && (
        <div className="glass-card p-4 text-sm text-amber-700 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          Only Super Admins can manage staff accounts, roles, and access.
        </div>
      )}

      {/* Toolbox: Search & Filter */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center rounded-2xl">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search admins by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:bg-white transition-colors outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full md:w-48 py-2.5 px-3 bg-gray-50/50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="All">All Roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="inventory_admin">Inventory Admin</option>
            <option value="delivery_admin">Delivery Admin</option>
            <option value="support_admin">Support Admin</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="glass-card p-6 text-center text-red-600 rounded-2xl">{error}</div>
      ) : (
        <div className="glass-card overflow-hidden rounded-2xl border border-white/40 shadow-xl shadow-slate-200/50">
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-slate-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-gray-500">Email</th>
                  <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-gray-500">Role</th>
                  <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-gray-500">Last Login</th>
                  <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-gray-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : filteredAdmins.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-sm">
                      {searchQuery ? 'No admins match your search filter.' : 'No admins found in the system.'}
                    </td>
                  </tr>
                ) : (
                  filteredAdmins.map((admin) => (
                    <tr key={admin.id} className={`transition-colors hover:bg-slate-50/50 ${admin.status === 'disabled' ? 'opacity-60 bg-gray-50/50' : ''}`}>
                      <td className="px-5 py-4 text-sm font-semibold text-gray-800">{admin.name || 'N/A'}</td>
                      <td className="px-5 py-4 text-sm text-gray-600">{admin.email}</td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md ${admin.role === 'super_admin' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                            admin.role === 'manager' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                              'bg-emerald-100 text-emerald-700 border border-emerald-200'
                          }`}>
                          {admin.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-full ${admin.status === 'active' ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 bg-gray-100'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${admin.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
                          {admin.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {admin.last_login ? new Date(admin.last_login).toLocaleString() : 'Never'}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {isSuperAdmin ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedAdmin(admin)
                                setForm({ name: admin.name, email: admin.email, role: admin.role })
                                setShowEditModal(true)
                              }}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors tooltip-trigger"
                              title="Edit Admin"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(admin.id, admin.status)}
                              className={`p-1.5 rounded-lg transition-colors tooltip-trigger ${admin.status === 'active' ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                              title={admin.status === 'active' ? 'Disable Admin' : 'Enable Admin'}
                            >
                              {admin.status === 'active' ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => {
                                setSelectedAdmin(admin)
                                setShowDeleteConfirm(true)
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors tooltip-trigger"
                              title="Delete Admin"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
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
        </div>
      )}

      {/* Add Admin Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-800">Create New Admin</h2>
              <p className="text-sm text-gray-500 mt-1">Add a new staff member to the system.</p>
            </div>
            <form onSubmit={handleCreate} className="p-6 flex flex-col gap-4 bg-gray-50/30">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="jane@jdlx.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Administrative Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all bg-white"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="inventory_admin">Inventory Admin</option>
                  <option value="delivery_admin">Delivery Admin</option>
                  <option value="support_admin">Support Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary px-6 py-2.5 text-sm rounded-xl flex items-center gap-2"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Admin Modal */}
      {showEditModal && selectedAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-800">Edit Admin Role</h2>
              <p className="text-sm text-gray-500 mt-1">Make changes to {selectedAdmin.email}'s account.</p>
            </div>
            <form onSubmit={handleUpdate} className="p-6 flex flex-col gap-4 bg-gray-50/30">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-400 mb-1.5">Email Address (Locked)</label>
                <input
                  type="email"
                  disabled
                  value={form.email}
                  className="w-full p-3 rounded-xl border border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Administrative Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all bg-white"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="inventory_admin">Inventory Admin</option>
                  <option value="delivery_admin">Delivery Admin</option>
                  <option value="support_admin">Support Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary px-6 py-2.5 text-sm rounded-xl flex items-center gap-2"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden text-center p-8 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Remove Admin?</h2>
            <p className="text-gray-500 text-sm mb-8">
              Are you sure you want to remove <strong>{selectedAdmin.email}</strong>? This action cannot be undone and will revoke all their dashboard access immediately.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleDelete}
                disabled={isSubmitting}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-xl transition-all shadow-md shadow-red-600/20 active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Yes, Delete Admin'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isSubmitting}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-4 rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default AdminAdmins
