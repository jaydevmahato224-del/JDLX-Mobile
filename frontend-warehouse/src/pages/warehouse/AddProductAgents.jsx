import React, { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  UserPlus, Copy, Check, KeyRound, Clock, Power, Trash2, PackagePlus,
  RefreshCw, Timer, Coffee, ShieldCheck, ChevronDown, ChevronUp
} from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'
import { resolveMediaUrl } from '../../config'

// Agent drafts store whatever URL the upload pipeline returned — cloud
// (http...) OR local /static paths served by the BACKEND origin. Without
// resolveMediaUrl the /static ones would 404 against the panel's own origin.
const toImgUrl = (u) => (u ? resolveMediaUrl(String(u)) : u)

// ─── Add-Product Agents (manager side) ───────────────────────────────────────
// Three jobs on this page:
//   1. Register agents ONCE (name + email + phone + passport-size photo) —
//      each gets a permanent unique code (AP-XXXXXX) stamped on every product
//      they create, so the manager always knows who made the listing.
//   2. Generate the daily 6-digit login OTP with a FLEXIBLE duration
//      (60–480 minutes dropdown, manager's choice, max 8 hours) and share it
//      with the agent by phone/WhatsApp. No agent passwords exist at all.
//   3. Complete agent drafts — agents can only fill discovery fields
//      (images/category/title/description/tags/return policy, brand locked to
//      "None"); the manager adds price/stock/SKU/brand and pushes the product
//      into the EXISTING admin-approval pipeline (unchanged flow).

const DURATIONS = [60, 120, 180, 240, 300, 360, 420, 480]
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)

export default function AddProductAgents() {
  const [agents, setAgents] = useState([])
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [regSubmitting, setRegSubmitting] = useState(false)
  const [otpBusy, setOtpBusy] = useState(null)        // agent_id while generating
  const [lastOtp, setLastOtp] = useState(null)        // { otp, agent_name, duration_minutes }
  const [openDraft, setOpenDraft] = useState(null)    // product_id being completed
  const [draftForm, setDraftForm] = useState({})
  const [completing, setCompleting] = useState(false)

  // Register form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [photo, setPhoto] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [aRes, dRes] = await Promise.all([
        apiFetch('/warehouse/add-agents'),
        apiFetch('/warehouse/add-agent-drafts'),
      ])
      const aJson = await aRes.json().catch(() => ({}))
      const aData = aJson.data !== undefined ? aJson.data : aJson
      if (aRes.ok) setAgents(Array.isArray(aData) ? aData : [])
      else toast.error(aJson.error || 'Agents load nahi hue')
      if (dRes.ok) {
        const dJson = await dRes.json().catch(() => ({}))
        const dData = dJson.data !== undefined ? dJson.data : dJson
        setDrafts(Array.isArray(dData) ? dData : [])
      }
    } catch (err) {
      console.error('Add-agents load error:', err)
      toast.error('Kuch load nahi hua — dobara try karen')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error('Name, email aur phone teeno bharēn')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Valid email enter karen')
      return
    }
    setRegSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('email', email.trim())
      fd.append('phone', phone.trim())
      if (photo) fd.append('photo', photo)
      const res = await apiFetch('/warehouse/add-agents', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Register fail hua')
      toast.success(`Agent registered — ID: ${(json.data || {}).agent_code || ''}`)
      setName(''); setEmail(''); setPhone(''); setPhoto(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRegSubmitting(false)
    }
  }

  const generateOtp = async (agent, minutes) => {
    setOtpBusy(agent.id)
    try {
      const res = await apiFetch(`/warehouse/add-agents/${agent.id}/otp`, {
        method: 'POST',
        body: JSON.stringify({ duration_minutes: minutes }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'OTP generate nahi hua')
      setLastOtp({ ...(json.data || {}), agent_name: agent.name })
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setOtpBusy(null)
    }
  }

  const toggleAgent = async (agent) => {
    try {
      const res = await apiFetch(`/warehouse/add-agents/${agent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: agent.status === 'active' ? 'inactive' : 'active' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || j.message || 'Status change fail')
      }
      toast.success(agent.status === 'active' ? 'Agent disabled (sessions revoked)' : 'Agent enabled')
      load()
    } catch (err) { toast.error(err.message) }
  }

  const deleteAgent = async (agent) => {
    if (!window.confirm(`Delete agent ${agent.name} (${agent.agent_code})? Ye permanent hai.`)) return
    try {
      const res = await apiFetch(`/warehouse/add-agents/${agent.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete fail hua')
      toast.success('Agent deleted')
      load()
    } catch (err) { toast.error(err.message) }
  }

  const openComplete = (draft) => {
    setOpenDraft(draft.id)
    setDraftForm({
      price: '', mrp: '', stock: '', sku: '', brand: 'None',
      selling_price: '', cost_price: '', unit: 'pcs',
      name: draft.name || '', description: draft.description || '',
    })
  }

  const completeDraft = async (draft) => {
    setCompleting(true)
    try {
      const res = await apiFetch(`/warehouse/add-agent-drafts/${draft.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          price: draftForm.price, mrp: draftForm.mrp || draftForm.price,
          stock: draftForm.stock, sku: draftForm.sku, brand: draftForm.brand,
          selling_price: draftForm.selling_price || draftForm.price,
          cost_price: draftForm.cost_price, unit: draftForm.unit,
          name: draftForm.name, description: draftForm.description,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Complete fail hua')
      toast.success('Product complete — admin approval ke liye bhej diya ✅')
      setOpenDraft(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCompleting(false)
    }
  }

  const copyOtp = () => {
    if (!lastOtp) return
    navigator.clipboard.writeText(lastOtp.otp)
    toast.success('OTP copy ho gaya — agent ko share karen')
  }

  const draftList = drafts.filter((d) => d.approval_status === 'agent_draft')
  const doneList = drafts.filter((d) => d.approval_status !== 'agent_draft')

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <PackagePlus className="text-amber-400" /> Add-Product Agents
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Listing agents — sirf discovery fields bharte hain (price access nahi). OTP-based daily login.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-bold">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* ── Register new agent ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h2 className="font-black flex items-center gap-2 mb-4"><UserPlus size={18} className="text-amber-400" /> Register New Agent</h2>
        <form onSubmit={handleRegister} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name *"
            className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email ID *" type="email"
            className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number *" type="tel"
            className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500" />
          <label className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-400 cursor-pointer truncate hover:border-amber-500">
            {photo ? photo.name : 'Passport photo (optional)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          </label>
          <button type="submit" disabled={regSubmitting}
            className="md:col-span-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-sm disabled:opacity-50">
            {regSubmitting ? 'Registering…' : 'Register Agent — unique ID milegi'}
          </button>
        </form>
      </section>

      {/* ── Last generated OTP ── */}
      {lastOtp && (
        <section className="bg-emerald-950/60 border border-emerald-800 rounded-2xl p-5 flex flex-wrap items-center gap-4">
          <KeyRound className="text-emerald-400" size={22} />
          <div>
            <p className="text-xs text-emerald-300/80 font-bold uppercase tracking-widest">
              {lastOtp.agent_name} · {fmtMin(lastOtp.duration_minutes)} session
            </p>
            <p className="text-3xl font-black tracking-[0.35em] text-emerald-300">{lastOtp.otp}</p>
            <p className="text-[11px] text-emerald-200/70 mt-1">Ye OTP dobara nahi dikhega — abhi copy karke agent ko share karen.</p>
          </div>
          <button onClick={copyOtp} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm">
            <Copy size={15} /> Copy OTP
          </button>
        </section>
      )}

      {/* ── Agents list ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h2 className="font-black flex items-center gap-2 mb-4"><ShieldCheck size={18} className="text-amber-400" /> Agents ({agents.length})</h2>
        {loading ? (
          <p className="text-slate-500 text-sm">Loading…</p>
        ) : agents.length === 0 ? (
          <p className="text-slate-500 text-sm">Koi agent registered nahi hai — upar se pehla agent add karen.</p>
        ) : (
          <div className="space-y-3">
            {agents.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-800/40 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  {a.photo_url
                    ? <img src={toImgUrl(a.photo_url)} alt="" className="h-11 w-11 rounded-full object-cover border border-slate-700" />
                    : <div className="h-11 w-11 rounded-full bg-slate-700 flex items-center justify-center font-black">{a.name?.[0]?.toUpperCase() || '?'}</div>}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate">{a.name} <span className="text-amber-400 font-black ml-1">{a.agent_code}</span></p>
                    <p className="text-xs text-slate-400 truncate">{a.email} · {a.phone}</p>
                  </div>
                  {a.active_session ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/70 border border-emerald-900 px-3 py-1.5 rounded-full">
                      <Timer size={13} /> Live · {fmtMin(a.active_session.duration_minutes)} shift
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-slate-500 bg-slate-800 px-3 py-1.5 rounded-full">Offline</span>
                  )}
                  <span className={`text-xs font-black px-2.5 py-1 rounded-full ${a.status === 'active' ? 'bg-slate-700 text-slate-200' : 'bg-red-950 text-red-400'}`}>
                    {a.status}
                  </span>
                </div>

                {/* OTP generator: flexible duration dropdown (60–480, max 8h) */}
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-800">
                  <select
                    id={`dur-${a.id}`}
                    defaultValue={240}
                    className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500"
                  >
                    {DURATIONS.map((m) => <option key={m} value={m}>{fmtMin(m)} session</option>)}
                  </select>
                  <button
                    onClick={() => generateOtp(a, Number(document.getElementById(`dur-${a.id}`)?.value || 240))}
                    disabled={otpBusy === a.id || a.status !== 'active'}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-black text-sm"
                  >
                    <KeyRound size={14} /> {otpBusy === a.id ? 'Generating…' : 'Generate OTP'}
                  </button>
                  {a.active_session && (
                    <span className="text-xs text-slate-400">ends ~{new Date(String(a.active_session.session_ends_at).replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => toggleAgent(a)} title="Enable/disable"
                      className={`p-2 rounded-lg border ${a.status === 'active' ? 'border-slate-700 text-slate-300 hover:text-red-400' : 'border-emerald-800 text-emerald-400'}`}>
                      <Power size={15} />
                    </button>
                    <button onClick={() => deleteAgent(a)} title="Delete"
                      className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-red-400">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Agent drafts awaiting completion ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h2 className="font-black flex items-center gap-2 mb-1">
          <Clock size={18} className="text-amber-400" /> Drafts — completion needed ({draftList.length})
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Agent ne discovery bhar diya hai. Aap price/stock/SKU complete karke admin approval me bhejenge.
        </p>
        {draftList.length === 0 ? (
          <p className="text-slate-500 text-sm">Koi pending draft nahi.</p>
        ) : (
          <div className="space-y-3">
            {draftList.map((d) => (
              <div key={d.id} className="rounded-xl border border-slate-800 bg-slate-800/40 p-4">
                <div className="flex items-center gap-3">
                  {Array.isArray(d.images) && d.images[0]
                    ? <img src={toImgUrl(d.images[0])} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-700" />
                    : <div className="h-12 w-12 rounded-lg bg-slate-700" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate">{d.name}</p>
                    <p className="text-xs text-slate-400">{d.category} · by <span className="text-amber-400 font-bold">{d.added_by_agent_code}</span> ({d.agent_name})</p>
                  </div>
                  <button onClick={() => (openDraft === d.id ? setOpenDraft(null) : openComplete(d))}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm">
                    Complete & Submit {openDraft === d.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {openDraft === d.id && (
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <label className="text-xs font-bold text-slate-400">Price (₹) *
                        <input type="number" min="1" value={draftForm.price} onChange={(e) => setDraftForm({ ...draftForm, price: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">MRP (₹)
                        <input type="number" min="0" value={draftForm.mrp} onChange={(e) => setDraftForm({ ...draftForm, mrp: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">Stock
                        <input type="number" min="0" value={draftForm.stock} onChange={(e) => setDraftForm({ ...draftForm, stock: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">SKU (blank = auto)
                        <input value={draftForm.sku} onChange={(e) => setDraftForm({ ...draftForm, sku: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">Brand (default: None)
                        <input value={draftForm.brand} onChange={(e) => setDraftForm({ ...draftForm, brand: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">Unit
                        <input value={draftForm.unit} onChange={(e) => setDraftForm({ ...draftForm, unit: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                    </div>
                    <button onClick={() => completeDraft(d)} disabled={completing}
                      className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-sm">
                      {completing ? 'Submitting…' : 'Complete & Send for Admin Approval →'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recently completed (visibility only) ── */}
      {doneList.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="font-black mb-4 text-slate-300">Completed / In-review ({doneList.length})</h2>
          <div className="space-y-2">
            {doneList.slice(0, 12).map((d) => (
              <div key={d.id} className="flex items-center gap-3 text-sm">
                <span className="font-bold truncate flex-1">{d.name}</span>
                <span className="text-xs text-amber-400 font-bold">{d.added_by_agent_code}</span>
                <span className={`text-xs font-black px-2.5 py-1 rounded-full ${
                  d.approval_status === 'approved' ? 'bg-emerald-950 text-emerald-400'
                  : d.approval_status === 'rejected' ? 'bg-red-950 text-red-400'
                  : 'bg-amber-950 text-amber-400'}`}>
                  {d.approval_status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
