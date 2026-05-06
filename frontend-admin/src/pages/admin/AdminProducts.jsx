import { useState, useEffect } from 'react'
import { Package, Save, ArrowLeft, Trash2, Plus, Search, Filter, ShieldCheck, Undo2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import toast from 'react-hot-toast'

function AdminProducts() {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        name: '',
        price: '',
        category_id: '',
        delivery_time: '15-30 mins',
        images: '[]',
        barcode: '',
        global_sku_code: '',
        return_policy: ''
    });

    const fetchProducts = async () => {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/inventory`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setProducts(Array.isArray(data) ? data : (data.data || []));
        } catch (err) {
            console.error(err);
        }
    };

    const fetchCategories = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/categories`);
            const data = await res.json();
            setCategories(Array.isArray(data) ? data : (data.data || []));
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            await Promise.all([fetchProducts(), fetchCategories()]);
            setLoading(false);
        };
        init();
    }, []);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.return_policy) {
            toast.error("Return Policy is mandatory!");
            return;
        }

        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        const url = editingProduct 
            ? `${API_BASE_URL}/admin/products/${editingProduct.id}`
            : `${API_BASE_URL}/admin/products`;
        
        try {
            const res = await fetch(url, {
                method: editingProduct ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                toast.success(editingProduct ? "Product Updated" : "Product Added");
                setShowAddModal(false);
                setEditingProduct(null);
                setFormData({ name: '', price: '', category_id: '', delivery_time: '15-30 mins', images: '[]', barcode: '', global_sku_code: '', return_policy: '' });
                fetchProducts();
            } else {
                const err = await res.json();
                toast.error(err.error || "Failed to save product");
            }
        } catch (err) {
            toast.error("An error occurred");
        }
    };

    const handleEdit = (product) => {
        setEditingProduct(product);
        setFormData({
            name: product.product_name,
            price: product.price,
            category_id: categories.find(c => c.name === product.category)?.id || '',
            delivery_time: product.delivery_time || '15-30 mins',
            images: product.images || '[]',
            barcode: product.barcode || '',
            global_sku_code: product.global_sku_code || '',
            return_policy: product.return_policy || ''
        });
        setShowAddModal(true);
    };

    const filteredProducts = products.filter(p => {
        const matchesSearch = p.product_name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    if (loading) return <div className="p-10 text-center animate-pulse">Loading Catalog...</div>;

    return (
        <div className="py-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/admin')} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-800" />
                    </button>
                    <h1 className="text-2xl font-bold text-gray-800">Global Product Catalog</h1>
                </div>
                <button 
                    onClick={() => {
                        setEditingProduct(null);
                        setFormData({ name: '', price: '', category_id: '', delivery_time: '15-30 mins', images: '[]', barcode: '', global_sku_code: '', return_policy: '' });
                        setShowAddModal(true);
                    }}
                    className="bg-primary text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" /> Add New Product
                </button>
            </div>

            <div className="glass-card p-4 flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input 
                        type="text"
                        placeholder="Search products..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select 
                    className="px-4 py-2 border border-gray-100 rounded-xl bg-white text-sm font-bold"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                >
                    <option value="all">All Categories</option>
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProducts.map(p => (
                    <div key={p.id} className="glass-card p-5 group hover:shadow-xl transition-all">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="font-bold text-gray-900 line-clamp-1">{p.product_name}</h3>
                                <p className="text-xs text-primary font-black uppercase tracking-tighter mt-1">{p.category}</p>
                            </div>
                            <span className="text-xl font-black text-slate-900 tracking-tighter">₹{p.price}</span>
                        </div>
                        
                        <div className="flex flex-col gap-2 mb-6">
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-50 p-2 rounded-lg">
                                <Undo2 size={14} className="text-emerald-500 shrink-0" />
                                <span className="truncate">{(p.return_policy || 'Using Category Policy').split('\n')[0]}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-50 p-2 rounded-lg">
                                <ShieldCheck size={14} className="text-blue-500" />
                                <span>{p.sku || 'No SKU'}</span>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button 
                                onClick={() => handleEdit(p)}
                                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-200 transition-colors"
                            >
                                Edit Product
                            </button>
                            <button className="p-2 text-red-500 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
                    <div className="relative bg-white rounded-[2rem] w-full max-w-2xl p-8 shadow-2xl animate-in zoom-in duration-300">
                        <h2 className="text-2xl font-black text-gray-900 mb-6">{editingProduct ? 'Edit Product' : 'Add New Product'}</h2>
                        
                        <form onSubmit={handleSave} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Product Name</label>
                                    <input 
                                        required
                                        type="text"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.name}
                                        onChange={e => setFormData({...formData, name: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Price (₹)</label>
                                    <input 
                                        required
                                        type="number"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.price}
                                        onChange={e => setFormData({...formData, price: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Category</label>
                                    <select 
                                        required
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.category_id}
                                        onChange={e => {
                                            const catId = e.target.value;
                                            const cat = categories.find(c => c.id === parseInt(catId));
                                            setFormData(prev => ({
                                                ...prev,
                                                category_id: catId,
                                                return_policy: (!prev.return_policy || categories.some(c => c.return_policy === prev.return_policy)) ? (cat?.return_policy || '') : prev.return_policy
                                            }));
                                        }}
                                    >
                                        <option value="">Select Category</option>
                                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Delivery Time</label>
                                    <input 
                                        type="text"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.delivery_time}
                                        onChange={e => setFormData({...formData, delivery_time: e.target.value})}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-black text-red-500 uppercase tracking-widest mb-2 flex items-center justify-between">
                                        <span>Return Policy <span className="text-red-500">*Mandatory</span></span>
                                        <span className="text-[10px] text-gray-400 normal-case font-bold italic">Enter each rule in a new line</span>
                                    </label>
                                    <textarea 
                                        required
                                        placeholder="1. 7 Days Replacement&#10;2. Product must be unused&#10;3. Original packaging required"
                                        className="w-full p-3 bg-gray-50 border border-red-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold h-32"
                                        value={formData.return_policy}
                                        onChange={e => setFormData({...formData, return_policy: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Barcode (Optional)</label>
                                    <input 
                                        type="text"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.barcode}
                                        onChange={e => setFormData({...formData, barcode: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">SKU Code (Optional)</label>
                                    <input 
                                        type="text"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.global_sku_code}
                                        onChange={e => setFormData({...formData, global_sku_code: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button 
                                    type="button" 
                                    onClick={() => setShowAddModal(false)}
                                    className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit"
                                    className="flex-[2] py-4 bg-primary text-white rounded-2xl font-bold shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                                >
                                    {editingProduct ? 'Update Product' : 'Add Product to Catalog'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default AdminProducts;
