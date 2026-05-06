import { create } from 'zustand'

const safeParse = (key) => {
    try {
        const item = localStorage.getItem(key);
        return (item && item !== 'undefined') ? JSON.parse(item) : null;
    } catch (e) {
        return null;
    }
};

export const useStore = create((set) => ({
    user: safeParse('user'),
    token: localStorage.getItem('token') || null,
    adminUser: safeParse('adminUser'),
    adminToken: localStorage.getItem('adminToken') || null,
    warehouseUser: safeParse('warehouseUser'),
    warehouseToken: localStorage.getItem('warehouseToken') || null,
    warehouseRequestUser: safeParse('warehouseRequestUser'),
    warehouseRequestToken: localStorage.getItem('warehouseRequestToken') || null,
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
    clearCart: () => set({ cart: [] })
}))
