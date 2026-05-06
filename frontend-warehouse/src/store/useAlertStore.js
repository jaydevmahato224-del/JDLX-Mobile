import { create } from 'zustand'

export const useAlertStore = create((set) => ({
    alerts: [],
    showAlert: (message, type = 'info', duration = 5000) => {
        const id = Math.random().toString(36).substring(2, 9)
        set((state) => ({
            alerts: [...state.alerts, { id, message, type, duration }]
        }))

        if (duration !== null) {
            setTimeout(() => {
                set((state) => ({
                    alerts: state.alerts.filter((alert) => alert.id !== id)
                }))
            }, duration)
        }
    },
    hideAlert: (id) => {
        set((state) => ({
            alerts: state.alerts.filter((alert) => alert.id !== id)
        }))
    }
}))
