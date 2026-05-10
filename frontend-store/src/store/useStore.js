import toast from "react-hot-toast"
import { create } from 'zustand'
import { API_BASE_URL } from '../config'
import { getDeviceModelValue } from '../utils/stickerCustomization'

const syncCartWithServer = async (productId, quantity, action = 'add') => {
    const token = localStorage.getItem('token');
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('sessionId', sessionId);
    }

    try {
        await fetch(`${API_BASE_URL}/cart`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ product_id: productId, quantity, action, session_id: sessionId })
        });
    } catch (e) {
        console.error('Failed to sync cart:', e);
    }
}

const getAvailableStock = (product) => {
    if (!product) return 0;
    // Standardize stock field - preferring 'stock' as per refactoring but keeping fallbacks
    const physical = Number(product.stock ?? product.physical_stock ?? product.stock_quantity ?? 0);
    const hardReserved = Number(product.hard_reserved ?? 0);
    return Math.max(0, physical - hardReserved);
}

const safeParse = (key) => {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        console.warn(`Error parsing localStorage key "${key}":`, e);
        return null;
    }
}

export const useStore = create((set) => ({
    user: safeParse('user'),
    token: localStorage.getItem('token') || null,
    adminUser: safeParse('adminUser'),
    adminToken: localStorage.getItem('adminToken') || null,
    warehouseUser: safeParse('warehouseUser'),
    warehouseToken: localStorage.getItem('warehouseToken') || null,
    warehouseRequestUser: safeParse('warehouseRequestUser'),
    warehouseRequestToken: localStorage.getItem('warehouseRequestToken') || null,
    cart: safeParse('cart') || [],
    theme: localStorage.getItem('theme') || 'light',
    fetchCart: async () => {
        const state = useStore.getState();
        if (!state.token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/cart`, {
                headers: { 'Authorization': `Bearer ${state.token}` }
            });
            const json = await res.json();
            if (res.ok && json.success) {
                const normalizedCart = Array.isArray(json.data) ? json.data : [];
                set({ cart: normalizedCart });
                localStorage.setItem('cart', JSON.stringify(normalizedCart));
            }
        } catch (e) {
            console.error('Failed to fetch cart:', e);
        }
    },
    setUser: (user, token) => {
        if (user && token) {
            localStorage.setItem('user', JSON.stringify(user));
            localStorage.setItem('token', token);
            // Auto-fetch cart and wishlist after login
            set({ user, token });
            useStore.getState().fetchCart();
            useStore.getState().fetchWishlist();
        } else {
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            set({ user, token });
        }
    },
    logout: () => {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        localStorage.removeItem('cart');
        set({ user: null, token: null, cart: [] });
    },
    setAdminUser: (adminUser, adminToken) => {
        if (adminUser && adminToken) {
            localStorage.setItem('adminUser', JSON.stringify(adminUser));
            localStorage.setItem('adminToken', adminToken);
        } else {
            localStorage.removeItem('adminUser');
            localStorage.removeItem('adminToken');
        }
        set({ adminUser, adminToken });
    },
    adminLogout: () => {
        localStorage.removeItem('adminUser');
        localStorage.removeItem('adminToken');
        set({ adminUser: null, adminToken: null });
    },
    setWarehouseUser: (warehouseUser, warehouseToken) => {
        if (warehouseUser && warehouseToken) {
            localStorage.setItem('warehouseUser', JSON.stringify(warehouseUser));
            localStorage.setItem('warehouseToken', warehouseToken);
        } else {
            localStorage.removeItem('warehouseUser');
            localStorage.removeItem('warehouseToken');
        }
        set({ warehouseUser, warehouseToken });
    },
    warehouseLogout: () => {
        localStorage.removeItem('warehouseUser');
        localStorage.removeItem('warehouseToken');
        set({ warehouseUser: null, warehouseToken: null });
    },
    setWarehouseRequestUser: (warehouseRequestUser, warehouseRequestToken) => {
        if (warehouseRequestUser && warehouseRequestToken) {
            localStorage.setItem('warehouseRequestUser', JSON.stringify(warehouseRequestUser));
            localStorage.setItem('warehouseRequestToken', warehouseRequestToken);
        } else {
            localStorage.removeItem('warehouseRequestUser');
            localStorage.removeItem('warehouseRequestToken');
        }
        set({ warehouseRequestUser, warehouseRequestToken });
    },
    clearWarehouseRequestUser: () => {
        localStorage.removeItem('warehouseRequestUser');
        localStorage.removeItem('warehouseRequestToken');
        set({ warehouseRequestUser: null, warehouseRequestToken: null });
    },
    addToCart: (product) => set((state) => {
        const deviceModel = getDeviceModelValue(product?.device_model);
        const existing = state.cart.find(item => String(item.id) === String(product.id));
        const availableStock = getAvailableStock(product)
        
        if (availableStock <= 0) {
            return state
        }

        let newCart;
        if (existing) {
            if (existing.qty >= availableStock) {
                return state
            }
            newCart = state.cart.map(item =>
                String(item.id) === String(product.id) ? { ...item, device_model: deviceModel || item.device_model || null, fitting: product.fitting ?? item.fitting ?? false, qty: item.qty + 1 } : item
            );
        } else {
            newCart = [
                ...state.cart,
                {
                    ...product,
                    device_model: deviceModel || null,
                    fitting: product.fitting ?? false,
                    stock: availableStock,
                    reserved_stock: Number(product?.reserved_stock ?? 0),
                    qty: 1,
                },
            ];
        }

        localStorage.setItem('cart', JSON.stringify(newCart));
        syncCartWithServer(product.id, 1, 'add');
        return { cart: newCart };
    }),
    removeFromCart: (productId) => set((state) => {
        const newCart = state.cart.filter(item => String(item.id) !== String(productId));
        localStorage.setItem('cart', JSON.stringify(newCart));
        syncCartWithServer(productId, 0, 'remove');
        return { cart: newCart };
    }),
    updateQuantity: (productId, qty) => set((state) => {
        let finalQty = qty;
        const newCart = state.cart.map(item => {
            if (String(item.id) !== String(productId)) return item;
            const maxQty = getAvailableStock(item);
            finalQty = Math.max(1, Math.min(qty, maxQty));
            return { ...item, qty: finalQty };
        });
        localStorage.setItem('cart', JSON.stringify(newCart));
        syncCartWithServer(productId, finalQty, 'update');
        return { cart: newCart };
    }),
    updateDeviceModel: (productId, deviceModel) => set((state) => {
        const normalizedDeviceModel = getDeviceModelValue(deviceModel);
        const newCart = state.cart.map(item =>
            String(item.id) === String(productId) ? { ...item, device_model: normalizedDeviceModel || null } : item
        );
        localStorage.setItem('cart', JSON.stringify(newCart));
        return { cart: newCart };
    }),
    toggleFittingService: (productId) => set((state) => {
        const newCart = state.cart.map(item =>
            String(item.id) === String(productId) ? { ...item, fitting: !item.fitting } : item
        );
        localStorage.setItem('cart', JSON.stringify(newCart));
        return { cart: newCart };
    }),
    clearCart: () => {
        localStorage.removeItem('cart');
        set({ cart: [] });
    },
    registerForNotification: async (productId, email) => {
        const { user } = useStore.getState();
        try {
            const response = await fetch(`${API_BASE_URL}/products/${productId}/notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email, 
                    user_id: user?.id 
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to register notification');
            return { success: true, message: result.message };
        } catch (error) {
            console.error('Notification error:', error);
            return { success: false, message: error.message };
        }
    },
    toggleTheme: () => set((state) => {
        const newTheme = state.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
        return { theme: newTheme };
    }),
    globalSearchQuery: '',
    setGlobalSearchQuery: (query) => set({ globalSearchQuery: query }),
    isSearching: false,
    setIsSearching: (val) => set({ isSearching: val }),
    
    // Delivery & Location Logic
    deliveryMode: localStorage.getItem('deliveryMode') || 'scheduled', // 'quick' or 'scheduled'
    userLocation: safeParse('userLocation'), // { lat, lng, address }
    setDeliveryMode: (mode) => {
        localStorage.setItem('deliveryMode', mode);
        set({ deliveryMode: mode });
    },
    setUserLocation: (location) => {
        if (location) {
            localStorage.setItem('userLocation', JSON.stringify(location));
        } else {
            localStorage.removeItem('userLocation');
        }
        set({ userLocation: location });
    },
    nearestStoreId: null,
    setNearestStoreId: (id) => set({ nearestStoreId: id }),
    isCheckingLocation: false,
    setIsCheckingLocation: (val) => set({ isCheckingLocation: val }),
    products: [],
    fetchProducts: async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/products?_t=${Date.now()}`);
            const data = await res.json();
            const normalized = Array.isArray(data) ? data : (data.data || []);
            set({ products: normalized });
            return normalized;
        } catch (e) {
            console.error('Failed to fetch products:', e);
            return [];
        }
    },
    syncCartWithInventory: async () => {
        const state = useStore.getState();
        if (state.cart.length === 0) return;

        try {
            const promises = state.cart.map(async (item) => {
                try {
                    const res = await fetch(`${API_BASE_URL}/products/${item.id}?_t=${Date.now()}`);
                    if (!res.ok) {
                        return { ...item, removedFromInventory: true, stock: 0 };
                    }
                    const freshProduct = await res.json();
                    
                    // Standardize stock field matching the refactor
                    const physical = Number(freshProduct.stock ?? freshProduct.physical_stock ?? freshProduct.stock_quantity ?? 0);
                    const hardReserved = Number(freshProduct.hard_reserved ?? 0);
                    const available = Math.max(0, physical - hardReserved);
                    
                    return { 
                        ...item, 
                        ...freshProduct, 
                        stock: available,
                        qty: Math.min(item.qty, Math.max(1, available)),
                        removedFromInventory: false 
                    };
                } catch (err) {
                    return { ...item, removedFromInventory: true, stock: 0 };
                }
            });
            
            const newCart = await Promise.all(promises);
            
            set({ cart: newCart });
            localStorage.setItem('cart', JSON.stringify(newCart));
        } catch (e) {
            console.error('Failed to sync cart with inventory:', e);
        }
    },
    
    recentlyViewed: safeParse('recentlyViewed') || [],
    addToRecentlyViewed: (product) => set((state) => {
        if (!product || !product.id) return state;
        const filtered = state.recentlyViewed.filter(item => String(item.id) !== String(product.id));
        const newList = [product, ...filtered].slice(0, 10);
        localStorage.setItem('recentlyViewed', JSON.stringify(newList));
        return { recentlyViewed: newList };
    }),
    
    // Wishlist Logic
    wishlist: safeParse('wishlist') || [],
    fetchWishlist: async () => {
        const state = useStore.getState();
        if (!state.token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/wishlist`, {
                headers: { 'Authorization': `Bearer ${state.token}` }
            });
            const data = await res.json();
            if (res.ok) {
                const normalized = Array.isArray(data) ? data : (data.data || []);
                set({ wishlist: normalized });
                localStorage.setItem('wishlist', JSON.stringify(normalized));
            }
        } catch (e) {
            console.error('Failed to fetch wishlist:', e);
        }
    },
    toggleWishlist: async (product) => {
        const state = useStore.getState();
        if (!state.token) {
            toast.error('Please login to use wishlist');
            return;
        }

        const isInWishlist = state.wishlist.some(item => String(item.id) === String(product.id));
        
        try {
            if (isInWishlist) {
                const res = await fetch(`${API_BASE_URL}/wishlist/${product.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${state.token}` }
                });
                if (res.ok) {
                    const newWishlist = state.wishlist.filter(item => String(item.id) !== String(product.id));
                    set({ wishlist: newWishlist });
                    localStorage.setItem('wishlist', JSON.stringify(newWishlist));
                }
            } else {
                const res = await fetch(`${API_BASE_URL}/wishlist`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.token}`
                    },
                    body: JSON.stringify({ product_id: product.id })
                });
                if (res.ok) {
                    const newWishlist = [...state.wishlist, product];
                    set({ wishlist: newWishlist });
                    localStorage.setItem('wishlist', JSON.stringify(newWishlist));
                }
            }
        } catch (e) {
            console.error('Wishlist toggle failed:', e);
        }
    },

    // PWA Install Prompt State
    pwaInstallPrompt: null,
    setPwaInstallPrompt: (prompt) => set({ pwaInstallPrompt: prompt }),
    clearPwaInstallPrompt: () => set({ pwaInstallPrompt: null })
}))
