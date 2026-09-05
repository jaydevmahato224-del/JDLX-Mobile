import { useState, useEffect, useCallback, useRef } from 'react'
import { 
    ShoppingBag, 
    Search, 
    Plus, 
    Loader2, 
    Clock, 
    CheckCircle2, 
    XCircle,
    Package,
    ArrowRight,
    Filter,
    AlertCircle,
    TrendingUp,
    Truck,
    Edit3,
    PackagePlus,
    Trash2,
    X,
    ChevronLeft,
    Layers,
    User,
    Calendar,
    FileText,
    Save,
    Printer,
    ArrowLeft,
    Tag,
    Scan,
    FileUp
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../utils/apiFetch'

// Move Modal Components OUTSIDE to prevent re-definition on every render
const VendorModal = ({ 
    show, 
    onClose, 
    isEditing, 
    formData, 
    setFormData, 
    onSave, 
    submitting 
}) => {
    if (!show) return null;
    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 lg:p-8 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl" onClick={onClose} />
            
            <div className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-[40px] shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-12 duration-500">
                <div className="p-4 sm:p-6 lg:p-8 border-b border-white/5 flex items-center justify-between bg-slate-950/30">
                    <div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                            {isEditing ? <Edit3 className="text-amber-500" size={24} /> : <User className="text-amber-500" size={24} />}
                            {isEditing ? 'Edit Vendor' : 'New Vendor'}
                        </h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                            {isEditing ? 'Update existing supplier details' : 'Register new supplier details'}
                        </p>
                    </div>
                    <button 
                        type="button"
                        onClick={onClose}
                        className="p-3 rounded-2xl bg-white/5 text-slate-500 hover:text-white transition-all"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
                    <div className="space-y-4">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Vendor Name</label>
                        <input 
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full bg-slate-950 border border-white/5 rounded-2xl py-4 px-6 text-sm font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Phone Number</label>
                            <input 
                                type="tel"
                                placeholder="Enter contact no."
                                value={formData.contact}
                                onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-xs font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">GST-IN (Optional)</label>
                            <input 
                                type="text"
                                placeholder="GST Number"
                                value={formData.gst_in}
                                onChange={(e) => setFormData({ ...formData, gst_in: e.target.value })}
                                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-xs font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Email Address</label>
                        <input 
                            type="email"
                            placeholder="vendor@email.com"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-xs font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Vendor Role</label>
                        <div className="grid grid-cols-2 gap-4">
                            {['Wholesaler', 'Retailer'].map(role => (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, role })}
                                    className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                                        formData.role === role 
                                        ? 'bg-amber-400 border-amber-400 text-slate-950' 
                                        : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10'
                                    }`}
                                >
                                    {role}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="p-4 sm:p-6 lg:p-8 bg-slate-950/50 border-t border-white/5">
                    <button 
                        type="button"
                        onClick={onSave}
                        disabled={!formData.name || submitting}
                        className="w-full py-5 rounded-2xl bg-amber-400 text-slate-950 text-sm font-black uppercase tracking-[0.3em] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-30 flex items-center justify-center gap-3 shadow-2xl shadow-amber-400/10"
                    >
                        {submitting ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} strokeWidth={3} />}
                        {isEditing ? 'Update Vendor' : 'Register Vendor'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const CategoryModal = ({ 
    show, 
    onClose, 
    product, 
    categories, 
    onSave, 
    submitting 
}) => {
    const [selectedCategory, setSelectedCategory] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [wasShown, setWasShown] = useState(show);

    // Reset the form every time the modal opens (adjust state during render —
    // the React-sanctioned equivalent of the old setState-in-effect reset).
    if (show !== wasShown) {
        setWasShown(show);
        if (show) {
            setSelectedCategory('');
            setNewCategory('');
            setIsAddingNew(false);
        }
    }

    if (!show || !product) return null;

    const handleConfirm = () => {
        const cat = isAddingNew ? newCategory : selectedCategory;
        if (!cat) return;
        onSave(product.id, cat);
    };

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-4 sm:p-6 border-b border-white/5 flex items-center justify-between bg-slate-950/30">
                    <div className="flex items-center gap-3">
                        <Tag className="text-amber-500" size={20} />
                        <div>
                            <h3 className="text-lg font-black text-white uppercase tracking-tight">Set Category</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{product.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl bg-white/5 text-slate-500 hover:text-white transition-all"><X size={20} /></button>
                </div>

                <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Select Existing</label>
                            <button 
                                onClick={() => setIsAddingNew(!isAddingNew)}
                                className="text-[9px] font-black text-amber-500 uppercase tracking-widest hover:underline"
                            >
                                {isAddingNew ? 'Select from list' : '+ Add New Category'}
                            </button>
                        </div>

                        {!isAddingNew ? (
                            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                {categories.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setSelectedCategory(cat)}
                                        className={`p-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all text-left ${
                                            selectedCategory === cat 
                                            ? 'bg-amber-400 border-amber-400 text-slate-950' 
                                            : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
                                        }`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-2 animate-in slide-in-from-top-4 duration-300">
                                <input 
                                    type="text"
                                    placeholder="Enter new category name..."
                                    autoFocus
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    className="w-full bg-slate-950 border border-white/5 rounded-2xl py-4 px-6 text-sm font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 sm:p-6 bg-slate-950/50 border-t border-white/5">
                    <button 
                        onClick={handleConfirm}
                        disabled={(!selectedCategory && !newCategory) || submitting}
                        className="w-full py-4 rounded-2xl bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-[0.2em] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-30 shadow-xl shadow-amber-400/10 flex items-center justify-center gap-2"
                    >
                        {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} strokeWidth={3} />}
                        Confirm Category
                    </button>
                </div>
            </div>
        </div>
    );
};

const WarehouseProcurement = () => {
    const navigate = useNavigate()
    const { warehouseLogout } = useStore()
    const [purchases, setPurchases] = useState([])
    const [storeInfo, setStoreInfo] = useState({ name: '', nextIndex: 1 })
    const [loading, setLoading] = useState(true)
    const [showCreateView, setShowCreateView] = useState(false)
    const [categories, setCategories] = useState([])
    const [isScanning, setIsScanning] = useState(false)
    const fileInputRef = useRef(null)
    
    // Vendor State
    const [vendorName, setVendorName] = useState('')
    const [foundVendors, setFoundVendors] = useState([])
    const [isSearchingVendor, setIsSearchingVendor] = useState(false)
    const [vendorSearchAttempted, setVendorSearchAttempted] = useState(false)
    const [selectedVendor, setSelectedVendor] = useState(null)
    const [showAddVendorModal, setShowAddVendorModal] = useState(false)
    const [isEditingVendor, setIsEditingVendor] = useState(false)
    const [vendorForm, setVendorForm] = useState({
        name: '', contact: '', email: '', gst_in: '', role: 'Wholesaler'
    })

    // Category Update State
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [activeItemForCategory, setActiveItemForCategory] = useState(null);
    
    // Purchase Form State
    const [invoiceNo, setInvoiceNo] = useState('')
    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
    const [reference, setReference] = useState('')
    const [purchaseItems, setPurchaseItems] = useState([
        { id: Date.now(), product: null, quantity: 1, unitPrice: 0, sellingPrice: 0, searchQuery: '', foundProducts: [], highlightedIndex: -1 }
    ])
    
    const [submitting, setSubmitting] = useState(false)
    const [notification, setNotification] = useState(null)

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type })
        setTimeout(() => setNotification(null), 3000)
    }

    const fetchPurchases = useCallback(async () => {
        setLoading(true)
        try {
            const response = await apiFetch('/warehouse/purchases')
            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                return
            }
            const result = await response.json()
            setPurchases(result.data?.purchases || [])
            setStoreInfo({
                name: result.data?.store_name || '',
                nextIndex: result.data?.next_index || 1
            })
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setLoading(false)
        }
    }, [warehouseLogout])

    const fetchCategories = useCallback(async () => {
        try {
            const response = await apiFetch('/warehouse/categories')
            const result = await response.json()
            if (response.ok) setCategories(result.data || [])
        } catch (err) {
            console.error('Failed to fetch categories:', err)
        }
    }, [])

    useEffect(() => {
        fetchPurchases()
        fetchCategories()
    }, [fetchPurchases, fetchCategories])

    // Handle Vendor Search
    useEffect(() => {
        if (!vendorName.trim() || selectedVendor?.name === vendorName) {
            setFoundVendors([])
            setVendorSearchAttempted(false)
            return
        }

        const timer = setTimeout(async () => {
            setIsSearchingVendor(true)
            setVendorSearchAttempted(true)
            try {
                const response = await apiFetch(`/warehouse/vendors/search?q=${vendorName}`)
                const result = await response.json()
                setFoundVendors(result.data || [])
            } catch (err) {
                console.error('Vendor search failed:', err)
            } finally {
                setIsSearchingVendor(false)
            }
        }, 300)

        return () => clearTimeout(timer)
    }, [vendorName, selectedVendor])

    const handleQuickAddVendor = () => {
        setIsEditingVendor(false)
        setVendorForm({ name: vendorName, contact: '', email: '', gst_in: '', role: 'Wholesaler' })
        setShowAddVendorModal(true)
    }

    const handleEditVendor = () => {
        if (!selectedVendor) return
        setIsEditingVendor(true)
        setVendorForm({
            name: selectedVendor.name || '',
            contact: selectedVendor.contact || '',
            email: selectedVendor.email || '',
            gst_in: selectedVendor.gst_in || '',
            role: selectedVendor.role || 'Wholesaler'
        })
        setShowAddVendorModal(true)
    }

    const handleSaveVendor = async (e) => {
        if (e) e.preventDefault()
        if (!vendorForm.name.trim()) return
        
        setSubmitting(true)
        try {
            const url = isEditingVendor 
                ? `/warehouse/vendors/${selectedVendor.id}`
                : '/warehouse/vendors'
            
            const method = isEditingVendor ? 'PUT' : 'POST'

            const response = await apiFetch(url, {
                method: method,
                body: JSON.stringify(vendorForm)
            })
            const result = await response.json()
            if (response.ok) {
                showNotification(isEditingVendor ? 'Vendor updated successfully' : 'Vendor added successfully')
                const updatedVendor = { 
                    ...selectedVendor, 
                    ...vendorForm, 
                    id: isEditingVendor ? selectedVendor.id : result.data.id 
                }
                setSelectedVendor(updatedVendor)
                setVendorName(vendorForm.name)
                setFoundVendors([])
                setVendorSearchAttempted(false)
                setShowAddVendorModal(false)
                setIsEditingVendor(false)
                setVendorForm({ name: '', contact: '', email: '', gst_in: '', role: 'Wholesaler' })
            } else {
                showNotification(result.message, 'error')
            }
        } catch {
            showNotification('Failed to save vendor', 'error')
        } finally {
            setSubmitting(false)
        }
    }

    const handleScanClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        
        setIsScanning(true)
        showNotification('Initializing AI Scanner...', 'success')
        
        const formData = new FormData()
        formData.append('file', file)
        
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/scan-invoice`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            })
            const result = await response.json()
            if (response.ok && result.data?.items) {
                const extractedItems = result.data.items.map(item => ({
                    id: Date.now() + Math.random(),
                    product: item.product,
                    quantity: item.quantity || 1,
                    unitPrice: item.unit_price || 0,
                    sellingPrice: item.product?.price || 0,
                    searchQuery: item.product?.name || '',
                    foundProducts: [],
                    highlightedIndex: -1
                }))
                
                setPurchaseItems(prev => {
                    // Remove initial empty row if it's the only one and has no product
                    const cleanPrev = prev.length === 1 && !prev[0].product ? [] : prev;
                    return [...cleanPrev, ...extractedItems]
                })
                showNotification(`AI extracted ${extractedItems.length} items successfully`)
            } else {
                showNotification(result.message || 'Failed to scan document', 'error')
            }
        } catch {
            showNotification('Scan service unavailable', 'error')
        } finally {
            setIsScanning(false)
            if (e.target) e.target.value = '' 
        }
    }

    const handleUpdateCategory = async (productId, category) => {
        setSubmitting(true);
        try {
            const response = await apiFetch(`/warehouse/products/${productId}/category`, {
                method: 'PUT',
                body: JSON.stringify({ category })
            });
            
            if (response.ok) {
                showNotification('Product category updated');
                // Update local state for all items with this product
                setPurchaseItems(prev => prev.map(item => {
                    if (item.product?.id === productId) {
                        return { ...item, product: { ...item.product, category } };
                    }
                    return item;
                }));
                fetchCategories();
                setShowCategoryModal(false);
            } else {
                showNotification('Failed to update category', 'error');
            }
        } catch {
            showNotification('Server error', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    // Handle Item Search
    const searchItemProduct = async (index, query) => {
        const newItems = [...purchaseItems]
        newItems[index].searchQuery = query
        newItems[index].highlightedIndex = -1 // Reset highlight on search
        if (query.length < 2) {
            newItems[index].foundProducts = []
            setPurchaseItems(newItems)
            return
        }

        try {
            const response = await fetch(`${API_BASE_URL}/products/search?q=${query}`)
            const data = await response.json()
            newItems[index].foundProducts = data || []
            setPurchaseItems(newItems)
        } catch (err) {
            console.error('Search failed:', err)
        }
    }

    const handleItemKeyDown = (e, index) => {
        const item = purchaseItems[index];
        if (!item.foundProducts.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = (item.highlightedIndex + 1) % item.foundProducts.length;
            const newItems = [...purchaseItems];
            newItems[index].highlightedIndex = nextIndex;
            setPurchaseItems(newItems);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const nextIndex = (item.highlightedIndex - 1 + item.foundProducts.length) % item.foundProducts.length;
            const newItems = [...purchaseItems];
            newItems[index].highlightedIndex = nextIndex;
            setPurchaseItems(newItems);
        } else if (e.key === 'Enter') {
            if (item.highlightedIndex >= 0) {
                e.preventDefault();
                selectProductForItem(index, item.foundProducts[item.highlightedIndex]);
            }
        } else if (e.key === 'Escape') {
            const newItems = [...purchaseItems];
            newItems[index].foundProducts = [];
            newItems[index].highlightedIndex = -1;
            setPurchaseItems(newItems);
        }
    };

    const selectProductForItem = (index, product) => {
        const newItems = [...purchaseItems]
        newItems[index].product = product
        newItems[index].searchQuery = product.name
        newItems[index].foundProducts = []
        newItems[index].highlightedIndex = -1
        newItems[index].unitPrice = Math.floor(product.price * 0.7)
        newItems[index].sellingPrice = product.price
        setPurchaseItems(newItems)
    }

    const updateItemValue = (index, field, value) => {
        const newItems = [...purchaseItems]
        newItems[index][field] = value
        setPurchaseItems(newItems)
    }

    const addRow = () => {
        setPurchaseItems([...purchaseItems, { id: Date.now(), product: null, quantity: 1, unitPrice: 0, sellingPrice: 0, searchQuery: '', foundProducts: [], highlightedIndex: -1 }])
    }

    const removeRow = (index) => {
        const newItems = purchaseItems.filter((_, i) => i !== index);
        if (newItems.length === 0) {
            setPurchaseItems([{ id: Date.now(), product: null, quantity: 1, unitPrice: 0, sellingPrice: 0, searchQuery: '', foundProducts: [], highlightedIndex: -1 }]);
        } else {
            setPurchaseItems(newItems);
        }
    }

    const calculateSubtotal = () => {
        return purchaseItems.reduce((acc, item) => acc + (parseFloat(item.unitPrice) * parseInt(item.quantity || 0)), 0)
    }

    const handleSavePurchase = async () => {
        const validItems = purchaseItems.filter(item => item.product && item.quantity > 0)
        if (validItems.length === 0) {
            showNotification('Add at least one product', 'error')
            return
        }
        if (!vendorName) {
            showNotification('Vendor name is required', 'error')
            return
        }

        // Mandatory Category Validation
        const missingCategory = validItems.find(item => !item.product.category);
        if (missingCategory) {
            showNotification(`Category required for ${missingCategory.product.name}`, 'error');
            setActiveItemForCategory(missingCategory.product);
            setShowCategoryModal(true);
            return;
        }

setSubmitting(true)
        try {
            const response = await apiFetch('/warehouse/purchases', {
                method: 'POST',
                body: JSON.stringify({
                    vendor_name: vendorName,
                    invoice_no: invoiceNo,
                    invoice_date: invoiceDate,
                    reference: reference,
                    items: validItems.map(item => ({
                        product_id: item.product.id,
                        quantity: parseInt(item.quantity),
                        unit_price: parseFloat(item.unitPrice),
                        selling_price: parseFloat(item.sellingPrice)
                    }))
                })
            })

            if (!response.ok) throw new Error('Failed to save purchase')
            
            showNotification('Purchase saved and inventory updated')
            setShowCreateView(false)
            resetForm()
            await fetchPurchases()
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setSubmitting(false)
        }
    }

    const resetForm = () => {
        setVendorName('')
        setSelectedVendor(null)
        setFoundVendors([])
        setVendorSearchAttempted(false)
        setReference('')
        setInvoiceNo('')
        setPurchaseItems([{ id: Date.now(), product: null, quantity: 1, unitPrice: 0, sellingPrice: 0, searchQuery: '', foundProducts: [], highlightedIndex: -1 }])
    }

    const generateInvoiceNo = useCallback(() => {
        const prefix = "JD-"
        let initials = "XX"
        const bracketMatch = storeInfo.name.match(/\((.*?)\)/)
        if (bracketMatch) {
            initials = bracketMatch[1].substring(0, 2).toUpperCase()
        } else {
            initials = storeInfo.name.split(' ')
                .map(word => word[0])
                .join('')
                .substring(0, 2)
                .toUpperCase()
        }
        const sequence = String(storeInfo.nextIndex).padStart(4, '0')
        return `${prefix}${initials}${sequence}`
    }, [storeInfo])

    useEffect(() => {
        if (showCreateView && !invoiceNo) {
            setInvoiceNo(generateInvoiceNo())
        }
    }, [showCreateView, generateInvoiceNo, invoiceNo])

    if (loading && purchases.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium">Loading purchase records...</p>
            </div>
        )
    }

    if (showCreateView) {
        return (
            <div className="min-h-screen bg-slate-950 -m-8 p-8 animate-in slide-in-from-right duration-500">
                {notification && (
                    <div className={`fixed top-8 right-8 z-[110] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl animate-in slide-in-from-right-8 fade-in border ${
                        notification.type === 'error' 
                        ? 'bg-rose-500/10 border-rose-500/20 text-rose-200' 
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                    }`}>
                        {notification.type === 'error' ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
                        <span className="font-bold text-sm uppercase tracking-wide">{notification.message}</span>
                    </div>
                )}

                <div className="flex items-center justify-between mb-5 sm:mb-8">
                    <div className="flex items-center gap-4">
                        <button 
                            type="button"
                            onClick={() => setShowCreateView(false)}
                            className="p-3 rounded-2xl bg-white/5 text-slate-400 hover:text-white transition-all"
                        >
                            <ArrowLeft size={24} />
                        </button>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tight">Create Purchase</h1>
                            <p className="text-xs font-black text-slate-500 uppercase tracking-widest mt-1">Record a new direct stock purchase</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <button 
                            type="button"
                            onClick={() => setShowCreateView(false)}
                            className="px-6 py-3 rounded-xl bg-white/5 text-white text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                        >
                            Cancel
                        </button>
                        <button 
                            type="button"
                            onClick={handleSavePurchase}
                            disabled={submitting}
                            className="px-8 py-3 rounded-xl bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-amber-400/20 flex items-center gap-2"
                        >
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} strokeWidth={3} />}
                            Save Purchase
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
                    <div className="lg:col-span-3 space-y-5 sm:space-y-8">
                        <div className="warehouse-panel p-4 sm:p-6 lg:p-8 border-white/5 bg-slate-900/40 backdrop-blur-xl space-y-5 sm:space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
                                <div className="space-y-2 relative">
                                    <div className="flex items-center justify-between ml-1">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                            <User size={12} className="text-amber-500" />
                                            Select Vendor
                                        </label>
                                        {selectedVendor && (
                                            <button 
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    handleEditVendor();
                                                }}
                                                className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-400/10 text-amber-500 border border-amber-400/20 hover:bg-amber-400/20 transition-all group"
                                            >
                                                <Edit3 size={10} className="group-hover:rotate-12 transition-transform" />
                                                <span className="text-[9px] font-black uppercase tracking-widest">Edit Details</span>
                                            </button>
                                        )}
                                    </div>
                                    <div className="relative group">
                                        <input 
                                            type="text" 
                                            placeholder="Type vendor name..."
                                            value={vendorName}
                                            onChange={(e) => setVendorName(e.target.value)}
                                            className="w-full bg-slate-950 border border-white/5 rounded-xl py-3.5 px-4 text-sm font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                                        />
                                        {isSearchingVendor && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-500 animate-spin" size={14} />}
                                    </div>

                                    {(foundVendors.length > 0 || (vendorSearchAttempted && !isSearchingVendor && !selectedVendor)) && (
                                        <div className="absolute left-0 right-0 top-full mt-2 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-[60] animate-in fade-in slide-in-from-top-2 duration-200">
                                            {foundVendors.map(v => (
                                                <button
                                                    key={v.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedVendor(v);
                                                        setVendorName(v.name);
                                                        setFoundVendors([]);
                                                        setVendorSearchAttempted(false);
                                                    }}
                                                    className="w-full p-4 text-left hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors flex items-center justify-between group"
                                                >
                                                    <div className="text-xs font-black text-white uppercase tracking-tight">{v.name}</div>
                                                    <div className="text-[9px] font-black text-slate-600 uppercase group-hover:text-amber-500 transition-colors tracking-widest">Select Vendor</div>
                                                </button>
                                            ))}
                                            {vendorSearchAttempted && foundVendors.length === 0 && !selectedVendor && (
                                                <div className="p-2">
                                                    <button 
                                                        type="button"
                                                        onClick={handleQuickAddVendor}
                                                        className="w-full p-4 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-lg transition-all flex flex-col items-center gap-1 group"
                                                    >
                                                        <div className="text-[10px] font-black uppercase tracking-widest">Vendor not found!</div>
                                                        <div className="flex items-center gap-2">
                                                            <Plus size={14} strokeWidth={3} className="group-hover:rotate-90 transition-transform" />
                                                            <span className="text-[11px] font-black uppercase tracking-tighter">Add "{vendorName}" to Database</span>
                                                        </div>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                        <FileText size={12} className="text-amber-500" />
                                        Purchase Invoice #
                                    </label>
                                    <input 
                                        type="text" 
                                        value={invoiceNo}
                                        onChange={(e) => setInvoiceNo(e.target.value)}
                                        className="w-full bg-slate-950 border border-white/5 rounded-xl py-3.5 px-4 text-sm font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                        <Calendar size={12} className="text-amber-500" />
                                        Invoice Date
                                    </label>
                                    <input 
                                        type="date" 
                                        value={invoiceDate}
                                        onChange={(e) => setInvoiceDate(e.target.value)}
                                        className="w-full bg-slate-950 border border-white/5 rounded-xl py-3.5 px-4 text-sm font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Products & Items</h3>
                                    <div className="flex items-center gap-4 sm:gap-6">
                                        <input 
                                            type="file" 
                                            ref={fileInputRef} 
                                            onChange={handleFileChange} 
                                            className="hidden" 
                                            accept="image/*,application/pdf"
                                        />
                                        <button 
                                            type="button"
                                            onClick={handleScanClick}
                                            disabled={isScanning}
                                            className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                                                isScanning ? 'text-amber-500 animate-pulse' : 'text-slate-400 hover:text-amber-500'
                                            }`}
                                        >
                                            {isScanning ? <Loader2 size={14} className="animate-spin" /> : <Scan size={14} />}
                                            {isScanning ? 'AI Scanning...' : 'Scan Invoice'}
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={() => navigate('/warehouse/inventory', { state: { openAddProduct: true } })}
                                            className="text-[10px] font-black text-amber-500 uppercase tracking-widest hover:underline"
                                        >
                                            + Add New Product to Catalog
                                        </button>
                                    </div>
                                </div>

                                <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-950/50">
                                    <table className="w-full border-collapse">
                                        <thead>
                                            <tr className="border-b border-white/5">
                                                <th className="px-6 py-4 text-left text-[9px] font-black uppercase tracking-widest text-slate-500 w-16">Img</th>
                                                <th className="px-6 py-4 text-left text-[9px] font-black uppercase tracking-widest text-slate-500">Product Name</th>
                                                <th className="px-6 py-4 text-left text-[9px] font-black uppercase tracking-widest text-slate-500">Category</th>
                                                <th className="px-6 py-4 text-left text-[9px] font-black uppercase tracking-widest text-slate-500">Qty</th>
                                                <th className="px-6 py-4 text-left text-[9px] font-black uppercase tracking-widest text-slate-500">Purchase Price</th>
                                                <th className="px-6 py-4 text-left text-[9px] font-black uppercase tracking-widest text-slate-500">Selling Price</th>
                                                <th className="px-6 py-4 text-right text-[9px] font-black uppercase tracking-widest text-slate-500">Total</th>
                                                <th className="px-6 py-4 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {purchaseItems.map((item, index) => (
                                                <tr key={item.id} className="group">
                                                    <td className="px-6 py-4">
                                                        <div className="w-12 h-12 rounded-xl bg-slate-900 border border-white/5 flex items-center justify-center overflow-hidden shadow-lg group-hover:scale-105 transition-transform duration-300">
                                                            {(() => {
                                                                const imgData = item.product?.images;
                                                                if (!imgData) return <Package size={18} className="text-slate-700" />;
                                                                if (imgData.startsWith('http')) return <img src={imgData} alt="" className="w-full h-full object-cover" />;
                                                                try {
                                                                    const parsed = JSON.parse(imgData);
                                                                    if (Array.isArray(parsed) && parsed.length > 0) {
                                                                        const img = parsed[0];
                                                                        const src = img.startsWith('http') ? img : `${API_BASE_URL}/uploads/${img}`;
                                                                        return <img src={src} alt="" className="w-full h-full object-cover" />;
                                                                    }
                                                                } catch { /* invalid JSON — fall back to raw image */ }
                                                                return <img src={`${API_BASE_URL}/uploads/${imgData}`} alt="" className="w-full h-full object-cover" />;
                                                            })()}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 relative">
                                                        <div className="relative">
                                                            <input 
                                                                type="text" 
                                                                placeholder="Search product..."
                                                                value={item.searchQuery}
                                                                onChange={(e) => searchItemProduct(index, e.target.value)}
                                                                onKeyDown={(e) => handleItemKeyDown(e, index)}
                                                                className="w-full bg-slate-900 border border-white/5 rounded-lg py-2.5 px-3 text-xs font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                                                            />
                                                            {item.foundProducts.length > 0 && (
                                                                <div className="absolute left-0 top-full mt-2 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 max-h-64 overflow-y-auto min-w-[320px] w-max max-w-md animate-in slide-in-from-top-2 duration-200">
                                                                    {item.foundProducts.map((p, pIndex) => (
                                                                        <button
                                                                            key={p.id}
                                                                            type="button"
                                                                            onClick={() => selectProductForItem(index, p)}
                                                                            onMouseEnter={() => {
                                                                                const newItems = [...purchaseItems];
                                                                                newItems[index].highlightedIndex = pIndex;
                                                                                setPurchaseItems(newItems);
                                                                            }}
                                                                            className={`w-full flex items-center gap-4 p-4 transition-colors border-b border-white/5 last:border-0 text-left group ${
                                                                                item.highlightedIndex === pIndex ? 'bg-amber-400/10 border-amber-400/20' : 'hover:bg-white/5'
                                                                            }`}
                                                                        >
                                                                            <div className="w-12 h-12 rounded-lg bg-slate-950 flex items-center justify-center border border-white/5 overflow-hidden flex-shrink-0 group-hover:border-amber-400/30 transition-colors">
                                                                                {(() => {
                                                                                    const imgData = p.images;
                                                                                    if (!imgData) return <Package size={16} className="text-slate-600" />;
                                                                                    if (imgData.startsWith('http')) return <img src={imgData} alt="" className="w-full h-full object-cover" />;
                                                                                    try {
                                                                                        const parsed = JSON.parse(imgData);
                                                                                        if (Array.isArray(parsed) && parsed.length > 0) {
                                                                                            const img = parsed[0];
                                                                                            const src = img.startsWith('http') ? img : `${API_BASE_URL}/uploads/${img}`;
                                                                                            return <img src={src} alt="" className="w-full h-full object-cover" />;
                                                                                        }
                                                                                    } catch { /* invalid JSON — fall back to raw image */ }
                                                                                    return <img src={`${API_BASE_URL}/uploads/${imgData}`} alt="" className="w-full h-full object-cover" />;
                                                                                })()}
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className={`text-[11px] font-black uppercase tracking-tight transition-colors leading-tight mb-1 ${
                                                                                    item.highlightedIndex === pIndex ? 'text-amber-400' : 'text-white'
                                                                                }`}>{p.name}</div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">ID: #{p.id}</div>
                                                                                    {p.category && (
                                                                                        <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded-full">{p.category}</div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-right flex-shrink-0">
                                                                                <div className="text-[11px] font-black text-white">₹{p.price}</div>
                                                                                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Current MRP</div>
                                                                            </div>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {item.product?.category ? (
                                                            <div className="wh-badge-category">
                                                                <Filter size={10} />
                                                                <span>{item.product.category}</span>
                                                            </div>
                                                        ) : item.product ? (
                                                            <button 
                                                                onClick={() => {
                                                                    setActiveItemForCategory(item.product);
                                                                    setShowCategoryModal(true);
                                                                }}
                                                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 hover:bg-rose-500/20 transition-all animate-pulse"
                                                            >
                                                                <AlertCircle size={10} />
                                                                <span className="text-[9px] font-black uppercase tracking-widest">Add Category</span>
                                                            </button>
                                                        ) : (
                                                            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest italic">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <input 
                                                            type="number" 
                                                            value={item.quantity}
                                                            onChange={(e) => updateItemValue(index, 'quantity', e.target.value)}
                                                            className="w-20 bg-slate-900 border border-white/5 rounded-lg py-2.5 px-3 text-xs font-bold text-white text-center focus:outline-none focus:border-amber-400/50 transition-all"
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]">₹</span>
                                                            <input 
                                                                type="number" 
                                                                value={item.unitPrice}
                                                                onChange={(e) => updateItemValue(index, 'unitPrice', e.target.value)}
                                                                className="w-28 bg-slate-900 border border-white/5 rounded-lg py-2.5 pl-6 pr-3 text-xs font-bold text-white focus:outline-none focus:border-amber-400/50 transition-all"
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]">₹</span>
                                                            <input 
                                                                type="number" 
                                                                value={item.sellingPrice}
                                                                onChange={(e) => updateItemValue(index, 'sellingPrice', e.target.value)}
                                                                className="w-28 bg-slate-900 border border-white/5 rounded-lg py-2.5 pl-6 pr-3 text-xs font-bold text-amber-500 focus:outline-none focus:border-emerald-500/50 transition-all"
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <span className="text-xs font-black text-white uppercase tracking-tight">
                                                            ₹{(parseFloat(item.unitPrice || 0) * parseInt(item.quantity || 0)).toLocaleString()}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <button 
                                                            type="button"
                                                            onClick={() => removeRow(index)}
                                                            className="p-2 text-slate-600 hover:text-rose-500 transition-colors"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <button 
                                        type="button"
                                        onClick={addRow}
                                        className="w-full py-4 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-amber-500 hover:bg-white/5 transition-all border-t border-white/5"
                                    >
                                        + Add Another Item
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="warehouse-panel p-4 sm:p-6 lg:p-8 border-white/5 bg-slate-900/40 backdrop-blur-xl">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Additional Reference / Notes</label>
                                <textarea 
                                    rows="3"
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    placeholder="Enter PO number, payment terms, or internal notes..."
                                    className="w-full bg-slate-950 border border-white/5 rounded-2xl p-6 text-sm font-medium text-white focus:outline-none focus:border-amber-400/50 transition-all placeholder:text-slate-700"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="lg:col-span-1 space-y-4 sm:space-y-6">
                        <div className="warehouse-panel p-4 sm:p-6 lg:p-8 border-white/5 bg-slate-900/60 backdrop-blur-xl sticky top-8">
                            <h3 className="text-xs font-black text-amber-500 uppercase tracking-[0.2em] mb-5 sm:mb-8">Purchase Summary</h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between text-white">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Items</span>
                                    <span className="text-sm font-black">{purchaseItems.filter(i => i.product).length}</span>
                                </div>
                                <div className="flex items-center justify-between text-white">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Subtotal</span>
                                    <span className="text-sm font-black">₹{calculateSubtotal().toLocaleString()}</span>
                                </div>
                                <div className="h-px bg-white/5 my-6" />
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Amount</span>
                                    <span className="text-4xl font-black text-white tracking-tighter leading-none">₹{calculateSubtotal().toLocaleString()}</span>
                                </div>
                                <button 
                                    type="button"
                                    onClick={handleSavePurchase}
                                    disabled={submitting}
                                    className="w-full mt-5 sm:mt-8 py-5 rounded-2xl bg-amber-400 text-slate-950 text-sm font-black uppercase tracking-[0.3em] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-30 disabled:grayscale shadow-2xl shadow-amber-400/20 flex items-center justify-center gap-3"
                                >
                                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <TrendingUp size={16} strokeWidth={3} />}
                                    Confirm Purchase
                                </button>
                                <p className="text-[9px] font-bold text-slate-500 uppercase text-center mt-4 italic">Inventory will update automatically</p>
                            </div>
                        </div>
                    </div>
                </div>
                <VendorModal 
                    show={showAddVendorModal}
                    onClose={() => setShowAddVendorModal(false)}
                    isEditing={isEditingVendor}
                    formData={vendorForm}
                    setFormData={setVendorForm}
                    onSave={handleSaveVendor}
                    submitting={submitting}
                />
                <CategoryModal 
                    show={showCategoryModal}
                    onClose={() => setShowCategoryModal(false)}
                    product={activeItemForCategory}
                    categories={categories}
                    onSave={handleUpdateCategory}
                    submitting={submitting}
                />
            </div>
        )
    }

    return (
        <div className="space-y-5 sm:space-y-8 animate-in fade-in duration-700 relative min-h-screen pb-20">
            {notification && (
                <div className={`fixed top-24 right-8 z-[110] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl animate-in slide-in-from-right-8 fade-in border ${
                    notification.type === 'error' 
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-200' 
                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                }`}>
                    {notification.type === 'error' ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
                    <span className="font-bold text-sm uppercase tracking-wide">{notification.message}</span>
                </div>
            )}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-6">
                <div>
                    <h1 className="text-4xl font-black text-white tracking-tight flex items-center gap-4">
                        <ShoppingBag className="text-amber-500" size={36} />
                        Direct Purchases
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium">Record and manage material inventory purchases from vendors.</p>
                </div>
                <button 
                    type="button"
                    onClick={() => setShowCreateView(true)}
                    className="flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-amber-400 text-slate-950 text-sm font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-amber-400/20"
                >
                    <Plus size={20} strokeWidth={3} />
                    Create Purchase
                </button>
            </div>

            <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl overflow-hidden flex flex-col">
                <div className="p-4 sm:p-6 border-b border-white/5 flex items-center justify-between">
                    <h3 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                        <Layers size={20} className="text-amber-500" />
                        Purchase History
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/5 bg-slate-950/20">
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Invoice Info</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Vendor / Supplier</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 text-center">Items</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Total Amount</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Status</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 text-right">Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {purchases.length > 0 ? purchases.map((p) => (
                                <tr key={p.id} className="hover:bg-white/[0.02] transition-colors group">
                                    <td className="px-8 py-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center border border-white/5">
                                                <FileText size={16} className="text-amber-500" />
                                            </div>
                                            <div>
                                                <div className="text-sm font-black text-white uppercase tracking-tight">{p.invoice_no}</div>
                                                <div className="text-[9px] font-bold text-slate-500 uppercase">ID: #{p.id}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6">
                                        <div className="flex items-center gap-2">
                                            <User size={12} className="text-slate-500" />
                                            <span className="text-xs font-black text-white uppercase">{p.vendor_name}</span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-center">
                                        <span className="px-3 py-1 rounded-lg bg-white/5 text-[11px] font-black text-white">{p.item_count} Items</span>
                                    </td>
                                    <td className="px-8 py-6">
                                        <span className="text-sm font-black text-white">₹{p.total_amount.toLocaleString()}</span>
                                    </td>
                                    <td className="px-8 py-6">
                                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                                            <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                            {p.status}
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <span className="text-[11px] font-black text-slate-500 uppercase">
                                            {new Date(p.invoice_date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </span>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="6" className="px-4 sm:px-6 py-16 sm:py-32 text-center">
                                        <div className="flex flex-col items-center gap-4 sm:gap-6 opacity-20">
                                            <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center">
                                                <ShoppingBag size={48} className="text-slate-500" />
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm font-black uppercase tracking-[0.2em] text-white">No Purchase Records</p>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Start by creating your first direct purchase</p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            <VendorModal 
                show={showAddVendorModal}
                onClose={() => setShowAddVendorModal(false)}
                isEditing={isEditingVendor}
                formData={vendorForm}
                setFormData={setVendorForm}
                onSave={handleSaveVendor}
                submitting={submitting}
            />
            <CategoryModal 
                show={showCategoryModal}
                onClose={() => setShowCategoryModal(false)}
                product={activeItemForCategory}
                categories={categories}
                onSave={handleUpdateCategory}
                submitting={submitting}
            />
        </div>
    )
}

export default WarehouseProcurement
