import { apiFetch } from './apiFetch'
import { toast } from 'react-hot-toast'

// Invoice retention window (mirrors backend INVOICE_RETENTION_DAYS and the
// Terms & Conditions policy): invoices download for 90 days after ordering.
export const INVOICE_RETENTION_DAYS = 90

/**
 * True while the order is inside the 90-day invoice download window.
 * Accepts the order's created_at (IST wall-clock string from the API).
 */
export function invoiceAvailable(created_at) {
    if (!created_at) return false
    const placed = new Date(String(created_at).replace(' ', 'T'))
    if (Number.isNaN(placed.getTime())) return false
    const ageDays = (Date.now() - placed.getTime()) / 86400000
    return ageDays < INVOICE_RETENTION_DAYS
}

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
            if (res.status === 410) {
                toast.error('Invoice download window has expired (90 days).')
                return
            }
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
