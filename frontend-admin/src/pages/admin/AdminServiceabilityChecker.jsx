import { useState } from 'react'
import { Loader2, MapPin, Search, CheckCircle2, XCircle, AlertTriangle, Package } from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'
import toast from 'react-hot-toast'

/**
 * Admin Serviceability Checker.
 *
 * Check whether a customer pincode is delivery-serviceable: shows COD/prepaid
 * availability, the pickup pincode used for the check, and the couriers
 * Shiprocket offers on that route. Read-only — mirrors the exact logic the
 * public /api/pincode/check endpoint uses at checkout.
 */
export default function AdminServiceabilityChecker() {
    const [pincode, setPincode] = useState('')
    const [checking, setChecking] = useState(false)
    const [result, setResult] = useState(null)
    const [error, setError] = useState('')

    const handleCheck = async (e) => {
        e.preventDefault()
        const pin = pincode.trim()
        if (!/^\d{6}$/.test(pin)) {
            setError('Enter a valid 6-digit pincode.')
            return
        }
        setChecking(true)
        setError('')
        setResult(null)
        try {
            const res = await apiFetch(`/admin/serviceability/check?pincode=${pin}`)
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || data.message || 'Serviceability check failed')
            }
            setResult(data.data || data)
        } catch (err) {
            setError(err.message || 'Something went wrong. Please try again.')
            toast.error(err.message || 'Check failed')
        } finally {
            setChecking(false)
        }
    }

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                    <MapPin className="w-6 h-6 text-indigo-600" /> Serviceability Checker
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                    Check whether a customer pincode is serviceable for delivery — exactly what the storefront checkout validates.
                </p>
            </div>

            {/* Input */}
            <form onSubmit={handleCheck} className="flex gap-3 items-start">
                <div className="flex-1">
                    <input
                        value={pincode}
                        onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Enter 6-digit pincode e.g. 110001"
                        inputMode="numeric"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none tracking-widest"
                    />
                    {error && <p className="text-xs font-bold text-rose-500 mt-2">{error}</p>}
                </div>
                <button
                    type="submit"
                    disabled={checking}
                    className="h-[46px] px-5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all flex items-center gap-2"
                >
                    {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Check
                </button>
            </form>

            {/* Result */}
            {result && (
                <div className={`rounded-2xl border p-5 space-y-4 ${result.serviceable ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                    <div className="flex items-center gap-3">
                        {result.serviceable
                            ? <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                            : <XCircle className="w-8 h-8 text-rose-600" />}
                        <div>
                            <p className={`text-lg font-black ${result.serviceable ? 'text-emerald-800' : 'text-rose-800'}`}>
                                {result.serviceable ? 'Serviceable' : 'NOT Serviceable'}
                            </p>
                            <p className="text-xs font-semibold text-gray-600">{result.message}</p>
                        </div>
                        <div className="ml-auto text-right">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Pincode</p>
                            <p className="text-xl font-black text-gray-800 tracking-widest">{result.pincode}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-white rounded-xl border border-gray-200 p-3">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">COD</p>
                            <p className={`text-sm font-black ${result.cod_allowed ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {result.cod_allowed ? 'Allowed' : 'Not allowed'}
                            </p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-3">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Prepaid only</p>
                            <p className="text-sm font-black text-gray-800">{result.prepaid_only ? 'Yes' : 'No'}</p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-3">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">City / State</p>
                            <p className="text-sm font-bold text-gray-800 truncate">{result.city || '—'}{result.state ? `, ${result.state}` : ''}</p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-3">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Couriers</p>
                            <p className="text-sm font-black text-indigo-600">{result.courier_count ?? 0}</p>
                        </div>
                    </div>

                    {/* Pickup info — transparency about what the check used */}
                    <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap gap-x-6 gap-y-1">
                        <p className="text-xs text-gray-600">
                            <span className="font-black uppercase text-[9px] tracking-widest text-gray-400 mr-1">Pickup pincode used:</span>
                            <strong>{result.pickup_pincode_used}</strong>
                        </p>
                        <p className="text-xs text-gray-600">
                            <span className="font-black uppercase text-[9px] tracking-widest text-gray-400 mr-1">Source:</span>
                            {result.pickup_source}
                        </p>
                        <p className="text-xs text-gray-600">
                            <span className="font-black uppercase text-[9px] tracking-widest text-gray-400 mr-1">Shiprocket verified:</span>
                            {result.shiprocket_verified ? 'Yes' : `No${result.shiprocket_error ? ` (${result.shiprocket_error})` : ''}`}
                        </p>
                    </div>

                    {/* Courier list */}
                    {(result.couriers || []).length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1">
                                <Package className="w-3 h-3" /> Available couriers on this route
                            </p>
                            <div className="overflow-x-auto rounded-xl border border-gray-200">
                                <table className="w-full text-sm bg-white">
                                    <thead>
                                        <tr className="bg-gray-50 text-left">
                                            <th className="px-3 py-2 text-[9px] font-black text-gray-400 uppercase tracking-widest">Courier</th>
                                            <th className="px-3 py-2 text-[9px] font-black text-gray-400 uppercase tracking-widest">COD</th>
                                            <th className="px-3 py-2 text-[9px] font-black text-gray-400 uppercase tracking-widest">ETA (days)</th>
                                            <th className="px-3 py-2 text-[9px] font-black text-gray-400 uppercase tracking-widest">Freight (₹)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.couriers.map((c) => (
                                            <tr key={c.id} className="border-t border-gray-100">
                                                <td className="px-3 py-2 font-bold text-gray-800">{c.name || `#${c.id}`}</td>
                                                <td className="px-3 py-2">
                                                    {c.cod
                                                        ? <span className="text-emerald-600 font-black text-xs">YES</span>
                                                        : <span className="text-gray-400 font-bold text-xs">No</span>}
                                                </td>
                                                <td className="px-3 py-2 font-semibold text-gray-700">{c.eta_days || '—'}</td>
                                                <td className="px-3 py-2 font-semibold text-gray-700">{c.freight ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Data-quality warning */}
                    {result.pickup_source && result.pickup_source.startsWith('Fallback') && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <p className="text-xs font-semibold text-amber-800">
                                The active dark store has no pincode set — checks are running from the default 110001 (Delhi).
                                Set the store pincode in Dark Stores management for accurate results.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
