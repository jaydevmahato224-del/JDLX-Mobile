import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, RefreshCw, AlertTriangle, CheckCircle, Clock, Package, UploadCloud, Users, FileText, ChevronRight, X, Save, Edit2, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'

function AdminRestocking() {
    const [activeTab, setActiveTab] = useState('dashboard'); // dashboard | suppliers | upload
    const [analytics, setAnalytics] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const [requests, setRequests] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [, setLoading] = useState(true);
    const [aiForecasts] = useState({});

    // OCR & Upload State
    const [uploading, setUploading] = useState(false);
    const [ocrData, setOcrData] = useState(null);
    const [pdfUrl, setPdfUrl] = useState(null);
    const fileInputRef = useRef(null);

    const navigate = useNavigate();

    const fetchDashboardData = async () => {
        setLoading(true);
        try {
            const [alertsRes, analyticsRes] = await Promise.all([
                apiFetch('/admin/restock-alerts'),
                apiFetch('/admin/inventory/restock-analytics')
            ]);

            if (alertsRes.ok) {
                const alertsData = await alertsRes.json();
                setAlerts(alertsData.alerts || []);
                setRequests(alertsData.requests || []);
            }
            if (analyticsRes.ok) {
                setAnalytics(await analyticsRes.json());
            }
        } catch (err) {
            console.error('Failed to fetch dashboard', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchSuppliers = async () => {
        try {
            const res = await apiFetch('/admin/suppliers');
            if (res.ok) setSuppliers(await res.json());
        } catch (err) { console.error(err); }
    };

    const createRequest = async (productId, quantity) => {
        try {
            const res = await apiFetch('/admin/restock-request', {
                method: 'POST',
                body: JSON.stringify({ product_id: productId, requested_quantity: quantity })
            });
            const data = await res.json();
            if (res.ok) {
                alert(data.message || 'Restock request created');
                fetchDashboardData();
            } else {
                alert(data.error || data.message || 'Failed to create restock request');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to create restock request');
        }
    };

    useEffect(() => {
        if (activeTab === 'dashboard') fetchDashboardData();
        if (activeTab === 'suppliers') fetchSuppliers();
    }, [activeTab]);

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || file.type !== 'application/pdf') {
            alert("Only PDF files are supported.");
            return;
        }

        setUploading(true);
        setActiveTab('upload');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API_BASE_URL}/admin/inventory/upload-invoice`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            const data = await res.json();

            if (res.ok) {
                setOcrData(data.data.items || []);
                setPdfUrl(`${API_BASE_URL.replace('/api', '')}${data.file_url}`);
            } else {
                alert(data.error);
                setActiveTab('dashboard');
            }
        } catch (err) {
            console.error(err);
            alert("Upload crashed.");
            setActiveTab('dashboard');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const confirmInvoice = async () => {
        if (!ocrData || ocrData.length === 0) return alert("No valid items to restock.");

        try {
            const res = await apiFetch('/admin/inventory/confirm-invoice', {
                method: 'POST',
                body: JSON.stringify({ items: ocrData, store_id: 1 })
            });

            const data = await res.json();
            if (res.ok) {
                alert(data.message);
                setOcrData(null);
                setPdfUrl(null);
                setActiveTab('dashboard');
            } else {
                alert(data.error);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const updateOcrItem = (index, field, value) => {
        const newData = [...ocrData];
        newData[index][field] = value;
        setOcrData(newData);
    };

    return (
        <div className="py-6 flex flex-col gap-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/admin')} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-800" />
                    </button>
                    <h1 className="text-2xl font-bold text-gray-800">Inventory Supply Chain</h1>
                </div>

                <div className="flex gap-2">
                    <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-2 rounded-xl text-sm font-bold ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Dashboard</button>
                    <button onClick={() => setActiveTab('suppliers')} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${activeTab === 'suppliers' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}><Users className="w-4 h-4" /> Suppliers</button>

                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={handleFileUpload} />
                    <button onClick={() => fileInputRef.current.click()} disabled={uploading} className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50">
                        {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                        Upload Invoice (OCR)
                    </button>
                </div>
            </div>

            {/* View: OCR Upload Preview */}
            {activeTab === 'upload' && (
                <div className="flex flex-col lg:flex-row gap-6">
                    {/* PDF Reader */}
                    <div className="w-full lg:w-1/2 bg-gray-900 rounded-2xl overflow-hidden shadow-xl border border-gray-800 flex flex-col">
                        <div className="p-3 bg-gray-800 text-gray-300 font-mono text-xs flex justify-between items-center">
                            <span>PDF Viewer</span>
                            <FileText className="w-4 h-4" />
                        </div>
                        {pdfUrl ? (
                            <iframe src={pdfUrl} className="w-full h-full border-none" title="Invoice Preview" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500">Loading PDF...</div>
                        )}
                    </div>

                    {/* Data Validation Grid */}
                    <div className="w-full lg:w-1/2 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-blue-50/50">
                            <div>
                                <h3 className="font-bold text-gray-800 text-lg">OCR Extracted Data</h3>
                                <p className="text-xs text-blue-600 font-medium">Auto-detected {ocrData?.length || 0} line items. Please verify.</p>
                            </div>
                            <button onClick={confirmInvoice} className="px-5 py-2.5 bg-green-600 text-white text-sm font-bold rounded-xl shadow-md cursor-pointer hover:bg-green-700 flex items-center gap-2">
                                <CheckCircle className="w-4 h-4" /> Confirm Restock
                            </button>
                        </div>
                        <div className="flex-1 p-4">
                            {ocrData && ocrData.length > 0 ? (
                                <div className="flex flex-col gap-3">
                                    {ocrData.map((item, idx) => (
                                        <div key={idx} className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                                            <div className="flex justify-between items-start">
                                                <input type="text" className="font-bold bg-transparent border-none outline-none w-2/3" value={item.product_name} onChange={(e) => updateOcrItem(idx, 'product_name', e.target.value)} />
                                                <input type="text" className="text-xs text-right font-mono bg-transparent border-none outline-none w-1/3 text-gray-500" value={item.sku} onChange={(e) => updateOcrItem(idx, 'sku', e.target.value)} placeholder="SKU" />
                                            </div>
                                            <div className="flex gap-4 mt-2">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase font-bold text-gray-400">Qty</span>
                                                    <input type="number" className="w-16 p-1 border rounded text-sm font-mono text-center" value={item.quantity} onChange={(e) => updateOcrItem(idx, 'quantity', parseInt(e.target.value))} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase font-bold text-gray-400">Buy Price (₹)</span>
                                                    <input type="number" step="0.01" className="w-20 p-1 border rounded text-sm font-mono text-center" value={item.purchase_price} onChange={(e) => updateOcrItem(idx, 'purchase_price', parseFloat(e.target.value))} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase font-bold text-gray-400">Sell Price (₹)</span>
                                                    <input type="number" step="0.01" className="w-20 p-1 border rounded text-sm font-mono text-center text-green-700 bg-green-50" value={item.selling_price} onChange={(e) => updateOcrItem(idx, 'selling_price', parseFloat(e.target.value))} />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
                                    <AlertTriangle className="w-10 h-10 opacity-50" />
                                    <p>No valid line items detected. Upload a structured invoice.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* View: Suppliers Management */}
            {activeTab === 'suppliers' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                        <h2 className="text-lg font-bold text-gray-800">Verified Suppliers</h2>
                        <button className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold hover:bg-indigo-100 cursor-pointer text-center flex justify-center">+ Add Supplier</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                    <th className="p-4 font-semibold text-gray-600 text-sm">ID</th>
                                    <th className="p-4 font-semibold text-gray-600 text-sm">Company Name</th>
                                    <th className="p-4 font-semibold text-gray-600 text-sm">Contact</th>
                                    <th className="p-4 font-semibold text-gray-600 text-sm">Email</th>
                                    <th className="p-4 font-semibold text-gray-600 text-sm">Registered</th>
                                </tr>
                            </thead>
                            <tbody>
                                {suppliers.length === 0 ? (
                                    <tr><td colSpan="5" className="p-8 text-center text-gray-400">No suppliers registered.</td></tr>
                                ) : (
                                    suppliers.map(sup => (
                                        <tr key={sup.id} className="border-b border-gray-50 hover:bg-gray-50 text-sm">
                                            <td className="p-4 font-mono text-xs font-bold text-indigo-600">{sup.supplier_id}</td>
                                            <td className="p-4 font-bold text-gray-800">{sup.name}</td>
                                            <td className="p-4 text-gray-600">{sup.contact || '-'}</td>
                                            <td className="p-4 text-gray-600">{sup.email || '-'}</td>
                                            <td className="p-4 text-gray-500">{new Date(sup.created_at).toLocaleDateString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* View: Dashboard */}
            {activeTab === 'dashboard' && (
                <>
                    {/* Analytics Header Cards */}
                    {analytics && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="glass-card p-6 border-l-4 border-red-500 flex flex-col gap-2">
                                <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider">Out of Stock Lines</h3>
                                <p className="text-3xl font-black text-gray-800">{analytics.out_of_stock}</p>
                                <span className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Immediate action required</span>
                            </div>
                            <div className="glass-card p-6 border-l-4 border-amber-500 flex flex-col gap-2">
                                <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider">Pending Replenishments</h3>
                                <p className="text-3xl font-black text-gray-800">{analytics.pending_requests_volume}</p>
                                <span className="text-xs text-amber-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Total units awaiting delivery</span>
                            </div>
                            <div className="glass-card p-6 border-l-4 border-green-500 flex flex-col gap-2">
                                <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider">Top Moving Product</h3>
                                <p className="text-xl font-bold text-gray-800 truncate">{analytics.top_restocked?.[0]?.name || 'N/A'}</p>
                                <span className="text-xs text-green-600 flex items-center gap-1"><TrendingUpIcon className="w-3 h-3" /> Highest restock frequency</span>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Low Stock Alerts (Legacy mapping preserved) */}
                        <div className="flex flex-col gap-4">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-amber-500" /> Actionable Low Stock
                            </h2>
                            <div className="flex flex-col gap-3">
                                {alerts.length === 0 ? (
                                    <div className="glass-card p-8 text-center text-gray-500 italic">Inventory levels are stable.</div>
                                ) : (
                                    alerts.map(product => {
                                        const aiRecommendation = aiForecasts[product.id];
                                        return (
                                            <div key={product.id} className="glass-card p-4 flex items-center justify-between">
                                                <div className="flex flex-col">
                                                    <p className="font-bold text-gray-800">{product.name}</p>
                                                    <div className="flex items-center flex-wrap gap-2 text-xs text-gray-500 mt-1">
                                                        <span>
                                                            Stock: <span className="font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded mr-1\">{product.stock || 0}</span>
                                                        </span>
                                                        <span>
                                                            Threshold: <span className="text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{product.restock_threshold}</span>
                                                        </span>
                                                        {aiRecommendation && aiRecommendation.recommended_restock > 0 && (
                                                            <span className="flex items-center gap-1 font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded ml-2">
                                                                <Brain className="w-3 h-3" /> AI Restock: +{aiRecommendation.recommended_restock}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button onClick={() => createRequest(product.id, aiRecommendation ? aiRecommendation.recommended_restock : 50)} className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-1">
                                                    Restock Request <ChevronRight className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>

                        {/* Recent Requests */}
                        <div className="flex flex-col gap-4">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-primary" /> Active Requests
                            </h2>
                            <div className="flex flex-col gap-3">
                                {requests.length === 0 ? (
                                    <div className="glass-card p-8 text-center text-gray-500 italic">No floating requests.</div>
                                ) : (
                                    requests.map(req => (
                                        <div key={req.id} className="glass-card p-4 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-xl ${req.status === 'PENDING' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
                                                    <Package className="w-5 h-5" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <p className="font-bold text-gray-800">{req.product_name}</p>
                                                    <p className="text-xs text-gray-500 font-mono mt-0.5">Qty: {req.requested_quantity} | Sup: {req.supplier_id}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-black tracking-wider ${req.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                                                    {req.status}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// Inline Icon to prevent crashing on missing import
const TrendingUpIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
        <polyline points="16 7 22 7 22 13"></polyline>
    </svg>
);

export default AdminRestocking;
