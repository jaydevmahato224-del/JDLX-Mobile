import React, { useState, useEffect, Component } from 'react';
import { Package, AlertCircle, Save, ArrowLeft, Search, ChevronLeft, ChevronRight, Power, PowerOff, TrendingUp, AlertTriangle, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../../config';

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(error, errorInfo) {
        console.error("Inventory error caught:", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px]">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">Inventory failed to load. Please retry.</h2>
                    <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

function InventoryContent() {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editValues, setEditValues] = useState({});
    const [message, setMessage] = useState({ text: '', type: '' });

    const [stats, setStats] = useState(null);

    // Feature: Search & Filter
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');

    // Feature: Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;

    // Safe Fallback
    const [fetchError, setFetchError] = useState(false);

    const fetchInventory = async () => {
        setLoading(true);
        setFetchError(false);
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const [invRes, statsRes] = await Promise.all([
                fetch(`${API_BASE_URL}/admin/inventory`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${API_BASE_URL}/admin/inventory/stats`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            const result = await invRes.json();
            const statsResult = statsRes.ok ? await statsRes.json() : null;

            if (statsResult) {
                const statsData = statsResult.data || statsResult;
                if (!statsData.error) setStats(statsData);
            }
            
            const data = Array.isArray(result) ? result : (result.data || []);
            if (Array.isArray(data)) {
                setProducts(data);
            } else {
                setFetchError(true);
            }
        } catch (err) {
            console.error('Failed to fetch inventory:', err);
            setFetchError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInventory();
    }, []);

    const handleEdit = (product) => {
        setEditingId(product.id);
        setEditValues({
            stock: product.stock,
            low_stock_threshold: product.low_stock_threshold,
            status: product.status || 'available'
        });
    };

    const handleSave = async (id) => {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/inventory/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editValues)
            });

            if (res.ok) {
                setMessage({ text: 'Product updated successfully!', type: 'success' });
                setEditingId(null);
                fetchInventory();
                setTimeout(() => setMessage({ text: '', type: '' }), 3000);
            } else {
                setMessage({ text: 'Failed to update product.', type: 'error' });
            }
        } catch (err) {
            console.error('Update error:', err);
            setMessage({ text: 'An error occurred.', type: 'error' });
        }
    };

    const toggleStatus = async (id, currentStatus) => {
        const newStatus = currentStatus === 'available' ? 'disabled' : 'available';
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/inventory/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (res.ok) {
                fetchInventory();
            }
        } catch (err) {
            console.error('Status toggle error:', err);
        }
    };

    // Filter logic
    const categories = [...new Set(products.map(p => p.category))];

    const filteredProducts = products.filter(product => {
        const pName = (product.product_name || '').toLowerCase();
        const pSku = (product.sku || '').toLowerCase();
        const sTerm = (searchTerm || '').toLowerCase();
        
        const matchesSearch = pName.includes(sTerm) || pSku.includes(sTerm);
        const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    // Pagination logic
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

    // Render loading
    if (loading) {
        return (
            <div className="p-10 text-center animate-pulse flex flex-col items-center justify-center">
                <Package className="w-10 h-10 text-gray-300 mb-4" />
                <div className="h-4 bg-gray-200 rounded w-48"></div>
            </div>
        );
    }

    // Subcomponents
    return (
        <div className="py-6 flex flex-col gap-6 relative min-h-screen">
            <div className="flex items-center gap-4">
                <Link to="/admin" className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-800" />
                </Link>
                <h1 className="text-2xl font-bold text-gray-800">Inventory Management</h1>
            </div>

            {message.text && (
                <div className={`p-4 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            {/* Dashboard Cards */}
            {stats && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                    <div className="glass-card p-6 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-gray-500">
                            <span className="font-semibold text-sm">Total Products</span>
                            <Package className="w-5 h-5 text-primary" />
                        </div>
                        <span className="text-3xl font-black text-gray-800">{stats.total_products}</span>
                    </div>
                    <div className="glass-card p-6 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-gray-500">
                            <span className="font-semibold text-sm">Low Stock Items</span>
                            <AlertTriangle className="w-5 h-5 text-yellow-500" />
                        </div>
                        <span className="text-3xl font-black text-gray-800">{stats.low_stock}</span>
                    </div>
                    <div className="glass-card p-6 flex flex-col gap-2 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                        <div className="flex items-center justify-between text-gray-500 relative z-10">
                            <span className="font-semibold text-sm">Out of Stock</span>
                            <AlertCircle className="w-5 h-5 text-red-500" />
                        </div>
                        <span className="text-3xl font-black text-red-600 relative z-10">{stats.out_of_stock}</span>
                    </div>
                    <div className="glass-card p-6 flex flex-col gap-2 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                        <div className="flex items-center justify-between text-primary">
                            <span className="font-semibold text-sm">Restock Suggestions</span>
                            <TrendingUp className="w-5 h-5 text-primary" />
                        </div>
                        <span className="text-3xl font-black text-primary">{stats.restock_suggestions}</span>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by Name or SKU..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary outline-none"
                    />
                </div>

                <div className="flex flex-wrap gap-4 w-full md:w-auto">
                    <select
                        value={categoryFilter}
                        onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
                        className="flex-1 md:flex-none py-2 px-4 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        <option value="all">All Categories</option>
                        {categories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Data Table */}
            <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Product ID / SKU</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Product Name</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Category</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Rating</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Price</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Stock</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Reserved</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Store</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Status</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fetchError ? (
                                <tr>
                                    <td colSpan="9" className="p-12 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <AlertCircle className="w-10 h-10 text-red-500" />
                                            <span className="text-gray-800 font-bold">Failed to load inventory data</span>
                                            <button onClick={fetchInventory} className="mt-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold shadow-sm">Retry Now</button>
                                        </div>
                                    </td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan="9" className="p-12 text-center text-gray-500 text-lg font-medium">No products found in the catalog.</td>
                                </tr>
                            ) : currentItems.length === 0 ? (
                                <tr>
                                    <td colSpan="9" className="p-12 text-center text-gray-500">No products matching your search or filters.</td>
                                </tr>
                            ) : (
                                currentItems.map(product => {
                                    const isVariant = product.has_variants === 1 || product.has_variants === true;
                                    const isLowStock = product.stock <= product.low_stock_threshold;
                                    return (
                                        <tr key={product.id} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${!product.status || product.status === 'disabled' ? 'opacity-50' : ''}`}>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-800 text-xs">{product.id}</span>
                                                    <span className="text-xs text-gray-500">{product.sku}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 font-medium text-gray-800">{product.product_name}</td>
                                            <td className="p-4 text-sm text-gray-500">{product.category}</td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded-lg w-fit">
                                                    <span className="font-black text-yellow-700 text-xs">{product.average_rating || '0.0'}</span>
                                                    <Star size={10} className="fill-yellow-400 text-yellow-400" />
                                                </div>
                                            </td>
                                            <td className="p-4 font-bold text-gray-800 whitespace-nowrap">₹{product.price}</td>
                                            <td className="p-4">
                                                {editingId === product.id ? (
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="number"
                                                            className="w-20 p-1 text-sm border border-gray-300 rounded focus:outline-none"
                                                            value={editValues.stock}
                                                            onChange={(e) => setEditValues({ ...editValues, stock: parseInt(e.target.value) })}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col">
                                                        <span className={`font-black ${isLowStock ? 'text-red-600' : 'text-gray-800'}`}>
                                                            {product.stock}
                                                        </span>
                                                        {isVariant && (
                                                            <span className="text-[9px] text-purple-600 font-black uppercase tracking-widest mt-0.5">Sum of variants</span>
                                                        )}
                                                        {isLowStock && (
                                                            <span className="text-[10px] text-red-500 font-bold flex items-center gap-1 uppercase mt-1">
                                                                <AlertCircle className="w-3 h-3" /> Low Stock
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-800">{product.reserved_stock || 0}</span>
                                                    {(product.user_reserved > 0 || product.guest_reserved > 0) && (
                                                        <div className="text-[9px] text-gray-400 mt-0.5 leading-tight uppercase font-black">
                                                            <span className="text-blue-500">U: {product.user_reserved || 0}</span>
                                                            <span className="mx-1">|</span>
                                                            <span className="text-amber-500">G: {product.guest_reserved || 0}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-800 text-xs">{product.store_name || 'N/A'}</span>
                                                    <span className="text-[10px] text-gray-500 uppercase font-black">{product.store_code || '---'}</span>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded text-xs font-semibold ${product.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                                                    {product.status ? product.status.toUpperCase() : 'AVAILABLE'}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex gap-2">
                                                    {editingId === product.id ? (
                                                        <button onClick={() => handleSave(product.id)} className="p-2 bg-primary text-white rounded-lg hover:shadow-lg transition-shadow">
                                                            <Save className="w-4 h-4" />
                                                        </button>
                                                    ) : isVariant ? (
                                                        <span className="px-3 py-1.5 text-[11px] font-black text-purple-600 bg-purple-50 border border-purple-100 rounded-lg whitespace-nowrap" title="Stock is managed per variant in the Product editor">
                                                            VARIANT
                                                        </span>
                                                    ) : (
                                                        <button onClick={() => handleEdit(product)} className="px-3 py-1.5 text-primary font-bold text-sm bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors">
                                                            Edit
                                                        </button>
                                                    )}
                                                    <button onClick={() => toggleStatus(product.id, product.status || 'available')} className="p-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors" title="Toggle Status">
                                                        {product.status === 'available' ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="p-4 border-t border-gray-100 flex items-center justify-between">
                        <span className="text-sm text-gray-500">
                            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, filteredProducts.length)} of {filteredProducts.length} Entries
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                            >
                                <ChevronLeft className="w-5 h-5 text-gray-600" />
                            </button>
                            <span className="py-2 px-4 rounded-lg bg-primary/10 text-primary font-bold">{currentPage}</span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                            >
                                <ChevronRight className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function AdminInventory() {
    return (
        <ErrorBoundary>
            <InventoryContent />
        </ErrorBoundary>
    );
}
