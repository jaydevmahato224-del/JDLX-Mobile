import React, { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  PackagePlus, KeyRound, Timer, Coffee, Play, Square, LogOut, Upload,
  Trash2, Image as ImageIcon, Loader2, ShieldCheck, AlertTriangle
} from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'
import { resolveMediaUrl } from '../../config'

// Uploads may return cloud URLs or local /static paths (backend origin) —
// resolve both against the right host for preview thumbnails.
const toImgUrl = (u) => (u ? resolveMediaUrl(String(u)) : u)

// ─── Add-Product Agent Workspace ─────────────────────────────────────────────
// One file, two phases:
//   LOGIN  — agent enters email-or-phone + the 6-digit OTP the warehouse
//            manager generated for them today. Terms & conditions are shown
//            CLEARLY on this screen (user requirement) before login.
//   APP    — session countdown (flexible, manager-chosen duration), break
//            control (15 min per rolling hour, splittable — pause the
//            countdown), and the add-product form with ONLY the allowed
//            fields. No price/stock input exists here at all.
// Auth token lives in localStorage 'addAgentToken' (separate from the
// warehouse owner token, so the two sessions never collide).

const AGENT_TOKEN_KEY = 'addAgentToken'

// apiFetch prefixes API_BASE_URL (no Vite proxy in this project, so relative
// fetch would hit the dev server and 404) — but it attaches the WAREHOUSE
// owner token by default. The agent token is a DIFFERENT credential, so every
// call here overrides the Authorization header explicitly.
const agentFetch = (path, options = {}) =>
  apiFetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${localStorage.getItem(AGENT_TOKEN_KEY) || ''}`,
    },
  })

const TERMS = [
  'Main sirf product ki listing details (image, category, title, description, tags, return policy) bharunga.',
  'Mujhe price ya stock set karne ka koi access nahi hai — wo warehouse manager karega.',
  'Mera session utna hi rahega jitna manager ne OTP dete waqt chuna (max 8 hours).',
  'Har hour me sirf 15 minute ka break milta hai — ek saath ya tukdon me, jab chahein.',
  'Har product par mera unique agent ID save hota hai, isliye kaam ki accountability meri hai.',
  'Galat/ghumawa content dalne par mera access manager kabhi bhi revoke kar sakta hai.',
]

function fmtCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

export default function AgentWorkspace() {
  const [token, setToken] = useState(() => localStorage.getItem(AGENT_TOKEN_KEY) || '')
  const [phase, setPhase] = useState(token ? 'boot' : 'login') // login | boot | app
  const [me, setMe] = useState(null)
  const [session, setSession] = useState(null)

  // login form
  const [identifier, setIdentifier] = useState('')
  const [otp, setOtp] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [agreed, setAgreed] = useState(false)

  // break
  const breakStartRef = useRef(null)
  const [breakElapsed, setBreakElapsed] = useState(0)

  // product form
  const [categories, setCategories] = useState([])
  const [images, setImages] = useState([])
  const [uploading, setUploading] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [returnPolicy, setReturnPolicy] = useState('')
  const [saving, setSaving] = useState(false)
  const [myDrafts, setMyDrafts] = useState([])

  // ── auth boot: token hai to session validate karo ──
  const bootSession = useCallback(async () => {
    try {
      const res = await agentFetch('/agent/session')
      if (!res.ok) throw new Error('session dead')
      const json = await res.json()
      const d = json.data || json
      setMe(d.agent)
      setSession(d)
      setPhase('app')
    } catch {
      localStorage.removeItem(AGENT_TOKEN_KEY)
      setToken('')
      setPhase('login')
    }
  }, [])

  useEffect(() => { if (phase === 'boot' && token) bootSession() }, [phase, token, bootSession])

  // ── heartbeat: session + break state sync (30s) ──
  useEffect(() => {
    if (phase !== 'app' || !token) return
    const tick = async () => {
      try {
        const res = await agentFetch('/agent/session')
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem(AGENT_TOKEN_KEY)
          setToken(''); setPhase('login')
          toast.error('Session khatam — manager se naya OTP lein')
          return
        }
        if (res.ok) {
          const json = await res.json()
          setSession(json.data || json)
        }
      } catch { /* transient network error — retry on next tick */ }
    }
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [phase, token])

  // ── local 1s countdown between heartbeats ──
  useEffect(() => {
    if (phase !== 'app') return
    const id = setInterval(() => {
      setSession((prev) => {
        if (!prev) return prev
        const onBreak = prev.break?.active
        const next = { ...prev }
        if (!onBreak) {
          next.remaining_minutes = Math.max(0, prev.remaining_minutes - 1 / 60)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  // break stopwatch
  useEffect(() => {
    if (!session?.break?.active) { breakStartRef.current = null; setBreakElapsed(0); return }
    if (!breakStartRef.current) {
      breakStartRef.current = Date.now() - (session.break.active.elapsed_minutes || 0) * 60000
    }
    const id = setInterval(() => setBreakElapsed((Date.now() - breakStartRef.current) / 1000), 500)
    return () => clearInterval(id)
  }, [session?.break?.active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!agreed) { toast.error('Pehle Terms & Conditions accept karen'); return }
    setLoggingIn(true)
    try {
      const res = await apiFetch('/agent/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim(), otp: otp.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Login fail hua')
      const d = json.data || {}
      localStorage.setItem(AGENT_TOKEN_KEY, d.token)
      setToken(d.token)
      setMe(d.agent)
      setSession(d.session)
      setPhase('app')
      toast.success(`Welcome ${d.agent?.name || ''} — session shuru!`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    try { await agentFetch('/agent/logout', { method: 'POST' }) } catch { /* ignore */ }
    localStorage.removeItem(AGENT_TOKEN_KEY)
    setToken(''); setMe(null); setSession(null); setPhase('login')
    toast.success('Logged out — apna shift complete kiya? 🎉')
  }

  // ── break actions ──
  const startBreak = async () => {
    try {
      const res = await agentFetch('/agent/break/start', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Break start nahi hua')
      const sessRes = await agentFetch('/agent/session')
      if (sessRes.ok) setSession((await sessRes.json()).data)
      toast.success('Break chalu — countdown paused')
    } catch (err) { toast.error(err.message) }
  }

  const endBreak = async () => {
    try {
      const res = await agentFetch('/agent/break/end', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Break end nahi hua')
      const sessRes = await agentFetch('/agent/session')
      if (sessRes.ok) setSession((await sessRes.json()).data)
      toast.success(`Break over — session ${json.data?.break_taken_minutes ?? ''} min extend hua`)
    } catch (err) { toast.error(err.message) }
  }

  // ── product form helpers ──
  const loadWorkspaceData = useCallback(async () => {
    try {
      const [cRes, dRes] = await Promise.all([
        agentFetch('/agent/categories'),
        agentFetch('/agent/products'),
      ])
      if (cRes.ok) { const j = await cRes.json(); setCategories(j.data || j || []) }
      if (dRes.ok) { const j = await dRes.json(); setMyDrafts(j.data || j || []) }
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { if (phase === 'app') loadWorkspaceData() }, [phase, loadWorkspaceData])

  const handleUpload = async (file) => {
    if (!file) return
    if (images.length >= 8) { toast.error('Max 8 images'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await agentFetch('/agent/upload', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Upload fail')
      setImages((prev) => [...prev, (json.data || {}).url])
      toast.success('Image uploaded')
    } catch (err) { toast.error(err.message) }
    finally { setUploading(false) }
  }

  const removeImage = (idx) => setImages((prev) => prev.filter((_, i) => i !== idx))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!title.trim() || !description.trim() || !categoryId || images.length === 0) {
      toast.error('Image, category, title aur description sab zaroori hain')
      return
    }
    setSaving(true)
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
      const res = await agentFetch('/agent/products', {
        method: 'POST',
        body: JSON.stringify({
          name: title.trim(), description: description.trim(),
          category_id: Number(categoryId), images, tags,
          return_policy: returnPolicy.trim(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.message || 'Save fail hua')
      toast.success('Draft save ho gaya ✅ Manager baaki fields bhar ke admin ko bhejega')
      setTitle(''); setDescription(''); setTagsInput(''); setReturnPolicy('')
      setImages([]); setCategoryId('')
      loadWorkspaceData()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  // ══════════════════ LOGIN PHASE ══════════════════
  if (phase === 'login' || phase === 'boot') {
    return (
      <div className="min-h-screen bg-[#0f172a] text-slate-100 flex items-center justify-center p-4">
        {phase === 'boot' ? (
          <Loader2 className="animate-spin text-amber-400" size={36} />
        ) : (
          <div className="w-full max-w-md space-y-5">
            <div className="text-center">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto text-2xl shadow-lg shadow-amber-500/20">📦</div>
              <h1 className="text-2xl font-black mt-3">Add-Product Agent Login</h1>
              <p className="text-sm text-slate-400 mt-1">Warehouse manager se mila OTP aur apni email/phone enter karen</p>
            </div>

            {/* T&C — clearly shown at login time (user requirement) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-xs font-black uppercase tracking-widest text-amber-400 flex items-center gap-1.5 mb-2">
                <ShieldCheck size={13} /> Terms & Conditions
              </p>
              <ul className="space-y-1.5">
                {TERMS.map((t, i) => (
                  <li key={i} className="text-[11px] text-slate-400 leading-relaxed flex gap-1.5">
                    <span className="text-amber-500/70">{i + 1}.</span> {t}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2 mt-3 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-500" />
                <span className="text-xs font-bold text-slate-300">Main in terms ko accept karta/karti hoon</span>
              </label>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Email ya Mobile number" autoComplete="username"
                className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-sm outline-none focus:border-amber-500" />
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit OTP" inputMode="numeric" autoComplete="one-time-code"
                className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-sm tracking-[0.4em] font-black text-center outline-none focus:border-amber-500" />
              <button type="submit" disabled={loggingIn || !agreed}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {loggingIn ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                {loggingIn ? 'Logging in…' : 'Login with OTP'}
              </button>
            </form>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              Password yahan hota hi nahi — har din manager naya OTP banata hai.<br />
              Session duration manager choose karta hai (1–8 hours).
            </p>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════ APP PHASE ══════════════════
  const remainingSec = (session?.remaining_minutes || 0) * 60
  const onBreak = !!session?.break?.active
  const breakRemainingAllowance = session?.break?.remaining_minutes ?? 0

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {/* Session bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          {me?.photo_url
            ? <img src={toImgUrl(me.photo_url)} alt="" className="h-11 w-11 rounded-full object-cover border border-slate-700" />
            : <div className="h-11 w-11 rounded-full bg-slate-700 flex items-center justify-center font-black">{me?.name?.[0] || '?'}</div>}
          <div>
            <p className="font-black text-sm">{me?.name} <span className="text-amber-400 ml-1">{me?.agent_code}</span></p>
            <p className="text-[11px] text-slate-400">{me?.email}</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className={`text-right ${onBreak ? 'opacity-60' : ''}`}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1 justify-end">
              <Timer size={11} /> {onBreak ? 'Paused (break)' : 'Session left'}
            </p>
            <p className={`text-2xl font-black tabular-nums ${remainingSec < 600 ? 'text-red-400' : 'text-emerald-400'}`}>
              {fmtCountdown(remainingSec)}
            </p>
          </div>
          <button onClick={handleLogout} title="Logout"
            className="p-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-red-400">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Break control — 15 min per rolling hour, splittable */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <Coffee size={18} className="text-amber-400" />
        <div className="text-sm">
          <p className="font-bold">Break allowance: <span className="text-emerald-400">{breakRemainingAllowance} min</span> / 15 min (is hour)</p>
          <p className="text-[11px] text-slate-500">Ek saath ya 2-2 min me — jab chahein lo. Break me countdown pause hota hai.</p>
        </div>
        {onBreak ? (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-red-400 font-black tabular-nums">{fmtCountdown(breakElapsed)}</span>
            <button onClick={endBreak}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-black text-sm">
              <Square size={14} /> End Break
            </button>
          </div>
        ) : (
          <button onClick={startBreak} disabled={breakRemainingAllowance <= 0}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 font-bold text-sm">
            <Play size={14} /> Start Break
          </button>
        )}
      </div>

      {/* Add product form — ONLY the allowed fields */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-black flex items-center gap-2"><PackagePlus size={18} className="text-amber-400" /> Add Product</h2>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-800 px-2.5 py-1 rounded-full">
            Price: manager set karega
          </span>
        </div>

        {/* Images */}
        <div>
          <label className="text-xs font-bold text-slate-400 block mb-2">Product Images * (max 8)</label>
          <div className="flex flex-wrap gap-2">
            {images.map((url, idx) => (
              <div key={idx} className="relative h-20 w-20">
                <img src={toImgUrl(url)} alt="" className="h-full w-full object-cover rounded-lg border border-slate-700" />
                <button type="button" onClick={() => removeImage(idx)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <label className={`h-20 w-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer text-slate-500 hover:border-amber-500 hover:text-amber-400 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <><Upload size={18} /><ImageIcon size={12} className="mt-1" /></>}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => { handleUpload(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="text-xs font-bold text-slate-400 block mb-1">Category *</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500">
            <option value="">Select category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs font-bold text-slate-400 block mb-1">Product Title * <span className="text-slate-500">({title.length}/120)</span></label>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. OnePlus Nord CE4 5G 8GB/128GB Celadon Marble"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500" />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-bold text-slate-400 block mb-1">Description *</label>
          <textarea value={description} rows={5} maxLength={4000} onChange={(e) => setDescription(e.target.value)}
            placeholder="Condition, box contents, specifications — jo bhi customer ko pata hona chahiye"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500 resize-y" />
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-bold text-slate-400 block mb-1">Tags <span className="text-slate-500">(comma separated)</span></label>
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
            placeholder="oneplus, 5g, under 25000, nord"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500" />
        </div>

        {/* Return policy */}
        <div>
          <label className="text-xs font-bold text-slate-400 block mb-1">Return Policy</label>
          <textarea value={returnPolicy} rows={2} maxLength={500} onChange={(e) => setReturnPolicy(e.target.value)}
            placeholder="e.g. 7 din replacement warranty — badalne ke liye box + bill zaroori"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm outline-none focus:border-amber-500 resize-y" />
        </div>

        <button type="submit" disabled={saving}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
          {saving ? 'Saving…' : 'Save Product Draft'}
        </button>
      </form>

      {/* My drafts */}
      {myDrafts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h3 className="font-black mb-3 text-sm">Mere Drafts ({myDrafts.length})</h3>
          <div className="space-y-2">
            {myDrafts.slice(0, 10).map((d) => (
              <div key={d.id} className="flex items-center gap-3 text-sm">
                {Array.isArray(d.images) && d.images[0]
                  ? <img src={toImgUrl(d.images[0])} alt="" className="h-9 w-9 rounded-lg object-cover border border-slate-700" />
                  : <div className="h-9 w-9 rounded-lg bg-slate-700" />}
                <span className="font-bold truncate flex-1">{d.name}</span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                  {d.approval_status === 'agent_draft' ? 'manager review pending' : d.approval_status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-600 flex items-center gap-1.5 justify-center pb-4">
        <AlertTriangle size={11} /> Har draft par aapka agent ID ({me?.agent_code}) record hota hai.
      </p>
    </div>
  )
}
