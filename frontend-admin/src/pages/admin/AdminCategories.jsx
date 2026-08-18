import { useState, useEffect } from 'react'
import { FolderTree, Save, ArrowLeft, Trash2, Plus, Image as ImageIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL, resolveMediaUrl } from '../../config'

function AdminCategories() {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editValues, setEditValues] = useState({});
    const [message, setMessage] = useState({ text: '', type: '' });
    const [showAddForm, setShowAddForm] = useState(false);
    const [newCategory, setNewCategory] = useState({ name: '', icon: '', important_note: '', return_policy: '7 Days Return Policy' });

    const fetchCategories = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/categories`);
            const result = await res.json();
            // Handle both wrapped { success, data } and legacy raw array responses
            const data = Array.isArray(result) ? result : (result.data || []);
            setCategories(data);
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch categories:', err);
            setLoading(false);
        }
    };

    useEffect(() => {
        // Wrapped so the fetch isn't invoked synchronously from the effect body
        const load = () => fetchCategories();
        load();
    }, []);

    const showMessage = (text, type = 'success') => {
        setMessage({ text, type });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/categories`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(newCategory)
            });

            if (res.ok) {
                showMessage('Category added successfully!');
                setShowAddForm(false);
                setNewCategory({ name: '', icon: '', important_note: '', return_policy: '7 Days Return Policy' });
                fetchCategories();
            } else {
                const error = await res.json();
                showMessage(error.error || 'Failed to add category.', 'error');
            }
        } catch (err) {
            console.error('Add error:', err);
            showMessage('An error occurred.', 'error');
        }
    };

    const handleEdit = (category) => {
        setEditingId(category.id);
        setEditValues({
            name: category.name,
            icon: category.icon,
            important_note: category.important_note || '',
            return_policy: category.return_policy || '7 Days Return Policy'
        });
    };

    const handleSave = async (id) => {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/categories/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editValues)
            });

            if (res.ok) {
                showMessage('Category updated successfully!');
                setEditingId(null);
                fetchCategories();
            } else {
                const error = await res.json();
                showMessage(error.error || 'Failed to update category.', 'error');
            }
        } catch (err) {
            console.error('Update error:', err);
            showMessage('An error occurred.', 'error');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this category? This will unlink products in this category.')) return;

        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/categories/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (res.ok) {
                showMessage('Category deleted successfully!');
                fetchCategories();
            } else {
                showMessage('Failed to delete category.', 'error');
            }
        } catch (err) {
            console.error('Delete error:', err);
            showMessage('An error occurred.', 'error');
        }
    };

    if (loading) return <div className="p-10 text-center text-gray-500">Loading categories...</div>;

    return (
        <div className="py-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/admin" className="p-2 hover:bg-white/40 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <FolderTree className="w-6 h-6 text-primary" /> Category Management
                    </h1>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="bg-primary text-white px-4 py-2 rounded-lg font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" /> Add Category
                </button>
            </div>

            {message.text && (
                <div className={`p-4 rounded-lg text-sm font-medium animate-fade-in ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            {showAddForm && (
                <form onSubmit={handleAdd} className="glass-card p-6 flex flex-col gap-4 animate-fade-in">
                    <h3 className="text-lg font-bold text-gray-800">Add New Category</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Name</label>
                            <input
                                required
                                type="text"
                                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                                value={newCategory.name}
                                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                                placeholder="E.g., Snacks"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Icon URL</label>
                            <div className="relative">
                                <ImageIcon className="w-5 h-5 absolute left-3 top-3.5 text-gray-400" />
                                <input
                                    required
                                    type="url"
                                    className="w-full pl-10 p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                                    value={newCategory.icon}
                                    onChange={(e) => setNewCategory({ ...newCategory, icon: e.target.value })}
                                    placeholder="https://example.com/icon.png"
                                />
                            </div>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center justify-between">
                                <span>Default Return Policy</span>
                                <span className="text-[10px] text-gray-400 normal-case font-bold italic">Enter each point in a new line</span>
                            </label>
                            <textarea
                                required
                                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                                value={newCategory.return_policy}
                                onChange={(e) => setNewCategory({ ...newCategory, return_policy: e.target.value })}
                                placeholder="1. 7 Days Replacement&#10;2. Product must be unused"
                                rows="3"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-bold text-gray-700 mb-1">Important Note (Storefront Highlight)</label>
                            <textarea
                                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                                value={newCategory.important_note}
                                onChange={(e) => setNewCategory({ ...newCategory, important_note: e.target.value })}
                                placeholder="E.g., Special handling required for this category..."
                                rows="2"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                        <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                        <button type="submit" className="px-6 py-2 bg-primary text-white font-bold rounded-lg hover:shadow-lg transition-shadow">Save Category</button>
                    </div>
                </form>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {categories.map((category) => (
                    <div key={category.id} className="glass-card p-4 flex flex-col items-center gap-3 relative group">
                        {editingId === category.id ? (
                            <div className="w-full flex flex-col gap-2">
                                <input
                                    type="text"
                                    className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                                    value={editValues.name}
                                    onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                                    placeholder="Name"
                                />
                                <input
                                    type="url"
                                    className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                                    value={editValues.icon}
                                    onChange={(e) => setEditValues({ ...editValues, icon: e.target.value })}
                                    placeholder="Icon URL"
                                />
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mt-2 flex justify-between">
                                    <span>Return Policy</span>
                                    <span className="italic normal-case">Point-wise (Enter for new line)</span>
                                </label>
                                <textarea
                                    className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none font-bold"
                                    value={editValues.return_policy}
                                    onChange={(e) => setEditValues({ ...editValues, return_policy: e.target.value })}
                                    placeholder="Return Policy"
                                    rows="3"
                                />
                                <textarea
                                    className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
                                    value={editValues.important_note}
                                    onChange={(e) => setEditValues({ ...editValues, important_note: e.target.value })}
                                    placeholder="Important Note"
                                    rows="2"
                                />
                                <div className="flex gap-2 mt-4">
                                    <button onClick={() => setEditingId(null)} className="w-1/2 p-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-bold">Cancel</button>
                                    <button onClick={() => handleSave(category.id)} className="w-1/2 p-2 bg-primary text-white rounded-lg text-sm font-bold flex items-center justify-center gap-1">
                                        <Save className="w-4 h-4" /> Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <img src={resolveMediaUrl(category.icon)} alt={category.name} className="w-20 h-20 object-cover rounded-2xl shadow-sm bg-white" />
                                <h3 className="font-bold text-gray-800 text-lg">{category.name}</h3>
                                <p className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded uppercase tracking-tighter truncate max-w-full">
                                    {(category.return_policy || 'Default').split('\n')[0]}
                                </p>

                                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                    <button
                                        onClick={() => handleEdit(category)}
                                        className="p-1.5 bg-white shadow-sm rounded-lg text-blue-600 hover:bg-blue-50"
                                    >
                                        <Save className="w-4 h-4 hidden" />
                                        <span className="text-xs font-bold px-1">Edit</span>
                                    </button>
                                    <button
                                        onClick={() => handleDelete(category.id)}
                                        className="p-1.5 bg-white shadow-sm rounded-lg text-red-600 hover:bg-red-50"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default AdminCategories
