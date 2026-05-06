import { create } from 'zustand';

export const useLoadingStore = create((set) => ({
    isLoading: false,
    pendingRequests: 0,
    startLoading: () =>
        set((state) => ({
            pendingRequests: state.pendingRequests + 1,
            isLoading: true,
        })),
    stopLoading: () =>
        set((state) => {
            const newPending = Math.max(0, state.pendingRequests - 1);
            return {
                pendingRequests: newPending,
                isLoading: newPending > 0,
            };
        }),
    resetLoading: () => set({ pendingRequests: 0, isLoading: false }),
}));
