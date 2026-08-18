import React, { useState, useEffect, Component } from 'react';
import { ArrowLeft, Warehouse, Plus, MapPin, Package, Save, Check, X, ChevronLeft, ChevronRight, Edit2, Trash2, Power, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
        console.error("Dark Stores UI Crash Caught:", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center p-12 text-center h-full min-h-[400px]">
                    <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Dark stores failed to load.</h2>
                    <p className="text-gray-500 mb-6">A connection error occurred while parsing active locations.</p>
                    <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} className="px-6 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors font-bold">
                        Retry Connection
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

function DarkStoresContent() {
    const [stores, setStores] = useState([]);
    const [selectedStore, setSelectedStore] = useState(null);
    const [inventory, setInventory] = useState([]);
    const [showStoreForm, setShowStoreForm] = useState(false);
    const [isEditingStore, setIsEditingStore] = useState(false);

    // Extended Data Model mapping the new Backend requirements
    const [storeFormData, setStoreFormData] = useState({
        id: null, name: '', latitude: '', longitude: '', address: '', pincode: '', manager_name: '', phone: '', status: 'active'
    });

    const [editingInventory, setEditingInventory] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState({ text: '', type: '' });

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    const navigate = useNavigate();

    const getAuthToken = () => {
        try {
            return localStorage.getItem('adminToken') || localStorage.getItem('token');
        } catch (e) {
            console.warn('LocalStorage inaccessible:', e);
            return null;
        }
    };

    const fetchStores = async () => {
        setLoading(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_BASE_URL}/admin/stores`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setStores(data);
            } else {
                setStores([]);
            }
        } catch (err) {
            console.error('Failed to fetch stores:', err);
            setStores([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchInventory = async (storeId) => {
        if (!storeId) return;
        try {
            const token = getAuthToken();
            if (String(storeId).startsWith('partner_')) {
                setInventory([]);
                return;
            }
            const actualId = String(storeId).replace('store_', '');
            const res = await fetch(`${API_BASE_URL}/admin/store-inventory/${actualId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setInventory(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error(err);
            setInventory([]);
        }
    };

    useEffect(() => {
        fetchStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
    }, []);

    const showMessage = (text, type = 'success') => {
        setMessage({ text, type });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    };

    const handleStoreSubmit = async (e) => {
        e.preventDefault();
        const token = getAuthToken();
        const url = isEditingStore ? `${API_BASE_URL}/admin/stores/${storeFormData.id}` : `${API_BASE_URL}/admin/stores`;
        const method = isEditingStore ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(storeFormData)
            });

            const data = await res.json();
            if (res.ok) {
                showMessage(data.message || `Store successfully ${isEditingStore ? 'updated' : 'created'}`);
                setShowStoreForm(false);
                setIsEditingStore(false);
                resetForm();
                fetchStores();
            } else {
                showMessage(data.error || 'Failed to process store', 'error');
            }
        } catch (err) {
            console.error(err);
            showMessage('Connection error', 'error');
        }
    };

    const handleDeleteStore = async (id) => {
        if (!window.confirm("Are you sure you want to permanently delete this dark store? All isolated inventory mappings will be wiped.")) return;

        try {
            const token = getAuthToken();
            const res = await fetch(`${API_BASE_URL}/admin/stores/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                showMessage('Store deleted successfully');
                fetchStores();
            } else {
                showMessage(data.error || 'Failed to delete store', 'error');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const resetForm = () => {
        setStoreFormData({ id: null, name: '', latitude: '', longitude: '', address: '', pincode: '', manager_name: '', phone: '', status: 'active' });
    };

    const openEditForm = (store) => {
        if (!store) return;
        setStoreFormData({
            id: store.id,
            name: store.name || '',
            address: store.address || '',
            pincode: store.pincode || '',
            latitude: store.latitude || '',
            longitude: store.longitude || '',
            manager_name: store.manager_name !== 'Unassigned' ? (store.manager_name || '') : '',
            phone: store.phone !== 'N/A' ? (store.phone || '') : '',
            status: store.status || 'active'
        });
        setIsEditingStore(true);
        setShowStoreForm(true);
    };

    const handleUpdateStock = async (productId, stock) => {
        if (!selectedStore || !productId) return;
        const token = getAuthToken();
        try {
            const actualId = String(selectedStore.id).replace('store_', '');
            await fetch(`${API_BASE_URL}/admin/store-inventory/${actualId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ product_id: productId, stock: parseInt(stock) })
            });
            setEditingInventory(null);
            fetchInventory(selectedStore.id);
            showMessage('Stock updated successfully');
        } catch (err) {
            console.error(err);
        }
    };

    const safeStores = Array.isArray(stores) ? stores : [];
    const indexOfLastStore = currentPage * itemsPerPage;
    const indexOfFirstStore = indexOfLastStore - itemsPerPage;
    const currentStores = safeStores.slice(indexOfFirstStore, indexOfLastStore);
    const totalPages = Math.ceil(safeStores.length / itemsPerPage);

    if (loading && safeStores.length === 0) {
        return (
            <div className="p-10 text-center animate-pulse flex flex-col items-center justify-center min-h-[400px]">
                <Warehouse className="w-10 h-10 text-gray-300 mb-4" />
                <div className="h-4 bg-gray-200 rounded w-48 mb-2"></div>
                <div className="h-3 bg-gray-100 rounded w-32"></div>
            </div>
        );
    }

    return (
        <div className="py-6 flex flex-col gap-6 relative min-h-screen">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => selectedStore ? setSelectedStore(null) : navigate('/admin')} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-800" />
                    </button>
                    <h1 className="text-2xl font-bold text-gray-800">
                        {selectedStore ? `${selectedStore?.name || 'Unnamed'} Hub` : 'Dark Stores Intelligence'}
                    </h1>
                </div>
                {!selectedStore && !showStoreForm && (
                    <button onClick={() => { resetForm(); setIsEditingStore(false); setShowStoreForm(true); }} className="btn-primary px-5 py-2.5 text-sm font-bold flex items-center gap-2 rounded-xl shadow-md hover:shadow-lg transition-all">
                        <Plus className="w-4 h-4" /> Add Dark Store
                    </button>
                )}
            </div>

            {message.text && (
                <div className={`p-4 rounded-xl text-sm font-bold flex items-center justify-between ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    <span>{message.text}</span>
                    <button onClick={() => setMessage({ text: '', type: '' })} className="hover:opacity-70"><X className="w-4 h-4" /></button>
                </div>
            )}

            {showStoreForm && (
                <div className="glass-card p-6 border-l-4 border-primary shadow-lg animate-in fade-in slide-in-from-top-4">
                    <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
                        <h2 className="text-lg font-black text-gray-800 flex items-center gap-2">
                            {isEditingStore ? <Edit2 className="w-5 h-5 text-primary" /> : <Plus className="w-5 h-5 text-primary" />}
                            {isEditingStore ? 'Edit Facility Profile' : 'Register Logistics Hub'}
                        </h2>
                    </div>
                    <form onSubmit={handleStoreSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Location Identifier</label>
                            <input type="text" placeholder="e.g. JDLX Jamshedpur City Center" value={storeFormData.name} onChange={e => setStoreFormData({ ...storeFormData, name: e.target.value })} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 font-medium" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Operations Manager</label>
                            <input type="text" placeholder="Supervisor Name" value={storeFormData.manager_name} onChange={e => setStoreFormData({ ...storeFormData, manager_name: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Facility Phone Line</label>
                            <input type="text" placeholder="+91 00000 00000" value={storeFormData.phone} onChange={e => setStoreFormData({ ...storeFormData, phone: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Geo-Latitude</label>
                            <input type="number" step="any" placeholder="22.8046" value={storeFormData.latitude} onChange={e => setStoreFormData({ ...storeFormData, latitude: e.target.value })} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Geo-Longitude</label>
                            <input type="number" step="any" placeholder="86.2029" value={storeFormData.longitude} onChange={e => setStoreFormData({ ...storeFormData, longitude: e.target.value })} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Physical Address</label>
                            <textarea placeholder="Complete Delivery Address..." value={storeFormData.address} onChange={e => setStoreFormData({ ...storeFormData, address: e.target.value })} required rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-medium"></textarea>
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Delivery Pincode</label>
                            <input type="text" placeholder="e.g. 700001" value={storeFormData.pincode} onChange={e => setStoreFormData({ ...storeFormData, pincode: e.target.value })} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 font-medium" />
                        </div>
                        {isEditingStore && (
                            <div className="md:col-span-2">
                                <label className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer">
                                    <div className={`w-10 h-6 rounded-full flex items-center p-1 transition-colors ${storeFormData.status === 'active' ? 'bg-primary' : 'bg-gray-300'}`}>
                                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${storeFormData.status === 'active' ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                    </div>
                                    <input type="checkbox" className="hidden" checked={storeFormData.status === 'active'} onChange={(e) => setStoreFormData({ ...storeFormData, status: e.target.checked ? 'active' : 'disabled' })} />
                                    <span className="font-bold text-gray-700">Hub is Active & Accepting External Orders</span>
                                </label>
                            </div>
                        )}
                        <div className="md:col-span-2 flex justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
                            <button type="button" onClick={() => { setShowStoreForm(false); setIsEditingStore(false); }} className="px-6 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                            <button type="submit" className="btn-primary px-8 py-2.5 text-sm font-bold rounded-xl shadow-md hover:shadow-lg transition-all">{isEditingStore ? 'Commit Overlay' : 'Deploy Infrastructure'}</button>
                        </div>
                    </form>
                </div>
            )}

            {!selectedStore ? (
                <div className="glass-card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left bg-white border-collapse">
                            <thead>
                                <tr className="bg-gray-50/80 border-b border-gray-100">
                                    <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Store ID</th>
                                    <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Facility Hub</th>
                                    <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Manager Lead</th>
                                    <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider text-center">Items Stocked</th>
                                    <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider text-center">Status</th>
                                    <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider text-right">Settings</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentStores.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-gray-500 font-medium">No logistics hubs have been registered.</td>
                                    </tr>
                                ) : (
                                    currentStores.map(store => store && (
                                        <tr key={store?.id || Math.random()} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${store.status === 'disabled' ? 'opacity-60 bg-gray-50/50' : ''}`}>
                                            <td className="p-4">
                                                <span className="text-xs font-black text-gray-400 font-mono tracking-widest">{store.id}</span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-extrabold text-gray-800 text-sm hover:text-primary cursor-pointer transition-colors" onClick={() => { setSelectedStore(store); fetchInventory(store.id); }}>
                                                        {store.name}
                                                    </span>
                                                    <span className="text-xs text-gray-400 font-medium mt-1 truncate max-w-[250px]">{store.address}</span>
                                                    {store.source_type === 'approved_warehouse' && (
                                                        <span className="mt-1 text-[10px] font-black uppercase tracking-wider text-emerald-600">Approved warehouse partner</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-gray-700">{store.manager_name}</span>
                                                    <span className="text-[10px] text-gray-400 mt-1">{store.phone}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 text-primary rounded-lg">
                                                    <Package className="w-3.5 h-3.5" />
                                                    <span className="text-xs font-black">{store.inventory_count || 0}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded border text-[10px] font-black tracking-wider uppercase ${store.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                                    {store.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => { setSelectedStore(store); fetchInventory(store.id); }} className="px-3 py-1.5 bg-gray-100 font-bold text-xs text-gray-700 rounded-lg shadow-sm hover:bg-white transition-all transform hover:-translate-y-0.5" title="Manage Internal Inventory">
                                                        Inspect
                                                    </button>
                                                    {(!store.source_type || store.source_type === 'dark_store') ? (
                                                        <>
                                                            <button onClick={() => openEditForm(store)} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors" title="Edit Hub Profile">
                                                                <Edit2 className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => handleDeleteStore(store.id)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors" title="Permanently Delete Store">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                                                                Synced from approvals
                                                            </span>
                                                            <button onClick={() => handleDeleteStore(store.id)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors" title="Permanently Delete Store">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <span className="text-sm font-medium text-gray-500">
                                Displaying {indexOfFirstStore + 1} to {Math.min(indexOfLastStore, safeStores.length)} of {safeStores.length} Hubs
                            </span>
                            <div className="flex gap-2">
                                <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="p-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 shadow-sm"><ChevronLeft className="w-4 h-4 text-gray-600" /></button>
                                <span className="py-2 px-4 rounded-xl bg-primary text-white shadow-sm font-bold text-sm">{currentPage}</span>
                                <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="p-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 shadow-sm"><ChevronRight className="w-4 h-4 text-gray-600" /></button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 glass-card p-8 relative overflow-hidden group">
                            <div className="absolute -right-12 -top-12 w-48 h-48 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors duration-700"></div>
                            <div className="relative z-10">
                                <div className="flex items-start justify-between mb-8">
                                    <div>
                                        <div className="flex items-center gap-3 mb-3">
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${selectedStore?.status === 'active' ? 'bg-green-100 text-green-700 ring-1 ring-green-200' : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'}`}>
                                                {selectedStore?.status || 'N/A'}
                                            </span>
                                            <span className="text-[10px] font-bold text-gray-400 font-mono uppercase tracking-tighter bg-gray-50 px-2 py-1 rounded-md border border-gray-100">ID: {selectedStore?.id || 'N/A'}</span>
                                            {selectedStore?.source_type === 'approved_warehouse' && (
                                                <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-1 rounded-md border border-blue-100">Partner Facility</span>
                                            )}
                                        </div>
                                        <h2 className="text-3xl font-black text-gray-900 tracking-tight leading-tight mb-2">{selectedStore?.name || 'Unnamed Facility'}</h2>
                                        <div className="flex items-center gap-2 text-gray-500">
                                            <div className="p-1.5 bg-primary/10 rounded-lg">
                                                <MapPin className="w-4 h-4 text-primary" />
                                            </div>
                                            <span className="text-sm font-semibold text-gray-600 leading-relaxed max-w-xl">{selectedStore?.address || 'No Address'}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {(!selectedStore?.source_type || selectedStore?.source_type === 'dark_store') ? (
                                            <button 
                                                onClick={() => openEditForm(selectedStore)} 
                                                className="p-3 bg-white border border-gray-100 text-gray-500 hover:text-primary hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 rounded-2xl transition-all duration-300"
                                                title="Edit Hub Configuration"
                                            >
                                                <Edit2 className="w-5 h-5" />
                                            </button>
                                        ) : (
                                            <div className="p-3 bg-gray-50 border border-gray-100 text-gray-400 rounded-2xl cursor-not-allowed">
                                                <AlertTriangle className="w-5 h-5" />
                                            </div>
                                        )}
                                        <button 
                                            onClick={() => {
                                                handleDeleteStore(selectedStore.id);
                                                setSelectedStore(null);
                                            }} 
                                            className="p-3 bg-red-50 border border-red-100 text-red-500 hover:bg-red-100 hover:text-red-600 hover:shadow-lg hover:shadow-red-500/5 rounded-2xl transition-all duration-300"
                                            title="Delete Hub Permanently"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-10">
                                    <div className="space-y-1.5">
                                        <p className="ui-label opacity-60">Lead Manager</p>
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-black text-gray-500 border-2 border-white shadow-sm uppercase">
                                                {selectedStore?.manager_name?.charAt(0) || 'U'}
                                            </div>
                                            <p className="font-bold text-gray-800 text-sm">{selectedStore?.manager_name || 'Unassigned'}</p>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <p className="ui-label opacity-60">Communication</p>
                                        <p className="font-bold text-gray-800 text-sm">{selectedStore?.phone || 'N/A'}</p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <p className="ui-label opacity-60">Postal Identity</p>
                                        <p className="font-bold text-gray-800 text-sm">{selectedStore?.pincode || 'N/A'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="glass-card p-8 bg-gradient-to-br from-white to-gray-50/50 border-white/50 flex flex-col items-center justify-center text-center shadow-xl shadow-gray-200/40 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                    <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Live Sync</span>
                                </div>
                            </div>
                            <div className="w-20 h-20 bg-primary/10 rounded-[28px] flex items-center justify-center mb-6 relative">
                                <Package className="w-10 h-10 text-primary" />
                                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-100">
                                    <Check className="w-4 h-4 text-green-500" />
                                </div>
                            </div>
                            <p className="text-5xl font-black text-gray-900 tracking-tighter mb-1">{Array.isArray(inventory) ? inventory.length : 0}</p>
                            <p className="ui-label text-primary font-black tracking-[0.3em]">Managed SKUs</p>
                            <div className="mt-8 w-full">
                                <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">
                                    <span>Stock Health</span>
                                    <span className="text-green-600">Optimal</span>
                                </div>
                                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: '85%' }}></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="glass-card overflow-hidden shadow-2xl shadow-gray-200/50">
                        <div className="px-8 py-6 border-b border-gray-100 bg-white/50 flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-gray-50 rounded-2xl">
                                    <Warehouse className="w-6 h-6 text-gray-700" />
                                </div>
                                <div>
                                    <h3 className="font-black text-gray-900 text-xl tracking-tight">Commodity Registry</h3>
                                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">Isolated Inventory Intelligence</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 w-full md:w-auto">
                                <div className="relative group flex-1 md:flex-none">
                                    <input 
                                        type="text" 
                                        placeholder="Search by ID or Name..." 
                                        className="pl-11 pr-4 py-3 bg-gray-50/80 border border-gray-200/60 rounded-2xl text-sm font-bold text-gray-700 focus:outline-none focus:ring-4 focus:ring-primary/10 focus:bg-white focus:border-primary/30 transition-all w-full md:w-72"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                    <Package className="w-4.5 h-4.5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-primary transition-colors" />
                                </div>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-gray-50/50 border-b border-gray-100">
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Product Intelligence</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Valuation</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-center">Localized Stock</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Operational Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50/50 bg-white">
                                    {(Array.isArray(inventory) ? inventory : []).filter(item => 
                                        (item?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                        String(item?.id || '').includes(searchTerm)
                                    ).length === 0 ? (
                                        <tr>
                                            <td colSpan="4" className="px-8 py-20 text-center">
                                                <div className="flex flex-col items-center justify-center grayscale opacity-40">
                                                    <Package className="w-12 h-12 mb-4" />
                                                    <p className="text-lg font-bold text-gray-800">No Match Found</p>
                                                    <p className="text-sm text-gray-500 mt-1">Try adjusting your search query for this facility.</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        (Array.isArray(inventory) ? inventory : [])
                                            .filter(item => 
                                                (item?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                                String(item?.id || '').includes(searchTerm)
                                            )
                                            .map((item, idx) => item && (
                                            <tr key={item?.id || idx} className="hover:bg-primary/[0.02] transition-all group duration-300">
                                                <td className="px-8 py-5">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-xs font-black text-gray-400">
                                                            {idx + 1}
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-black text-gray-800 group-hover:text-primary transition-colors">{item?.name || 'Unnamed'}</div>
                                                            <div className="text-[10px] font-bold font-mono text-gray-400 mt-0.5 flex items-center gap-1.5 uppercase tracking-tighter">
                                                                <span className="bg-gray-100 px-1.5 py-0.5 rounded">SKU: {item?.id || 'N/A'}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-gray-700 text-sm">₹{item?.price || 0}</span>
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Base Unit</span>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-5 text-center">
                                                    {editingInventory && editingInventory.id === item?.id ? (
                                                        <div className="flex justify-center">
                                                            <input
                                                                type="number"
                                                                value={editingInventory?.stock || 0}
                                                                onChange={e => setEditingInventory({ ...editingInventory, stock: e.target.value })}
                                                                className="w-24 bg-white border-2 border-primary/40 rounded-xl shadow-inner px-3 py-2 text-sm font-black text-center focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                                                                autoFocus
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="flex justify-center">
                                                            <span className={`inline-flex flex-col items-center justify-center min-w-[4rem] px-3 py-2 rounded-2xl font-black transition-all ${(item?.stock_quantity || 0) > 10 ? 'bg-gray-50 text-gray-700 group-hover:bg-primary/10 group-hover:text-primary' : (item?.stock_quantity || 0) > 0 ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                                                                <span className="text-sm">{item?.stock_quantity || 0}</span>
                                                                <span className="text-[8px] uppercase tracking-tighter opacity-60">In Stock</span>
                                                            </span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-8 py-5 text-right">
                                                    {editingInventory && editingInventory.id === item?.id ? (
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button 
                                                                onClick={() => handleUpdateStock(item?.id, editingInventory?.stock)} 
                                                                className="p-2.5 bg-green-500 text-white rounded-xl shadow-lg shadow-green-500/20 hover:scale-105 active:scale-95 transition-all"
                                                            >
                                                                <Check className="w-4 h-4" />
                                                            </button>
                                                            <button 
                                                                onClick={() => setEditingInventory(null)} 
                                                                className="p-2.5 bg-white border border-gray-100 text-gray-400 rounded-xl hover:bg-gray-50 transition-all"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            onClick={() => setEditingInventory({ id: item?.id, stock: item?.stock_quantity || 0 })} 
                                                            className="inline-flex items-center gap-2 text-xs font-black bg-white border border-gray-100 text-gray-500 hover:text-white hover:bg-primary hover:border-primary hover:shadow-xl hover:shadow-primary/20 px-4 py-2.5 rounded-xl transition-all duration-300 transform active:scale-95"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                            Modify Stock
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-8 py-5 bg-gray-50/50 border-t border-gray-100 flex justify-between items-center">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Showing all {Array.isArray(inventory) ? inventory.length : 0} commodities mapped to this hub</p>
                            <div className="flex items-center gap-4">
                                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></div>
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Inventory Health Scanned</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AdminDarkStores() {
    return (
        <ErrorBoundary>
            <DarkStoresContent />
        </ErrorBoundary>
    );
}
