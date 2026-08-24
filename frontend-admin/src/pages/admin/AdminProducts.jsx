import { useState, useEffect } from 'react'
import { Package, Save, ArrowLeft, Trash2, Plus, Search, Filter, ShieldCheck, Undo2, CreditCard, Layers } from 'lucide-react'
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

    const EMPTY_FORM = {
        name: '',
        price: '',
        category_id: '',
        delivery_time: '15-30 mins',
        images: '[]',
        barcode: '',
        global_sku_code: '',
        return_policy: '',
        prepaid_only: 0,
        has_variants: false,
        variant_options: [],
        variants: [],
        color: '',
        material_type: '',
        brand: '',
        units_per_pack: '',
        weight: '',
        dimensions: '',
        is_fragile: false,
        is_temp_sensitive: false,
        is_perishable: false,
        expiry_date: '',
        usage_instructions: '',
    };

    const [formData, setFormData] = useState(EMPTY_FORM);

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

    // Option-group helpers for the variants editor.
    const addVariantGroup = () => setFormData(prev => ({
        ...prev,
        variant_options: [...prev.variant_options, { option_name: '', option_values: [] }]
    }));

    const updateVariantGroup = (idx, patch) => setFormData(prev => {
        const groups = prev.variant_options.map((g, i) => i === idx ? { ...g, ...patch } : g);
        return { ...prev, variant_options: groups };
    });

    const removeVariantGroup = (idx) => setFormData(prev => {
        const removed = prev.variant_options[idx];
        const groups = prev.variant_options.filter((_, i) => i !== idx);
        // Drop the removed group's key from every variant's option map.
        const variants = prev.variants.map(v => {
            const options = { ...(v.options || {}) };
            delete options[removed?.option_name];
            return { ...v, options };
        });
        return { ...prev, variant_options: groups, variants };
    });

    const addVariantRow = () => setFormData(prev => ({
        ...prev,
        variants: [...prev.variants, { name: '', sku: '', price: prev.price || '', mrp: '', stock: 0, options: {} }]
    }));

    const updateVariantRow = (idx, patch) => setFormData(prev => {
        const variants = prev.variants.map((v, i) => i === idx ? { ...v, ...patch } : v);
        return { ...prev, variants };
    });

    const updateVariantOption = (idx, groupName, value) => setFormData(prev => {
        const variants = prev.variants.map((v, i) => {
            if (i !== idx) return v;
            const options = { ...(v.options || {}), [groupName]: value };
            return { ...v, options };
        });
        return { ...prev, variants };
    });

    const removeVariantRow = (idx) => setFormData(prev => ({
        ...prev,
        variants: prev.variants.filter((_, i) => i !== idx)
    }));

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.return_policy) {
            toast.error("Return Policy is mandatory!");
            return;
        }

        // Build the variant payload the backend expects: option groups + a
        // full variant set (existing ids preserved for cart/order stability).
        const payload = {
            ...formData,
            has_variants: formData.has_variants,
            variant_options: (formData.variant_options || [])
                .filter(g => (g.option_name || '').trim())
                .map(g => ({ option_name: g.option_name.trim(), option_values: g.option_values || [] })),
            variants: (formData.has_variants ? (formData.variants || []) : []).map(v => {
                const options = v.options || {};
                const valueParts = Object.values(options).filter(Boolean);
                return {
                    ...(v.id ? { id: v.id } : {}),
                    name: (v.name || '').trim() || valueParts.join(' / '),
                    sku: v.sku || '',
                    price: v.price,
                    mrp: v.mrp,
                    stock: v.stock,
                    options
                };
            })
        };

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
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                toast.success(editingProduct ? "Product Updated" : "Product Added");
                setShowAddModal(false);
                setEditingProduct(null);
                setFormData(EMPTY_FORM);
                fetchProducts();
            } else {
                const err = await res.json();
                toast.error(err.error || "Failed to save product");
            }
        } catch {
            toast.error("An error occurred");
        }
    };

    const handleEdit = async (product) => {
        setEditingProduct(product);
        const base = {
            ...EMPTY_FORM,
            name: product.product_name,
            price: product.price,
            category_id: categories.find(c => c.name === product.category)?.id || '',
            delivery_time: product.delivery_time || '15-30 mins',
            images: product.images || '[]',
            barcode: product.barcode || '',
            global_sku_code: product.global_sku_code || '',
            return_policy: product.return_policy || '',
            prepaid_only: product.prepaid_only || 0,
            color: product.color || '',
            material_type: product.material_type || '',
            brand: product.brand || '',
            units_per_pack: product.units_per_pack || '',
            weight: product.weight || '',
            dimensions: product.dimensions || '',
            is_fragile: product.is_fragile || false,
            is_temp_sensitive: product.is_temp_sensitive || false,
            is_perishable: product.is_perishable || false,
            expiry_date: product.expiry_date || '',
            usage_instructions: product.usage_instructions || '',
        };
        // Variant products need their full variant set — the list payload only
        // carries the base row, so fetch the detail endpoint.
        if (product.has_variants || product.variant_group_id) {
            try {
                const res = await fetch(`${API_BASE_URL}/products/${product.id}`);
                const data = await res.json();
                const detail = data.data || data;
                
                // Check if this is a parent product with linked variants
                if (detail.is_parent && detail.linked_variant_products) {
                    base.has_variants = true;
                    base.variant_options = (detail.variant_options || []).map(o => ({
                        option_name: o.option_name,
                        option_values: o.option_values || []
                    }));
                    base.variants = (detail.linked_variant_products || []).map(v => ({
                        id: v.id,
                        name: v.variant_name || '',
                        sku: v.global_sku_code || '',
                        price: v.price,
                        mrp: v.mrp,
                        stock: v.stock || 0,
                        images: v.images,
                        options: {}
                    }));
                } else if (detail.variants && detail.variants.length > 0) {
                    // Backward compatibility with old variant system
                    base.has_variants = true;
                    base.variant_options = (detail.variant_options || []).map(o => ({
                        option_name: o.option_name,
                        option_values: o.option_values || []
                    }));
                    base.variants = (detail.variants || []).map(v => ({
                        id: v.id,
                        name: v.name || '',
                        sku: v.sku || '',
                        price: v.price,
                        mrp: v.mrp,
                        stock: v.stock || 0,
                        options: v.options || {}
                    }));
                }
            } catch {
                console.error('Failed to load variants');
            }
        }
        setFormData(base);
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
                        setFormData(EMPTY_FORM);
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
                {filteredProducts.map(p => {
                    const isVariantProduct = p.variant_group_id && p.variant_group_id !== p.id;
                    const isParentProduct = p.is_parent === 1;
                    const displayName = isVariantProduct && p.variant_name 
                        ? `${p.product_name} (${p.variant_name})` 
                        : p.product_name;
                    
                    return (
                        <div key={p.id} className="glass-card p-5 group hover:shadow-xl transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-bold text-gray-900 line-clamp-1">{displayName}</h3>
                                    <p className="text-xs text-primary font-black uppercase tracking-tighter mt-1">{p.category}</p>
                                    {isVariantProduct && (
                                        <span className="text-[10px] font-black text-purple-600 bg-purple-50 px-2 py-0.5 rounded uppercase tracking-widest">
                                            VARIANT: {p.variant_name}
                                        </span>
                                    )}
                                    {isParentProduct && p.has_variants && (
                                        <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded uppercase tracking-widest ml-1">
                                            PARENT WITH VARIANTS
                                        </span>
                                    )}
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
                                    <span>{p.sku || p.global_sku_code || 'No SKU'}</span>
                                </div>
                                {p.prepaid_only === 1 && (
                                    <div className="flex items-center gap-2 text-xs font-black text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100">
                                        <CreditCard size={14} />
                                        <span>PREPAID ONLY</span>
                                    </div>
                                )}
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
                    );
                })}
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
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Product Color</label>
                                    <input 
                                        type="text"
                                        placeholder="e.g. Midnight Blue, Jet Black, Rose Gold"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.color}
                                        onChange={e => setFormData({...formData, color: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Material Type</label>
                                    <input 
                                        type="text"
                                        placeholder="e.g. Premium Glass, Silicone, TPU"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.material_type}
                                        onChange={e => setFormData({...formData, material_type: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Brand</label>
                                    <input 
                                        type="text"
                                        placeholder="e.g. Apple, Samsung, Generic"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.brand}
                                        onChange={e => setFormData({...formData, brand: e.target.value})}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Units per Pack</label>
                                        <input 
                                            type="text"
                                            placeholder="e.g. 1 pc, 2 pcs, 1 set"
                                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                            value={formData.units_per_pack}
                                            onChange={e => setFormData({...formData, units_per_pack: e.target.value})}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Weight</label>
                                        <input 
                                            type="text"
                                            placeholder="e.g. 50g, 0.5kg"
                                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                            value={formData.weight}
                                            onChange={e => setFormData({...formData, weight: e.target.value})}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Dimensions</label>
                                    <input 
                                        type="text"
                                        placeholder="e.g. 15x7x1 cm, 6.5x3x0.5 inch"
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                        value={formData.dimensions}
                                        onChange={e => setFormData({...formData, dimensions: e.target.value})}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Expiry Date (Optional)</label>
                                        <input 
                                            type="date"
                                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold"
                                            value={formData.expiry_date}
                                            onChange={e => setFormData({...formData, expiry_date: e.target.value})}
                                        />
                                    </div>
                                    <div className="flex items-end">
                                        <label className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer hover:bg-white hover:shadow-md transition-all w-full">
                                            <input 
                                                type="checkbox"
                                                className="w-5 h-5 rounded-lg border-gray-300 text-primary focus:ring-primary"
                                                checked={formData.is_fragile}
                                                onChange={e => setFormData({...formData, is_fragile: e.target.checked})}
                                            />
                                            <div>
                                                <p className="text-sm font-black text-slate-800">Fragile</p>
                                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Requires special handling</p>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex items-end">
                                        <label className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer hover:bg-white hover:shadow-md transition-all w-full">
                                            <input 
                                                type="checkbox"
                                                className="w-5 h-5 rounded-lg border-gray-300 text-primary focus:ring-primary"
                                                checked={formData.is_temp_sensitive}
                                                onChange={e => setFormData({...formData, is_temp_sensitive: e.target.checked})}
                                            />
                                            <div>
                                                <p className="text-sm font-black text-slate-800">Temperature Sensitive</p>
                                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Store in controlled environment</p>
                                            </div>
                                        </label>
                                    </div>
                                    <div className="flex items-end">
                                        <label className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer hover:bg-white hover:shadow-md transition-all w-full">
                                            <input 
                                                type="checkbox"
                                                className="w-5 h-5 rounded-lg border-gray-300 text-primary focus:ring-primary"
                                                checked={formData.is_perishable}
                                                onChange={e => setFormData({...formData, is_perishable: e.target.checked})}
                                            />
                                            <div>
                                                <p className="text-sm font-black text-slate-800">Perishable</p>
                                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Has limited shelf life</p>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">How to Use Instructions</label>
                                    <textarea 
                                        placeholder="Step-by-step usage instructions for customers..."
                                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-primary outline-none font-bold h-24"
                                        value={formData.usage_instructions}
                                        onChange={e => setFormData({...formData, usage_instructions: e.target.value})}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer hover:bg-white hover:shadow-md transition-all">
                                        <input 
                                            type="checkbox"
                                            className="w-5 h-5 rounded-lg border-gray-300 text-primary focus:ring-primary"
                                            checked={formData.prepaid_only === 1}
                                            onChange={e => setFormData({...formData, prepaid_only: e.target.checked ? 1 : 0})}
                                        />
                                        <div>
                                            <p className="text-sm font-black text-slate-800">Restrict to Prepaid Only</p>
                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Disable COD for this product</p>
                                        </div>
                                    </label>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer hover:bg-white hover:shadow-md transition-all">
                                        <input 
                                            type="checkbox"
                                            className="w-5 h-5 rounded-lg border-gray-300 text-primary focus:ring-primary"
                                            checked={formData.has_variants}
                                            onChange={e => setFormData(prev => ({
                                                ...prev,
                                                has_variants: e.target.checked,
                                                variants: e.target.checked && prev.variants.length === 0
                                                    ? [{ name: '', sku: '', price: prev.price || '', mrp: '', stock: 0, options: {} }]
                                                    : prev.variants
                                            }))}
                                        />
                                        <div>
                                            <p className="text-sm font-black text-slate-800">Enable Variants & Options</p>
                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Customers pick options like Size, Color, or Model on the product page</p>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* Variants & Options Editor */}
                            {formData.has_variants && (
                                <VariantsEditor
                                    groups={formData.variant_options}
                                    variants={formData.variants}
                                    onAddGroup={addVariantGroup}
                                    onUpdateGroup={updateVariantGroup}
                                    onRemoveGroup={removeVariantGroup}
                                    onAddVariant={addVariantRow}
                                    onUpdateVariant={updateVariantRow}
                                    onUpdateVariantOption={updateVariantOption}
                                    onRemoveVariant={removeVariantRow}
                                />
                            )}

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

/*
 * Variants & Options editor — a self-contained form used inside the product
 * modal. Builds option groups (Size -> [S, M, L]) and one row per variant
 * combination (option values, SKU, price, MRP, stock). All mutations flow up
 * through the callbacks so the parent owns the form state.
 */
function VariantsEditor({ groups, variants, onAddGroup, onUpdateGroup, onRemoveGroup, onAddVariant, onUpdateVariant, onUpdateVariantOption, onRemoveVariant }) {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
            {/* Option Groups */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Option Groups</h3>
                        <p className="text-[10px] text-slate-500 font-bold mt-0.5">e.g. Size (S, M, L) or Color (Red, Blue)</p>
                    </div>
                    <button type="button" onClick={onAddGroup} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:scale-105 active:scale-95 transition-all">
                        <Plus size={14} /> Add Group
                    </button>
                </div>
                {groups.length === 0 && (
                    <p className="text-[11px] font-bold text-slate-400 text-center py-3">No option groups yet — add one to structure the picker.</p>
                )}
                {groups.map((group, gi) => (
                    <div key={gi} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-center bg-white border border-slate-100 rounded-xl p-3">
                        <input
                            type="text"
                            placeholder="Option name (e.g. Size)"
                            className="w-full p-2.5 bg-gray-50 border border-gray-100 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-xs"
                            value={group.option_name}
                            onChange={e => onUpdateGroup(gi, { option_name: e.target.value })}
                        />
                        <input
                            type="text"
                            placeholder="Values, comma separated (e.g. S, M, L)"
                            className="w-full p-2.5 bg-gray-50 border border-gray-100 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-xs"
                            value={Array.isArray(group.option_values) ? group.option_values.join(', ') : group.option_values}
                            onChange={e => onUpdateGroup(gi, { option_values: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })}
                        />
                        <button type="button" onClick={() => onRemoveGroup(gi)} className="p-2 text-red-500 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Variant Rows */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Variants</h3>
                        <p className="text-[10px] text-slate-500 font-bold mt-0.5">One row per combination — price, MRP, stock and SKU can differ</p>
                    </div>
                    <button type="button" onClick={onAddVariant} className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:scale-105 active:scale-95 transition-all">
                        <Plus size={14} /> Add Variant
                    </button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
                    <table className="w-full text-left border-collapse min-w-[640px]">
                        <thead>
                            <tr className="border-b border-slate-100 bg-gray-50">
                                {groups.map((g) => (
                                    <th key={g.option_name || 'g'} className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">{g.option_name || 'Option'}</th>
                                ))}
                                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">SKU</th>
                                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Price</th>
                                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">MRP</th>
                                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Stock</th>
                                <th className="p-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {variants.map((variant, vi) => (
                                <tr key={variant.id || `new-${vi}`}>
                                    {groups.map((g) => {
                                        const current = (variant.options || {})[g.option_name];
                                        return (
                                            <td key={g.option_name || 'g'} className="p-2">
                                                <select
                                                    className="w-full p-2 bg-gray-50 border border-gray-100 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-xs"
                                                    value={current || ''}
                                                    onChange={e => onUpdateVariantOption(vi, g.option_name, e.target.value)}
                                                >
                                                    <option value="">Select</option>
                                                    {(g.option_values || []).map(v => <option key={v} value={v}>{v}</option>)}
                                                </select>
                                            </td>
                                        );
                                    })}
                                    <td className="p-2">
                                        <input type="text" placeholder="SKU" className="w-24 p-2 bg-gray-50 border border-gray-100 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-xs" value={variant.sku || ''} onChange={e => onUpdateVariant(vi, { sku: e.target.value })} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" placeholder="Price" className="w-24 p-2 bg-gray-50 border border-gray-100 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-xs" value={variant.price ?? ''} onChange={e => onUpdateVariant(vi, { price: e.target.value })} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" placeholder="MRP" className="w-24 p-2 bg-gray-50 border border-gray-100 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-xs" value={variant.mrp ?? ''} onChange={e => onUpdateVariant(vi, { mrp: e.target.value })} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" min="0" placeholder="0" className="w-20 p-2 bg-gray-50 border border-gray-100 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-xs" value={variant.stock ?? 0} onChange={e => onUpdateVariant(vi, { stock: parseInt(e.target.value) || 0 })} />
                                    </td>
                                    <td className="p-2 text-right">
                                        <button type="button" onClick={() => onRemoveVariant(vi)} className="p-2 text-red-500 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {variants.length === 0 && (
                        <p className="text-[11px] font-bold text-slate-400 text-center py-4">No variants yet — add one to start configuring combinations.</p>
                    )}
                </div>
            </div>
        </div>
    );
}

export default AdminProducts;
