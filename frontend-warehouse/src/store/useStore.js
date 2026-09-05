import { create } from 'zustand'
import { apiFetch } from '../utils/apiFetch'

const safeParse = (key) => {
        try {
            const item = localStorage.getItem(key);
            return (item && item !== 'undefined') ? JSON.parse(item) : null;
        } catch {
            return null;
        }
    };

export const useStore = create((set) => ({
    user: safeParse('user'),
    adminUser: safeParse('adminUser'),
    adminToken: localStorage.getItem('adminToken') || null,
    // Staff/billing-agent sessions are stored under staff_token / warehouse_token
    // (snake_case) by the setup & login flows; fall back to those so the store
    // recognizes staff logins just like partner logins.
    warehouseUser: safeParse('warehouseUser') || safeParse('warehouse_user'),
    warehouseToken: localStorage.getItem('warehouseToken') || localStorage.getItem('warehouse_token') || localStorage.getItem('staff_token') || null,
    warehouseRequestUser: safeParse('warehouseRequestUser'),
    warehouseRequestToken: localStorage.getItem('warehouseRequestToken') || null,
    cart: [],
    setUser: (user) => {
        if (user) {
            localStorage.setItem('user', JSON.stringify(user));
        } else {
            localStorage.removeItem('user');
        }
        set({ user });
    },
    logout: () => {
        localStorage.removeItem('user');
        apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        set({ user: null, cart: [] });
    },
    setAdminUser: (adminUser) => {
        if (adminUser) {
            localStorage.setItem('adminUser', JSON.stringify(adminUser));
        } else {
            localStorage.removeItem('adminUser');
        }
        set({ adminUser });
    },
    adminLogout: () => {
        localStorage.removeItem('adminUser');
        apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        set({ adminUser: null });
    },
    setWarehouseUser: (warehouseUser) => {
        if (warehouseUser) {
            localStorage.setItem('warehouseUser', JSON.stringify(warehouseUser));
        } else {
            localStorage.removeItem('warehouseUser');
        }
        set({ warehouseUser });
    },
    warehouseLogout: () => {
        // Clear both the partner (camelCase) and staff (snake_case) session
        // keys so a billing-agent logout doesn't leave a stale token behind.
        localStorage.removeItem('warehouseUser');
        localStorage.removeItem('warehouseToken');
        localStorage.removeItem('warehouse_user');
        localStorage.removeItem('warehouse_token');
        localStorage.removeItem('staff_token');
        apiFetch('/api/warehouse/auth/logout', { method: 'POST' }).catch(() => {});
        set({ warehouseUser: null, warehouseToken: null });
    },
    setWarehouseRequestUser: (warehouseRequestUser) => {
        if (warehouseRequestUser) {
            localStorage.setItem('warehouseRequestUser', JSON.stringify(warehouseRequestUser));
        } else {
            localStorage.removeItem('warehouseRequestUser');
        }
        set({ warehouseRequestUser });
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
