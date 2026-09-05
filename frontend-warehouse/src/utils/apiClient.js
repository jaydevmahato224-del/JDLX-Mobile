import { useAlertStore } from '../store/useAlertStore'
import { API_BASE_URL } from '../config'
import { apiFetch } from './apiFetch'

export const apiClient = {
    async request(endpoint, options = {}) {
        const { showAlert } = useAlertStore.getState()
        const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`
        
        // Default headers
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        }

        try {
            const response = await apiFetch(url, { ...options, headers })
            const data = await response.json()

            if (!response.ok) {
                const isTechnical = response.status >= 500
                const message = data.error || data.message || 'A technical connection error occurred.'
                
                showAlert(
                    isTechnical ? `SYSTEM ERROR: ${message}` : message, 
                    isTechnical ? 'error' : 'warning',
                    isTechnical ? null : 6000
                )
                
                throw new Error(message)
            }

            return data
        } catch (error) {
            if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
                showAlert('Network Connection Failed. Please check your internet or server status.', 'error', null)
            } else if (!error.message) {
                showAlert('An unexpected submission error occurred. Data may not have been saved.', 'error', null)
            }
            throw error
        }
    },

    get(endpoint, options) {
        return this.request(endpoint, { ...options, method: 'GET' })
    },

    post(endpoint, body, options) {
        return this.request(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) })
    },

    put(endpoint, body, options) {
        return this.request(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) })
    },

    patch(endpoint, body, options) {
        return this.request(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) })
    },

    delete(endpoint, options) {
        return this.request(endpoint, { ...options, method: 'DELETE' })
    }
}
