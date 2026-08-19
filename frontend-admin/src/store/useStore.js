import { create } from 'zustand'

/**
 * Generate a session fingerprint based on browser characteristics.
 * Used to detect token theft across different devices/browsers.
 */
function generateSessionFingerprint() {
    const components = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    ];
    // Simple hash — not cryptographic, but sufficient for tamper detection
    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

/**
 * Basic JWT structure validation (does NOT verify signature — that's the server's job).
 * Checks: 3-part structure, valid base64, not expired.
 */
function isTokenStructureValid(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && payload.exp * 1000 < Date.now()) return false;
        return true;
    } catch {
        return false;
    }
}

/**
 * Safely parse JSON from localStorage — malformed data must never crash the app
 * at store-init time (which would white-screen the whole admin panel).
 */
function safeParse(key) {
    try {
        return JSON.parse(localStorage.getItem(key)) || null;
    } catch {
        return null;
    }
}

export const useStore = create((set, get) => ({
    user: safeParse('user'),
    token: localStorage.getItem('token') || null,
    adminUser: safeParse('adminUser'),
    adminToken: localStorage.getItem('adminToken') || null,
    warehouseUser: safeParse('warehouseUser'),
    warehouseToken: localStorage.getItem('warehouseToken') || null,
    warehouseRequestUser: safeParse('warehouseRequestUser'),
    warehouseRequestToken: localStorage.getItem('warehouseRequestToken') || null,
    isReauthenticating: false,
    cart: [],
    setUser: (user, token) => {
        if (user && token) {
            localStorage.setItem('user', JSON.stringify(user));
            localStorage.setItem('token', token);
        } else {
            localStorage.removeItem('user');
            localStorage.removeItem('token');
        }
        set({ user, token });
    },
    logout: () => {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        set({ user: null, token: null, cart: [] });
    },
    setAdminUser: (adminUser, adminToken) => {
        if (adminUser && adminToken) {
            // Validate token structure before storing
            if (!isTokenStructureValid(adminToken)) {
                console.error('Admin login blocked: invalid token structure');
                return;
            }
            localStorage.setItem('adminUser', JSON.stringify(adminUser));
            localStorage.setItem('adminToken', adminToken);
            // Store session fingerprint for tamper detection
            localStorage.setItem('adminSessionFingerprint', generateSessionFingerprint());
        } else {
            localStorage.removeItem('adminUser');
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminSessionFingerprint');
        }
        set({ adminUser, adminToken });
    },
    setReauthenticating: (val) => set({ isReauthenticating: val }),
    adminLogout: () => {
        localStorage.removeItem('adminUser');
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminSessionFingerprint');
        set({ adminUser: null, adminToken: null });
    },
    /**
     * Validates the current admin session:
     * - Token structure (3-part JWT, not expired)
     * - Session fingerprint (same device/browser)
     * Returns true if valid, auto-logs out and returns false if not.
     */
    validateAdminSession: () => {
        const state = get();
        if (!state.adminToken || !state.adminUser) return false;

        // Check token structure & expiry
        if (!isTokenStructureValid(state.adminToken)) {
            console.warn('Admin session expired or token invalid');
            get().adminLogout();
            return false;
        }

        // Check session fingerprint
        const storedFingerprint = localStorage.getItem('adminSessionFingerprint');
        if (storedFingerprint && storedFingerprint !== generateSessionFingerprint()) {
            console.warn('Session fingerprint mismatch — possible session theft');
            get().adminLogout();
            return false;
        }

        return true;
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
        const existing = state.cart.find(item => item.id === product.id);
        if (existing) {
            return {
                cart: state.cart.map(item =>
                    item.id === product.id ? { ...item, qty: item.qty + 1 } : item
                )
            };
        }
        return { cart: [...state.cart, { ...product, qty: 1 }] };
    }),
    removeFromCart: (productId) => set((state) => ({
        cart: state.cart.filter(item => item.id !== productId)
    })),
    updateQuantity: (productId, qty) => set((state) => ({
        cart: state.cart.map(item =>
            item.id === productId ? { ...item, qty } : item
        )
    })),
    clearCart: () => set({ cart: [] }),

    // Global Error State
    globalError: null, // null | 'network' | 'server'
    setGlobalError: (error) => set({ globalError: error }),
    clearGlobalError: () => set({ globalError: null })
}))
