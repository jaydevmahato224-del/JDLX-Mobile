import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
    Package,
    Search,
    Filter,
    ArrowUpDown,
    AlertCircle,
    Plus,
    Edit2,
    Trash2,
    CheckCircle2,
    XCircle,
    ChevronRight,
    Loader2,
    MapPin,
    X,
    FileText,
    Barcode,
    Layers,
    Tag,
    RefreshCw,
    Warehouse,
    Truck,
    DollarSign,
    Percent,
    Shield,
    Calendar,
    Zap,
    Scale,
    Maximize,
    Thermometer,
    Info,
    Upload,
    ArrowDownCircle,
    ArrowUpCircle,
    History,
    TrendingUp,
    TrendingDown,
    Star,
    MessageSquare,
    Eye,
    ShoppingCart,
    CreditCard,
    Heart
} from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { useStore } from '../../store/useStore'

const INITIAL_PRODUCT_STATE = {
    product_id: '', name: '', description: '', price: '', cost_price: 0, mrp: '', discount_pct: 0, discount_amt: 0, gst_pct: null, apply_gst: false, category: '', category_id: '', sub_category: '', sku: '', barcode: '', stock_quantity: 0, unit: 'pcs', low_stock_threshold: 2, bin_location: '', rack_no: '', shelf_no: '', bin_id: '', images: [], weight: '', dimensions: '', is_fragile: false, is_temp_sensitive: false, supplier_name: '', contact_info: '', purchase_date: '', is_active: true, is_visible: true, is_perishable: false, expiry_date: '', brand: '', delivery_time: '10-30 mins', units_per_pack: '', material_type: '', is_featured: false, return_policy: '', has_variants: false, variants: [], recommendation_priority: 0, recommendation_weight: 1.0, recommendations: { related: [], upsell: [], cross_sell: [], frequent: [] }, content: { overview: '', highlights: [], specifications: {}, compatibility: '', box_contents: '', warranty_info: '', usage_instructions: '' }, badges: [], fulfillment: { package_weight: 0, length: 0, width: 0, height: 0, shipping_tier: 'standard', dispatch_sla: 24, is_cod_eligible: true, is_fragile: false, is_express_eligible: true, return_window: 7 }, lifecycle_state: 'live', discovery: { meta_title: '', meta_description: '', search_keywords: [], product_tags: [], search_synonyms: [] }, analytics: { view_count: 0, cart_add_count: 0, purchase_count: 0, wishlist_count: 0, conversion_rate: 0 }
};

const WarehouseInventory = () => {
    const location = useLocation()
    const { warehouseToken, warehouseLogout } = useStore()
    const [inventory, setInventory] = useState([])

    const handleToggleFeatured = async (item) => {
        try {
            const isFeatured = (item.is_featured === 1 || item.is_featured === true)
            const newStatus = !isFeatured
            const response = await fetch(`${API_BASE_URL}/warehouse/inventory/${item.id}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ is_featured: newStatus ? 1 : 0 })
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Failed to update status')

            setInventory(prev => prev.map(inv =>
                inv.id === item.id ? { ...inv, is_featured: newStatus ? 1 : 0 } : inv
            ))
            showNotification(`Product ${newStatus ? 'marked as featured' : 'removed from featured'}`)
        } catch (err) {
            showNotification(err.message, 'error')
        }
    }
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState('all') // all, low, out
    const [lifecycleFilter, setLifecycleFilter] = useState('all') // all, draft, testing, live, archived, discontinued, coming_soon
    const [updatingId, setUpdatingId] = useState(null)
    const [error, setError] = useState('')
    const [notification, setNotification] = useState(null)

    // Stock IN/OUT Modal State
    const [stockAdjustModal, setStockAdjustModal] = useState(null) // { item, mode: 'IN'|'OUT' }
    const [selectedItem, setSelectedItem] = useState(null) // For detail panel
    const [adjustQty, setAdjustQty] = useState(1)
    const [adjustReason, setAdjustReason] = useState('')
    const [adjustRemark, setAdjustRemark] = useState('')
    const [adjusting, setAdjusting] = useState(false)
    const [showHistory, setShowHistory] = useState(null) // inventory item
    const [movements, setMovements] = useState([])
    const [loadingMovements, setLoadingMovements] = useState(false)

    // Product Reviews State for Detail Panel
    const [itemReviews, setItemReviews] = useState([]);
    const [itemStats, setItemStats] = useState({ total: 0, average: 0, distribution: {} });
    const [loadingReviews, setLoadingReviews] = useState(false);

    const fetchItemReviews = useCallback(async (productId) => {
        if (!productId) return;
        setLoadingReviews(true);
        try {
            const res = await fetch(`${API_BASE_URL}/review/product/${productId}`);
            const data = await res.json();
            if (res.ok) {
                setItemReviews(data.reviews || []);
                setItemStats(data.stats || { total: 0, average: 0, distribution: {} });
            }
        } catch (error) {
            console.error('Failed to fetch item reviews:', error);
        } finally {
            setLoadingReviews(false);
        }
    }, []);

    useEffect(() => {
        if (selectedItem?.product_id) {
            fetchItemReviews(selectedItem.product_id);
        } else {
            setItemReviews([]);
            setItemStats({ total: 0, average: 0, distribution: {} });
        }
    }, [selectedItem?.product_id, fetchItemReviews]);

    const IN_REASONS = [
        'New Purchase / Restock',
        'Customer Return',
        'Transfer from Another Warehouse',
        'Vendor Replacement',
        'Opening Stock Entry',
        'Other'
    ]
    const OUT_REASONS = [
        'Damaged Product',
        'Wasted / Spoiled',
        'Expired Product',
        'Lost / Theft',
        'Returned to Supplier',
        'Manual Adjustment',
        'Other'
    ]

    // Add Product View State (Unify New & Existing)
    const [showAddProductView, setShowAddProductView] = useState(false)
    const [editingItemId, setEditingItemId] = useState(null)
    const [newProductData, setNewProductData] = useState(INITIAL_PRODUCT_STATE)

    const [productSearch, setProductSearch] = useState('')
    const [foundProducts, setFoundProducts] = useState([])
    const [isSearchingProducts, setIsSearchingProducts] = useState(false)
    const [categories, setCategories] = useState([])
    const [selectedCategoryId, setSelectedCategoryId] = useState(null)
    const [hasSubCategory, setHasSubCategory] = useState(false)
    const [showLocationMapping, setShowLocationMapping] = useState(false)
    const [showLogistics, setShowLogistics] = useState(false)
    const [recSearchTarget, setRecSearchTarget] = useState(null) // { type, rect }
    const [isWarehouseImageUploading, setIsWarehouseImageUploading] = useState(false)
    const fileInputRef = useRef(null)

    // Create Category Modal
    const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false)
    const [newCategoryName, setNewCategoryName] = useState('')
    const [newCategoryEmoji, setNewCategoryEmoji] = useState('📦')
    const [isCreatingCategory, setIsCreatingCategory] = useState(false)

    // Brands Management
    const [brands, setBrands] = useState([])
    const [showCreateBrandModal, setShowCreateBrandModal] = useState(false)
    const [newBrandName, setNewBrandName] = useState('')
    const [isCreatingBrand, setIsCreatingBrand] = useState(false)

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type })
        setTimeout(() => setNotification(null), 3000)
    }

    const fetchInventory = useCallback(async () => {
        if (!warehouseToken) return
        setLoading(true)
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/inventory`, {
                headers: { Authorization: `Bearer ${warehouseToken}` }
            })
            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                return
            }
            if (!response.ok) throw new Error('Failed to fetch inventory')
            const data = await response.json()
            setInventory(data)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [warehouseToken, warehouseLogout])

    useEffect(() => {
        fetchInventory()
    }, [fetchInventory])

    const fetchCategories = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/categories`)
            const data = await res.json()
            if (data.success) {
                setCategories(data.data)
            }
        } catch (err) {
            console.error('Failed to fetch categories:', err)
        }
    }, [])

    useEffect(() => {
        fetchCategories()
    }, [fetchCategories])

    const fetchBrands = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/brands`)
            const data = await res.json()
            if (data.success) {
                setBrands(data.data)
            }
        } catch (err) {
            console.error('Failed to fetch brands:', err)
        }
    }, [])

    useEffect(() => {
        fetchBrands()
    }, [fetchBrands])

    const handleCreateBrand = async () => {
        if (!newBrandName.trim()) {
            showNotification('Brand name is required', 'error')
            return
        }
        setIsCreatingBrand(true)
        try {
            const res = await fetch(`${API_BASE_URL}/brands`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: newBrandName.trim() })
            })
            const result = await res.json()
            if (!res.ok) throw new Error(result.message || result.error || 'Failed to create brand')

            // Select the new brand immediately
            setNewProductData(prev => ({
                ...prev,
                brand: result.data.name
            }))

            // Refresh brands list
            await fetchBrands()
            setShowCreateBrandModal(false)
            setNewBrandName('')
            showNotification(`Brand "${result.data.name}" created & selected!`)
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setIsCreatingBrand(false)
        }
    }

    const handleCreateCategory = async () => {
        if (!newCategoryName.trim()) {
            showNotification('Category name is required', 'error')
            return
        }
        setIsCreatingCategory(true)
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/categories`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: newCategoryName.trim(), emoji: newCategoryEmoji })
            })
            const result = await res.json()
            if (!res.ok) throw new Error(result.message || result.error || 'Failed to create category')
            // Select the new category immediately
            setNewProductData(prev => ({
                ...prev,
                category_id: result.data.id,
                category: result.data.name
            }))
            // Refresh categories list
            await fetchCategories()
            setShowCreateCategoryModal(false)
            setNewCategoryName('')
            setNewCategoryEmoji('📦')
            showNotification(`Category "${result.data.name}" created & selected!`)
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setIsCreatingCategory(false)
        }
    }

    // Handle navigation from Procurement with pre-fill data
    useEffect(() => {
        if (location.state?.openAddProduct) {
            setShowAddProductView(true)
            if (location.state.productName) {
                setNewProductData(prev => ({
                    ...prev,
                    name: location.state.productName
                }))
                // Also set the catalog search to the same name
                setProductSearch(location.state.productName)
            }
            // Clear location state to prevent re-opening on manual refresh
            window.history.replaceState({}, document.title)
        }
    }, [location.state])

    // Global Catalog Search with Debounce
    useEffect(() => {
        if (!productSearch.trim() && !selectedCategoryId) {
            setFoundProducts([])
            return
        }

        const timer = setTimeout(async () => {
            setIsSearchingProducts(true)
            try {
                const params = new URLSearchParams()
                if (productSearch.trim()) params.append('q', productSearch.trim())
                if (selectedCategoryId) params.append('category_id', selectedCategoryId)

                const response = await fetch(`${API_BASE_URL}/products/search?${params.toString()}`)
                if (!response.ok) throw new Error('Search failed')
                const data = await response.json()
                setFoundProducts(data)
            } catch (err) {
                console.error('Catalog search error:', err)
                setFoundProducts([])
            } finally {
                setIsSearchingProducts(false)
            }
        }, 500)

        return () => clearTimeout(timer)
    }, [productSearch, selectedCategoryId])

    const handleUpdateStock = async (id, newQuantity) => {
        if (!warehouseToken) return
        setUpdatingId(id)
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/inventory/${id}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ stock_quantity: newQuantity })
            })
            if (!response.ok) throw new Error('Failed to update stock')
            showNotification('Stock updated successfully')
            await fetchInventory()
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setUpdatingId(null)
        }
    }

    const openStockAdjust = (item, mode) => {
        setStockAdjustModal({ item, mode })
        setAdjustQty(1)
        setAdjustReason(mode === 'IN' ? IN_REASONS[0] : OUT_REASONS[0])
        setAdjustRemark('')
    }

    const handleStockAdjust = async () => {
        if (!warehouseToken || !stockAdjustModal) return
        if (!adjustReason) { showNotification('Please select a reason', 'error'); return }
        if (adjustQty < 1) { showNotification('Quantity must be at least 1', 'error'); return }
        const available = Math.max(0, stockAdjustModal.item.stock_quantity - (stockAdjustModal.item.reserved_stock || 0));
        if (stockAdjustModal.mode === 'OUT' && adjustQty > available) {
            showNotification(`Cannot remove more than available stock (${available})`, 'error');
            return;
        }
        setAdjusting(true)
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/inventory/${stockAdjustModal.item.id}/adjust`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${warehouseToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    movement_type: stockAdjustModal.mode,
                    quantity: adjustQty,
                    reason: adjustReason,
                    remark: adjustRemark
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.message || 'Adjustment failed')
            showNotification(`Stock ${stockAdjustModal.mode === 'IN' ? 'added' : 'removed'} successfully`)
            setStockAdjustModal(null)
            await fetchInventory()
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setAdjusting(false)
        }
    }

    const loadMovements = async (item) => {
        setShowHistory(item)
        setLoadingMovements(true)
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/inventory/${item.id}/movements`, {
                headers: { Authorization: `Bearer ${warehouseToken}` }
            })
            const data = await res.json()
            setMovements(data.data || [])
        } catch {
            setMovements([])
        } finally {
            setLoadingMovements(false)
        }
    }

    const handleEditItem = async (item) => {
        setEditingItemId(item.id);
        let parsedImages = [];
        if (item.images) {
            if (Array.isArray(item.images)) {
                parsedImages = item.images;
            } else if (typeof item.images === 'string') {
                try {
                    const parsed = JSON.parse(item.images);
                    parsedImages = Array.isArray(parsed) ? parsed : [item.images];
                } catch (e) {
                    parsedImages = [item.images];
                }
            }
        }

        // Initialize state with basic info from list
        setNewProductData(prev => ({
            ...prev,
            product_id: item.product_id || '',
            name: item.product_name || '',
            sku: item.sku || '',
            stock_quantity: item.stock_quantity || 0,
            low_stock_threshold: item.low_stock_threshold || 2,
            bin_location: item.bin_location || '',
            unit: item.unit || 'pcs',
            cost_price: item.cost_price || 0,
            price: item.selling_price || item.global_price || 0,
            mrp: item.mrp || 0,
            discount_pct: item.discount_pct || 0,
            discount_amt: item.discount_amt || 0,
            gst_pct: item.gst_pct,
            apply_gst: item.gst_pct !== null && item.gst_pct !== undefined,
            brand: item.global_brand || item.local_brand || '',
            category: item.category || '',
            category_id: item.category_id || '',
            sub_category: item.sub_category || '',
            description: item.description || '',
            units_per_pack: item.units_per_pack || '',
            material_type: item.material_type || '',
            weight: item.weight || '',
            dimensions: item.dimensions || '',
            is_fragile: !!item.is_fragile,
            is_temp_sensitive: !!item.is_temp_sensitive,
            is_perishable: !!item.is_perishable,
            expiry_date: item.expiry_date || '',
            is_featured: !!item.is_featured,
            material: item.material_type || '',
            images: parsedImages,
            return_policy: item.return_policy || '',
            lifecycle_state: item.lifecycle_state || 'live',
            discovery: {
                meta_title: '',
                meta_description: '',
                search_keywords: [],
                product_tags: [],
                search_synonyms: []
            },
            analytics: {
                view_count: 0,
                cart_add_count: 0,
                purchase_count: 0,
                wishlist_count: 0,
                conversion_rate: 0
            },
            recommendation_priority: item.recommendation_priority || 0,
            recommendation_weight: item.recommendation_weight || 1.0,
            recommendations: {
                related: [],
                upsell: [],
                cross_sell: [],
                frequent: []
            },
            content: {
                overview: '',
                highlights: [],
                specifications: {},
                compatibility: '',
                box_contents: '',
                warranty_info: '',
                usage_instructions: ''
            },
            badges: [],
            fulfillment: {
                package_weight: 0,
                length: 0,
                width: 0,
                height: 0,
                shipping_tier: 'standard',
                dispatch_sla: 24,
                is_cod_eligible: true,
                is_fragile: false,
                is_express_eligible: true,
                return_window: 7
            }
        }));

        // Fetch deep metadata (like recommendations, content, badges & fulfillment) if product_id exists
        if (item.product_id) {
            try {
                const res = await fetch(`${API_BASE_URL}/products/${item.product_id}`);
                const data = await res.json();
                if (res.ok) {
                    const controls = data.data?.recommendation_controls;
                    const content = data.data?.content;
                    const badges = data.data?.badges;
                    const fulfillment = data.data?.fulfillment;
                    const discovery = data.data?.discovery;
                    const analytics = data.data?.analytics;

                    setNewProductData(prev => ({
                        ...prev,
                        recommendations: controls ? {
                            related: controls.related?.map(r => r.id) || [],
                            upsell: controls.upsell?.map(r => r.id) || [],
                            cross_sell: controls.cross_sell?.map(r => r.id) || [],
                            frequent: controls.frequent?.map(r => r.id) || []
                        } : prev.recommendations,
                        content: content ? {
                            overview: content.overview || '',
                            highlights: content.highlights || [],
                            specifications: content.specifications || {},
                            compatibility: content.compatibility || '',
                            box_contents: content.box_contents || '',
                            warranty_info: content.warranty_info || '',
                            usage_instructions: content.usage_instructions || ''
                        } : prev.content,
                        badges: badges ? badges.map(b => ({
                            type: b.badge_type,
                            priority: b.priority,
                            is_active: true
                        })) : prev.badges,
                        fulfillment: fulfillment ? {
                            package_weight: fulfillment.package_weight || 0,
                            length: fulfillment.length || 0,
                            width: fulfillment.width || 0,
                            height: fulfillment.height || 0,
                            shipping_tier: fulfillment.shipping_tier || 'standard',
                            dispatch_sla: fulfillment.dispatch_sla || 24,
                            is_cod_eligible: !!fulfillment.is_cod_eligible,
                            is_fragile: !!fulfillment.is_fragile,
                            is_express_eligible: !!fulfillment.is_express_eligible,
                            return_window: fulfillment.return_window || 7
                        } : prev.fulfillment,
                        discovery: discovery ? {
                            meta_title: discovery.meta_title || '',
                            meta_description: discovery.meta_description || '',
                            search_keywords: discovery.search_keywords || [],
                            product_tags: discovery.product_tags || [],
                            search_synonyms: discovery.search_synonyms || []
                        } : prev.discovery,
                        analytics: analytics ? {
                            view_count: analytics.view_count || 0,
                            cart_add_count: analytics.cart_add_count || 0,
                            purchase_count: analytics.purchase_count || 0,
                            wishlist_count: analytics.wishlist_count || 0,
                            conversion_rate: analytics.conversion_rate || 0
                        } : prev.analytics
                    }));
                }
            } catch (err) {
                console.error("Failed to fetch extended product data:", err);
            }
        }

        setShowAddProductView(true);
    }

    const handleDeleteItem = async (id) => {
        if (!warehouseToken) return
        if (!window.confirm('Are you sure you want to remove this SKU?')) return

        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/inventory/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${warehouseToken}` }
            })
            if (!response.ok) throw new Error('Failed to delete SKU')
            showNotification('SKU removed from inventory')
            await fetchInventory()
        } catch (err) {
            showNotification(err.message, 'error')
        }
    }

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        if (!warehouseToken) return;

        if (newProductData.images.length + files.length > 10) {
            showNotification('Maximum 10 images allowed', 'error');
            return;
        }

        setIsWarehouseImageUploading(true);
        const uploadedUrls = [];

        try {
            for (const file of files) {
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch(`${API_BASE_URL}/warehouse/upload`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${warehouseToken}`
                    },
                    body: formData
                });

                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Upload failed');

                uploadedUrls.push(result.data.url);
            }

            setNewProductData(prev => ({ ...prev, images: [...prev.images, ...uploadedUrls] }));
            showNotification(`${uploadedUrls.length} image(s) uploaded successfully`);
        } catch (err) {
            showNotification(err.message, 'error');
        } finally {
            setIsWarehouseImageUploading(false);
            if (e.target) e.target.value = '';
        }
    }

    const generateRandomSku = () => {
        const randomNum = Math.floor(100000 + Math.random() * 900000)
        setNewProductData(prev => ({ ...prev, sku: randomNum.toString() }))
    }

    const handleAddProduct = async (e) => {
        e.preventDefault()
        if (!warehouseToken) return

        // Frontend Validation for Barcode format (Optional but must be 13 digits if provided)
        if (newProductData.barcode && (newProductData.barcode.length < 8 || newProductData.barcode.length > 14)) {
            showNotification('Barcode must be between 8 and 14 digits if provided', 'error')
            return
        }

        // Image Validation: Minimum 3 images required
        if (newProductData.images.length < 3) {
            showNotification('A minimum of 3 product images are required.', 'error')
            return
        }

        try {
            let endpoint = '';
            let method = 'POST';

            if (editingItemId) {
                endpoint = `${API_BASE_URL}/warehouse/inventory/${editingItemId}`;
                method = 'PATCH';
            } else {
                // Determine endpoint based on whether we selected an existing product
                endpoint = newProductData.product_id
                    ? `${API_BASE_URL}/warehouse/inventory` // Register existing catalog product
                    : `${API_BASE_URL}/warehouse/products`  // Create & Register brand new product
            }

            let finalDescription = newProductData.description;
            if (newProductData.units_per_pack || newProductData.material) {
                const parts = [];
                if (newProductData.units_per_pack) parts.push(`Unit per pack - ${newProductData.units_per_pack}`);
                if (newProductData.material) parts.push(`Material - ${newProductData.material}`);

                const detailsStr = parts.join('\n');
                if (!finalDescription.includes(parts[0])) {
                    finalDescription = finalDescription ? `${finalDescription}\n\n${detailsStr}` : detailsStr;
                }
            }

            const payload = {
                ...newProductData,
                description: finalDescription,
                category_id: parseInt(newProductData.category_id) || null,
                stock_quantity: parseInt(newProductData.stock_quantity) || 0,
                low_stock_threshold: parseInt(newProductData.low_stock_threshold) || 2,
                cost_price: parseFloat(newProductData.cost_price) || 0,
                selling_price: parseFloat(newProductData.price) || 0,
                price: parseFloat(newProductData.price) || 0,
                mrp: parseFloat(newProductData.mrp) || 0,
                discount_pct: parseFloat(newProductData.discount_pct) || 0,
                discount_amt: parseFloat(newProductData.discount_amt) || 0,
                gst_pct: newProductData.apply_gst ? (parseFloat(newProductData.gst_pct) || 0) : null,
                brand: newProductData.brand,
                units_per_pack: newProductData.units_per_pack,
                material_type: newProductData.material_type,
                weight: newProductData.weight,
                dimensions: newProductData.dimensions,
                is_fragile: newProductData.is_fragile ? 1 : 0,
                is_temp_sensitive: newProductData.is_temp_sensitive ? 1 : 0,
                is_perishable: newProductData.is_perishable ? 1 : 0,
                expiry_date: newProductData.expiry_date,
                is_featured: newProductData.is_featured ? 1 : 0,
                has_variants: newProductData.has_variants,
                variants: newProductData.variants.map(v => ({
                    ...v,
                    price: parseFloat(v.price) || 0,
                    stock_quantity: parseInt(v.stock_quantity) || 0
                })),
                recommendation_priority: parseInt(newProductData.recommendation_priority) || 0,
                recommendation_weight: parseFloat(newProductData.recommendation_weight) || 1.0,
                recommendations: newProductData.recommendations,
                content: newProductData.content,
                badges: newProductData.badges,
                lifecycle_state: newProductData.lifecycle_state,
                discovery: newProductData.discovery,
                fulfillment: {
                    ...newProductData.fulfillment,
                    package_weight: parseFloat(newProductData.fulfillment.package_weight) || 0,
                    length: parseFloat(newProductData.fulfillment.length) || 0,
                    width: parseFloat(newProductData.fulfillment.width) || 0,
                    height: parseFloat(newProductData.fulfillment.height) || 0,
                    dispatch_sla: parseInt(newProductData.fulfillment.dispatch_sla) || 24,
                    return_window: parseInt(newProductData.fulfillment.return_window) || 7
                }
            }

            const response = await fetch(endpoint, {
                method: method,
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })

            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Operation failed')

            showNotification(editingItemId ? 'Product updated successfully' : 'Product added successfully')
            setShowAddProductView(false)
            setEditingItemId(null)
            setNewProductData(INITIAL_PRODUCT_STATE)
            setProductSearch('')
            setFoundProducts([])
            setSelectedCategoryId(null)
            setHasSubCategory(false)
            setShowLocationMapping(false)
            setShowLogistics(false)
            showNotification(newProductData.product_id ? 'SKU linked successfully' : 'Product created and linked')
            await fetchInventory()
        } catch (err) {
            showNotification(err.message, 'error')
        }
    }

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && showAddProductView) {
                setShowAddProductView(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [showAddProductView])

    const uniqueSubCategories = Array.from(new Set(inventory.map(item => item.sub_category).filter(Boolean)));
    const filteredInventory = inventory.filter(item => {
        const matchesSearch = (item.product_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.sku || "").toLowerCase().includes(searchQuery.toLowerCase())

        const matchesLifecycle = lifecycleFilter === 'all' || item.lifecycle_state === lifecycleFilter

        if (!matchesSearch || !matchesLifecycle) return false

        const threshold = item.low_stock_threshold || 5;
        if (filterStatus === 'low') return (item.stock_quantity <= threshold) && item.stock_quantity > 0
        if (filterStatus === 'out') return item.stock_quantity === 0
        if (filterStatus === 'featured') return (item.is_featured === 1 || item.is_featured === true)
        return true
    })
    const stats = {
        totalItems: inventory.length,
        lowStock: inventory.filter(i => i.stock_quantity <= (i.low_stock_threshold || 5) && i.stock_quantity > 0).length,
        outOfStock: inventory.filter(i => i.stock_quantity === 0).length,
        featured: inventory.filter(i => i.is_featured === 1 || i.is_featured === true).length,
        totalUnits: inventory.reduce((acc, curr) => acc + (curr.stock_quantity || 0), 0)
    }

    if (loading && inventory.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium">Loading inventory engine...</p>
            </div>
        )
    }

    const mainUI = (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Notification Toast */}
            {notification && (
                <div className={`fixed top-24 right-8 z-[110] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl animate-in slide-in-from-right-8 fade-in border ${notification.type === 'error'
                        ? 'bg-rose-500/10 border-rose-500/20 text-rose-200'
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                    }`}>
                    {notification.type === 'error' ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
                    <span className="font-bold text-sm uppercase tracking-wide">{notification.message}</span>
                </div>
            )}

            {showAddProductView ? (
                <div className="space-y-8 animate-in slide-in-from-bottom-8 duration-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <button
                                onClick={() => {
                                    setShowAddProductView(false);
                                    setEditingItemId(null);
                                    setNewProductData(INITIAL_PRODUCT_STATE)
                                }}
                                className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors mb-4 group"
                            >
                                <ChevronRight size={18} className="rotate-180 transition-transform group-hover:-translate-x-1" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Back to Inventory</span>
                            </button>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-amber-400/10 text-amber-500 rounded-xl">
                                    <Package size={20} />
                                </div>
                                <div>
                                    <h2 className="text-4xl font-black text-white tracking-tight">{editingItemId ? 'Edit Product' : 'Register Product'}</h2>
                                    <p className="text-slate-400 mt-2 font-medium">{editingItemId ? 'Update product details' : 'Search global catalog or create a brand new product.'}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Unified Search Section */}
                    {!editingItemId && (
                        <div className="warehouse-panel p-8 border-amber-400/20 bg-amber-400/[0.02]">
                            <div className="space-y-6">
                                <div className="flex items-center gap-4">
                                    <div className="h-px flex-1 bg-gradient-to-r from-amber-400/20 to-transparent" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500/80">Search Global Catalog</span>
                                    <div className="h-px flex-1 bg-gradient-to-l from-amber-400/20 to-transparent" />
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                                        {categories.map(cat => (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setSelectedCategoryId(selectedCategoryId === cat.id ? null : cat.id)}
                                                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${selectedCategoryId === cat.id
                                                        ? 'bg-amber-400 text-slate-950 border-amber-400 shadow-lg shadow-amber-400/20'
                                                        : 'bg-white/5 text-slate-400 border-white/5 hover:border-white/10'
                                                    }`}
                                            >
                                                {cat.emoji} &nbsp; {cat.name}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="relative group">
                                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-amber-400 transition-colors" size={20} />
                                        <input
                                            type="text"
                                            placeholder="Start typing product name to search catalog..."
                                            value={productSearch}
                                            onChange={(e) => setProductSearch(e.target.value)}
                                            className="w-full bg-slate-950 border border-white/5 rounded-[20px] py-5 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all shadow-inner"
                                        />
                                        {isSearchingProducts && (
                                            <Loader2 className="absolute right-6 top-1/2 -translate-y-1/2 text-amber-500 animate-spin" size={20} />
                                        )}
                                    </div>

                                    {foundProducts.length > 0 && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
                                            {foundProducts.map(p => (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => {
                                                        const generatedSku = newProductData.sku || (100000 + Math.floor(Math.random() * 900000)).toString();
                                                        setNewProductData(prev => ({
                                                            ...prev,
                                                            product_id: p.id,
                                                            name: p.name,
                                                            description: p.description || '',
                                                            price: p.price,
                                                            category_id: p.category_id,
                                                            category: p.category_name || p.category,
                                                            images: p.images || '',
                                                            sku: generatedSku
                                                        }))
                                                        setProductSearch(p.name)
                                                        setFoundProducts([])
                                                        showNotification(`Linked to: ${p.name}`, 'info')
                                                    }}
                                                    className={`flex items-start gap-4 p-4 rounded-3xl border transition-all text-left group/item ${newProductData.product_id === p.id
                                                            ? 'bg-amber-400/10 border-amber-400/40 shadow-xl shadow-amber-400/5'
                                                            : 'bg-white/[0.03] border-white/5 hover:border-white/10 hover:bg-white/[0.05]'
                                                        }`}
                                                >
                                                    <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center text-slate-500 shrink-0">
                                                        <Package size={24} />
                                                    </div>
                                                    <div className="min-w-0 pr-4">
                                                        <div className="text-sm font-black text-white group-hover/item:text-amber-400 truncate transition-colors">{p.name}</div>
                                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-0.5">{p.category_name || p.category}</div>
                                                        <div className="text-sm font-black text-amber-400 mt-2">₹{p.price}</div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="relative">
                        <form onSubmit={handleAddProduct} className="space-y-8 pb-32">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* SECTION 1: BASIC INFORMATION */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-1">
                                        <div className="w-20 h-20 bg-amber-400/5 blur-3xl rounded-full" />
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                                            <FileText size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Basic Information</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Foundational product details</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between ml-1">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Product Name</label>
                                                {newProductData.product_id && (
                                                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-500 text-[8px] font-black uppercase tracking-tighter border border-amber-400/20">
                                                        <Zap size={8} /> Catalog Linked
                                                    </span>
                                                )}
                                            </div>
                                            <input
                                                required
                                                type="text"
                                                placeholder="e.g. Ultra Fast Charger 65W"
                                                value={newProductData.name}
                                                onChange={(e) => setNewProductData(prev => ({ ...prev, name: e.target.value }))}
                                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Description / Spec Sheet</label>
                                            <textarea
                                                rows="4"
                                                placeholder="Detailed specifications, features, and model info..."
                                                value={newProductData.description}
                                                onChange={(e) => setNewProductData(prev => ({ ...prev, description: e.target.value }))}
                                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all resize-none outline-none"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Units per Pack</label>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. 1 unit, 2 pcs"
                                                    value={newProductData.units_per_pack}
                                                    onChange={(e) => setNewProductData(prev => ({ ...prev, units_per_pack: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Material Type</label>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. Premium Glass, Silicone"
                                                    value={newProductData.material_type}
                                                    onChange={(e) => setNewProductData(prev => ({ ...prev, material_type: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                                                <span>Return Policy <span className="text-amber-500">*Mandatory</span></span>
                                                <span className="text-[8px] text-slate-500 normal-case font-bold italic">Enter each point in a new line</span>
                                            </label>
                                            <textarea
                                                required
                                                rows="3"
                                                placeholder="1. 7 Days Replacement&#10;2. Original packaging required"
                                                value={newProductData.return_policy}
                                                onChange={(e) => setNewProductData(prev => ({ ...prev, return_policy: e.target.value }))}
                                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none resize-none"
                                            />
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between ml-1">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Product Images ({newProductData.images.length}/10) <span className="text-amber-500 ml-2">*Min 3 Required</span></label>
                                                <div className="flex items-center gap-4">
                                                    <input
                                                        type="file"
                                                        hidden
                                                        multiple
                                                        ref={fileInputRef}
                                                        accept="image/*"
                                                        onChange={handleImageUpload}
                                                    />
                                                    <button
                                                        type="button"
                                                        disabled={isWarehouseImageUploading || newProductData.images.length >= 10}
                                                        onClick={() => fileInputRef.current?.click()}
                                                        className="flex items-center gap-2 text-[9px] font-black text-amber-500 uppercase tracking-widest hover:text-amber-400 transition-colors disabled:opacity-50"
                                                    >
                                                        {isWarehouseImageUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                                        {isWarehouseImageUploading ? 'Uploading...' : 'Add Image(s)'}
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                                {newProductData.images.map((imgUrl, idx) => {
                                                    const src = resolveMediaUrl(imgUrl);
                                                    return (
                                                        <div key={idx} className="relative aspect-square rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center overflow-hidden group shadow-inner">
                                                            <img src={src} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                                                            <button
                                                                type="button"
                                                                onClick={() => setNewProductData(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }))}
                                                                className="absolute top-2 right-2 bg-slate-950/80 text-rose-400 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>
                                                    )
                                                })}
                                                {newProductData.images.length < 10 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => fileInputRef.current?.click()}
                                                        className="aspect-square rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-amber-400 hover:border-amber-400/30 transition-all bg-white/[0.02]"
                                                    >
                                                        <Plus size={24} />
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">Add Image</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 2: CATEGORY & IDENTITY */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-blue-400/10 text-blue-400">
                                            <Barcode size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Category & Identity</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">System identifiers and taxonomy</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Brand Name</label>
                                                <input
                                                    type="text"
                                                    list="brand-options"
                                                    placeholder="Select or type brand (e.g. Realme, Xiaomi)"
                                                    value={newProductData.brand}
                                                    onChange={(e) => setNewProductData(prev => ({ ...prev, brand: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                                />
                                                <datalist id="brand-options">
                                                    {brands.map(b => (
                                                        <option key={b.id} value={b.name} />
                                                    ))}
                                                </datalist>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCreateBrandModal(true)}
                                                    className="mt-2 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-500 hover:text-amber-400 transition-colors"
                                                >
                                                    <Plus size={10} />
                                                    Create New Brand
                                                </button>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Primary Category</label>
                                                <div className="relative">
                                                    <select
                                                        required
                                                        disabled={!!newProductData.product_id}
                                                        value={newProductData.category_id}
                                                        onChange={(e) => {
                                                            const cat = categories.find(c => c.id === parseInt(e.target.value))
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                category_id: e.target.value,
                                                                category: cat ? cat.name : '',
                                                                // Auto-populate return policy if current is empty or matches previous category policy
                                                                return_policy: (!prev.return_policy || categories.some(c => c.return_policy === prev.return_policy)) ? (cat?.return_policy || '') : prev.return_policy
                                                            }))
                                                        }}
                                                        className={`w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all appearance-none outline-none ${newProductData.product_id ? 'opacity-70 cursor-not-allowed border-amber-400/20' : ''}`}
                                                    >
                                                        <option value="">Select Category</option>
                                                        {categories.map(cat => (
                                                            <option key={cat.id} value={cat.id}>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name}</option>
                                                        ))}
                                                    </select>
                                                    <Layers className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-700 pointer-events-none" size={16} />
                                                </div>
                                                {!newProductData.product_id && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowCreateCategoryModal(true)}
                                                        className="flex items-center gap-2 text-[10px] font-black text-amber-500 uppercase tracking-widest hover:text-amber-400 transition-colors mt-1 ml-1 group"
                                                    >
                                                        <Plus size={12} className="group-hover:rotate-90 transition-transform" />
                                                        Create New Category
                                                    </button>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Sub-Category</label>
                                                {(!hasSubCategory && !newProductData.sub_category) ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setHasSubCategory(true)}
                                                        className="w-full h-[52px] border border-dashed border-white/10 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:border-amber-400/30 hover:text-amber-400 transition-all group"
                                                    >
                                                        <Plus size={14} className="group-hover:rotate-90 transition-transform" /> Add Sub-Category
                                                    </button>
                                                ) : (
                                                    <div className="relative group/sub">
                                                        <input
                                                            type="text"
                                                            list="subcat-options"
                                                            placeholder="Select or type (e.g. Wired Headphones)"
                                                            value={newProductData.sub_category}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, sub_category: e.target.value }))}
                                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none pr-12"
                                                        />
                                                        {uniqueSubCategories.length > 0 && (
                                                            <datalist id="subcat-options">
                                                                {uniqueSubCategories.map((sub, idx) => (
                                                                    <option key={idx} value={sub} />
                                                                ))}
                                                            </datalist>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setNewProductData(prev => ({ ...prev, sub_category: '' }))
                                                                setHasSubCategory(false)
                                                            }}
                                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-rose-400 opacity-0 group-hover/sub:opacity-100 transition-all"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between ml-1">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Global SKU Code</label>
                                                <button
                                                    type="button"
                                                    onClick={generateRandomSku}
                                                    className="flex items-center gap-2 text-[9px] font-black text-amber-500 uppercase tracking-widest hover:text-amber-400 transition-colors"
                                                >
                                                    <RefreshCw size={12} /> Auto-Generate
                                                </button>
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="e.g. ELEC-CHG-65W"
                                                value={newProductData.sku}
                                                onChange={(e) => setNewProductData(prev => ({ ...prev, sku: e.target.value.toUpperCase() }))}
                                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-black focus:outline-none focus:border-amber-400/50 transition-all uppercase outline-none font-mono"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between ml-1">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Universal Barcode / EAN <span className="text-slate-600 font-bold lowercase tracking-normal">(Optional)</span></label>
                                                {newProductData.barcode && (
                                                    <span className={`text-[9px] font-black ${newProductData.barcode.length === 13 ? 'text-emerald-500' : 'text-amber-500'} uppercase tracking-widest`}>
                                                        {newProductData.barcode.length}/13 Digits
                                                    </span>
                                                )}
                                            </div>
                                            <div className="relative group/input">
                                                <Maximize className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-700 group-focus-within/input:text-amber-500 transition-colors" size={18} />
                                                <input
                                                    type="text"
                                                    placeholder="Scan or enter 13-digit barcode..."
                                                    value={newProductData.barcode}
                                                    onChange={(e) => setNewProductData(prev => ({ ...prev, barcode: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                                />
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t border-white/5">
                                            <div className="flex items-center justify-between p-4 rounded-2xl bg-amber-400/5 border border-amber-400/10">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 rounded-xl bg-amber-400/20 text-amber-500">
                                                        <Layers size={16} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Enable Product Variants</h4>
                                                        <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mt-0.5">Support multiple sizes, colors, or models</p>
                                                    </div>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={newProductData.has_variants}
                                                        onChange={(e) => {
                                                            const enabled = e.target.checked;
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                has_variants: enabled,
                                                                variants: enabled && prev.variants.length === 0 ? [{ id: Date.now(), name: '', sku: '', price: prev.price, stock_quantity: 0 }] : prev.variants
                                                            }))
                                                        }}
                                                    />
                                                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                                </label>
                                            </div>
                                        </div>

                                        {newProductData.has_variants && (
                                            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Variant Configuration</h4>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewProductData(prev => ({
                                                            ...prev,
                                                            variants: [...prev.variants, { id: Date.now(), name: '', sku: '', price: prev.price, stock_quantity: 0 }]
                                                        }))}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-400/10 text-amber-500 text-[9px] font-black uppercase tracking-widest hover:bg-amber-400/20 transition-all"
                                                    >
                                                        <Plus size={12} /> Add Variant
                                                    </button>
                                                </div>

                                                <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-950/30">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead>
                                                            <tr className="border-b border-white/5">
                                                                <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Variant Name</th>
                                                                <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">SKU</th>
                                                                <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Price</th>
                                                                <th className="p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Stock</th>
                                                                <th className="p-4"></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-white/5">
                                                            {newProductData.variants.map((variant, idx) => (
                                                                <tr key={variant.id} className="group/row hover:bg-white/[0.02] transition-colors">
                                                                    <td className="p-3">
                                                                        <input
                                                                            type="text"
                                                                            placeholder="Blue / 128GB"
                                                                            value={variant.name}
                                                                            onChange={(e) => {
                                                                                const newVariants = [...newProductData.variants];
                                                                                newVariants[idx].name = e.target.value;
                                                                                setNewProductData(prev => ({ ...prev, variants: newVariants }));
                                                                            }}
                                                                            className="w-full bg-transparent border-none p-2 text-xs text-white font-bold focus:outline-none"
                                                                        />
                                                                    </td>
                                                                    <td className="p-3">
                                                                        <input
                                                                            type="text"
                                                                            placeholder="SKU"
                                                                            value={variant.sku}
                                                                            onChange={(e) => {
                                                                                const newVariants = [...newProductData.variants];
                                                                                newVariants[idx].sku = e.target.value.toUpperCase();
                                                                                setNewProductData(prev => ({ ...prev, variants: newVariants }));
                                                                            }}
                                                                            className="w-full bg-transparent border-none p-2 text-xs text-white font-black uppercase font-mono focus:outline-none"
                                                                        />
                                                                    </td>
                                                                    <td className="p-3">
                                                                        <input
                                                                            type="number"
                                                                            placeholder="Price"
                                                                            value={variant.price}
                                                                            onChange={(e) => {
                                                                                const newVariants = [...newProductData.variants];
                                                                                newVariants[idx].price = e.target.value;
                                                                                setNewProductData(prev => ({ ...prev, variants: newVariants }));
                                                                            }}
                                                                            className="w-24 bg-transparent border-none p-2 text-xs text-amber-500 font-bold focus:outline-none"
                                                                        />
                                                                    </td>
                                                                    <td className="p-3">
                                                                        <input
                                                                            type="number"
                                                                            placeholder="Qty"
                                                                            value={variant.stock_quantity}
                                                                            onChange={(e) => {
                                                                                const newVariants = [...newProductData.variants];
                                                                                newVariants[idx].stock_quantity = e.target.value;
                                                                                setNewProductData(prev => ({ ...prev, variants: newVariants }));
                                                                            }}
                                                                            className="w-16 bg-transparent border-none p-2 text-xs text-emerald-500 font-bold focus:outline-none"
                                                                        />
                                                                    </td>
                                                                    <td className="p-3 text-right">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setNewProductData(prev => ({
                                                                                    ...prev,
                                                                                    variants: prev.variants.filter((_, i) => i !== idx)
                                                                                }));
                                                                            }}
                                                                            className="p-2 text-slate-600 hover:text-rose-500 transition-colors"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                    {newProductData.variants.length === 0 && (
                                                        <div className="p-8 text-center">
                                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">No variants added yet</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* SECTION 3: INVENTORY DETAILS */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-emerald-400/10 text-emerald-400">
                                            <Warehouse size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Inventory Details</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Stock levels and warehouse location</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Initial Stock Quantity</label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={newProductData.stock_quantity}
                                                        onChange={(e) => setNewProductData(prev => ({ ...prev, stock_quantity: parseInt(e.target.value) || 0 }))}
                                                        className="flex-1 min-w-0 bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                                    />
                                                    <select
                                                        value={newProductData.unit}
                                                        onChange={(e) => setNewProductData(prev => ({ ...prev, unit: e.target.value }))}
                                                        className="w-24 bg-slate-900 border border-white/10 rounded-2xl py-4 px-2 text-[10px] font-black text-amber-500 uppercase tracking-widest focus:outline-none focus:border-amber-500 transition-all appearance-none text-center outline-none shrink-0"
                                                    >
                                                        <option value="pcs">PCS</option>
                                                        <option value="box">BOX</option>
                                                        <option value="kg">KG</option>
                                                        <option value="ltr">LITERS</option>
                                                        <option value="set">SET</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Low Stock Alert Threshold</label>
                                                <div className="relative group/threshold">
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={newProductData.low_stock_threshold}
                                                        onChange={(e) => setNewProductData(prev => ({ ...prev, low_stock_threshold: parseInt(e.target.value) || 2 }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-rose-400/50 transition-all outline-none"
                                                    />
                                                    <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-amber-500/40 uppercase tracking-widest pointer-events-none">
                                                        {newProductData.unit}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {!showLocationMapping && !newProductData.rack_no && !newProductData.shelf_no && !newProductData.bin_id ? (
                                            <button
                                                type="button"
                                                onClick={() => setShowLocationMapping(true)}
                                                className="w-full py-8 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center gap-3 text-slate-500 hover:border-amber-400/30 hover:text-amber-400 transition-all group bg-slate-950/20"
                                            >
                                                <div className="p-3 rounded-2xl bg-white/5 group-hover:bg-amber-400/10 transition-colors">
                                                    <MapPin size={24} className="group-hover:scale-110 transition-transform" />
                                                </div>
                                                <div className="text-center">
                                                    <span className="block text-[10px] font-black uppercase tracking-widest">Add Precision Location Mapping</span>
                                                    <span className="block text-[8px] font-bold opacity-50 mt-1 uppercase">Define Rack, Shelf, and Bin Location</span>
                                                </div>
                                            </button>
                                        ) : (
                                            <div className="p-6 bg-slate-950/50 rounded-3xl border border-white/5 space-y-6 relative group/mapping">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setNewProductData(prev => ({ ...prev, rack_no: '', shelf_no: '', bin_id: '', bin_location: '' }))
                                                        setShowLocationMapping(false)
                                                    }}
                                                    className="absolute top-4 right-4 text-slate-600 hover:text-rose-400 opacity-0 group-hover/mapping:opacity-100 transition-all"
                                                >
                                                    <X size={14} />
                                                </button>
                                                <div className="flex items-center gap-2">
                                                    <MapPin size={14} className="text-amber-500" />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Precision Location Mapping</span>
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    <div className="space-y-2">
                                                        <label className="text-[8px] font-black uppercase tracking-widest text-slate-600">Rack No</label>
                                                        <input
                                                            type="text" placeholder="R-01"
                                                            value={newProductData.rack_no}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, rack_no: e.target.value.toUpperCase() }))}
                                                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[8px] font-black uppercase tracking-widest text-slate-600">Shelf No</label>
                                                        <input
                                                            type="text" placeholder="S-04"
                                                            value={newProductData.shelf_no}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, shelf_no: e.target.value.toUpperCase() }))}
                                                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[8px] font-black uppercase tracking-widest text-slate-600">Bin ID</label>
                                                        <input
                                                            type="text" placeholder="B12"
                                                            value={newProductData.bin_id}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, bin_id: e.target.value.toUpperCase() }))}
                                                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[8px] font-black uppercase tracking-widest text-slate-600">Legacy Loc.</label>
                                                        <input
                                                            type="text" placeholder="A-01-04"
                                                            value={newProductData.bin_location}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, bin_location: e.target.value.toUpperCase() }))}
                                                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none text-slate-400"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* SECTION 4: PRICING */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                                            <DollarSign size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Pricing Architecture</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Global and warehouse specific margins</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Base Selling Price</label>
                                                <div className="relative">
                                                    <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">₹</div>
                                                    <input
                                                        required
                                                        type="number"
                                                        min="0"
                                                        value={newProductData.price}
                                                        onChange={(e) => {
                                                            const s = parseFloat(e.target.value) || 0;
                                                            const m = parseFloat(newProductData.mrp) || 0;
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                price: e.target.value,
                                                                discount_amt: m > 0 ? (m - s).toFixed(2) : 0,
                                                                discount_pct: m > 0 ? (((m - s) / m) * 100).toFixed(2) : 0
                                                            }))
                                                        }}
                                                        readOnly={!!newProductData.product_id}
                                                        className={`w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-12 pr-6 text-sm text-white font-black focus:outline-none focus:border-amber-400/50 transition-all outline-none shadow-xl shadow-amber-400/5 ${newProductData.product_id ? 'opacity-70 cursor-not-allowed border-amber-400/20' : ''}`}
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between ml-1">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Landing Cost (Per Unit)</label>
                                                    {parseFloat(newProductData.cost_price) > 0 && (
                                                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
                                                            <span className={`text-[9px] font-black uppercase tracking-[0.1em] ${parseFloat(newProductData.price) - parseFloat(newProductData.cost_price) >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>
                                                                Profit: ₹{(parseFloat(newProductData.price) - parseFloat(newProductData.cost_price)).toFixed(2)}
                                                            </span>
                                                            <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black tracking-tighter ${parseFloat(newProductData.price) - parseFloat(newProductData.cost_price) >= 0 ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-400/20'}`}>
                                                                {((parseFloat(newProductData.price) - parseFloat(newProductData.cost_price)) / parseFloat(newProductData.cost_price) * 100).toFixed(1)}%
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="relative">
                                                    <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">₹</div>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={newProductData.cost_price}
                                                        onChange={(e) => setNewProductData(prev => ({ ...prev, cost_price: parseFloat(e.target.value) || 0 }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-12 pr-6 text-sm text-white font-bold focus:outline-none focus:border-emerald-400/50 transition-all outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 lg:ml-1">Maximum Retail Price (MRP)</label>
                                                <div className="relative">
                                                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-xs">₹</div>
                                                    <input
                                                        type="number"
                                                        placeholder="0.00"
                                                        value={newProductData.mrp}
                                                        onChange={(e) => {
                                                            const m = parseFloat(e.target.value) || 0;
                                                            const s = parseFloat(newProductData.price) || 0;
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                mrp: e.target.value,
                                                                discount_amt: m > 0 ? (m - s).toFixed(2) : 0,
                                                                discount_pct: m > 0 ? (((m - s) / m) * 100).toFixed(2) : 0
                                                            }))
                                                        }}
                                                        className="w-full bg-slate-950/30 border border-white/5 rounded-xl py-3 pl-10 pr-4 text-xs text-white font-bold focus:outline-none focus:border-white/20 transition-all outline-none"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Discount (₹)</label>
                                                <div className="relative">
                                                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-xs">₹</div>
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        value={newProductData.discount_amt}
                                                        onChange={(e) => {
                                                            const d_amt = parseFloat(e.target.value) || 0;
                                                            const m = parseFloat(newProductData.mrp) || 0;
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                discount_amt: e.target.value,
                                                                price: m > 0 ? (m - d_amt).toFixed(2) : prev.price,
                                                                discount_pct: m > 0 ? ((d_amt / m) * 100).toFixed(2) : 0
                                                            }))
                                                        }}
                                                        className="w-full bg-slate-950/30 border border-white/5 rounded-xl py-3 pl-10 pr-4 text-xs text-white font-bold focus:outline-none focus:border-white/20 transition-all outline-none"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Discount Percentage</label>
                                                <div className="relative">
                                                    <Percent className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600" size={12} />
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        value={newProductData.discount_pct}
                                                        onChange={(e) => {
                                                            const d_pct = parseFloat(e.target.value) || 0;
                                                            const m = parseFloat(newProductData.mrp) || 0;
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                discount_pct: e.target.value,
                                                                price: m > 0 ? (m * (1 - d_pct / 100)).toFixed(2) : prev.price,
                                                                discount_amt: m > 0 ? (m * (d_pct / 100)).toFixed(2) : 0
                                                            }))
                                                        }}
                                                        className="w-full bg-slate-950/30 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-white/20 transition-all outline-none"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-3">
                                                <div className={`flex items-center justify-between p-3 rounded-xl border transition-all ${newProductData.apply_gst ? 'bg-cyan-400/5 border-cyan-400/20' : 'bg-slate-950/30 border-white/5'}`}>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">GST / Tax</span>
                                                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tight">{newProductData.apply_gst ? 'Enabled' : 'Disabled'}</span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewProductData(prev => ({
                                                            ...prev,
                                                            apply_gst: !prev.apply_gst,
                                                            gst_pct: !prev.apply_gst ? 18 : null
                                                        }))}
                                                        className={`w-9 h-5 rounded-full p-0.5 transition-all ${newProductData.apply_gst ? 'bg-cyan-400' : 'bg-slate-800'}`}
                                                    >
                                                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${newProductData.apply_gst ? 'translate-x-4' : 'translate-x-0'} shadow-sm`} />
                                                    </button>
                                                </div>

                                                {newProductData.apply_gst && (
                                                    <div className="relative animate-in slide-in-from-top-2 duration-300">
                                                        <Percent className="absolute right-4 top-1/2 -translate-y-1/2 text-cyan-400/60" size={12} />
                                                        <select
                                                            value={newProductData.gst_pct || 18}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, gst_pct: parseInt(e.target.value) }))}
                                                            className="w-full bg-cyan-400/5 border border-cyan-400/20 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-cyan-400/40 transition-all appearance-none outline-none"
                                                        >
                                                            <option value="0">0% (Exempt)</option>
                                                            <option value="5">5% (Essentials)</option>
                                                            <option value="12">12% (Standard)</option>
                                                            <option value="18">18% (Standard+)</option>
                                                            <option value="28">28% (Luxury)</option>
                                                        </select>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 5: LOGISTICS */}
                                {!showLogistics && !newProductData.weight && !newProductData.dimensions && !newProductData.is_fragile && !newProductData.is_temp_sensitive ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowLogistics(true)}
                                        className="w-full py-8 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center gap-3 text-slate-500 hover:border-indigo-400/30 hover:text-indigo-400 transition-all group bg-slate-950/20"
                                    >
                                        <div className="p-3 rounded-2xl bg-white/5 group-hover:bg-indigo-400/10 transition-colors">
                                            <Truck size={24} className="group-hover:scale-110 transition-transform" />
                                        </div>
                                        <div className="text-center">
                                            <span className="block text-[10px] font-black uppercase tracking-widest">Add Logistics & Handling Details</span>
                                            <span className="block text-[8px] font-bold opacity-50 mt-1 uppercase">Define Weight, Dimensions, and Sensitivity</span>
                                        </div>
                                    </button>
                                ) : (
                                    <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group relative overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setNewProductData(prev => ({ ...prev, weight: '', dimensions: '', is_fragile: false, is_temp_sensitive: false }))
                                                setShowLogistics(false)
                                            }}
                                            className="absolute top-4 right-4 text-slate-600 hover:text-rose-400 opacity-0 group-hover/mapping:opacity-100 transition-all z-10"
                                        >
                                            <X size={14} />
                                        </button>
                                        <div className="absolute -bottom-8 -right-8 p-1 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity">
                                            <Truck size={120} />
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 rounded-2xl bg-indigo-400/10 text-indigo-400">
                                                <Truck size={22} />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-black text-white uppercase tracking-tight">Logistics & Handling</h3>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Physical attributes and sensitivity</p>
                                            </div>
                                        </div>

                                        <div className="space-y-6">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Physical Weight</label>
                                                    <div className="relative">
                                                        <Scale className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-700" size={16} />
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. 0.450 kg"
                                                            value={newProductData.weight}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, weight: e.target.value }))}
                                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-indigo-400/50 transition-all outline-none"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Box Dimensions</label>
                                                    <div className="relative">
                                                        <Maximize className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-700" size={16} />
                                                        <input
                                                            type="text"
                                                            placeholder="L x W x H (cm)"
                                                            value={newProductData.dimensions}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, dimensions: e.target.value }))}
                                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-indigo-400/50 transition-all outline-none"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-2 md:col-span-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Promised Delivery Window</label>
                                                    <div className="relative">
                                                        <Zap className="absolute left-6 top-1/2 -translate-y-1/2 text-amber-500" size={16} />
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. 10-30 mins or 2-4 Hours"
                                                            value={newProductData.delivery_time}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, delivery_time: e.target.value }))}
                                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-black focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                                        />
                                                        <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest mt-2 ml-1">Used for storefront "Instant Delivery" badges</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setNewProductData(prev => ({ ...prev, is_fragile: !prev.is_fragile }))}
                                                    className={`flex items-center justify-between p-5 rounded-3xl border transition-all ${newProductData.is_fragile
                                                            ? 'bg-rose-400/10 border-rose-400/30'
                                                            : 'bg-slate-950/30 border-white/5 hover:border-white/10'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3 text-left">
                                                        <Shield size={18} className={newProductData.is_fragile ? 'text-rose-400' : 'text-slate-600'} />
                                                        <div>
                                                            <div className="text-[10px] font-black text-white uppercase tracking-wider text-left">Fragile Item</div>
                                                            <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Special handling required</div>
                                                        </div>
                                                    </div>
                                                    <div className={`w-10 h-6 rounded-full p-1 transition-all ${newProductData.is_fragile ? 'bg-rose-400' : 'bg-slate-800'}`}>
                                                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${newProductData.is_fragile ? 'translate-x-4' : 'translate-x-0'}`} />
                                                    </div>
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => setNewProductData(prev => ({ ...prev, is_temp_sensitive: !prev.is_temp_sensitive }))}
                                                    className={`flex items-center justify-between p-5 rounded-3xl border transition-all ${newProductData.is_temp_sensitive
                                                            ? 'bg-blue-400/10 border-blue-400/30'
                                                            : 'bg-slate-950/30 border-white/5 hover:border-white/10'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3 text-left">
                                                        <Thermometer size={18} className={newProductData.is_temp_sensitive ? 'text-blue-400' : 'text-slate-600'} />
                                                        <div>
                                                            <div className="text-[10px] font-black text-white uppercase tracking-wider text-left">Temp Sensitive</div>
                                                            <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Maintain specific environment</div>
                                                        </div>
                                                    </div>
                                                    <div className={`w-10 h-6 rounded-full p-1 transition-all ${newProductData.is_temp_sensitive ? 'bg-blue-400' : 'bg-slate-800'}`}>
                                                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${newProductData.is_temp_sensitive ? 'translate-x-4' : 'translate-x-0'}`} />
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* SECTION 6: SUPPLIER INFO */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-cyan-400/10 text-cyan-400">
                                            <RefreshCw size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Supplier Intelligence</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Origins and procurement data</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Supplier / Vendor Name</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Reliance Logistics Pvt Ltd"
                                                value={newProductData.supplier_name}
                                                onChange={(e) => setNewProductData(prev => ({ ...prev, supplier_name: e.target.value }))}
                                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-cyan-400/50 transition-all outline-none"
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Contact Information</label>
                                                <input
                                                    type="text"
                                                    placeholder="Phone or Email"
                                                    value={newProductData.contact_info}
                                                    onChange={(e) => setNewProductData(prev => ({ ...prev, contact_info: e.target.value }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-cyan-400/50 transition-all outline-none"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Purchase Date</label>
                                                <div className="relative">
                                                    <Calendar className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-700" size={16} />
                                                    <input
                                                        type="date"
                                                        value={newProductData.purchase_date}
                                                        onChange={(e) => setNewProductData(prev => ({ ...prev, purchase_date: e.target.value }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-cyan-400/50 transition-all outline-none [color-scheme:dark]"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 7: STATUS & CONTROL */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group col-span-1 lg:col-span-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                                            <Shield size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Status & Operational Controls</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Lifecycle and visibility management</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                        <div className="space-y-6">
                                            <div className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-white/5">
                                                <div>
                                                    <div className="text-[10px] font-black text-white uppercase tracking-widest">Active Status</div>
                                                    <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Available for orders</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setNewProductData(prev => ({ ...prev, is_active: !prev.is_active }))}
                                                    className={`w-12 h-7 rounded-full p-1 transition-all ${newProductData.is_active ? 'bg-emerald-400' : 'bg-slate-800'}`}
                                                >
                                                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${newProductData.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            <div className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-white/5">
                                                <div>
                                                    <div className="text-[10px] font-black text-white uppercase tracking-widest">Store Visibility</div>
                                                    <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Visible to customers</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setNewProductData(prev => ({ ...prev, is_visible: !prev.is_visible }))}
                                                    className={`w-12 h-7 rounded-full p-1 transition-all ${newProductData.is_visible ? 'bg-amber-400' : 'bg-slate-800'}`}
                                                >
                                                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${newProductData.is_visible ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-6">
                                            <div className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-white/5">
                                                <div>
                                                    <div className="text-[10px] font-black text-white uppercase tracking-widest">Perishable Goods</div>
                                                    <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Has short shelf life</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setNewProductData(prev => ({ ...prev, is_perishable: !prev.is_perishable }))}
                                                    className={`w-12 h-7 rounded-full p-1 transition-all ${newProductData.is_perishable ? 'bg-rose-400' : 'bg-slate-800'}`}
                                                >
                                                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${newProductData.is_perishable ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            <div className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-white/5">
                                                <div>
                                                    <div className="text-[10px] font-black text-white uppercase tracking-widest">Featured Product</div>
                                                    <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">Show in Popular section</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setNewProductData(prev => ({ ...prev, is_featured: !prev.is_featured }))}
                                                    className={`w-12 h-7 rounded-full p-1 transition-all ${newProductData.is_featured ? 'bg-indigo-400' : 'bg-slate-800'}`}
                                                >
                                                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${newProductData.is_featured ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            {newProductData.is_perishable && (
                                                <div className="space-y-2 animate-in slide-in-from-top-4 duration-500">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Expiry Date</label>
                                                    <div className="relative">
                                                        <AlertCircle className="absolute right-6 top-1/2 -translate-y-1/2 text-rose-500" size={16} />
                                                        <input
                                                            type="date"
                                                            value={newProductData.expiry_date}
                                                            onChange={(e) => setNewProductData(prev => ({ ...prev, expiry_date: e.target.value }))}
                                                            className="w-full bg-rose-500/5 border border-rose-500/20 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-rose-400 transition-all [color-scheme:dark]"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="p-6 rounded-3xl bg-amber-400/5 border border-amber-400/10 flex flex-col justify-center gap-2">
                                            <div className="flex items-center gap-2 text-amber-500">
                                                <Info size={16} />
                                                <span className="text-[10px] font-black uppercase tracking-widest leading-none">System Note</span>
                                            </div>
                                            <p className="text-[9px] font-bold text-slate-400 leading-relaxed uppercase tracking-tight">
                                                Ensure all regulatory labels and shelf-life markers are verified before marking as "Store Visible". Logistics engines rely on these parameters for fulfillment routing.
                                            </p>
                                        </div>
                                    </div>
                                
                                    <div className="pt-6 border-t border-white/5">
                                        <div className="flex items-center gap-3 mb-4">
                                            <RefreshCw size={14} className="text-amber-500" />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lifecycle Management</span>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                            {[
                                                { label: 'Draft', value: 'draft', color: 'bg-slate-500' },
                                                { label: 'Testing', value: 'testing', color: 'bg-blue-500' },
                                                { label: 'Live', value: 'live', color: 'bg-emerald-500' },
                                                { label: 'Archived', value: 'archived', color: 'bg-rose-500' },
                                                { label: 'Discontinued', value: 'discontinued', color: 'bg-amber-700' },
                                                { label: 'Coming Soon', value: 'coming_soon', color: 'bg-purple-500' }
                                            ].map((state) => (
                                                <button
                                                    key={state.value}
                                                    type="button"
                                                    onClick={() => setNewProductData(prev => ({ ...prev, lifecycle_state: state.value }))}
                                                    className={`px-4 py-3 rounded-2xl border transition-all flex flex-col items-center gap-2 ${newProductData.lifecycle_state === state.value
                                                            ? 'bg-white/10 border-white/20'
                                                            : 'bg-slate-950/20 border-white/5 hover:border-white/10'
                                                        }`}
                                                >
                                                    <div className={`w-2 h-2 rounded-full ${state.color} ${newProductData.lifecycle_state === state.value ? 'animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.5)]' : ''}`} />
                                                    <span className={`text-[9px] font-black uppercase tracking-widest ${newProductData.lifecycle_state === state.value ? 'text-white' : 'text-slate-500'}`}>{state.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 6: RECOMMENDATION CONTROLS */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group col-span-1 lg:col-span-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-indigo-400/10 text-indigo-400">
                                            <TrendingUp size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Recommendation Controls</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Smart upsells & cross-sell mapping</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-6">
                                            {[
                                                { label: 'Related Products', type: 'related', color: 'indigo' },
                                                { label: 'Upsell Products', type: 'upsell', color: 'emerald' },
                                                { label: 'Cross-Sell Products', type: 'cross_sell', color: 'amber' },
                                                { label: 'Frequently Bought Together', type: 'frequent', color: 'rose' }
                                            ].map((rec) => (
                                                <div key={rec.type} className="space-y-3">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{rec.label}</label>
                                                    <div className="relative group/rec">
                                                        <Search className="absolute left-4 top-4 text-slate-700 group-focus-within/rec:text-indigo-400 transition-colors" size={14} />
                                                        <input
                                                            type="text"
                                                            placeholder={`Search to add ${rec.label.toLowerCase()}...`}
                                                            onFocus={(e) => {
                                                                const rect = e.target.getBoundingClientRect();
                                                                setRecSearchTarget({ type: rec.type, rect });
                                                            }}
                                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-3.5 pl-11 pr-6 text-xs text-white font-bold focus:outline-none focus:border-indigo-400/50 transition-all outline-none"
                                                        />
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 min-h-[40px] p-2 rounded-2xl bg-slate-950/30 border border-white/5">
                                                        {newProductData.recommendations[rec.type].map(prodId => {
                                                            const prod = inventory.find(i => i.product_id === prodId) || foundProducts.find(p => p.id === prodId);
                                                            return (
                                                                <div key={prodId} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl bg-white/5 border border-white/10 group/tag">
                                                                    <div className="w-6 h-6 rounded-lg bg-slate-800 overflow-hidden">
                                                                        <img src={resolveMediaUrl(prod?.images?.[0])} alt="" className="w-full h-full object-cover" />
                                                                    </div>
                                                                    <span className="text-[10px] font-bold text-white max-w-[100px] truncate">{prod?.name || 'Unknown'}</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setNewProductData(prev => ({
                                                                            ...prev,
                                                                            recommendations: {
                                                                                ...prev.recommendations,
                                                                                [rec.type]: prev.recommendations[rec.type].filter(id => id !== prodId)
                                                                            }
                                                                        }))}
                                                                        className="text-slate-500 hover:text-rose-400"
                                                                    >
                                                                        <X size={12} />
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                        {newProductData.recommendations[rec.type].length === 0 && (
                                                            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest m-auto">No products mapped</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="space-y-8 bg-slate-950/20 p-6 rounded-3xl border border-white/5">
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Manual Recommendation Priority</label>
                                                    <span className="text-xs font-black text-indigo-400">{newProductData.recommendation_priority}</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={newProductData.recommendation_priority}
                                                    onChange={(e) => setNewProductData(prev => ({ ...prev, recommendation_priority: parseInt(e.target.value) }))}
                                                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                />
                                                <p className="text-[8px] font-bold text-slate-600 uppercase tracking-tighter">Higher priority products appear first in manual recommendation slots</p>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Smart Recommendation Weight</label>
                                                    <span className="text-xs font-black text-emerald-400">{newProductData.recommendation_weight}x</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0.1"
                                                    max="5.0"
                                                    step="0.1"
                                                    value={newProductData.recommendation_weight}
                                                    onChange={(e) => setNewProductData(prev => ({ ...prev, recommendation_weight: parseFloat(e.target.value) }))}
                                                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                />
                                                <p className="text-[8px] font-bold text-slate-600 uppercase tracking-tighter">Influences AI-driven cross-sell probability (1.0 = neutral)</p>
                                            </div>

                                            <div className="p-4 rounded-2xl bg-indigo-400/5 border border-indigo-400/10 space-y-2">
                                                <div className="flex items-center gap-2 text-indigo-400">
                                                    <Info size={14} />
                                                    <span className="text-[9px] font-black uppercase tracking-widest">Visibility Tip</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                                                    Mapped products will be prioritized in "You May Also Like" sections. Upsells are shown in the product page, while Cross-Sells appear in the cart.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 7: PRODUCT CONTENT BUILDER */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group col-span-1 lg:col-span-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-rose-400/10 text-rose-400">
                                            <MessageSquare size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Product Content Builder</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Rich content for storefront tabs</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                        <div className="space-y-8">
                                            <div className="space-y-3">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Rich Overview (Main Tab)</label>
                                                <textarea
                                                    rows="6"
                                                    placeholder="HTML/Markdown supported overview..."
                                                    value={newProductData.content.overview}
                                                    onChange={(e) => setNewProductData(prev => ({
                                                        ...prev,
                                                        content: { ...prev.content, overview: e.target.value }
                                                    }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-xs text-white font-medium focus:outline-none focus:border-rose-400/50 transition-all resize-none outline-none leading-relaxed"
                                                />
                                            </div>

                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between ml-1">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Key Highlights (Bullet Points)</label>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewProductData(prev => ({
                                                            ...prev,
                                                            content: { ...prev.content, highlights: [...prev.content.highlights, ''] }
                                                        }))}
                                                        className="text-[9px] font-black text-rose-400 uppercase tracking-widest flex items-center gap-1.5 hover:text-rose-300 transition-colors"
                                                    >
                                                        <Plus size={12} /> Add Point
                                                    </button>
                                                </div>
                                                <div className="space-y-2">
                                                    {newProductData.content.highlights.map((h, idx) => (
                                                        <div key={idx} className="flex gap-2 group/h">
                                                            <input
                                                                type="text"
                                                                placeholder={`Highlight #${idx + 1}`}
                                                                value={h}
                                                                onChange={(e) => {
                                                                    const newH = [...newProductData.content.highlights];
                                                                    newH[idx] = e.target.value;
                                                                    setNewProductData(prev => ({
                                                                        ...prev,
                                                                        content: { ...prev.content, highlights: newH }
                                                                    }))
                                                                }}
                                                                className="flex-1 bg-slate-950/30 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-rose-400/30 transition-all outline-none"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setNewProductData(prev => ({
                                                                    ...prev,
                                                                    content: { ...prev.content, highlights: prev.content.highlights.filter((_, i) => i !== idx) }
                                                                }))}
                                                                className="p-3 text-slate-600 hover:text-rose-500 opacity-0 group-hover/h:opacity-100 transition-all"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {newProductData.content.highlights.length === 0 && (
                                                        <div className="py-6 border border-dashed border-white/5 rounded-2xl flex items-center justify-center">
                                                            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">No highlights added</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-8">
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between ml-1">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Technical Specifications</label>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const key = `Param ${Object.keys(newProductData.content.specifications).length + 1}`;
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                content: {
                                                                    ...prev.content,
                                                                    specifications: { ...prev.content.specifications, [key]: '' }
                                                                }
                                                            }))
                                                        }}
                                                        className="text-[9px] font-black text-rose-400 uppercase tracking-widest flex items-center gap-1.5 hover:text-rose-300 transition-colors"
                                                    >
                                                        <Plus size={12} /> Add Row
                                                    </button>
                                                </div>
                                                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                                    {Object.entries(newProductData.content.specifications).map(([key, val], idx) => (
                                                        <div key={idx} className="grid grid-cols-2 gap-2 group/s">
                                                            <input
                                                                type="text"
                                                                placeholder="Property (e.g. Battery)"
                                                                value={key}
                                                                onChange={(e) => {
                                                                    const newS = { ...newProductData.content.specifications };
                                                                    delete newS[key];
                                                                    newS[e.target.value] = val;
                                                                    setNewProductData(prev => ({
                                                                        ...prev,
                                                                        content: { ...prev.content, specifications: newS }
                                                                    }))
                                                                }}
                                                                className="bg-slate-950/30 border border-white/5 rounded-xl py-3 px-4 text-xs text-rose-400 font-black uppercase tracking-widest focus:outline-none focus:border-rose-400/30 transition-all outline-none"
                                                            />
                                                            <div className="relative">
                                                                <input
                                                                    type="text"
                                                                    placeholder="Value"
                                                                    value={val}
                                                                    onChange={(e) => setNewProductData(prev => ({
                                                                        ...prev,
                                                                        content: {
                                                                            ...prev.content,
                                                                            specifications: { ...prev.content.specifications, [key]: e.target.value }
                                                                        }
                                                                    }))}
                                                                    className="w-full bg-slate-950/30 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-rose-400/30 transition-all outline-none pr-10"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const newS = { ...newProductData.content.specifications };
                                                                        delete newS[key];
                                                                        setNewProductData(prev => ({
                                                                            ...prev,
                                                                            content: { ...prev.content, specifications: newS }
                                                                        }))
                                                                    }}
                                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-rose-500 opacity-0 group-hover/s:opacity-100 transition-all"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Compatibility</label>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g. iPhone 15, Galaxy S24"
                                                        value={newProductData.content.compatibility}
                                                        onChange={(e) => setNewProductData(prev => ({
                                                            ...prev,
                                                            content: { ...prev.content, compatibility: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-xs text-white font-bold focus:outline-none focus:border-rose-400/50 transition-all outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">What's in the Box</label>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g. Main Unit, User Manual"
                                                        value={newProductData.content.box_contents}
                                                        onChange={(e) => setNewProductData(prev => ({
                                                            ...prev,
                                                            content: { ...prev.content, box_contents: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-xs text-white font-bold focus:outline-none focus:border-rose-400/50 transition-all outline-none"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Warranty Info</label>
                                                    <textarea
                                                        rows="3"
                                                        placeholder="Coverage, duration, claim process..."
                                                        value={newProductData.content.warranty_info}
                                                        onChange={(e) => setNewProductData(prev => ({
                                                            ...prev,
                                                            content: { ...prev.content, warranty_info: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-xs text-white font-medium focus:outline-none focus:border-rose-400/50 transition-all resize-none outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Usage Instructions</label>
                                                    <textarea
                                                        rows="3"
                                                        placeholder="Step-by-step setup or safety guide..."
                                                        value={newProductData.content.usage_instructions}
                                                        onChange={(e) => setNewProductData(prev => ({
                                                            ...prev,
                                                            content: { ...prev.content, usage_instructions: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-xs text-white font-medium focus:outline-none focus:border-rose-400/50 transition-all resize-none outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 8: STOREFRONT BADGES */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group col-span-1 lg:col-span-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                                            <Tag size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Storefront Badges</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Dynamic merchandising labels</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {[
                                            { label: 'Best Seller', type: 'best_seller', color: 'bg-amber-500' },
                                            { label: 'Trending', type: 'trending', color: 'bg-indigo-500' },
                                            { label: 'New Arrival', type: 'new_arrival', color: 'bg-emerald-500' },
                                            { label: 'Premium Pick', type: 'premium', color: 'bg-purple-500' },
                                            { label: 'Limited Deal', type: 'limited_deal', color: 'bg-rose-500' },
                                            { label: 'Staff Choice', type: 'staff_choice', color: 'bg-blue-500' },
                                            { label: 'Verified', type: 'verified', color: 'bg-sky-500' }
                                        ].map((badge) => {
                                            const activeBadge = newProductData.badges.find(b => b.type === badge.type);
                                            return (
                                                <div key={badge.type} className={`p-4 rounded-3xl border transition-all ${activeBadge ? 'bg-white/5 border-white/10' : 'bg-slate-950/20 border-white/5'}`}>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`w-2 h-2 rounded-full ${badge.color}`} />
                                                            <span className="text-[10px] font-black uppercase tracking-widest text-white">{badge.label}</span>
                                                        </div>
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={!!activeBadge}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        setNewProductData(prev => ({
                                                                            ...prev,
                                                                            badges: [...prev.badges, { type: badge.type, priority: 1, is_active: true }]
                                                                        }))
                                                                    } else {
                                                                        setNewProductData(prev => ({
                                                                            ...prev,
                                                                            badges: prev.badges.filter(b => b.type !== badge.type)
                                                                        }))
                                                                    }
                                                                }}
                                                            />
                                                            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                                                        </label>
                                                    </div>

                                                    {activeBadge && (
                                                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                                            <div className="flex items-center justify-between">
                                                                <label className="text-[8px] font-black uppercase tracking-tighter text-slate-500">Priority</label>
                                                                <span className="text-[10px] font-black text-white">{activeBadge.priority}</span>
                                                            </div>
                                                            <input
                                                                type="range"
                                                                min="1"
                                                                max="10"
                                                                value={activeBadge.priority}
                                                                onChange={(e) => {
                                                                    const newBadges = [...newProductData.badges];
                                                                    const idx = newBadges.findIndex(b => b.type === badge.type);
                                                                    newBadges[idx].priority = parseInt(e.target.value);
                                                                    setNewProductData(prev => ({ ...prev, badges: newBadges }));
                                                                }}
                                                                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* SECTION 9: FULFILLMENT CONFIGURATION */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group col-span-1 lg:col-span-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-sky-400/10 text-sky-400">
                                            <Truck size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Fulfillment Configuration</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Logistics & delivery parameters</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                        <div className="space-y-8">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Package Weight (kg)</label>
                                                    <div className="relative">
                                                        <Scale className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-700" size={18} />
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            placeholder="0.00"
                                                            value={newProductData.fulfillment.package_weight}
                                                            onChange={(e) => setNewProductData(prev => ({
                                                                ...prev,
                                                                fulfillment: { ...prev.fulfillment, package_weight: parseFloat(e.target.value) || 0 }
                                                            }))}
                                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 transition-all outline-none"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Shipping Tier</label>
                                                    <select
                                                        value={newProductData.fulfillment.shipping_tier}
                                                        onChange={(e) => setNewProductData(prev => ({
                                                            ...prev,
                                                            fulfillment: { ...prev.fulfillment, shipping_tier: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 transition-all outline-none appearance-none"
                                                    >
                                                        <option value="standard">Standard Shipping</option>
                                                        <option value="express">Express Delivery</option>
                                                        <option value="heavy">Heavy / Oversized</option>
                                                        <option value="fragile">Fragile Handling</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Package Dimensions (cm)</label>
                                                <div className="grid grid-cols-3 gap-4">
                                                    {[
                                                        { label: 'Length', key: 'length' },
                                                        { label: 'Width', key: 'width' },
                                                        { label: 'Height', key: 'height' }
                                                    ].map((dim) => (
                                                        <div key={dim.key} className="space-y-1">
                                                            <div className="text-[8px] font-black uppercase tracking-tighter text-slate-600 ml-1">{dim.label}</div>
                                                            <input
                                                                type="number"
                                                                placeholder="0"
                                                                value={newProductData.fulfillment[dim.key]}
                                                                onChange={(e) => setNewProductData(prev => ({
                                                                    ...prev,
                                                                    fulfillment: { ...prev.fulfillment, [dim.key]: parseFloat(e.target.value) || 0 }
                                                                }))}
                                                                className="w-full bg-slate-950/30 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-sky-400/30 transition-all outline-none"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-8">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Dispatch SLA (Hours)</label>
                                                    <input
                                                        type="number"
                                                        placeholder="24"
                                                        value={newProductData.fulfillment.dispatch_sla}
                                                        onChange={(e) => setNewProductData(prev => ({
                                                            ...prev,
                                                            fulfillment: { ...prev.fulfillment, dispatch_sla: parseInt(e.target.value) || 0 }
                                                        }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 transition-all outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Return Window (Days)</label>
                                                    <input
                                                        type="number"
                                                        placeholder="7"
                                                        value={newProductData.fulfillment.return_window}
                                                        onChange={(e) => setNewProductData(prev => ({
                                                            ...prev,
                                                            fulfillment: { ...prev.fulfillment, return_window: parseInt(e.target.value) || 0 }
                                                        }))}
                                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 transition-all outline-none"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                {[
                                                    { label: 'COD Eligible', key: 'is_cod_eligible', color: 'bg-emerald-500' },
                                                    { label: 'Fragile Item', key: 'is_fragile', color: 'bg-amber-500' },
                                                    { label: 'Express Ready', key: 'is_express_eligible', color: 'bg-sky-500' }
                                                ].map((toggle) => (
                                                    <div key={toggle.key} className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-white/5">
                                                        <span className="text-[9px] font-black text-white uppercase tracking-widest leading-tight">{toggle.label}</span>
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only peer"
                                                                checked={newProductData.fulfillment[toggle.key]}
                                                                onChange={(e) => setNewProductData(prev => ({
                                                                    ...prev,
                                                                    fulfillment: { ...prev.fulfillment, [toggle.key]: e.target.checked }
                                                                }))}
                                                            />
                                                            <div className={`w-8 h-4.5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:${toggle.color}`}></div>
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 10: SEARCH & DISCOVERY */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group col-span-1 lg:col-span-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-emerald-400/10 text-emerald-400">
                                            <Search size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Search & Discovery</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">SEO and storefront findability</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                        <div className="space-y-8">
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between ml-1">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Meta Title (SEO)</label>
                                                    <span className={`text-[9px] font-black uppercase tracking-widest ${newProductData.discovery.meta_title.length > 60 ? 'text-rose-400' : 'text-slate-600'}`}>{newProductData.discovery.meta_title.length}/60</span>
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Focus keyword included title..."
                                                    value={newProductData.discovery.meta_title}
                                                    onChange={(e) => setNewProductData(prev => ({
                                                        ...prev,
                                                        discovery: { ...prev.discovery, meta_title: e.target.value }
                                                    }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-emerald-400/50 transition-all outline-none"
                                                />
                                            </div>

                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between ml-1">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Meta Description</label>
                                                    <span className={`text-[9px] font-black uppercase tracking-widest ${newProductData.discovery.meta_description.length > 160 ? 'text-rose-400' : 'text-slate-600'}`}>{newProductData.discovery.meta_description.length}/160</span>
                                                </div>
                                                <textarea
                                                    rows="4"
                                                    placeholder="Compelling summary for search results..."
                                                    value={newProductData.discovery.meta_description}
                                                    onChange={(e) => setNewProductData(prev => ({
                                                        ...prev,
                                                        discovery: { ...prev.discovery, meta_description: e.target.value }
                                                    }))}
                                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-xs text-white font-medium focus:outline-none focus:border-emerald-400/50 transition-all resize-none outline-none leading-relaxed"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-8">
                                            {[
                                                { label: 'Search Keywords', key: 'search_keywords', placeholder: 'Add search term...', color: 'text-emerald-400' },
                                                { label: 'Product Tags', key: 'product_tags', placeholder: 'Add tag...', color: 'text-blue-400' },
                                                { label: 'Search Synonyms', key: 'search_synonyms', placeholder: 'Add synonym (e.g. mobile, phone)...', color: 'text-purple-400' }
                                            ].map((disco) => (
                                                <div key={disco.key} className="space-y-3">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{disco.label}</label>
                                                    <div className="relative group/disco">
                                                        <Plus className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-700" size={14} />
                                                        <input
                                                            type="text"
                                                            placeholder={disco.placeholder}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && e.target.value.trim()) {
                                                                    e.preventDefault();
                                                                    const val = e.target.value.trim().toLowerCase();
                                                                    if (!newProductData.discovery[disco.key].includes(val)) {
                                                                        setNewProductData(prev => ({
                                                                            ...prev,
                                                                            discovery: {
                                                                                ...prev.discovery,
                                                                                [disco.key]: [...prev.discovery[disco.key], val]
                                                                            }
                                                                        }));
                                                                    }
                                                                    e.target.value = '';
                                                                }
                                                            }}
                                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-3.5 pl-11 pr-6 text-xs text-white font-bold focus:outline-none focus:border-emerald-400/50 transition-all outline-none"
                                                        />
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 min-h-[30px]">
                                                        {newProductData.discovery[disco.key].map(tag => (
                                                            <div key={tag} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 group/tag">
                                                                <span className={`text-[10px] font-black uppercase tracking-widest ${disco.color}`}>{tag}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setNewProductData(prev => ({
                                                                        ...prev,
                                                                        discovery: {
                                                                            ...prev.discovery,
                                                                            [disco.key]: prev.discovery[disco.key].filter(t => t !== tag)
                                                                        }
                                                                    }))}
                                                                    className="text-slate-500 hover:text-rose-400 transition-colors"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                        {newProductData.discovery[disco.key].length === 0 && (
                                                            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-2 ml-1">No items added</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 11: PRODUCT ANALYTICS (READ-ONLY) */}
                                <div className="warehouse-panel p-8 space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group col-span-1 lg:col-span-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-indigo-400/10 text-indigo-400">
                                            <TrendingUp size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-white uppercase tracking-tight">Product Performance Analytics</h3>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Operational performance and engagement</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
                                        {[
                                            { label: 'Lifetime Views', value: newProductData.analytics.view_count, icon: Eye, color: 'text-blue-400' },
                                            { label: 'Cart Additions', value: newProductData.analytics.cart_add_count, icon: ShoppingCart, color: 'text-amber-400' },
                                            { label: 'Total Purchases', value: newProductData.analytics.purchase_count, icon: CreditCard, color: 'text-emerald-400' },
                                            { label: 'Wishlist Savings', value: newProductData.analytics.wishlist_count, icon: Heart, color: 'text-rose-400' },
                                            { label: 'Conversion Rate', value: `${newProductData.analytics.conversion_rate}%`, icon: Zap, color: 'text-purple-400' }
                                        ].map((stat, idx) => (
                                            <div key={idx} className="p-5 rounded-[24px] bg-slate-950/40 border border-white/5 flex flex-col gap-3">
                                                <div className="flex items-center justify-between">
                                                    <stat.icon size={14} className={stat.color} />
                                                    <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                                                </div>
                                                <div>
                                                    <div className="text-[18px] font-black text-white leading-none">{stat.value}</div>
                                                    <div className="text-[8px] font-black uppercase tracking-widest text-slate-600 mt-2">{stat.label}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="p-4 rounded-2xl bg-indigo-400/5 border border-indigo-400/10 flex items-start gap-4">
                                        <Info size={16} className="text-indigo-400 mt-0.5" />
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Performance Insights</p>
                                            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                                These metrics are calculated in real-time based on storefront engagement. High views with low cart additions may suggest pricing or image optimization is needed.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Recommendation Search Overlay */}
                            {recSearchTarget && (
                                <div
                                    className="fixed inset-0 z-[200]"
                                    onClick={() => setRecSearchTarget(null)}
                                >
                                    <div
                                        className="fixed w-[320px] max-h-[400px] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
                                        style={{
                                            top: Math.min(window.innerHeight - 420, recSearchTarget.rect.bottom + 10),
                                            left: recSearchTarget.rect.left
                                        }}
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <div className="p-3 border-b border-white/5 bg-slate-950/50 sticky top-0">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    placeholder="Filter products..."
                                                    value={productSearch}
                                                    onChange={(e) => setProductSearch(e.target.value)}
                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs text-white font-bold focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                        <div className="p-2 space-y-1">
                                            {(productSearch ? [...foundProducts, ...inventory.map(i => ({ id: i.product_id, name: i.product_name, images: i.images, brand: i.brand }))] : inventory.map(i => ({ id: i.product_id, name: i.product_name, images: i.images, brand: i.brand })))
                                                .filter((p, idx, self) => self.findIndex(t => t.id === p.id) === idx) // Unique
                                                .filter(p => p.name?.toLowerCase().includes(productSearch.toLowerCase()))
                                                .slice(0, 50)
                                                .map(prod => (
                                                    <button
                                                        key={prod.id}
                                                        type="button"
                                                        disabled={newProductData.recommendations[recSearchTarget.type].includes(prod.id)}
                                                        onClick={() => {
                                                            setNewProductData(prev => ({
                                                                ...prev,
                                                                recommendations: {
                                                                    ...prev.recommendations,
                                                                    [recSearchTarget.type]: [...prev.recommendations[recSearchTarget.type], prod.id]
                                                                }
                                                            }));
                                                            setProductSearch('');
                                                            setRecSearchTarget(null);
                                                        }}
                                                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <div className="w-10 h-10 rounded-lg bg-slate-800 overflow-hidden flex-shrink-0">
                                                            <img src={resolveMediaUrl(prod.images?.[0])} alt="" className="w-full h-full object-cover" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="text-[11px] font-bold text-white truncate">{prod.name}</div>
                                                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">{prod.brand || 'No Brand'}</div>
                                                        </div>
                                                        {newProductData.recommendations[recSearchTarget.type].includes(prod.id) && (
                                                            <CheckCircle2 size={14} className="ml-auto text-emerald-500" />
                                                        )}
                                                    </button>
                                                ))
                                            }
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STICKY ACTION BAR */}
                            <div className="fixed bottom-0 left-0 right-0 p-8 pt-10 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent z-[100] flex justify-center">
                                <div className="max-w-5xl w-full flex items-center justify-between gap-6 px-10 py-6 bg-slate-900/40 backdrop-blur-2xl border border-white/10 rounded-[32px] shadow-2xl shadow-amber-400/5 animate-in slide-in-from-bottom-12 duration-700">
                                    <div className="hidden md:block">
                                        <div className="text-xs font-black text-white uppercase tracking-widest">Unsaved Configuration</div>
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter mt-0.5">Review all sections before global registration</p>
                                    </div>

                                    <div className="flex items-center gap-4 w-full md:w-auto">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowAddProductView(false);
                                                setEditingItemId(null);
                                                setNewProductData(INITIAL_PRODUCT_STATE);
                                                setProductSearch('');
                                            }}
                                            className="flex-1 md:w-48 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5 transition-all outline-none"
                                        >
                                            Discard Changes
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="flex-[2] md:w-72 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 py-4 rounded-2xl font-black text-sm transition-all hover:scale-[1.02] active:scale-[0.98] shadow-2xl shadow-amber-400/20 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:grayscale outline-none"
                                        >
                                            {loading ? (
                                                <Loader2 size={18} className="animate-spin" />
                                            ) : (
                                                <>
                                                    <Zap size={18} className="fill-slate-950 transition-transform group-hover:scale-125" />
                                                    {editingItemId ? 'UPDATE PRODUCT' : 'CREATE & REGISTER PRODUCT'}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 rounded-lg bg-amber-400/10 text-amber-500">
                                    <Package size={20} />
                                </div>
                                <span className="text-sm font-black uppercase tracking-[0.2em] text-amber-500">Logistics Control</span>
                            </div>
                            <h1 className="text-4xl font-black text-white tracking-tight">Inventory Management</h1>
                            <p className="text-slate-400 mt-2 font-medium">Monitor and manage your warehouse stock in real-time.</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowAddProductView(true)}
                                className="flex items-center gap-2 bg-amber-400 hover:bg-amber-500 text-slate-950 px-8 py-3.5 rounded-2xl font-black text-sm transition-all hover:scale-105 active:scale-95 shadow-xl shadow-amber-400/10 group"
                            >
                                <Plus size={18} className="transition-transform group-hover:rotate-90" />
                                ADD NEW PRODUCT
                            </button>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                            { label: 'Total SKUs', value: stats.totalItems, icon: Package, color: 'emerald' },
                            { label: 'Low Stock', value: stats.lowStock, icon: AlertCircle, color: 'amber' },
                            { label: 'Out of Stock', value: stats.outOfStock, icon: XCircle, color: 'rose' },
                            { label: 'Featured', value: stats.featured, icon: Zap, color: 'indigo' },
                            { label: 'Total Units', value: stats.totalUnits, icon: CheckCircle2, color: 'blue' }
                        ].map((stat, i) => (
                            <div key={i} className="warehouse-panel p-6 border border-white/5 hover:border-white/10 transition-colors">
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`p-2.5 rounded-xl bg-${stat.color}-400/10 text-${stat.color}-400`}>
                                        <stat.icon size={20} />
                                    </div>
                                    <div className="h-1 w-8 rounded-full bg-white/5" />
                                </div>
                                <div className="text-2xl font-black text-white">{stat.value}</div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Controls & Table */}
                    <div className="warehouse-panel overflow-hidden border border-white/5">
                        {/* Search & Filter Bar */}
                        <div className="p-6 border-b border-white/5 flex flex-col lg:flex-row gap-4 justify-between bg-white/[0.02]">
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search by product name or SKU..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 pl-12 pr-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-400/50 transition-all"
                                />
                            </div>

                            <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0">
                                {[
                                    { id: 'all', label: 'All Items' },
                                    { id: 'featured', label: 'Featured' },
                                    { id: 'low', label: 'Low Stock' },
                                    { id: 'out', label: 'Out of Stock' }
                                ].map((btn) => (
                                    <button
                                        key={btn.id}
                                        onClick={() => setFilterStatus(btn.id)}
                                        className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${filterStatus === btn.id
                                                ? 'bg-white/10 text-white border border-white/20'
                                                : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                            }`}
                                    >
                                        {btn.label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0 border-l border-white/5 pl-4 ml-2">
                                {[
                                    { id: 'all', label: 'All States' },
                                    { id: 'draft', label: 'Draft' },
                                    { id: 'testing', label: 'Testing' },
                                    { id: 'live', label: 'Live' },
                                    { id: 'archived', label: 'Archived' },
                                    { id: 'coming_soon', label: 'Coming Soon' }
                                ].map((btn) => (
                                    <button
                                        key={btn.id}
                                        onClick={() => setLifecycleFilter(btn.id)}
                                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${lifecycleFilter === btn.id
                                                ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                                : 'text-slate-600 hover:text-slate-400 border border-transparent'
                                            }`}
                                    >
                                        {btn.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-white/[0.01]">
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-white/5 whitespace-nowrap">Product Detail</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-white/5">SKU / Bin</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-white/5">Available</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-white/5">Status</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-white/5">Lifecycle</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-white/5 text-right">Operations</th>

                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {filteredInventory.length > 0 ? filteredInventory.map((item) => {
                                        const isOut = item.stock_quantity <= 0;
                                        const isLow = item.stock_quantity <= (item.low_stock_threshold || 5) && item.stock_quantity > 0;

                                        return (
                                            <tr key={item.id} onClick={() => setSelectedItem(item)} className="group hover:bg-white/[0.03] transition-colors cursor-pointer">
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 shrink-0 rounded-xl bg-slate-800 border border-white/5 flex items-center justify-center text-slate-500 overflow-hidden group-hover:border-amber-400/20 transition-all">
                                                            {(() => {
                                                                let displayImage = null;
                                                                if (item.images) {
                                                                    try {
                                                                        const parsed = JSON.parse(item.images);
                                                                        displayImage = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : item.images;
                                                                    } catch (e) {
                                                                        displayImage = item.images;
                                                                    }
                                                                }
                                                                if (displayImage) {
                                                                    if (displayImage.startsWith('/') || !displayImage.startsWith('http')) displayImage = resolveMediaUrl(displayImage);
                                                                    return <img src={displayImage} alt={item.product_name} className="w-full h-full object-cover" />;
                                                                }
                                                                return <Package size={20} />;
                                                            })()}
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                <div className="text-sm font-bold text-white">{item.product_name}</div>
                                                                {(item.is_featured === 1 || item.is_featured === true) && (
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400 text-[8px] font-black uppercase tracking-tighter border border-indigo-500/20">
                                                                        <Zap size={8} fill="currentColor" />
                                                                        Featured
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-400/10 text-amber-500 border border-amber-400/10">
                                                                    <span className="text-[9px] font-black">{item.average_rating || '0.0'}</span>
                                                                    <Star size={8} fill="currentColor" />
                                                                </div>
                                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.category || 'Uncategorized'}</span>
                                                                {item.brand && (
                                                                    <>
                                                                        <span className="w-1 h-1 rounded-full bg-slate-700" />
                                                                        <span className="text-[10px] font-bold text-amber-500/60 uppercase tracking-widest">{item.brand}</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="text-xs font-black text-amber-500/80 mb-1">{item.sku}</div>
                                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                        <MapPin size={10} />
                                                        {item.bin_location || 'NO BIN'}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-col">
                                                        <div className="flex items-baseline gap-1">
                                                            <span className="text-lg font-black text-white">{item.stock_quantity || 0}</span>
                                                            <span className="text-[10px] font-bold text-slate-600 uppercase">Total {item.unit || 'Units'}</span>
                                                        </div>
                                                        <div className={`text-[11px] font-black uppercase tracking-tight ${(item.stock_quantity - (item.reserved_stock || 0)) <= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                                            {Math.max(0, item.stock_quantity - (item.reserved_stock || 0))} Available
                                                        </div>
                                                    </div>
                                                    <div className="text-[9px] font-black uppercase tracking-widest mt-1">
                                                        <span className="text-slate-500">Reserved: {item.reserved_stock || 0}</span>
                                                        {(item.user_reserved > 0 || item.guest_reserved > 0) && (
                                                            <span className="ml-1 opacity-50">
                                                                (U: {item.user_reserved || 0} G: {item.guest_reserved || 0})
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    {isOut ? (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-400/10 text-rose-400 text-[10px] font-black uppercase tracking-wider border border-rose-400/20">
                                                            <span className="w-1 h-1 rounded-full bg-rose-400 animate-pulse" />
                                                            Out of Stock
                                                        </span>
                                                    ) : isLow ? (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/10 text-amber-400 text-[10px] font-black uppercase tracking-wider border border-amber-400/20">
                                                            <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                                                            Low Stock
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-400/10 text-emerald-400 text-[10px] font-black uppercase tracking-wider border border-emerald-400/20">
                                                            Health Optimal
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${item.lifecycle_state === 'live' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                                                                item.lifecycle_state === 'draft' ? 'bg-slate-500' :
                                                                    item.lifecycle_state === 'testing' ? 'bg-blue-500' :
                                                                        item.lifecycle_state === 'archived' ? 'bg-rose-500' :
                                                                            item.lifecycle_state === 'discontinued' ? 'bg-amber-700' :
                                                                                'bg-purple-500'
                                                            }`} />
                                                        <span className={`text-[9px] font-black uppercase tracking-widest ${item.lifecycle_state === 'live' ? 'text-emerald-400' : 'text-slate-500'
                                                            }`}>
                                                            {item.lifecycle_state || 'live'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">

                                                    <div className="flex items-center justify-end gap-2">
                                                        {/* Stock IN */}
                                                        <button
                                                            title="Stock IN"
                                                            onClick={(e) => { e.stopPropagation(); openStockAdjust(item, 'IN'); }}
                                                            className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                                                        >
                                                            <ArrowDownCircle size={16} />
                                                        </button>
                                                        {/* Stock OUT */}
                                                        <button
                                                            title="Stock OUT"
                                                            onClick={(e) => { e.stopPropagation(); openStockAdjust(item, 'OUT'); }}
                                                            className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all"
                                                        >
                                                            <ArrowUpCircle size={16} />
                                                        </button>
                                                        {/* Featured Toggle */}
                                                        <button
                                                            title={item.is_featured ? "Remove from Featured" : "Mark as Featured"}
                                                            onClick={(e) => { e.stopPropagation(); handleToggleFeatured(item); }}
                                                            className={`p-2.5 rounded-xl border transition-all ${(item.is_featured === 1 || item.is_featured === true)
                                                                    ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                                                                    : 'bg-white/5 border-white/5 text-slate-500 hover:text-indigo-400 hover:border-indigo-500/20'
                                                                }`}
                                                        >
                                                            <Zap size={16} fill={(item.is_featured === 1 || item.is_featured === true) ? "currentColor" : "none"} />
                                                        </button>
                                                        {/* Edit */}
                                                        <button
                                                            title="Edit Product"
                                                            onClick={(e) => { e.stopPropagation(); handleEditItem(item); }}
                                                            className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 hover:text-blue-400 hover:border-blue-400/20 transition-all"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        {/* History */}
                                                        <button
                                                            title="Movement History"
                                                            onClick={(e) => { e.stopPropagation(); loadMovements(item); }}
                                                            className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 hover:text-amber-400 hover:border-amber-400/20 transition-all"
                                                        >
                                                            <History size={16} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                                                            className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 hover:text-rose-400 hover:border-rose-400/20 transition-all"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    }) : (
                                        <tr>
                                            <td colSpan="5" className="px-6 py-20 text-center">
                                                <div className="flex flex-col items-center gap-3">
                                                    <Package size={40} className="text-slate-800" />
                                                    <p className="text-slate-500 font-bold uppercase tracking-widest text-sm">No items matching criteria</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Placeholder */}
                        <div className="p-6 bg-white/[0.01] border-t border-white/5 flex items-center justify-between">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Showing {filteredInventory.length} of {inventory.length} items</p>
                            <div className="flex items-center gap-2">
                                <button className="p-2 rounded-lg border border-white/5 text-slate-600 cursor-not-allowed">
                                    <ChevronRight size={16} className="rotate-180" />
                                </button>
                                <button className="p-2 rounded-lg border border-white/10 text-white">
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )

    return (
        <div className="relative">
            {/* Main Inventory UI with Animation */}
            <div className="space-y-8 animate-in fade-in duration-700">
                {mainUI}
            </div>

            {/* Modals & Slide-Overs (Outside Animated Container) */}

            {/* ── Stock Adjust Modal ── */}
            {stockAdjustModal && (() => {
                const isIN = stockAdjustModal.mode === 'IN'
                const reasons = isIN ? IN_REASONS : OUT_REASONS
                return (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setStockAdjustModal(null)} />
                        <div className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-300">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className={`p-3 rounded-2xl ${isIN ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                                        {isIN ? <ArrowDownCircle size={22} /> : <ArrowUpCircle size={22} />}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black text-white">
                                            Stock {isIN ? 'IN' : 'OUT'}
                                        </h3>
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                            {stockAdjustModal.item.product_name}
                                        </p>
                                    </div>
                                </div>
                                <button onClick={() => setStockAdjustModal(null)} className="p-2 rounded-xl text-slate-500 hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Current Stock */}
                            <div className={`rounded-2xl p-4 mb-6 flex items-center justify-between ${isIN ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-rose-500/5 border border-rose-500/20'}`}>
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current Stock</span>
                                <span className="text-2xl font-black text-white">{stockAdjustModal.item.stock_quantity} <span className="text-sm text-slate-500">{stockAdjustModal.item.unit || 'pcs'}</span></span>
                            </div>

                            <div className="space-y-5">
                                {/* Quantity */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Quantity</label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setAdjustQty(q => Math.max(1, q - 1))}
                                            className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 text-white font-black text-xl hover:bg-white/10 transition-all flex items-center justify-center"
                                        >
                                            −
                                        </button>
                                        <input
                                            type="number"
                                            min="1"
                                            max={!isIN ? Math.max(0, stockAdjustModal.item.stock_quantity - (stockAdjustModal.item.reserved_stock || 0)) : undefined}
                                            value={adjustQty}
                                            onChange={e => {
                                                let val = parseInt(e.target.value) || 1;
                                                if (!isIN) {
                                                    const avail = Math.max(0, stockAdjustModal.item.stock_quantity - (stockAdjustModal.item.reserved_stock || 0));
                                                    val = Math.min(val, avail);
                                                }
                                                setAdjustQty(Math.max(1, val));
                                            }}
                                            className="flex-1 bg-slate-950 border border-white/10 rounded-2xl py-3 text-center text-xl font-black text-white focus:outline-none focus:border-amber-400/50"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setAdjustQty(q => {
                                                if (!isIN) {
                                                    const avail = Math.max(0, stockAdjustModal.item.stock_quantity - (stockAdjustModal.item.reserved_stock || 0));
                                                    if (q >= avail) return q;
                                                }
                                                return q + 1;
                                            })}
                                            className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 text-white font-black text-xl hover:bg-white/10 transition-all flex items-center justify-center"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                {/* Reason */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Reason</label>
                                    <div className="flex flex-wrap gap-2">
                                        {reasons.map(r => (
                                            <button
                                                key={r}
                                                onClick={() => setAdjustReason(r)}
                                                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide border transition-all ${adjustReason === r
                                                        ? isIN ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500'
                                                        : 'bg-white/5 text-slate-400 border-white/10 hover:border-white/20'
                                                    }`}
                                            >
                                                {r}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Remark */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Additional Remark <span className="text-slate-600 font-bold normal-case tracking-normal">(optional)</span></label>
                                    <textarea
                                        rows={2}
                                        value={adjustRemark}
                                        onChange={e => setAdjustRemark(e.target.value)}
                                        placeholder="e.g. Batch no. 202, supplier invoice #INV-445..."
                                        className="w-full bg-slate-950 border border-white/10 rounded-2xl py-3 px-5 text-sm text-white font-medium focus:outline-none focus:border-amber-400/50 transition-all resize-none"
                                    />
                                </div>

                                {/* Preview */}
                                {adjustQty > 0 && (
                                    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 flex items-center justify-between">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Stock After</span>
                                        <span className={`text-xl font-black ${isIN ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isIN ? stockAdjustModal.item.stock_quantity + adjustQty : Math.max(0, stockAdjustModal.item.stock_quantity - adjustQty)} pcs
                                            <span className={`text-[10px] font-bold ml-2 ${!isIN && adjustQty > stockAdjustModal.item.stock_quantity ? 'text-rose-500' : 'text-slate-600'}`}>
                                                ({isIN ? '+' : '-'}{adjustQty})
                                            </span>
                                        </span>
                                    </div>
                                )}

                                {/* Submit */}
                                <button
                                    onClick={handleStockAdjust}
                                    disabled={adjusting}
                                    className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${isIN
                                            ? 'bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-50'
                                            : 'bg-rose-500 hover:bg-rose-400 text-white disabled:opacity-50'
                                        }`}
                                >
                                    {adjusting ? <Loader2 size={18} className="animate-spin" /> : (isIN ? <TrendingUp size={18} /> : <TrendingDown size={18} />)}
                                    {adjusting ? 'Processing...' : `Confirm Stock ${isIN ? 'IN' : 'OUT'}`}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            })()}

            {/* ── Movement History Modal ── */}
            {showHistory && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowHistory(null)} />
                    <div className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-300 max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-400">
                                    <History size={22} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-white">Movement History</h3>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{showHistory.product_name}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowHistory(null)} className="p-2 rounded-xl text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                            {loadingMovements ? (
                                <div className="flex justify-center py-12">
                                    <Loader2 size={28} className="text-amber-400 animate-spin" />
                                </div>
                            ) : movements.length === 0 ? (
                                <div className="text-center py-12 text-slate-600">
                                    <History size={32} className="mx-auto mb-3 opacity-30" />
                                    <p className="text-sm font-bold">No movements recorded yet</p>
                                </div>
                            ) : movements.map(m => (
                                <div key={m.id} className={`rounded-2xl p-4 border ${m.movement_type === 'IN' ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-rose-500/5 border-rose-500/15'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-xl ${m.movement_type === 'IN' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                                                {m.movement_type === 'IN' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] font-black uppercase tracking-widest ${m.movement_type === 'IN' ? 'text-emerald-400' : 'text-rose-400'}`}>{m.movement_type}</span>
                                                    <span className="text-white font-black">+{m.quantity} pcs</span>
                                                </div>
                                                <p className="text-xs text-slate-400 font-medium mt-0.5">{m.reason}</p>
                                                {m.remark && <p className="text-[10px] text-slate-600 mt-0.5 italic">"{m.remark}"</p>}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[10px] text-slate-600 font-bold">{m.stock_before} → {m.stock_after}</p>
                                            <p className="text-[9px] text-slate-700 mt-1">{new Date(m.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── CREATE BRAND MODAL ── */}
            {showCreateBrandModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                        onClick={() => setShowCreateBrandModal(false)}
                    />
                    <div className="relative w-full max-w-sm bg-slate-900 border border-white/10 rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-300">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-2xl bg-blue-400/10 text-blue-400">
                                    <Tag size={22} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-white">Register Brand</h3>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Global brand identity</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowCreateBrandModal(false)}
                                className="p-2 rounded-xl text-slate-500 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Brand Name</label>
                                <input
                                    type="text"
                                    value={newBrandName}
                                    onChange={(e) => setNewBrandName(e.target.value)}
                                    placeholder="e.g. Samsung, Apple..."
                                    className="w-full bg-slate-950 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-blue-400/50 transition-all outline-none"
                                />
                            </div>

                            <button
                                onClick={handleCreateBrand}
                                disabled={isCreatingBrand || !newBrandName.trim()}
                                className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-2xl py-4 font-black uppercase tracking-widest text-xs shadow-lg shadow-blue-500/10 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isCreatingBrand ? (
                                    <div className="flex items-center justify-center gap-2">
                                        <RefreshCw size={14} className="animate-spin" />
                                        Registering...
                                    </div>
                                ) : 'Create Brand'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CREATE CATEGORY MODAL ── */}
            {showCreateCategoryModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                        onClick={() => setShowCreateCategoryModal(false)}
                    />
                    <div className="relative w-full max-w-sm bg-slate-900 border border-white/10 rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-300">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-400">
                                    <Layers size={22} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-white">Create Category</h3>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Add a new product taxonomy</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowCreateCategoryModal(false)}
                                className="p-2 rounded-xl text-slate-500 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Emoji Picker Row */}
                        <div className="space-y-2 mb-4">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Category Emoji</label>
                            <div className="flex flex-wrap gap-2">
                                {['📦', '🛒', '🔌', '📱', '💊', '🍎', '👕', '🏠', '🎮', '🚗', '🧴', '📚', '🧪', '🎵', '🌿', '💎'].map(em => (
                                    <button
                                        key={em}
                                        type="button"
                                        onClick={() => setNewCategoryEmoji(em)}
                                        className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border transition-all ${newCategoryEmoji === em ? 'bg-amber-400/20 border-amber-400/50 scale-110' : 'bg-white/5 border-white/5 hover:border-white/10'}`}
                                    >
                                        {em}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Name Input */}
                        <div className="space-y-2 mb-6">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Category Name</label>
                            <div className="flex items-center gap-3 bg-slate-950/50 border border-white/10 rounded-2xl px-4 py-3 focus-within:border-amber-400/50 transition-all">
                                <span className="text-2xl">{newCategoryEmoji}</span>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="e.g. Electronics, Groceries..."
                                    value={newCategoryName}
                                    onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleCreateCategory() }}
                                    className="flex-1 bg-transparent text-sm text-white font-bold focus:outline-none placeholder:text-slate-600"
                                />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => { setShowCreateCategoryModal(false); setNewCategoryName(''); setNewCategoryEmoji('📦') }}
                                className="flex-1 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateCategory}
                                disabled={isCreatingCategory || !newCategoryName.trim()}
                                className="flex-[2] bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-amber-400/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale"
                            >
                                {isCreatingCategory ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Plus size={14} />
                                )}
                                {isCreatingCategory ? 'Creating...' : 'Create Category'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════
                PRODUCT DETAIL PANEL (Slide-Over)
            ═══════════════════════════════════════════════════════ */}
            {selectedItem && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-200"
                        onClick={() => setSelectedItem(null)}
                    />
                    {/* Panel */}
                    <div className="fixed right-0 top-0 h-full w-full max-w-md bg-slate-950 border-l border-white/5 z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 shrink-0">
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-500 mb-1">Product Details</p>
                                <h2 className="text-lg font-black text-white truncate">{selectedItem.product_name}</h2>
                            </div>
                            <button
                                onClick={() => setSelectedItem(null)}
                                className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-all"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {/* Image Gallery */}
                            {(() => {
                                let imageList = [];
                                try {
                                    if (selectedItem.images) {
                                        const p = JSON.parse(selectedItem.images);
                                        imageList = Array.isArray(p) ? p : [selectedItem.images];
                                    }
                                } catch { imageList = selectedItem.images ? [selectedItem.images] : []; }
                                return imageList.length > 0 ? (
                                    <div className="grid grid-cols-3 gap-3">
                                        {imageList.map((url, i) => (
                                            <div key={i} className="aspect-square rounded-2xl overflow-hidden bg-slate-900 border border-white/5">
                                                <img src={resolveMediaUrl(url)} alt={`img-${i + 1}`} className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="aspect-video rounded-2xl bg-slate-900 border border-white/5 flex items-center justify-center">
                                        <Package size={40} className="text-slate-700" />
                                    </div>
                                );
                            })()}

                            {/* Category & Brand */}
                            <div className="flex flex-wrap gap-2">
                                {selectedItem.category && (
                                    <span className="px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-400 text-[10px] font-black uppercase tracking-widest">{selectedItem.category}</span>
                                )}
                                {selectedItem.sub_category && (
                                    <span className="px-3 py-1 rounded-full bg-blue-400/10 border border-blue-400/20 text-blue-400 text-[10px] font-black uppercase tracking-widest">{selectedItem.sub_category}</span>
                                )}
                                {selectedItem.brand && (
                                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/5 text-slate-400 text-[10px] font-black uppercase tracking-widest">{selectedItem.brand}</span>
                                )}
                            </div>

                            {/* Description */}
                            {selectedItem.description && (
                                <div className="space-y-2">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Description</p>
                                    <p className="text-sm text-slate-300 font-medium leading-relaxed whitespace-pre-line">{selectedItem.description}</p>
                                </div>
                            )}

                            {/* Key Stats Grid */}
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: 'Stock', value: `${selectedItem.stock_quantity} ${selectedItem.unit || 'pcs'}`, color: selectedItem.stock_quantity === 0 ? 'text-rose-400' : selectedItem.stock_quantity <= selectedItem.low_stock_threshold ? 'text-amber-400' : 'text-emerald-400' },
                                    {
                                        label: 'Reserved',
                                        value: `${selectedItem.reserved_stock || 0}${(selectedItem.user_reserved > 0 || selectedItem.guest_reserved > 0) ? ` (U:${selectedItem.user_reserved || 0} G:${selectedItem.guest_reserved || 0})` : ''}`,
                                        color: 'text-slate-300'
                                    },
                                    { label: 'Selling Price', value: (selectedItem.selling_price !== undefined && selectedItem.selling_price !== null) ? `₹${selectedItem.selling_price}` : '—', color: 'text-amber-400' },
                                    { label: 'Cost Price', value: (selectedItem.cost_price !== undefined && selectedItem.cost_price !== null) ? `₹${selectedItem.cost_price}` : '—', color: 'text-slate-300' },
                                    { label: 'Low Stock Alert', value: selectedItem.low_stock_threshold, color: 'text-slate-300' },
                                    { label: 'SKU', value: selectedItem.sku, color: 'text-amber-400' },
                                ].map(({ label, value, color }) => (
                                    <div key={label} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1">{label}</p>
                                        <p className={`text-sm font-black ${color}`}>{value}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Return Policy Section */}
                            <div className="space-y-2 p-4 rounded-2xl bg-emerald-500/[0.03] border border-emerald-500/10">
                                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500/60 mb-1">Return Policy</p>
                                <div className="space-y-1.5">
                                    {(selectedItem.return_policy || 'Default Policy').split('\n').filter(p => p.trim()).map((point, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <div className="w-1 h-1 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                                            <p className="text-[11px] font-bold text-emerald-100 leading-tight">{point.trim()}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Bin Location */}
                            {selectedItem.bin_location && (
                                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-amber-400/10 text-amber-400">
                                        <MapPin size={14} />
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Bin Location</p>
                                        <p className="text-sm font-black text-white">{selectedItem.bin_location}</p>
                                    </div>
                                </div>
                            )}

                            {/* Customer Feedback & Ratings */}
                            <div className="space-y-4 pt-4 border-t border-white/5">
                                <div className="flex items-center justify-between">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Customer Feedback</p>
                                    {itemStats.total > 0 && (
                                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-400/10 text-amber-500">
                                            <Star size={10} fill="currentColor" />
                                            <span className="text-[10px] font-black">{itemStats.average}</span>
                                        </div>
                                    )}
                                </div>

                                {loadingReviews ? (
                                    <div className="flex items-center gap-3 py-4">
                                        <Loader2 size={16} className="animate-spin text-slate-600" />
                                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Fetching reviews...</span>
                                    </div>
                                ) : itemReviews.length === 0 ? (
                                    <div className="p-6 rounded-2xl bg-white/[0.01] border border-dashed border-white/5 text-center">
                                        <MessageSquare size={24} className="mx-auto mb-2 text-slate-800" />
                                        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">No customer reviews yet</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {itemReviews.slice(0, 3).map((rev) => (
                                            <div key={rev.id} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center text-[8px] font-black text-slate-500">
                                                            {rev.user_name?.charAt(0) || 'U'}
                                                        </div>
                                                        <span className="text-[10px] font-black text-slate-300">{rev.user_name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-0.5 text-amber-400">
                                                        {[1, 2, 3, 4, 5].map(s => (
                                                            <Star key={s} size={8} fill={s <= rev.rating ? "currentColor" : "none"} className={s <= rev.rating ? "" : "text-slate-800"} />
                                                        ))}
                                                    </div>
                                                </div>
                                                <p className="text-[11px] text-slate-400 font-medium leading-relaxed italic line-clamp-2">"{rev.review_text}"</p>
                                            </div>
                                        ))}
                                        {itemReviews.length > 3 && (
                                            <p className="text-center text-[9px] font-black text-slate-600 uppercase tracking-widest">+ {itemReviews.length - 3} more reviews available in store</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Status */}
                            <div className={`p-4 rounded-2xl border flex items-center gap-3 ${selectedItem.stock_quantity === 0 ? 'bg-rose-500/5 border-rose-500/20' : selectedItem.stock_quantity <= selectedItem.low_stock_threshold ? 'bg-amber-400/5 border-amber-400/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                                <div className={`w-2 h-2 rounded-full ${selectedItem.stock_quantity === 0 ? 'bg-rose-500' : selectedItem.stock_quantity <= selectedItem.low_stock_threshold ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                                <p className={`text-xs font-black uppercase tracking-widest ${selectedItem.stock_quantity === 0 ? 'text-rose-400' : selectedItem.stock_quantity <= selectedItem.low_stock_threshold ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {selectedItem.stock_quantity === 0 ? 'Out of Stock' : selectedItem.stock_quantity <= selectedItem.low_stock_threshold ? 'Low Stock' : 'Health Optimal'}
                                </p>
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="p-6 border-t border-white/5 shrink-0 flex gap-3">
                            <button
                                onClick={() => { setSelectedItem(null); handleEditItem(selectedItem); }}
                                className="flex-1 py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                            >
                                <Edit2 size={14} /> Edit Product
                            </button>
                            <button
                                onClick={() => { setSelectedItem(null); openStockAdjust(selectedItem, 'IN'); }}
                                className="flex-1 py-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                            >
                                <ArrowDownCircle size={14} /> Stock IN
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

export default WarehouseInventory
