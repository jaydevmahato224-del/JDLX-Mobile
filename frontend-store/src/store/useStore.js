import toast from "react-hot-toast"
import { create } from 'zustand'
import { API_BASE_URL } from '../config'
import { getDeviceModelValue } from '../utils/stickerCustomization'
import { refreshRecentlyViewed } from '../utils/recentlyViewedSync'
import { apiFetch } from '../utils/apiFetch'

let processingSync = false;

const syncCartWithServer = async (productId, quantity, action = 'add', variantId = null) => {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('sessionId', sessionId);
    }

    try {
        const response = await apiFetch('/cart', {
            method: 'POST',
            body: JSON.stringify({ product_id: productId, quantity, action, session_id: sessionId, variant_id: variantId })
        });
        return response.ok;
    } catch (e) {
        console.error('Failed to sync cart:', e);
        return false;
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

export const useStore = create((set, get) => ({
    user: safeParse('user'),
    // Restored: several components (Cart, Wishlist, Home, useAppReview, …)
    // select `state.token` to tell a logged-in user apart from a guest. The
    // field went missing in the HttpOnly-cookie refactor, which made every
    // `token` check evaluate to undefined — Cart showed the login modal for
    // logged-in users and Wishlist redirected everyone to /login.
    token: localStorage.getItem('userToken') || null,
    adminUser: safeParse('adminUser'),
    adminToken: localStorage.getItem('adminToken') || null,
    warehouseUser: safeParse('warehouseUser'),
    warehouseToken: localStorage.getItem('warehouseToken') || null,
    warehouseRequestUser: safeParse('warehouseRequestUser'),
    warehouseRequestToken: localStorage.getItem('warehouseRequestToken') || null,
    cart: safeParse('cart') || [],
    isCartLoaded: false,
    _fetchCartInProgress: false,
    theme: localStorage.getItem('theme') || 'light',
    storeBlocked: false,
    setStoreBlocked: (val) => set({ storeBlocked: val }),
    constructionMode: false,
    constructionModeMessage: 'Our website is currently undergoing scheduled maintenance and upgrades. JDLX Mobile will be back online with exciting new premium products soon. Thank you for your patience!',
    setConstructionMode: (val) => set({ constructionMode: val }),
    fetchCart: async () => {
        // Guard: prevent overlapping fetchCart calls causing race conditions
        if (get()._fetchCartInProgress) return;
        set({ _fetchCartInProgress: true });

        // Only show loading screen if we have NO cached cart at all
        const cachedCart = safeParse('cart');
        if (!cachedCart || cachedCart.length === 0) {
            set({ isCartLoaded: false });
        }
        let sessionId = localStorage.getItem('sessionId');
        if (!sessionId) {
            sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('sessionId', sessionId);
        }

        try {
            const res = await apiFetch(`/cart?session_id=${sessionId}&_t=${Date.now()}`);
            const json = await res.json();

            if (res.ok && json.success) {
                const serverCart = Array.isArray(json.data) ? json.data : [];
                // Standardize and deduplicate server cart items to match local structure
                const serverCartMapped = [];
                for (const item of serverCart) {
                    const stock = Number(item.stock ?? 0);
                    const currentQty = Number(item.qty || item.quantity || 1);
                    const safeQty = isNaN(currentQty) ? 1 : currentQty;
                    
                    const existingMapped = serverCartMapped.find(m => 
                        String(m.product_id) === String(item.product_id) && 
                        (m.variant_id === item.variant_id || (m.variant_id === null && item.variant_id === null) || (m.variant_id === undefined && item.variant_id === undefined))
                    );
                    
                    if (existingMapped) {
                        existingMapped.qty = Math.min(existingMapped.qty + safeQty, Math.max(1, stock));
                    } else {
                        serverCartMapped.push({
                            ...item,
                            id: item.product_id, // Map product_id back to id for UI
                            stock: stock,
                            qty: Math.min(safeQty, Math.max(1, stock)),
                            removedFromInventory: false
                        });
                    }
                }

                // Smart Merge: Preserve local storage cart items so they aren't lost
                const localCart = safeParse('cart') || [];
                const mergedCart = [...serverCartMapped];
                const itemsToSync = [];

                for (const localItem of localCart) {
                    const existsOnServer = mergedCart.find(item => 
                        String(item.id) === String(localItem.id) && 
                        (item.variant_id === localItem.variant_id || (item.variant_id === null && localItem.variant_id === null) || (item.variant_id === undefined && localItem.variant_id === undefined))
                    );

                    if (!existsOnServer) {
                        mergedCart.push(localItem);
                        itemsToSync.push({ item: localItem, action: 'add' });
                    } else {
                        // Merge attributes
                        existsOnServer.device_model = localItem.device_model || existsOnServer.device_model;
                        existsOnServer.fitting = localItem.fitting || existsOnServer.fitting;
                        if (localItem.qty !== existsOnServer.qty) {
                            // Keep the higher of local/server qty (existing merge
                            // behavior) but never exceed the available stock, so
                            // a stale local cart can't inflate quantity past
                            // what's actually in inventory.
                            existsOnServer.qty = Math.min(Math.max(localItem.qty, existsOnServer.qty), Math.max(1, existsOnServer.stock));
                            itemsToSync.push({ item: existsOnServer, action: 'update' });
                        }
                    }
                }
                
                set({ cart: mergedCart });
                localStorage.setItem('cart', JSON.stringify(mergedCart));
                
                // Instantly mark loaded so UI renders without latency
                set({ isCartLoaded: true });

                // Sync unsynced items to the server in the background
                if (itemsToSync.length > 0) {
                    for (const { item, action } of itemsToSync) {
                        await syncCartWithServer(item.id, item.qty, action);
                    }
                }
                
                // Refresh detailed stocks in background
                get().syncCartWithInventory();
            } else {
                set({ isCartLoaded: true });
            }
        } catch (e) {
            console.error('Failed to fetch cart:', e);
            // On failure, still show cart (use cached data from localStorage)
            const fallbackCart = safeParse('cart') || [];
            if (fallbackCart.length > 0 && get().cart.length === 0) {
                set({ cart: fallbackCart });
            }
            set({ isCartLoaded: true });
        } finally {
            set({ _fetchCartInProgress: false });
        }
    },
    setUser: (user, token = null) => {
        if (user) {
            localStorage.setItem('user', JSON.stringify(user));
            if (token) {
                localStorage.setItem('userToken', token);
            }
            // Auto-fetch cart and wishlist after login
            set({ user, token: token || localStorage.getItem('userToken') });
            get().fetchCart();
            get().fetchWishlist();
        } else {
            localStorage.removeItem('user');
            localStorage.removeItem('userToken');
            set({ user: null, token: null });
        }
    },
    initAuth: async () => {
        // Optimistically restore the cached user so the UI renders instantly,
        // then re-validate the session against the backend in the background.
        // The cookie/token may have expired or been invalidated server-side;
        // without this re-check the app stays stuck in a fake "logged in" state
        // and every authenticated call 401s silently forever.
        const cachedUser = safeParse('user');
        if (cachedUser) {
            set({ user: cachedUser });
            get().fetchCart();
            get().fetchWishlist();
            get().validateSession();
            return true;
        }
        
        // Verify session on app mount by calling backend
        try {
            const res = await apiFetch('/api/auth/verify-token');
            if (res.ok) {
                const data = await res.json();
                if (data.valid) {
                    // Fetch user data
                    const userRes = await apiFetch('/user/profile');
                    if (userRes.ok) {
                        const userData = await userRes.json();
                        set({ user: userData });
                        localStorage.setItem('user', JSON.stringify(userData));
                        get().fetchCart();
                        get().fetchWishlist();
                        return true;
                    }
                }
            }
        } catch {
            // Silently fail - user is not logged in, that's OK
            // Don't log to console to avoid cluttering during normal use
        }
        // Clear stale user data if auth failed
        localStorage.removeItem('user');
        localStorage.removeItem('userToken');
        set({ user: null, token: null });
        return false;
    },
    // Re-validate the persisted session with the backend. Returns true when the
    // session is confirmed valid, or when the check could not be completed
    // (offline / backend hiccup) — a transient network failure must never log a
    // user out. Only a definitive 401 clears the local session.
    validateSession: async () => {
        try {
            const res = await apiFetch('/api/auth/verify-token');
            if (res.status === 401) {
                get().clearLocalSession({ expired: true });
                return false;
            }
            return res.ok;
        } catch {
            return true;
        }
    },
    // Clear every locally cached, user-scoped datum. Used both by logout and by
    // the global 401 handler, so a dead session can never keep showing the
    // previous account's wishlist/cart on a shared device.
    clearLocalSession: (opts = {}) => {
        const wasLoggedIn = !!get().user;
        localStorage.removeItem('user');
        localStorage.removeItem('userToken');
        localStorage.removeItem('cart');
        localStorage.removeItem('wishlist');
        // Regenerate the guest cart session id so a new user on the same device
        // never inherits the previous user's server-side cart.
        localStorage.setItem('sessionId', Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
        set({ user: null, token: null, cart: [], wishlist: [] });
        // Only surface a message when the session actually died (not on an
        // explicit logout), and only once (a burst of 401s clears just once).
        if (opts.expired && wasLoggedIn) {
            toast.error('Session expired. Please login again.');
        }
    },
    logout: async () => {
        // Clear locally FIRST so the UI reacts immediately and no user-scoped
        // data (wishlist included) leaks to the next user on this device.
        get().clearLocalSession();
        await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
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
    // Variant-aware helpers: cart lines are keyed by (product_id, variant_id)
    // so the same product can hold several option combinations (e.g. two
    // sizes/colors) as separate lines. Products without variants keep their
    // legacy behavior (variant_id undefined/null).
    addToCart: async (product) => {
        if (processingSync) return;
        processingSync = true;
        try {
            const state = get();
            const deviceModel = getDeviceModelValue(product?.device_model);
            const variantId = product?.variant_id || null;
            const existing = state.cart.find(item => String(item.id) === String(product.id) && 
                (item.variant_id === variantId || (item.variant_id === null && variantId === null) || (item.variant_id === undefined && variantId === null)));
            const availableStock = getAvailableStock(product)
            
            if (availableStock <= 0) {
                toast.error("Item out of stock");
                return;
            }

            if (existing && existing.qty >= availableStock) {
                toast.error("Maximum available stock reached");
                return;
            }

            const currentQty = Number(existing?.qty || 0);
            const safeQty = isNaN(currentQty) ? 0 : currentQty;
            const newQty = existing ? safeQty + 1 : 1;
            
            // UPDATE LOCAL STATE IMMEDIATELY (Optimistic UI)
            set((state) => {
                let newCart;
                if (existing) {
                    newCart = state.cart.map(item =>
                        String(item.id) === String(product.id) && String(item.variant_id || '') === String(variantId || '') ? { ...item, device_model: deviceModel || item.device_model || null, fitting: product.fitting ?? item.fitting ?? false, qty: newQty } : item
                    );
                } else {
                    newCart = [
                        ...state.cart,
                        {
                            ...product,
                            variant_id: variantId,
                            device_model: deviceModel || null,
                            fitting: product.fitting ?? false,
                            stock: availableStock,
                            reserved_stock: Number(product?.reserved_stock ?? 0),
                            qty: 1,
                        },
                    ];
                }
                localStorage.setItem('cart', JSON.stringify(newCart));
                return { cart: newCart };
            });

            // Sync with server in background
            const success = await syncCartWithServer(product.id, 1, 'add', variantId);
            if (!success) {
                console.error('Failed to sync add-to-cart with server');
            }
        } finally {
            processingSync = false;
        }
    },
    removeFromCart: async (productId, variantId = null) => {
        // UPDATE LOCAL STATE IMMEDIATELY (Optimistic UI)
        set((state) => {
            const newCart = state.cart.filter(item => !(String(item.id) === String(productId) && 
                (item.variant_id === variantId || (item.variant_id === null && variantId === null) || (item.variant_id === undefined && variantId === null))));
            localStorage.setItem('cart', JSON.stringify(newCart));
            return { cart: newCart };
        });

        // Sync with server in background
        const success = await syncCartWithServer(productId, 0, 'remove', variantId);
        if (!success) {
            console.error('Failed to sync remove-from-cart with server');
        }
    },
    updateQuantity: async (productId, qty, variantId = null) => {
        if (processingSync) return;
        processingSync = true;

        try {
            let requestedQty = Number(qty);
            if (isNaN(requestedQty)) requestedQty = 1;
            
            let finalQty = requestedQty;
            const state = get();
            const item = state.cart.find(i => String(i.id) === String(productId) && 
                (i.variant_id === variantId || (i.variant_id === null && variantId === null) || (i.variant_id === undefined && variantId === null)));
            if (!item) return;

            const maxQty = getAvailableStock(item);
            // In-stock items are clamped to [1, stock]. When an item has 0
            // available stock, keep its current quantity instead of forcing it
            // to 1 — the cart renders these lines as "sold out/unavailable"
            // and shouldn't silently rewrite the user's quantity.
            finalQty = maxQty > 0 ? Math.max(1, Math.min(requestedQty, maxQty)) : item.qty;

            // Update local state IMMEDIATELY for responsiveness
            set((state) => {
                const newCart = state.cart.map(item => {
                    if (!(String(item.id) === String(productId) && 
      (item.variant_id === variantId || (item.variant_id === null && variantId === null) || (item.variant_id === undefined && variantId === null)))) return item;
                    return { ...item, qty: finalQty };
                });
                localStorage.setItem('cart', JSON.stringify(newCart));
                return { cart: newCart };
            });

            // PERSISTENCE FIX: Sync with server
            const success = await syncCartWithServer(productId, finalQty, 'update', variantId);
            if (!success) {
                console.error('Failed to persist quantity to server');
            }
        } finally {
            processingSync = false;
        }
    },
    updateDeviceModel: (productId, deviceModel, variantId = null) => set((state) => {
        const normalizedDeviceModel = getDeviceModelValue(deviceModel);
        const newCart = state.cart.map(item =>
            String(item.id) === String(productId) && 
            (item.variant_id === variantId || (item.variant_id === null && variantId === null) || (item.variant_id === undefined && variantId === null)) ? { ...item, device_model: normalizedDeviceModel || null } : item
        );
        localStorage.setItem('cart', JSON.stringify(newCart));
        return { cart: newCart };
    }),
    toggleFittingService: (productId, variantId = null) => set((state) => {
        const newCart = state.cart.map(item =>
            String(item.id) === String(productId) && 
            (item.variant_id === variantId || (item.variant_id === null && variantId === null) || (item.variant_id === undefined && variantId === null)) ? { ...item, fitting: !item.fitting } : item
        );
        localStorage.setItem('cart', JSON.stringify(newCart));
        return { cart: newCart };
    }),
    clearCart: () => {
        localStorage.removeItem('cart');
        syncCartWithServer(null, 0, 'clear_cart');
        set({ cart: [] });
    },
    registerForNotification: async (productId, email) => {
        try {
            // Use the authenticated wrapper so the server can attach the in-app
            // notification to the real session user (the backend no longer
            // trusts a client-supplied user_id).
            const response = await apiFetch(`/products/${productId}/notify`, {
                method: 'POST',
                body: JSON.stringify({ email })
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
    // (deliveryMode / setDeliveryMode removed — quick delivery is retired;
    // all orders use standard scheduled fulfillment.)
    userLocation: safeParse('userLocation'), // { lat, lng, address }
    setUserLocation: (location) => {
        if (location) {
            localStorage.setItem('userLocation', JSON.stringify(location));
        } else {
            localStorage.removeItem('userLocation');
        }
        set({ userLocation: location });
    },
    nearestStoreId: null,
    setNearestStoreId: () => set({ nearestStoreId: null }),
    isCheckingLocation: false,
    setIsCheckingLocation: (val) => set({ isCheckingLocation: val }),
    banners: [],
    fetchBanners: async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/settings?_t=${Date.now()}`);
            const json = await res.json();
            let bannersData = [];
            if (res.ok && json.data) {
                // Ensure banners is always an array
                bannersData = json.data.banners || [];
                const isBlocked = json.data.store_blocked === 'true' || json.data.store_blocked === true;
                const isConstruction = json.data.construction_mode === 'true' || json.data.construction_mode === true;
                const constructionMsg = json.data.construction_mode_message || 'Our website is currently undergoing scheduled maintenance and upgrades. JDLX Mobile will be back online with exciting new premium products soon. Thank you for your patience!';
                set({ 
                    storeBlocked: isBlocked,
                    constructionMode: isConstruction,
                    constructionModeMessage: constructionMsg
                });
            }

            // The /settings payload does NOT always include banners (and may
            // itself fail). Fall back to the dedicated /banners endpoint so the
            // carousel still renders even when settings lacks a banners key.
            if (!Array.isArray(bannersData) || bannersData.length === 0) {
                try {
                    const bRes = await fetch(`${API_BASE_URL}/banners?_t=${Date.now()}`);
                    const bJson = await bRes.json();
                    if (bRes.ok && Array.isArray(bJson.data)) {
                        bannersData = bJson.data;
                    }
                } catch (e) {
                    console.error('Failed to fetch banners fallback:', e);
                }
            }

            set({ banners: bannersData });
            return bannersData;
        } catch (e) {
            console.error('Failed to fetch banners:', e);
            return [];
        }
    },
    products: [],
    fetchProducts: async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/products?_t=${Date.now()}`);
            const data = await res.json();
            const normalized = Array.isArray(data) ? data : (data.data || []);
            set({ products: normalized });
            // Self-heal: recently-viewed items are cached in localStorage with a
            // snapshot of the product (including image URLs). If product images
            // changed server-side (e.g. migrated to cloud storage), those cached
            // paths go stale and show the text fallback. Refresh each entry with
            // the freshest catalog data so images always resolve (order kept).
            const currentRV = get().recentlyViewed;
            if (currentRV.length > 0 && normalized.length > 0) {
                const refreshed = refreshRecentlyViewed(currentRV, normalized);
                if (JSON.stringify(refreshed) !== JSON.stringify(currentRV)) {
                    set({ recentlyViewed: refreshed });
                    localStorage.setItem('recentlyViewed', JSON.stringify(refreshed));
                }
            }
            return normalized;
        } catch (e) {
            console.error('Failed to fetch products:', e);
            return [];
        }
    },
    syncCartWithInventory: async () => {
        const state = get();
        if (state.cart.length === 0) return;

        try {
            const promises = state.cart.map(async (item) => {
                try {
                    const res = await fetch(`${API_BASE_URL}/products/${item.id}?_t=${Date.now()}`);
                    if (!res.ok) {
                        return { ...item, removedFromInventory: true, stock: 0 };
                    }
                    const json = await res.json();
                    const freshProduct = json.data || {};
                    
                    // Variant-aware refresh: a variant cart line must keep its own
                    // price/stock/images instead of inheriting the parent row's.
                    let stockSource = freshProduct;
                    if (item.variant_id && Array.isArray(freshProduct.variants)) {
                        const v = freshProduct.variants.find(v => String(v.id) === String(item.variant_id));
                        if (v) stockSource = v;
                    }

                    // Standardize stock field matching the refactor
                    const physical = Number(stockSource.stock ?? stockSource.physical_stock ?? stockSource.stock_quantity ?? 0);
                    const hardReserved = Number(stockSource.hard_reserved ?? 0);
                    const available = Math.max(0, physical - hardReserved);
                    
                    const currentQty = Number(item.qty || item.quantity || 1);
                    const safeQty = isNaN(currentQty) ? 1 : currentQty;
                    
                    const refreshed = { 
                        ...item, 
                        ...freshProduct, 
                        stock: available,
                        qty: Math.min(safeQty, Math.max(1, available)),
                        removedFromInventory: false 
                    };
                    // Restore variant-specific values so a variant line is never
                    // clobbered by the parent product row.
                    if (item.variant_id && stockSource !== freshProduct) {
                        refreshed.price = stockSource.price != null ? stockSource.price : refreshed.price;
                        refreshed.variant_name = stockSource.name || refreshed.variant_name;
                        if (Array.isArray(stockSource.images) && stockSource.images.length) {
                            refreshed.images = stockSource.images;
                        }
                    }
                    return refreshed;
                } catch {
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
        try {
            const res = await apiFetch(`/wishlist?_t=${Date.now()}`);
            if (res.status === 401) {
                // Session is gone — drop the cached wishlist instead of
                // continuing to show another user's saved items (and count).
                localStorage.removeItem('wishlist');
                set({ wishlist: [] });
                return;
            }
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
        const state = get();
        
        // Guests can't persist a wishlist server-side; without this guard the
        // API call 401s silently while the UI still toasts "Added to wishlist".
        if (!state.user) {
            toast.error('Please login to save favorites');
            return;
        }
        
        const isInWishlist = state.wishlist.some(item => String(item.id) === String(product.id));
        
        try {
            if (isInWishlist) {
                const res = await apiFetch(`/wishlist/${product.id}`, {
                    method: 'DELETE',
                });
                if (res.ok) {
                    const newWishlist = state.wishlist.filter(item => String(item.id) !== String(product.id));
                    set({ wishlist: newWishlist });
                    localStorage.setItem('wishlist', JSON.stringify(newWishlist));
                }
            } else {
                const res = await apiFetch('/wishlist', {
                    method: 'POST',
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
    // pwaInstallPromptUsed is a GLOBAL guard: a captured beforeinstallprompt
    // event can only drive the native prompt ONCE. Banner and Profile both
    // share this event, so usage is tracked in the store (not per-component)
    // to keep the second click from calling prompt() again on the same event
    // and hanging on an infinite "Installing…" state.
    pwaInstallPrompt: null,
    pwaInstallPromptUsed: false,
    setPwaInstallPrompt: (prompt) => set({ pwaInstallPrompt: prompt, pwaInstallPromptUsed: false }),
    markPwaInstallPromptUsed: () => set({ pwaInstallPromptUsed: true }),
    clearPwaInstallPrompt: () => set({ pwaInstallPrompt: null, pwaInstallPromptUsed: false }),

    // Offers & Discounts
    activeOffers: [],
    appliedOffer: null, // { offer_id, discount_amount, title, code }
    fetchActiveOffers: async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/offers/active`);
            const json = await res.json();
            if (res.ok && json.data) {
                set({ activeOffers: json.data });
                return json.data;
            }
        } catch (e) {
            console.error('Failed to fetch offers:', e);
        }
        return [];
    },
    applyAutomaticOffers: async (cartTotal, productIds, items) => {
        if (cartTotal <= 0) return null;
        try {
            const res = await apiFetch('/offers/apply-automatic', {
                method: 'POST',
                body: JSON.stringify({ cart_total: cartTotal, product_ids: productIds, items: items || [] })
            });
            const json = await res.json();
            if (res.ok && json.data && json.data.applied_offer) {
                // Only auto-apply if it's better than current applied offer
                const state = get();
                const currentDiscount = state.appliedOffer ? state.appliedOffer.discount_amount : 0;
                const autoOffer = json.data.applied_offer;
                if (autoOffer.discount_amount > currentDiscount || (!state.appliedOffer?.code && autoOffer.discount_amount > 0)) {
                    set({ appliedOffer: autoOffer });
                    return autoOffer;
                }
            }
        } catch (e) {
            console.error('Failed to apply automatic offers:', e);
        }
        return null;
    },
    applyCoupon: async (code, cartTotal, productIds, items) => {
        try {
            const res = await apiFetch('/offers/validate-coupon', {
                method: 'POST',
                body: JSON.stringify({ coupon_code: code, cart_total: cartTotal, product_ids: productIds, items: items || [] })
            });
            const json = await res.json();
            if (res.ok && json.data && json.data.valid) {
                set({ appliedOffer: { ...json.data, code } });
                return json.data;
            } else {
                return { valid: false, message: json.error || 'Invalid coupon' };
            }
        } catch (e) {
            console.error('Failed to validate coupon:', e);
            return { valid: false, message: 'Failed to validate coupon' };
        }
    },
    removeOffer: () => set({ appliedOffer: null }),

    // Global Error State
    globalError: null, // null | 'network' | 'server'
    setGlobalError: (error) => set({ globalError: error }),
    clearGlobalError: () => set({ globalError: null })
}))
