import React, { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  UserPlus, Copy, Check, KeyRound, Clock, Power, Trash2, PackagePlus,
  RefreshCw, Timer, Coffee, ShieldCheck, ChevronDown, ChevronUp,
  Share2, ExternalLink, Smartphone, Wallet, IndianRupee, ClipboardList, Clock3
} from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'
import { resolveMediaUrl } from '../../config'
import { agentLoginUrl, shareAgentLink } from '../../utils/agentShare'

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
  const [linkCopied, setLinkCopied] = useState(false)

  // Register form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [photo, setPhoto] = useState(null)
  const [perEntryRate, setPerEntryRate] = useState('')   // ₹ per entry (manager decides)
  const [rateEditing, setRateEditing] = useState(null)   // agent_id being rate-edited
  const [rateValue, setRateValue] = useState('')

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
      else toast.error(aJson.error || 'Could not load agents')
      if (dRes.ok) {
        const dJson = await dRes.json().catch(() => ({}))
        const dData = dJson.data !== undefined ? dJson.data : dJson
        setDrafts(Array.isArray(dData) ? dData : [])
      }
    } catch (err) {
      console.error('Add-agents load error:', err)
      toast.error('Something did not load — please try again')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error('Name, email and phone are all required')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Please enter a valid email')
      return
    }
    setRegSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('email', email.trim())
      fd.append('phone', phone.trim())
      fd.append('per_entry_rate', perEntryRate || '0')
      if (photo) fd.append('photo', photo)
      const res = await apiFetch('/warehouse/add-agents', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Registration failed')
      toast.success(`Agent registered — ID: ${(json.data || {}).agent_code || ''}`)
      setName(''); setEmail(''); setPhone(''); setPhoto(null); setPerEntryRate('')
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
      if (!res.ok) throw new Error(json.error || json.message || 'OTP could not be generated')
      setLastOtp({ ...(json.data || {}), agent_name: agent.name })
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setOtpBusy(null)
    }
  }

  const saveAgentRate = async (agent) => {
    try {
      const res = await apiFetch(`/warehouse/add-agents/${agent.id}/rate`, {
        method: 'PATCH',
        body: JSON.stringify({ per_entry_rate: rateValue }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Rate update failed')
      toast.success(`Rate updated — ₹${json.data?.per_entry_rate ?? rateValue} per entry`)
      setRateEditing(null); setRateValue('')
      load()
    } catch (err) { toast.error(err.message) }
  }

  const toggleAgent = async (agent) => {
    try {
      const res = await apiFetch(`/warehouse/add-agents/${agent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: agent.status === 'active' ? 'inactive' : 'active' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || j.message || 'Status change failed')
      }
      toast.success(agent.status === 'active' ? 'Agent disabled (sessions revoked)' : 'Agent enabled')
      load()
    } catch (err) { toast.error(err.message) }
  }

  const deleteAgent = async (agent) => {
    if (!window.confirm(`Delete agent ${agent.name} (${agent.agent_code})? This is permanent.`)) return
    try {
      const res = await apiFetch(`/warehouse/add-agents/${agent.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Agent deleted')
      load()
    } catch (err) { toast.error(err.message) }
  }

  // Case-like categories get the standard no-warranty line auto-filled and
  // LOCKED (user requirement) — the backend enforces the same default.
  const DEFAULT_WARRANTY_TEXT = 'No warranty available in mobile cases'
  const isCaseLikeCategory = (cat) =>
    /case|cover|skin|pouch|sleeve/i.test(String(cat || ''))

  // Discount base matches the backend's mrp_eff (complete endpoint): MRP when
  // filled, else the selling price. Keeps the UI auto-calc identical to what
  // gets stored.
  const draftDiscountBase = (f) => parseFloat(f?.mrp) || parseFloat(f?.price) || 0

  const openComplete = (draft) => {
    setOpenDraft(draft.id)
    setDraftForm({
      price: '', mrp: '', stock: '', sku: '', brand: 'None',
      selling_price: '', cost_price: '', unit: 'pcs',
      name: draft.name || '', description: draft.description || '',
      // Extended fields (parity with the regular add-product form)
      units_per_pack: '1', material_type: '',
      discount_amt: '', discount_pct: '', gst_pct: '',
      apply_gst: true,
      offline_price: '', is_active: true,
      compatibility: draft.content?.compatibility || '',
      box_contents: draft.content?.box_contents || '',
      warranty_info: draft.content?.warranty_info
        || (isCaseLikeCategory(draft.category) ? DEFAULT_WARRANTY_TEXT : ''),
      return_window: draft.return_window ?? 7,
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
          // Extended fields
          units_per_pack: draftForm.units_per_pack,
          material_type: draftForm.material_type,
          discount_amt: draftForm.discount_amt, discount_pct: draftForm.discount_pct,
          gst_pct: draftForm.apply_gst === false ? 0 : draftForm.gst_pct,
          offline_price: draftForm.offline_price,
          is_active: draftForm.is_active,
          compatibility: draftForm.compatibility,
          box_contents: draftForm.box_contents,
          warranty_info: draftForm.warranty_info,
          return_window: draftForm.return_window,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Completion failed')
      toast.success('Product completed — sent for admin approval ✅')
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
    toast.success('OTP copied — share it with the agent')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(agentLoginUrl())
      setLinkCopied(true)
      toast.success('Login link copied — send it to the agent')
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      toast.error('Copy failed — link: ' + agentLoginUrl())
    }
  }

  const handleShareLink = async () => {
    const how = await shareAgentLink(agentLoginUrl())
    if (how === 'copied') toast.success('Link copied')
  }

  const shareOtpOnWhatsApp = () => {
    if (!lastOtp) return
    const url = agentLoginUrl()
    const msg = `JDLX Agent login:\nID: ${lastOtp.agent_name}\nOTP: ${lastOtp.otp}\nSession: ${fmtMin(lastOtp.duration_minutes)}\nLogin here: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
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
            Listing agents — they only fill discovery fields (no price access). OTP-based daily login.
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
          <input value={perEntryRate} onChange={(e) => setPerEntryRate(e.target.value)} placeholder="Pay per entry (₹) — e.g. 10" type="number" min="0" step="0.5"
            className="md:col-span-2 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500" />
          <p className="md:col-span-2 text-[11px] text-slate-500 self-center">
            The agent will see their earning calculated at this rate on their profile. You can change it later.
          </p>
          <button type="submit" disabled={regSubmitting}
            className="md:col-span-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-sm disabled:opacity-50">
            {regSubmitting ? 'Registering…' : 'Register Agent — gets a unique ID'}
          </button>
        </form>
      </section>

      {/* ── Agent login link — share + installable app info ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-black flex items-center gap-2 text-sm">
              <ExternalLink size={16} className="text-amber-400" /> Agent Login Link
            </h2>
            <p className="text-xs text-slate-500 mt-1 truncate">
              {agentLoginUrl()}
            </p>
            <p className="text-[11px] text-slate-600 mt-1 flex items-start gap-1">
              <Smartphone size={11} className="shrink-0 mt-0.5" /> <span>Agents can also install this as an app on their phone ("Install App" button on the login page).</span>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={copyLink}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-sm border border-slate-700">
              {linkCopied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
              {linkCopied ? 'Copied!' : 'Copy Link'}
            </button>
            <button onClick={handleShareLink}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm">
              <Share2 size={15} /> Share
            </button>
          </div>
        </div>
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
            <p className="text-[11px] text-emerald-200/70 mt-1">This OTP will not be shown again — copy and share it with the agent now.</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={shareOtpOnWhatsApp} title="Send the OTP + login link on WhatsApp"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#25D366] hover:brightness-110 text-slate-950 font-black text-sm">
              <Share2 size={15} /> WhatsApp
            </button>
            <button onClick={copyOtp} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm">
              <Copy size={15} /> Copy OTP
            </button>
          </div>
        </section>
      )}

      {/* ── Agents list ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h2 className="font-black flex items-center gap-2 mb-4"><ShieldCheck size={18} className="text-amber-400" /> Agents ({agents.length})</h2>
        {loading ? (
          <p className="text-slate-500 text-sm">Loading…</p>
        ) : agents.length === 0 ? (
          <p className="text-slate-500 text-sm">No agents registered yet — add the first one above.</p>
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

                {/* Work + payout snapshot — entries, time worked, break, earning */}
                {a.stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                    <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1"><ClipboardList size={10} /> Entries</p>
                      <p className="text-sm font-black text-slate-100">{a.stats.entries} <span className="text-slate-500 font-bold">({a.stats.approved_entries} approved)</span></p>
                    </div>
                    <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1"><Clock3 size={10} /> Worked</p>
                      <p className="text-sm font-black text-slate-100">{fmtMin(Math.round(a.stats.minutes_worked || 0))}</p>
                    </div>
                    <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1"><Coffee size={10} /> Break</p>
                      <p className="text-sm font-black text-slate-100">{fmtMin(Math.round(a.stats.break_minutes || 0))}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-950/40 border border-emerald-900/60 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 flex items-center gap-1"><Wallet size={10} /> Payable</p>
                      <p className="text-sm font-black text-emerald-300">₹{a.stats.total_earning} <span className="text-emerald-600/80 font-bold">@ ₹{a.stats.per_entry_rate}/entry</span></p>
                    </div>
                  </div>
                )}

                {/* Rate edit + OTP generator row */}
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-800">
                  {rateEditing === a.id ? (
                    <span className="flex items-center gap-1.5">
                      <IndianRupee size={14} className="text-amber-400" />
                      <input type="number" min="0" step="0.5" value={rateValue} autoFocus
                        onChange={(e) => setRateValue(e.target.value)} placeholder="₹ per entry"
                        className="w-28 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500" />
                      <button onClick={() => saveAgentRate(a)}
                        className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs">Save</button>
                      <button onClick={() => { setRateEditing(null); setRateValue('') }}
                        className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs">Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => { setRateEditing(a.id); setRateValue(String(a.per_entry_rate ?? 0)) }}
                      title="Change the per-entry payout rate"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs">
                      <IndianRupee size={13} className="text-amber-400" /> ₹{a.per_entry_rate ?? 0} / entry
                    </button>
                  )}

                  {/* OTP generator: flexible duration dropdown (60–480, max 8h) */}
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
          The agent has filled the discovery details. Complete price/stock/SKU and send it for admin approval.
        </p>
        {draftList.length === 0 ? (
          <p className="text-slate-500 text-sm">No pending drafts.</p>
        ) : (
          <div className="space-y-3">
            {draftList.map((d) => (
              <div key={d.id} className="rounded-xl border border-slate-800 bg-slate-800/40 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  {Array.isArray(d.images) && d.images[0]
                    ? <img src={toImgUrl(d.images[0])} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-700" />
                    : <div className="h-12 w-12 rounded-lg bg-slate-700" />}
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-bold text-sm truncate">{d.name}</p>
                    <p className="text-xs text-slate-400 truncate">{d.category} · by <span className="text-amber-400 font-bold">{d.added_by_agent_code}</span> ({d.agent_name})</p>
                  </div>
                  <button onClick={() => (openDraft === d.id ? setOpenDraft(null) : openComplete(d))}
                    className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm">
                    Complete & Submit {openDraft === d.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {openDraft === d.id && (
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                    {/* Agent-contributed discovery — searchable on the storefront */}
                    {(d.search_keywords?.length > 0 || d.product_tags?.length > 0 || d.search_synonyms?.length > 0) && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                          <ShieldCheck size={11} className="text-amber-400" /> Agent discovery inputs
                        </p>
                        {[['Keywords', d.search_keywords], ['Tags', d.product_tags], ['Synonyms', d.search_synonyms]].map(([label, list]) =>
                          list?.length > 0 ? (
                            <div key={label} className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 w-20">{label}</span>
                              {list.map((t) => (
                                <span key={t} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">{t}</span>
                              ))}
                            </div>
                          ) : null
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <label className="text-xs font-bold text-slate-400">Price (₹) *
                        <input type="number" min="1" value={draftForm.price} onChange={(e) => setDraftForm((prev) => {
                          const next = { ...prev, price: e.target.value }
                          // Base changed — refresh whichever discount field is filled.
                          const base = draftDiscountBase(next)
                          const amt = parseFloat(prev.discount_amt) || 0
                          const pct = parseFloat(prev.discount_pct) || 0
                          if (amt > 0 && base > 0) next.discount_pct = ((amt / base) * 100).toFixed(2)
                          else if (pct > 0 && base > 0) next.discount_amt = (base * (pct / 100)).toFixed(2)
                          return next
                        })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">MRP (₹)
                        <input type="number" min="0" value={draftForm.mrp} onChange={(e) => setDraftForm((prev) => {
                          const next = { ...prev, mrp: e.target.value }
                          // Base changed — refresh whichever discount field is filled.
                          const base = draftDiscountBase(next)
                          const amt = parseFloat(prev.discount_amt) || 0
                          const pct = parseFloat(prev.discount_pct) || 0
                          if (amt > 0 && base > 0) next.discount_pct = ((amt / base) * 100).toFixed(2)
                          else if (pct > 0 && base > 0) next.discount_amt = (base * (pct / 100)).toFixed(2)
                          return next
                        })}
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

                    {/* ── Packaging ── */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                      <label className="text-xs font-bold text-slate-400">Units per Pack
                        <input type="number" min="1" value={draftForm.units_per_pack}
                          onChange={(e) => setDraftForm({ ...draftForm, units_per_pack: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">Landing Cost (per unit ₹)
                        <input type="number" min="0" value={draftForm.cost_price}
                          onChange={(e) => setDraftForm({ ...draftForm, cost_price: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">Material Type
                        <input value={draftForm.material_type} placeholder="e.g. Premium Glass, Silicone"
                          onChange={(e) => setDraftForm({ ...draftForm, material_type: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                    </div>

                    {/* ── Discount & GST — amt/pct two-way auto-calc (base = MRP, else price — same as backend) ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                      <label className="text-xs font-bold text-slate-400">Discount (₹)
                        <input type="number" min="0" value={draftForm.discount_amt}
                          onChange={(e) => {
                            const amt = e.target.value
                            setDraftForm((prev) => {
                              const base = draftDiscountBase(prev)
                              return {
                                ...prev, discount_amt: amt,
                                discount_pct: base > 0 && parseFloat(amt) > 0 ? ((parseFloat(amt) / base) * 100).toFixed(2) : '',
                              }
                            })
                          }}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">Discount (%)
                        <input type="number" min="0" max="100" value={draftForm.discount_pct}
                          onChange={(e) => {
                            const pct = e.target.value
                            setDraftForm((prev) => {
                              const base = draftDiscountBase(prev)
                              return {
                                ...prev, discount_pct: pct,
                                discount_amt: base > 0 && parseFloat(pct) > 0 ? (base * (parseFloat(pct) / 100)).toFixed(2) : '',
                              }
                            })
                          }}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      {/* GST toggle — non-GST-registered sellers can switch GST off entirely (stored as 0) */}
                      <div className={`flex flex-col justify-between p-3 rounded-lg border transition-all ${draftForm.apply_gst ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700 bg-slate-800/60'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-400">GST / TAX</span>
                          <button type="button" onClick={() => setDraftForm((prev) => ({
                            ...prev,
                            apply_gst: !prev.apply_gst,
                            gst_pct: !prev.apply_gst ? (prev.gst_pct === 0 ? '' : prev.gst_pct) : 0,
                          }))}
                            aria-label="Toggle GST on or off for this product"
                            className={`w-9 h-5 rounded-full p-0.5 transition-all shrink-0 ${draftForm.apply_gst ? 'bg-amber-500' : 'bg-slate-700'}`}>
                            <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${draftForm.apply_gst ? 'translate-x-4' : 'translate-x-0'}`} />
                          </button>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-1">
                          {draftForm.apply_gst ? 'Enabled' : 'Disabled — no GST on product'}
                        </p>
                      </div>
                      <label className="text-xs font-bold text-slate-400">Offline Sale Price (₹)
                        <input type="number" min="0" value={draftForm.offline_price} placeholder="blank = online price"
                          onChange={(e) => setDraftForm({ ...draftForm, offline_price: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                    </div>
                    {draftForm.apply_gst && (
                      <label className="text-xs font-bold text-slate-400 block">GST Rate (%)
                        <input type="number" min="0" max="28" value={draftForm.gst_pct} placeholder="18"
                          onChange={(e) => setDraftForm({ ...draftForm, gst_pct: e.target.value })}
                          className="mt-1 w-full sm:w-40 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                    )}

                    {/* ── Compatibility / Box / Warranty (case categories auto-locked) ── */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                      <label className="text-xs font-bold text-slate-400">Compatibility
                        <input value={draftForm.compatibility} placeholder="e.g. iPhone 15, Galaxy S24"
                          onChange={(e) => setDraftForm({ ...draftForm, compatibility: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">What's in the Box
                        <input value={draftForm.box_contents} placeholder="e.g. Main Unit, User Manual"
                          onChange={(e) => setDraftForm({ ...draftForm, box_contents: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500" />
                      </label>
                      <label className="text-xs font-bold text-slate-400">Warranty Info
                        <input value={draftForm.warranty_info} disabled={isCaseLikeCategory(d.category)}
                          onChange={(e) => setDraftForm({ ...draftForm, warranty_info: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500 disabled:opacity-60" />
                      </label>
                    </div>
                    {isCaseLikeCategory(d.category) && (
                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <ShieldCheck size={11} className="text-emerald-400" /> Case/cover category — warranty auto-set to "{DEFAULT_WARRANTY_TEXT}" (locked).
                      </p>
                    )}

                    {/* ── Return window + Active status ── */}
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <label className="text-xs font-bold text-slate-400">Return Window
                        <select value={String(draftForm.return_window)}
                          onChange={(e) => setDraftForm({ ...draftForm, return_window: parseInt(e.target.value) || 0 })}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-100 outline-none focus:border-amber-500">
                          <option value="0">No Returns</option>
                          <option value="1">24 Hours</option>
                          <option value="2">48 Hours</option>
                          <option value="3">3 Days</option>
                          <option value="5">5 Days</option>
                          <option value="7">7 Days</option>
                        </select>
                      </label>
                      <label className="text-xs font-bold text-slate-400">Active Status
                        <button type="button" onClick={() => setDraftForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
                          className={`mt-1 w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-bold ${draftForm.is_active ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                          {draftForm.is_active ? 'Active — available for orders' : 'Inactive — hidden from orders'}
                          <span className={`w-10 h-5 rounded-full p-0.5 transition-all ${draftForm.is_active ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                            <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${draftForm.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                          </span>
                        </button>
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
