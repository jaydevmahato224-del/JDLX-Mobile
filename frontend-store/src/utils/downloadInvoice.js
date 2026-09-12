import { apiFetch } from './apiFetch'
import { toast } from 'react-hot-toast'

/**
 * Download the customer's invoice PDF for an order via the authenticated
 * /invoice/:id endpoint. Handles blob download + toast errors so both
 * OrderTracking and MyOrders can share one implementation.
 */
export async function downloadOrderInvoice(orderId, { setBusy, filename } = {}) {
    setBusy?.(true)
    try {
        const res = await apiFetch(`/invoice/${orderId}`)
        if (!res.ok) {
            let msg = 'Could not download invoice'
            try {
                const data = await res.json()
                msg = data?.message || msg
            } catch { /* non-JSON error body — keep default */ }
            throw new Error(msg)
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename || `ORD-${orderId}-invoice.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
    } catch (e) {
        toast.error(e?.message || 'Could not download invoice')
    } finally {
        setBusy?.(false)
    }
}
