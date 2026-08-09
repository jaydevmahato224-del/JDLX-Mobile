import { useEffect, useState } from 'react'
import { Edit3, Plus, Save, Smartphone, Trash2 } from 'lucide-react'
import { API_BASE_URL } from '../../config'

const blankModel = { name: '', brand: '', type: '', status: 'active' }

function getAdminHeaders() {
    const token = localStorage.getItem('adminToken') || localStorage.getItem('token')
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
    }
}

export default function AdminDeviceModels() {
    const [models, setModels] = useState([])
    const [categories, setCategories] = useState([])
    const [newModel, setNewModel] = useState(blankModel)
    const [editingId, setEditingId] = useState(null)
    const [editValues, setEditValues] = useState(blankModel)
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(true)

    const showMessage = (text) => {
        setMessage(text)
        setTimeout(() => setMessage(''), 2500)
    }

    const fetchData = async () => {
        setLoading(true)
        try {
            const [modelsRes, categoriesRes] = await Promise.all([
                fetch(`${API_BASE_URL}/admin/device-models`, { headers: getAdminHeaders() }),
                fetch(`${API_BASE_URL}/categories`)
            ])
            const modelsResult = await modelsRes.json()
            const categoriesResult = await categoriesRes.json()
            setModels(Array.isArray(modelsResult) ? modelsResult : (modelsResult.data || []))
            setCategories(Array.isArray(categoriesResult) ? categoriesResult : (categoriesResult.data || []))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    const handleCreate = async (event) => {
        event.preventDefault()
        const response = await fetch(`${API_BASE_URL}/admin/device-models`, {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify(newModel)
        })
        if (response.ok) {
            setNewModel(blankModel)
            showMessage('Device model added')
            fetchData()
        }
    }

    const handleSave = async (id) => {
        const response = await fetch(`${API_BASE_URL}/admin/device-models/${id}`, {
            method: 'PATCH',
            headers: getAdminHeaders(),
            body: JSON.stringify(editValues)
        })
        if (response.ok) {
            setEditingId(null)
            showMessage('Device model updated')
            fetchData()
        }
    }

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this device model?')) return
        const response = await fetch(`${API_BASE_URL}/admin/device-models/${id}`, {
            method: 'DELETE',
            headers: getAdminHeaders()
        })
        if (response.ok) {
            showMessage('Device model deleted')
            fetchData()
        }
    }

    const toggleCategory = async (category) => {
        const response = await fetch(`${API_BASE_URL}/admin/categories/${category.id}`, {
            method: 'PATCH',
            headers: getAdminHeaders(),
            body: JSON.stringify({
                device_customization_enabled: !category.device_customization_enabled
            })
        })
        if (response.ok) {
            showMessage('Category setting updated')
            fetchData()
        }
    }

    if (loading) {
        return <div className="p-10 text-center text-gray-500">Loading device models...</div>
    }

    return (
        <div className="py-6 space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Smartphone className="w-6 h-6 text-primary" /> Device Model Manager
                    </h1>
                    <p className="text-sm font-medium text-gray-500 mt-1">Manage sticker cutting models and category enablement.</p>
                </div>
                {message && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">{message}</div>}
            </div>

            <form onSubmit={handleCreate} className="glass-card p-5 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                {['name', 'brand', 'type'].map((field) => (
                    <div key={field}>
                        <label className="block text-[11px] font-black uppercase tracking-widest text-gray-500 mb-1">{field}</label>
                        <input
                            required={field === 'name'}
                            value={newModel[field]}
                            onChange={(event) => setNewModel({ ...newModel, [field]: event.target.value })}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                            placeholder={field === 'name' ? 'iPhone 15 Pro' : field}
                        />
                    </div>
                ))}
                <div>
                    <label className="block text-[11px] font-black uppercase tracking-widest text-gray-500 mb-1">status</label>
                    <select
                        value={newModel.status}
                        onChange={(event) => setNewModel({ ...newModel, status: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                    >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
                <button className="h-10 rounded-lg bg-primary text-white text-sm font-black flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" /> Add
                </button>
            </form>

            <div className="glass-card overflow-x-auto">
                <div className="grid grid-cols-12 gap-3 border-b border-gray-100 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 min-w-[720px]">
                    <span className="col-span-4">Model</span>
                    <span className="col-span-2">Brand</span>
                    <span className="col-span-2">Type</span>
                    <span className="col-span-2">Status</span>
                    <span className="col-span-2 text-right">Actions</span>
                </div>
                {models.map((model) => (
                    <div key={model.id} className="grid grid-cols-12 gap-3 px-5 py-4 border-b border-gray-100 last:border-0 items-center min-w-[720px]">
                        {editingId === model.id ? (
                            <>
                                {['name', 'brand', 'type'].map((field, index) => (
                                    <input
                                        key={field}
                                        value={editValues[field]}
                                        onChange={(event) => setEditValues({ ...editValues, [field]: event.target.value })}
                                        className={`${index === 0 ? 'col-span-4' : 'col-span-2'} rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold`}
                                    />
                                ))}
                                <select
                                    value={editValues.status}
                                    onChange={(event) => setEditValues({ ...editValues, status: event.target.value })}
                                    className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold"
                                >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                                <div className="col-span-2 flex justify-end gap-2">
                                    <button onClick={() => setEditingId(null)} className="px-3 py-2 rounded-lg bg-gray-100 text-xs font-bold">Cancel</button>
                                    <button onClick={() => handleSave(model.id)} className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold flex items-center gap-1">
                                        <Save className="w-3 h-3" /> Save
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <span className="col-span-4 text-sm font-black text-gray-800">{model.name}</span>
                                <span className="col-span-2 text-sm font-bold text-gray-500">{model.brand || '-'}</span>
                                <span className="col-span-2 text-sm font-bold text-gray-500">{model.type || '-'}</span>
                                <span className={`col-span-2 w-fit rounded-full px-2 py-1 text-[10px] font-black uppercase ${model.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{model.status}</span>
                                <div className="col-span-2 flex justify-end gap-2">
                                    <button onClick={() => { setEditingId(model.id); setEditValues(model) }} className="p-2 rounded-lg bg-blue-50 text-blue-600">
                                        <Edit3 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(model.id)} className="p-2 rounded-lg bg-red-50 text-red-600">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>

            <div className="glass-card p-5">
                <h2 className="text-lg font-black text-gray-800 mb-4">Category Feature Toggle</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {categories.map((category) => (
                        <button
                            key={category.id}
                            onClick={() => toggleCategory(category)}
                            className={`flex items-center justify-between rounded-xl border p-4 text-left transition ${category.device_customization_enabled ? 'border-primary bg-primary/5' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                        >
                            <span className="font-black text-sm text-gray-800">{category.name}</span>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${category.device_customization_enabled ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'}`}>
                                {category.device_customization_enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
