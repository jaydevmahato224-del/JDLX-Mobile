import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
    Activity, Server, Database, Users, Gauge, AlertTriangle, ShieldAlert,
    RefreshCw, TrendingUp, Timer, Zap, Wifi, WifiOff, CheckCircle2,
    Cpu, HardDrive, Radio, Lightbulb, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Legend,
} from 'recharts'
import { API_BASE_URL } from '../../config'

const REFRESH_MS = 5000

// ---- small utils -----------------------------------------------------------
const timeAgo = (ts) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    return `${Math.floor(s / 3600)}h ago`
}

const fmtUptime = (s) => {
    if (s == null) return '—'
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

const fmtMinute = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const scoreColor = (score) =>
    score >= 80 ? 'text-emerald-600' : score >= 55 ? 'text-amber-600' : 'text-red-600'

const scoreBg = (score) =>
    score >= 80 ? 'from-emerald-500 to-green-400' : score >= 55 ? 'from-amber-500 to-yellow-400' : 'from-red-600 to-orange-500'

const statusPill = (status) => ({
    ok: { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'ALL SYSTEMS OPERATIONAL' },
    warning: { cls: 'bg-amber-100 text-amber-800 border-amber-200', label: 'PERFORMANCE DEGRADED' },
    critical: { cls: 'bg-red-100 text-red-700 border-red-200', label: 'CRITICAL — ATTENTION NEEDED' },
}[status] || { cls: 'bg-gray-100 text-gray-700 border-gray-200', label: 'UNKNOWN' })

const barColor = (pct) => (pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500')

// ---- SVG capacity gauge ------------------------------------------------------
function CapacityGauge({ pct, label, sub }) {
    const R = 52, C = 2 * Math.PI * R
    const clamped = Math.max(0, Math.min(100, pct || 0))
    const stroke = clamped > 85 ? '#ef4444' : clamped > 60 ? '#f59e0b' : '#10b981'
    return (
        <div className="flex flex-col items-center">
            <svg width="132" height="132" viewBox="0 0 132 132" className="-rotate-90">
                <circle cx="66" cy="66" r={R} fill="none" stroke="#e5e7eb" strokeWidth="11" />
                <circle
                    cx="66" cy="66" r={R} fill="none" stroke={stroke} strokeWidth="11"
                    strokeLinecap="round" strokeDasharray={C}
                    strokeDashoffset={C - (C * clamped) / 100}
                    style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
                />
            </svg>
            <div className="-mt-[88px] mb-[46px] text-center">
                <div className="text-2xl font-black text-gray-900">{Math.round(clamped)}%</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">of capacity</div>
            </div>
            <div className="text-sm font-bold text-gray-800">{label}</div>
            {sub && <div className="text-xs text-gray-500">{sub}</div>}
        </div>
    )
}

// ---- section wrapper ---------------------------------------------------------
function Card({ title, icon: Icon, children, right }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                    {Icon && <Icon className="h-4.5 w-4.5 text-gray-500" />}
                    {title}
                </h3>
                {right}
            </div>
            <div className="p-5">{children}</div>
        </div>
    )
}

// ---- main page ----------------------------------------------------------------
const AdminLoadMonitor = () => {
    const [snap, setSnap] = useState(null)
    const [error, setError] = useState(null)
    const [paused, setPaused] = useState(false)
    const [useSse, setUseSse] = useState(true)
    const [lastUpdate, setLastUpdate] = useState(null)
    const [flash, setFlash] = useState(false)
    const [showCapacityInfo, setShowCapacityInfo] = useState(false)
    const esRef = useRef(null)
    const pollRef = useRef(null)

    const applySnapshot = useCallback((data) => {
        setSnap(data)
        setLastUpdate(Date.now())
        setFlash(true)
        setTimeout(() => setFlash(false), 400)
    }, [])

    // ---- one-shot fetch (initial load + polling fallback) --------------------
    const fetchSnapshot = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/system/load`, {
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('adminToken') || localStorage.getItem('admin_token') || ''}`,
                },
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const body = await res.json()
            if (body?.success && body?.data) {
                applySnapshot(body.data)
                setError(null)
            } else {
                throw new Error(body?.message || 'Bad response')
            }
        } catch (e) {
            setError(e.message || 'Failed to load metrics')
            setUseSse(false) // SSE likely broken too; fall back to polling
        }
    }, [applySnapshot])

    // ---- SSE live stream ------------------------------------------------------
    useEffect(() => {
        if (!useSse || paused) return
        let cancelled = false
        let reconnectTimer = null

        const connect = () => {
            if (cancelled) return
            const token = localStorage.getItem('adminToken') || localStorage.getItem('admin_token') || ''
            const es = new EventSource(`${API_BASE_URL}/admin/system/load/stream?token=${encodeURIComponent(token)}`, { withCredentials: true })
            esRef.current = es
            es.addEventListener('metrics', (ev) => {
                try {
                    const payload = JSON.parse(ev.data)
                    if (payload?.metrics) {
                        applySnapshot(payload.metrics)
                        setError(null)
                        // surface brand-new critical alerts like a live ticker
                        const crit = payload.new_critical_alerts || []
                        crit.forEach((a) => console.warn('[LoadMonitor]', a.severity, '-', a.title, ':', a.detail))
                    }
                } catch { /* ignore malformed frame */ }
            })
            es.onerror = () => {
                es.close()
                // one polling attempt to distinguish auth/network issues, then retry SSE
                fetchSnapshot()
                reconnectTimer = setTimeout(connect, 8000)
            }
        }
        connect()
        return () => {
            cancelled = true
            clearTimeout(reconnectTimer)
            if (esRef.current) esRef.current.close()
        }
    }, [useSse, paused, applySnapshot, fetchSnapshot])

    // ---- polling fallback -----------------------------------------------------
    useEffect(() => {
        if (paused || useSse) return
        fetchSnapshot()
        pollRef.current = setInterval(fetchSnapshot, REFRESH_MS)
        return () => clearInterval(pollRef.current)
    }, [paused, useSse, fetchSnapshot])

    // initial load (when SSE is the chosen path, the stream delivers data anyway)
    useEffect(() => { if (useSse && !paused) fetchSnapshot() /* eslint-disable-line */ }, [])

    const live = !paused && !error && !!snap

    // ---- loading / error screens ----------------------------------------------
    if (error && !snap) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
                <div className="flex items-center gap-3">
                    <AlertTriangle className="h-6 w-6" />
                    <h2 className="text-lg font-semibold">Load Monitor unreachable</h2>
                </div>
                <p className="mt-2">{error}</p>
                <button onClick={fetchSnapshot} className="mt-4 flex items-center gap-2 rounded-xl bg-red-600 px-6 py-2.5 font-bold text-white shadow-lg hover:bg-red-700">
                    <RefreshCw className="h-4 w-4" /> Retry
                </button>
            </div>
        )
    }
    if (!snap) {
        return (
            <div className="flex h-full items-center justify-center p-8">
                <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    const cap = snap.capacity || {}
    const conc = snap.concurrency || {}
    const req = snap.requests || {}
    const sys = snap.system || {}
    const db = snap.db || {}
    const aud = snap.audience || {}
    const win = req.window15 || {}
    const loadPct = cap.capacity_concurrent_users
        ? Math.min(999, (aud.active_5m / cap.capacity_concurrent_users) * 100)
        : 0
    const pill = statusPill(snap.status)

    return (
        <div className="space-y-6">
            {/* ============ header ============ */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                        <Gauge className="h-6 w-6 text-blue-600" /> System Load Monitor
                    </h1>
                    <p className="text-sm text-gray-500">
                        Live traffic, capacity aur health — har {REFRESH_MS / 1000}s auto-update
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${live ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                        {live ? <Wifi className="h-3.5 w-3.5 animate-pulse" /> : <WifiOff className="h-3.5 w-3.5" />}
                        {paused ? 'PAUSED' : useSse ? 'LIVE' : 'POLLING'}
                    </span>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                        worker #{snap.worker_pid} · {snap.workers_configured}w × {snap.threads_per_worker}t
                    </span>
                    <button onClick={() => setPaused(p => !p)}
                        className={`rounded-full border px-3 py-1 text-xs font-bold transition ${paused ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                        {paused ? 'Resume' : 'Pause'}
                    </button>
                    <button onClick={() => { setUseSse(s => !s) }}
                        title="Switch between live stream and polling"
                        className={`rounded-full border px-3 py-1 text-xs font-bold transition ${useSse ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                        {useSse ? 'SSE' : '5s poll'}
                    </button>
                    <button onClick={fetchSnapshot}
                        className={`rounded-full p-1.5 text-gray-500 hover:bg-gray-100 ${flash ? 'animate-spin text-blue-600' : ''}`}>
                        <RefreshCw className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* ============ status banner + score ============ */}
            <div className="grid gap-6 lg:grid-cols-4">
                <div className={`rounded-xl border p-5 lg:col-span-3 ${pill.cls} flex flex-col justify-between transition-shadow ${flash ? 'shadow-md' : ''}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-black tracking-wider">
                            <Radio className="h-4 w-4" /> {pill.label}
                        </div>
                        {lastUpdate && <span className="text-xs opacity-70">updated {timeAgo(lastUpdate)}</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
                        <div>
                            <div className="text-3xl font-black">{snap.score}<span className="text-base font-bold opacity-60">/100</span></div>
                            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Health Score</div>
                        </div>
                        <div className="h-10 w-px bg-current opacity-20" />
                        <div>
                            <div className="text-3xl font-black">{aud.active_5m ?? '—'}</div>
                            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Users online (5 min)</div>
                        </div>
                        <div className="h-10 w-px bg-current opacity-20" />
                        <div>
                            <div className="text-3xl font-black">{req.rps_now ?? '—'}<span className="text-base font-bold opacity-60"> req/s</span></div>
                            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Traffic now</div>
                        </div>
                        <div className="h-10 w-px bg-current opacity-20" />
                        <div>
                            <div className="text-3xl font-black">{win.avg_ms ?? '—'}<span className="text-base font-bold opacity-60"> ms</span></div>
                            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Avg response (15m)</div>
                        </div>
                    </div>
                </div>

                <CapacityGauge pct={loadPct} label={`${aud.active_5m ?? 0} online`} sub={`of ~${cap.capacity_concurrent_users ?? '—'} max`} />
            </div>

            {/* ============ live critical alerts ============ */}
            {(snap.alerts || []).length > 0 && (
                <div className="space-y-2">
                    {snap.alerts.map((a) => (
                        <div key={a.id} className={`flex items-start gap-3 rounded-xl border p-4 shadow-sm ${a.severity === 'critical' ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                            {a.severity === 'critical'
                                ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                                : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${a.severity === 'critical' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}>
                                        {a.severity === 'critical' ? 'CRITICAL' : 'WARNING'}
                                    </span>
                                    <span className="font-bold text-gray-900">{a.title}</span>
                                </div>
                                <p className="mt-0.5 text-sm text-gray-700">{a.detail}</p>
                            </div>
                            <span className="text-xs text-gray-400">{timeAgo(a.ts)}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* ============ traffic chart + status split ============ */}
            <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                    <Card title="Live Traffic — last 30 minutes" icon={TrendingUp}
                        right={<span className="text-xs text-gray-400">requests/min · avg ms</span>}>
                        <ResponsiveContainer width="100%" height={240}>
                            <AreaChart data={req.timeline || []} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
                                <defs>
                                    <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.03} />
                                    </linearGradient>
                                    <linearGradient id="gLat" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.03} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="t" tickFormatter={fmtMinute} tick={{ fontSize: 11 }} minTickGap={28} />
                                <YAxis yAxisId="l" tick={{ fontSize: 11 }} allowDecimals={false} />
                                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={44} />
                                <Tooltip
                                    labelFormatter={fmtMinute}
                                    contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                                    formatter={(v, name) => [name === 'avg_ms' ? `${v} ms` : v, name === 'total' ? 'requests' : name === 'errors' ? 'errors' : 'avg ms']}
                                />
                                <Area yAxisId="l" type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} fill="url(#gTotal)" name="total" />
                                <Area yAxisId="l" type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={1.5} fill="transparent" name="errors" />
                                <Area yAxisId="r" type="monotone" dataKey="avg_ms" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#gLat)" name="avg_ms" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </Card>
                </div>

                <Card title="Response Status Split (15 min)" icon={Activity}>
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={[{
                            name: 'requests',
                            '2xx': win.ok || 0,
                            '4xx': win.client_err || 0,
                            '5xx': win.server_err || 0,
                        }]} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="name" hide />
                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="2xx" stackId="s" fill="#10b981" radius={[0, 0, 0, 0]} />
                            <Bar dataKey="4xx" stackId="s" fill="#f59e0b" />
                            <Bar dataKey="5xx" stackId="s" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-lg bg-emerald-50 p-2"><div className="font-black text-emerald-700">{win.ok ?? 0}</div><div className="text-emerald-600">success</div></div>
                        <div className="rounded-lg bg-amber-50 p-2"><div className="font-black text-amber-700">{win.client_err ?? 0}</div><div className="text-amber-600">client err</div></div>
                        <div className="rounded-lg bg-red-50 p-2"><div className="font-black text-red-700">{win.server_err ?? 0}</div><div className="text-red-600">server err</div></div>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 p-2.5 text-xs">
                        <span className="text-gray-500">p95 latency</span>
                        <span className="font-bold text-gray-900">{win.p95_ms ?? 0} ms</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between rounded-lg bg-gray-50 p-2.5 text-xs">
                        <span className="text-gray-500">slow (&gt;1s) requests</span>
                        <span className="font-bold text-gray-900">{win.slow_ratio_pct ?? 0}%</span>
                    </div>
                </Card>
            </div>

            {/* ============ capacity card ============ */}
            <Card title="Capacity & Load Model" icon={Gauge}
                right={
                    <button onClick={() => setShowCapacityInfo(s => !s)} className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800">
                        assumptions {showCapacityInfo ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                }>
                <div className="grid gap-6 md:grid-cols-3">
                    <div className="flex justify-center">
                        <CapacityGauge pct={loadPct} label="Live load" sub={`${aud.active_5m ?? 0} / ~${cap.capacity_concurrent_users ?? '—'} users`} />
                    </div>
                    <div className="space-y-3 md:col-span-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl bg-blue-50 p-3.5">
                                <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">Concurrent capacity</div>
                                <div className="text-2xl font-black text-gray-900">~{cap.capacity_concurrent_users ?? '—'}</div>
                                <div className="text-xs text-gray-500">users ek waqt pe</div>
                            </div>
                            <div className="rounded-xl bg-violet-50 p-3.5">
                                <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">Daily capacity (DAU)</div>
                                <div className="text-2xl font-black text-gray-900">~{cap.capacity_dau?.toLocaleString?.() ?? cap.capacity_dau ?? '—'}</div>
                                <div className="text-xs text-gray-500">customers per day</div>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 p-3.5">
                            <div className="mb-2 flex items-center justify-between text-xs">
                                <span className="font-semibold text-gray-600">Request slots busy</span>
                                <span className="font-bold text-gray-900">{conc.in_flight ?? 0} / {conc.slots ?? '—'} (peak {conc.peak_in_flight ?? 0})</span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                                <div className={`h-full rounded-full transition-all duration-500 ${barColor(conc.utilization_pct || 0)}`} style={{ width: `${Math.min(100, conc.utilization_pct || 0)}%` }} />
                            </div>
                            <div className="mt-1 text-right text-[10px] text-gray-400">server utilization {conc.utilization_pct ?? 0}%</div>
                        </div>
                        {showCapacityInfo && (
                            <ul className="list-inside list-disc rounded-xl bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
                                {(cap.assumptions || []).map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                        )}
                    </div>
                </div>
            </Card>

            {/* ============ infra + db + audience ============ */}
            <div className="grid gap-6 lg:grid-cols-3">
                <Card title="Server Resources" icon={Server}>
                    <div className="space-y-3.5">
                        <div>
                            <div className="mb-1 flex justify-between text-xs"><span className="flex items-center gap-1.5 text-gray-600"><Cpu className="h-3.5 w-3.5" /> CPU ({sys.cpu_cores} cores)</span><span className="font-bold">{sys.cpu_percent}%</span></div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full transition-all ${barColor(sys.cpu_percent)}`} style={{ width: `${sys.cpu_percent}%` }} /></div>
                        </div>
                        <div>
                            <div className="mb-1 flex justify-between text-xs"><span className="flex items-center gap-1.5 text-gray-600"><HardDrive className="h-3.5 w-3.5" /> RAM</span><span className="font-bold">{sys.mem_percent}% <span className="font-normal text-gray-400">({sys.mem_used_mb}/{sys.mem_total_mb} MB)</span></span></div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full transition-all ${barColor(sys.mem_percent)}`} style={{ width: `${sys.mem_percent}%` }} /></div>
                        </div>
                        <div>
                            <div className="mb-1 flex justify-between text-xs"><span className="flex items-center gap-1.5 text-gray-600"><HardDrive className="h-3.5 w-3.5" /> Disk</span><span className="font-bold">{sys.disk_percent}% <span className="font-normal text-gray-400">({sys.disk_used_gb}/{sys.disk_total_gb} GB)</span></span></div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full transition-all ${barColor(sys.disk_percent)}`} style={{ width: `${sys.disk_percent}%` }} /></div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs">
                            <div><div className="font-black text-gray-900">{sys.proc_rss_mb} MB</div><div className="text-gray-400">worker RSS</div></div>
                            <div><div className="font-black text-gray-900">{sys.proc_threads}</div><div className="text-gray-400">threads</div></div>
                            <div><div className="font-black text-gray-900">{fmtUptime(snap.uptime_s)}</div><div className="text-gray-400">uptime</div></div>
                        </div>
                    </div>
                </Card>

                <Card title="Database" icon={Database}
                    right={<span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${db.latency_ms != null ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{db.latency_ms != null ? 'connected' : 'down'}</span>}>
                    <div className="space-y-2.5 text-sm">
                        <div className="flex justify-between"><span className="text-gray-500">Engine</span><span className="font-bold text-gray-900 uppercase">{db.type || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Round-trip</span><span className={`font-bold ${db.latency_ms > 250 ? 'text-amber-600' : 'text-emerald-600'}`}>{db.latency_ms != null ? `${db.latency_ms} ms` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Registered users</span><span className="font-bold text-gray-900">{db.users_total?.toLocaleString?.() ?? '—'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Orders today</span><span className="font-bold text-gray-900">{db.orders_today ?? '—'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Open orders</span><span className="font-bold text-gray-900">{db.orders_open ?? '—'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Store sessions (24h)</span><span className="font-bold text-gray-900">{db.sessions_24h?.toLocaleString?.() ?? '—'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Page views (24h)</span><span className="font-bold text-gray-900">{db.page_views_24h?.toLocaleString?.() ?? '—'}</span></div>
                    </div>
                </Card>

                <Card title="Live Audience" icon={Users}
                    right={<span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><Zap className="h-3.5 w-3.5" /> real-time</span>}>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-emerald-50 p-3.5 text-center">
                            <div className="text-3xl font-black text-emerald-700">{aud.active_5m ?? 0}</div>
                            <div className="text-xs font-semibold text-emerald-600">online now (5m)</div>
                        </div>
                        <div className="rounded-xl bg-blue-50 p-3.5 text-center">
                            <div className="text-3xl font-black text-blue-700">{aud.active_30m ?? 0}</div>
                            <div className="text-xs font-semibold text-blue-600">active (30m)</div>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-3.5 text-center">
                            <div className="text-xl font-black text-gray-900">{aud.logged_in_5m ?? 0}</div>
                            <div className="text-xs text-gray-500">logged-in</div>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-3.5 text-center">
                            <div className="text-xl font-black text-gray-900">{aud.guests_5m ?? 0}</div>
                            <div className="text-xs text-gray-500">guests</div>
                        </div>
                    </div>
                    <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-700">
                        Sessions = distinct JWT users / store session IDs is worker ne 30 min mein dekhe (per-worker approx).
                    </div>
                </Card>
            </div>

            {/* ============ top endpoints ============ */}
            <Card title="Top Loaded Endpoints (last 15 min)" icon={Timer}>
                {(req.top_endpoints || []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-gray-400">Abhi koi traffic record nahi hua — page ko thoda browse karke dekhein.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wider text-gray-400">
                                    <th className="pb-2 pr-4">Endpoint</th>
                                    <th className="pb-2 pr-4 text-right">Requests</th>
                                    <th className="pb-2 pr-4 text-right">Avg ms</th>
                                    <th className="pb-2 text-right">Errors</th>
                                    <th className="w-1/3 pb-2 pl-4">Load share</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {(req.top_endpoints || []).map((e) => {
                                    const maxCount = (req.top_endpoints[0] || {}).count || 1
                                    return (
                                        <tr key={e.endpoint} className="hover:bg-gray-50">
                                            <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-gray-800">{e.endpoint}</td>
                                            <td className="py-2.5 pr-4 text-right font-bold">{e.count}</td>
                                            <td className={`py-2.5 pr-4 text-right font-bold ${e.avg_ms > 800 ? 'text-red-600' : e.avg_ms > 400 ? 'text-amber-600' : 'text-gray-700'}`}>{e.avg_ms}</td>
                                            <td className={`py-2.5 text-right font-bold ${e.err_pct > 5 ? 'text-red-600' : 'text-gray-500'}`}>{e.err_pct}%</td>
                                            <td className="py-2.5 pl-4">
                                                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                                                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${(e.count / maxCount) * 100}%` }} />
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* ============ recommendations ============ */}
            <Card title="Scaling Recommendations" icon={Lightbulb}>
                <div className="space-y-3">
                    {(snap.recommendations || []).map((r, i) => (
                        <div key={i} className={`flex items-start gap-3 rounded-xl border p-4 ${r.priority === 'high' ? 'border-red-200 bg-red-50' : r.priority === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-blue-100 bg-blue-50/60'}`}>
                            <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${r.priority === 'high' ? 'bg-red-200 text-red-800' : r.priority === 'medium' ? 'bg-amber-200 text-amber-800' : 'bg-blue-200 text-blue-800'}`}>
                                {r.priority}
                            </span>
                            <div>
                                <div className="font-bold text-gray-900">{r.title}</div>
                                <p className="mt-0.5 text-sm text-gray-700">{r.detail}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            {/* footer note */}
            <div className="flex items-center justify-center gap-2 pb-2 text-[11px] text-gray-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Metrics per gunicorn worker se aate hain ({snap.workers_configured} workers configured) — numbers approximate hain, monitoring-only system hai.
            </div>
        </div>
    )
}

export default AdminLoadMonitor
