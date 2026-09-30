import { useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle, Printer, X, Share2, Download, Loader2 } from 'lucide-react'
import { formatBillDate } from './BillingApi'
import { API_BASE_URL, resolveMediaUrl } from '../../../config'

/**
 * Shared counter-sale invoice/receipt modal.
 * Expects an `invoice` shaped like the billing generate/history response:
 *   order_number, customer_name, customer_phone, payment_mode, created_at,
 *   subtotal, tax_amount, gst_rate, discount_amount, total_amount, items[]
 *
 * Actions (all three preserve the existing on-screen view unchanged):
 *   - Print: receipt-ONLY print via a hidden iframe — the old window.print()
 *     printed the whole dashboard page behind the modal (broken since day 1).
 *   - Share: Web Share API (WhatsApp/Sms/etc. on mobile) sharing the PDF
 *     file; clipboard fallback where sharing isn't available.
 *   - Download: server-rendered 80mm receipt PDF (fpdf2, same auth guard as
 *     the billing history — vendor-scoped, OFFLINE bills only).
 */
export default function InvoiceModal({ invoice, onClose }) {
  const [downloading, setDownloading] = useState(false)
  const [sharing, setSharing] = useState(false)

  if (!invoice) return null

  const orderId = invoice.order_id || invoice.id
  const receiptName = `${invoice.order_number || 'receipt'}-receipt.pdf`

  /** Receipt-only print: build a standalone, print-styled document from the
   * invoice data (NOT a DOM clone — Tailwind classes don't exist inside the
   * iframe, so cloned markup would print unstyled) and print it via a hidden
   * iframe. The dark dashboard page never enters the print output. */
  const handlePrint = () => {
    const items = (invoice.items || []).filter((it) => (it.billed_qty ?? it.quantity ?? it.qty ?? 0) > 0)
    const damaged = (invoice.items || []).filter((it) => Number(it.damage_qty || 0) > 0)
    const money = (v) => Number(v || 0).toFixed(2)
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

    const itemsHtml = items.map((it) => `
      <div class="r-item">
        <span>${esc(it.name)} x${it.billed_qty ?? it.quantity ?? it.qty}</span>
        <span class="amt">₹${money(it.subtotal)}</span>
      </div>`).join('')

    const damagedHtml = damaged.length > 0 ? `
      <div class="r-sec-title" style="color:#b91c1c">Damaged (Not Billed)</div>
      ${damaged.map((it) => `
        <div class="r-dmg">
          <div style="display:flex;justify-content:space-between">
            <span>${esc(it.name)} x${it.damage_qty}</span><span>₹0</span>
          </div>
          ${it.damage_comment ? `<div style="font-style:italic;color:#64748b">“${esc(it.damage_comment)}”</div>` : ''}
        </div>`).join('')}` : ''

    const html = `<!DOCTYPE html><html><head><title>${receiptName}</title><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #0f172a; padding: 14px; }
      .receipt { max-width: 320px; margin: 0 auto; }
      .r-head { text-align: center; border-bottom: 1px dashed #94a3b8; padding-bottom: 10px; margin-bottom: 10px; }
      .r-head h1 { font-size: 16px; font-weight: 800; color: #b45309; letter-spacing: .5px; }
      .r-head p { font-size: 10px; color: #64748b; }
      .r-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 3px 0; border-bottom: 1px dashed #e2e8f0; }
      .r-row .k { color: #64748b; }
      .r-row .v { font-weight: 600; text-align: right; }
      .r-sec { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; margin-top: 10px; }
      .r-sec-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .8px; color: #64748b; margin-bottom: 4px; }
      .r-item { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 2px 0; }
      .r-item .amt { font-weight: 700; white-space: nowrap; }
      .r-dmg { border: 1px solid #fecaca; background: #fef2f2; border-radius: 6px; padding: 6px; margin: 4px 0; font-size: 10px; color: #b91c1c; }
      .r-tot { border-top: 1px solid #cbd5e1; margin-top: 8px; padding-top: 6px; }
      .r-sub { display: flex; justify-content: space-between; font-size: 10px; color: #64748b; padding: 2px 0; }
      .r-total { display: flex; justify-content: space-between; font-size: 15px; font-weight: 800; color: #b45309; padding-top: 4px; }
      .r-foot { text-align: center; font-size: 9px; color: #64748b; margin-top: 12px; border-top: 1px dashed #94a3b8; padding-top: 8px; }
    </style></head><body>
      <div class="receipt">
        <div class="r-head">
          <h1>JDLX MOBILE</h1>
          <p>Premium Mobile Store — Counter Sale Receipt</p>
        </div>
        <div class="r-row"><span class="k">Invoice No:</span><span class="v">${esc(invoice.order_number)}</span></div>
        <div class="r-row"><span class="k">Customer:</span><span class="v">${esc(invoice.customer_name || 'Counter Customer')}</span></div>
        ${invoice.customer_phone ? `<div class="r-row"><span class="k">Phone:</span><span class="v">${esc(invoice.customer_phone)}</span></div>` : ''}
        <div class="r-row"><span class="k">Payment:</span><span class="v">${esc(invoice.payment_mode || 'CASH')}</span></div>
        <div class="r-row"><span class="k">Date:</span><span class="v">${esc(formatBillDate(invoice.created_at))}</span></div>
        <div class="r-sec">
          <div class="r-sec-title">Purchased Items</div>
          ${itemsHtml}
          ${damagedHtml}
          <div class="r-tot">
            <div class="r-sub"><span>Subtotal:</span><span>₹${money(invoice.subtotal)}</span></div>
            <div class="r-sub"><span>${Number(invoice.gst_rate) > 0 ? `GST (${esc(invoice.gst_rate)}%)` : 'No GST'}:</span><span>₹${money(invoice.tax_amount)}</span></div>
            ${Number(invoice.discount_amount) > 0 ? `<div class="r-sub"><span>Discount:</span><span>-₹${money(invoice.discount_amount)}</span></div>` : ''}
            <div class="r-total"><span>Total Paid:</span><span>₹${money(invoice.total_amount)}</span></div>
          </div>
        </div>
        <div class="r-foot">Thank you for shopping with JDLX Mobile!<br/>This is a computer-generated receipt.</div>
      </div>
    </body></html>`

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument
    doc.open()
    doc.write(html)
    doc.close()

    const doPrint = () => {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      // Cleanup after the print dialog consumes the document.
      setTimeout(() => document.body.removeChild(iframe), 60_000)
    }
    setTimeout(doPrint, 150)
  }

  /** Web Share API with the actual PDF file (level 2). Falls back to sharing
   * the text summary, then to clipboard. Mobile par WhatsApp direct khulta
   * hai — manager receipt customer ko turant bhej sakta hai. */
  const handleShare = async () => {
    if (sharing) return
    setSharing(true)
    try {
      let file = null
      if (orderId && navigator.canShare) {
        try {
          const res = await fetch(
            `${API_BASE_URL}/warehouse/billing/${orderId}/receipt`,
            { headers: { Authorization: `Bearer ${localStorage.getItem('warehouseToken') || localStorage.getItem('warehouse_token') || localStorage.getItem('staff_token') || ''}` } }
          )
          if (res.ok) {
            const blob = await res.blob()
            file = new File([blob], receiptName, { type: 'application/pdf' })
          }
        } catch { /* file sharing optional — text fallback below */ }
      }

      const shareText = [
        `JDLX Mobile — Receipt ${invoice.order_number || ''}`,
        `Customer: ${invoice.customer_name || 'Counter Customer'}`,
        `Total Paid: ₹${Number(invoice.total_amount || 0).toFixed(2)}`,
        `Payment: ${invoice.payment_mode || 'CASH'}`,
      ].join('\n')

      if (file && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: `Receipt ${invoice.order_number || ''}`, text: shareText, files: [file] })
      } else if (navigator.share) {
        await navigator.share({ title: `Receipt ${invoice.order_number || ''}`, text: shareText })
      } else {
        await navigator.clipboard.writeText(shareText)
        toast.success('Receipt summary copy ho gayi — kahin bhi paste karen')
      }
    } catch (err) {
      // AbortError = user closed the share sheet — not an error.
      if (err?.name !== 'AbortError') {
        toast.error('Share nahi hua — Download karke manually bhejen')
      }
    } finally {
      setSharing(false)
    }
  }

  /** Download the server-rendered receipt PDF. */
  const handleDownload = async () => {
    if (!orderId || downloading) return
    setDownloading(true)
    try {
      const token = localStorage.getItem('warehouseToken') || localStorage.getItem('warehouse_token') || localStorage.getItem('staff_token') || ''
      const res = await fetch(`${API_BASE_URL}/warehouse/billing/${orderId}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Receipt download fail hua')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = receiptName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Receipt PDF download ho gaya')
    } catch (err) {
      toast.error(err.message || 'Receipt download fail hua')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl relative animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
          aria-label="Close invoice"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Print builds its own print-styled document from `invoice`; this
            block stays the single on-screen source of truth for the content. */}
        <div>
          <div className="receipt">
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
                {(invoice.items || [])
                  .filter((item) => (item.billed_qty ?? item.quantity ?? item.qty ?? 0) > 0)
                  .map((item, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="truncate pr-2">{item.name} x{item.billed_qty ?? item.quantity ?? item.qty}</span>
                      <span className="font-semibold text-white">₹{item.subtotal}</span>
                    </div>
                  ))}
                {(invoice.items || []).filter((item) => Number(item.damage_qty || 0) > 0).length > 0 && (
                  <div className="pt-2 border-t border-red-500/30 space-y-1.5">
                    <p className="font-bold text-red-400 uppercase text-[10px] tracking-wider">Damaged (Not Billed)</p>
                    {(invoice.items || [])
                      .filter((item) => Number(item.damage_qty || 0) > 0)
                      .map((item, idx) => (
                        <div key={idx} className="bg-red-950/20 border border-red-500/20 rounded-lg p-2 space-y-1">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-red-300 font-medium truncate pr-2">
                              {item.name} x{item.damage_qty}
                            </span>
                            <span className="text-red-400 font-semibold whitespace-nowrap">₹0</span>
                          </div>
                          {item.damage_comment && (
                            <p className="text-[10px] text-slate-400 italic">“{item.damage_comment}”</p>
                          )}
                          {item.damage_image_url && (
                            <img
                              src={resolveMediaUrl(item.damage_image_url)}
                              alt="Damage proof"
                              className="w-14 h-14 rounded-lg object-cover border border-red-500/30 mt-1"
                            />
                          )}
                        </div>
                      ))}
                  </div>
                )}
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
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={handleShare}
            disabled={sharing}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg"
          >
            {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />} Share
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || !orderId}
            title={orderId ? 'Download PDF receipt' : 'PDF sirf saved bills ke liye (naya bill pehle save karen)'}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg"
          >
            <Printer className="w-4 h-4" /> Print
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
