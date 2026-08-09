import { CheckCircle, Printer, X } from 'lucide-react'
import { formatBillDate } from './BillingApi'

/**
 * Shared counter-sale invoice/receipt modal.
 * Expects an `invoice` shaped like the billing generate/history response:
 *   order_number, customer_name, customer_phone, payment_mode, created_at,
 *   subtotal, tax_amount, gst_rate, discount_amount, total_amount, items[]
 */
export default function InvoiceModal({ invoice, onClose }) {
  if (!invoice) return null

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
          aria-label="Close invoice"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center border-b border-slate-800 pb-4 mb-4">
          <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-2 text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">JDLX Mobile - Tax Invoice</h2>
          <p className="text-xs text-slate-400">Counter Sale Receipt</p>
        </div>

        <div className="space-y-3 text-xs text-slate-300">
          <div className="flex justify-between border-b border-slate-800/60 pb-2">
            <span className="text-slate-400">Invoice No:</span>
            <span className="font-mono font-bold text-white">{invoice.order_number}</span>
          </div>
          <div className="flex justify-between border-b border-slate-800/60 pb-2">
            <span className="text-slate-400">Customer:</span>
            <span className="font-medium text-white">{invoice.customer_name || 'Counter Customer'}</span>
          </div>
          {invoice.customer_phone && (
            <div className="flex justify-between border-b border-slate-800/60 pb-2">
              <span className="text-slate-400">Phone:</span>
              <span className="font-medium text-white">{invoice.customer_phone}</span>
            </div>
          )}
          <div className="flex justify-between border-b border-slate-800/60 pb-2">
            <span className="text-slate-400">Payment Method:</span>
            <span className="font-medium text-emerald-400">{invoice.payment_mode || 'CASH'}</span>
          </div>
          <div className="flex justify-between border-b border-slate-800/60 pb-2">
            <span className="text-slate-400">Date & Time:</span>
            <span className="text-slate-300">{formatBillDate(invoice.created_at)}</span>
          </div>

          {/* Items Table */}
          <div className="mt-3 bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
            <p className="font-bold text-slate-400 uppercase text-[10px] tracking-wider mb-1">Purchased Items</p>
            {(invoice.items || []).map((item, idx) => (
              <div key={idx} className="flex justify-between text-xs">
                <span className="truncate pr-2">{item.name} x{item.qty}</span>
                <span className="font-semibold text-white">₹{item.subtotal}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-slate-800 space-y-1">
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>Subtotal:</span>
                <span>₹{Number(invoice.subtotal || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>{Number(invoice.gst_rate) > 0 ? `GST (${invoice.gst_rate}%):` : 'No GST:'}</span>
                <span>₹{Number(invoice.tax_amount || 0).toFixed(2)}</span>
              </div>
              {Number(invoice.discount_amount) > 0 && (
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Discount:</span>
                  <span>-₹{Number(invoice.discount_amount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-white pt-1">
                <span>Total Amount Paid:</span>
                <span className="text-emerald-400 text-base">₹{Number(invoice.total_amount || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => window.print()}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg"
          >
            <Printer className="w-4 h-4" /> Print Receipt
          </button>
          <button
            onClick={onClose}
            className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
