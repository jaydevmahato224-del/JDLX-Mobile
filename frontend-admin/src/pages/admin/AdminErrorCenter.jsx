import { useCallback, useEffect, useRef, useState } from 'react'
import {
    AlertTriangle, ArrowUpRight, Bug, CheckCircle2, ChevronDown, CircleDot,
    EyeOff, Gauge, Loader2, RefreshCcw, Search, ShieldAlert, Users, Wrench, XCircle,
} from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'
import toast from 'react-hot-toast'

/**
 * Admin Error Center — client error telemetry for the storefront.
 *
 * Shows every AUTOMATICALLY captured frontend problem (crashes, unhandled
 * rejections, API failure batches) grouped by fingerprint, with a status
 * workflow (new → acknowledged → fixed/ignored). Also surfaces the legacy
 * manual user reports (issue_reports) which previously had no admin viewer.
 *
 * Read/write surface:
 *   GET  /api/admin/client-errors/summary   — top-bar KPIs (polled)
 *   GET  /api/admin/client-errors/groups    — filterable group list (polled)
 *   GET  /api/admin/client-errors/groups/:id/events — drilldown on expand
 *   POST /api/admin/client-errors/groups/:id/status — triage workflow
 *   GET  /api/admin/issue-reports           — read-only legacy reports
 */

const SEVERITY_STYLES = {
    critical: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-700 border-red-200', label: 'CRITICAL' },
    high: { dot: 'bg-orange-500', chip: 'bg-orange-100 text-orange-700 border-orange-200', label: 'HIGH' },
    medium: { dot: 'bg-amber-400', chip: 'bg-amber-100 text-amber-700 border-amber-200', label: 'MEDIUM' },
    low: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 border-slate-200', label: 'LOW' },
}

const KIND_LABELS = {
    crash: '💥 Crash',
    unhandledrejection: '⏳ Rejection',
    api_failure: '🔌 API Failure',
    manual: '📝 Manual',
}

const STATUS_META = {
    new: { chip: 'bg-blue-100 text-blue-700 border-blue-200', label: 'New' },
    acknowledged: { chip: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Acknowledged' },
    fixed: { chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Fixed' },
    ignored: { chip: 'bg-slate-100 text-slate-500 border-slate-200', label: 'Ignored' },
}

const POLL_INTERVAL_MS = 20000

function timeAgo(dateStr) {
    if (!dateStr) return '—'
    const then = new Date(String(dateStr).replace(' ', 'T'))
    if (Number.isNaN(then.getTime())) return dateStr
    const secs = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000))
    if (secs < 60) return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
    return `${Math.floor(secs / 86400)}d ago`
}

export default function AdminErrorCenter() {
    const [summary, setSummary] = useState(null)
    const [groups, setGroups] = useState([])
    const [reports, setReports] = useState([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [autoRefresh, setAutoRefresh] = useState(true)

    // Filters
    const [status, setStatus] = useState('new')
    const [severity, setSeverity] = useState('')
    const [kind, setKind] = useState('')
    const [search, setSearch] = useState('')
    const [tab, setTab] = useState('groups') // groups | reports

    const [expandedId, setExpandedId] = useState(null)
    const [groupEvents, setGroupEvents] = useState({})
    const [statusUpdating, setStatusUpdating] = useState(null)

    const pollRef = useRef(null)
    const filtersRef = useRef({})
    filtersRef.current = { status, severity, kind, search }

    const loadAll = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setRefreshing(true)
        try {
            const f = filtersRef.current
            const params = new URLSearchParams()
            if (f.status) params.set('status', f.status)
            if (f.severity) params.set('severity', f.severity)
            if (f.kind) params.set('kind', f.kind)
            if (f.search) params.set('q', f.search)
            params.set('limit', '100')

            const [sumRes, grpRes] = await Promise.all([
                apiFetch('/admin/client-errors/summary'),
                apiFetch(`/admin/client-errors/groups?${params.toString()}`),
            ])
            const sumJson = await sumRes.json().catch(() => ({}))
            const grpJson = await grpJsonSafe(grpRes)
            if (sumRes.ok) setSummary(sumJson?.data || null)
            if (grpRes.ok) setGroups(Array.isArray(grpJson?.data) ? grpJson.data : [])

            if (tab === 'reports') {
                const repRes = await apiFetch('/admin/issue-reports?limit=100')
                const repJson = await repRes.json().catch(() => ({}))
                if (repRes.ok) setReports(Array.isArray(repJson?.data) ? repJson.data : [])
            }
        } catch {
            if (!silent) toast.error('Error Center data load failed')
        } finally {
            setLoading(false)
            if (!silent) setRefreshing(false)
        }
    }, [tab])

    // Initial + filter-change load, plus the live poll loop. Search text is
    // debounced separately so typing doesn't fire a request per keystroke.
    useEffect(() => {
        setLoading(true)
        loadAll()
        if (autoRefresh) {
            pollRef.current = setInterval(() => loadAll({ silent: true }), POLL_INTERVAL_MS)
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [loadAll, autoRefresh, status, severity, kind])

    const firstRenderRef = useRef(true)
    useEffect(() => {
        // Skip the initial mount — the main effect above already loaded.
        if (firstRenderRef.current) { firstRenderRef.current = false; return }
        const t = setTimeout(() => loadAll({ silent: true }), 400)
        return () => clearTimeout(t)
    }, [search, loadAll])

    const toggleGroup = async (group) => {
        if (expandedId === group.id) { setExpandedId(null); return }
        setExpandedId(group.id)
        if (!groupEvents[group.id]) {
            try {
                const res = await apiFetch(`/admin/client-errors/groups/${group.id}/events`)
                const json = await res.json().catch(() => ({}))
                if (res.ok) setGroupEvents((prev) => ({ ...prev, [group.id]: json?.data || [] }))
            } catch {
                setGroupEvents((prev) => ({ ...prev, [group.id]: [] }))
            }
        }
    }

    const setStatusFor = async (group, newStatus) => {
        setStatusUpdating(group.id)
        try {
            const res = await apiFetch(`/admin/client-errors/groups/${group.id}/status`, {
                method: 'POST',
                body: JSON.stringify({ status: newStatus }),
            })
            if (!res.ok) throw new Error('Update failed')
            setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, status: newStatus } : g)))
            toast.success(`Marked as ${STATUS_META[newStatus]?.label || newStatus}`)
        } catch {
            toast.error('Status update failed')
        } finally {
            setStatusUpdating(null)
        }
    }

    const kpis = [
        { label: 'Events (24h)', value: summary?.events_24h ?? '—', icon: Gauge, tone: 'text-blue-600 bg-blue-50' },
        { label: 'New Groups', value: summary?.groups_new ?? '—', icon: AlertTriangle, tone: 'text-red-600 bg-red-50' },
        { label: 'Active Groups', value: summary?.groups_active ?? '—', icon: Bug, tone: 'text-amber-600 bg-amber-50' },
        { label: 'Affected Users (24h)', value: summary?.users_24h ?? '—', icon: Users, tone: 'text-emerald-600 bg-emerald-50' },
    ]

    return (
        <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                        <ShieldAlert className="w-6 h-6 text-rose-600" /> Error Center
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Storefront crashes &amp; failures — captured automatically from every user device.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-gray-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="accent-emerald-600 w-4 h-4"
                        />
                        Live
                        {autoRefresh && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>}
                    </label>
                    <button
                        onClick={() => loadAll()}
                        className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                        Refresh
                    </button>
                </div>
            </div>

            {/* Spike alert */}
            {summary?.spike && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl animate-in fade-in">
                    <XCircle className="w-6 h-6 text-red-600 shrink-0" />
                    <div className="text-sm">
                        <span className="font-black text-red-700">Error spike detected!</span>{' '}
                        <span className="text-red-600">
                            {summary.spike.visitors} users hit the same error in the last hour
                            {summary.top_group?.message ? <> — top: <em className="font-bold not-italic">{summary.top_group.message.slice(0, 120)}</em></> : null}
                        </span>
                    </div>
                </div>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {kpis.map((k) => (
                    <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${k.tone} mb-2`}>
                            <k.icon className="w-5 h-5" />
                        </div>
                        <div className="text-2xl font-black text-gray-800">{k.value}</div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-gray-200">
                <button
                    onClick={() => setTab('groups')}
                    className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${tab === 'groups' ? 'border-rose-600 text-rose-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    Error Groups {summary?.groups_new ? <span className="ml-1 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px]">{summary.groups_new} new</span> : null}
                </button>
                <button
                    onClick={() => setTab('reports')}
                    className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${tab === 'reports' ? 'border-rose-600 text-rose-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    Manual Reports
                </button>
            </div>

            {loading ? (
                <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 text-rose-500 animate-spin" /></div>
            ) : tab === 'groups' ? (
                <>
                    {/* Filters */}
                    <div className="flex flex-wrap gap-2 items-center">
                        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700">
                            <option value="">All Statuses</option>
                            <option value="new">New</option>
                            <option value="acknowledged">Acknowledged</option>
                            <option value="fixed">Fixed</option>
                            <option value="ignored">Ignored</option>
                        </select>
                        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700">
                            <option value="">All Severities</option>
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                        <select value={kind} onChange={(e) => setKind(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700">
                            <option value="">All Types</option>
                            <option value="crash">Crashes</option>
                            <option value="unhandledrejection">Rejections</option>
                            <option value="api_failure">API Failures</option>
                        </select>
                        <div className="relative flex-1 min-w-[180px]">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search message or page…"
                                className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm"
                            />
                        </div>
                    </div>

                    {/* Groups list */}
                    {groups.length === 0 ? (
                        <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                            <p className="font-bold text-gray-700">No error groups here</p>
                            <p className="text-sm text-gray-400 mt-1">Storefront is clean for this filter. 🎉</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {groups.map((g) => {
                                const sev = SEVERITY_STYLES[g.severity] || SEVERITY_STYLES.low
                                const expanded = expandedId === g.id
                                return (
                                    <div key={g.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                                        <button onClick={() => toggleGroup(g)} className="w-full text-left p-4 hover:bg-gray-50/60 transition-colors">
                                            <div className="flex items-start gap-3">
                                                <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${sev.dot}`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black ${sev.chip}`}>{sev.label}</span>
                                                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">{KIND_LABELS[g.kind] || g.kind}</span>
                                                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${(STATUS_META[g.status] || STATUS_META.new).chip}`}>
                                                            {(STATUS_META[g.status] || STATUS_META.new).label}
                                                        </span>
                                                        {g.possible_regression ? (
                                                            <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-black animate-pulse">↩ REGRESSION?</span>
                                                        ) : null}
                                                    </div>
                                                    <p className="text-sm font-bold text-gray-800 break-words">{g.message}</p>
                                                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                                                        {g.sample_page ? `📄 ${g.sample_page} · ` : ''}
                                                        first {timeAgo(g.first_seen_at)} · last {timeAgo(g.last_seen_at)}
                                                    </p>
                                                </div>
                                                <div className="text-right shrink-0 flex items-center gap-3">
                                                    <div className="text-xs font-bold text-gray-600 space-y-0.5">
                                                        <div>{g.total_count ?? 0} total</div>
                                                        <div className="text-rose-600">{g.count_24h ?? 0} in 24h</div>
                                                        <div className="text-gray-400">{g.users_affected ?? 0} users</div>
                                                    </div>
                                                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                                                </div>
                                            </div>
                                        </button>

                                        {expanded && (
                                            <div className="border-t border-gray-100 bg-gray-50/50 p-4 space-y-4 animate-in fade-in">
                                                {/* Status workflow */}
                                                <div className="flex flex-wrap gap-2">
                                                    {[
                                                        { status: 'acknowledged', icon: Wrench, bg: 'bg-amber-500' },
                                                        { status: 'fixed', icon: CheckCircle2, bg: 'bg-emerald-600' },
                                                        { status: 'ignored', icon: EyeOff, bg: 'bg-slate-500' },
                                                    ].map((action) => (
                                                        <button
                                                            key={action.status}
                                                            onClick={() => setStatusFor(g, action.status)}
                                                            disabled={statusUpdating === g.id || g.status === action.status}
                                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black text-white ${action.bg} disabled:opacity-40 hover:opacity-90 transition-opacity`}
                                                        >
                                                            {statusUpdating === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <action.icon className="w-3.5 h-3.5" />}
                                                            Mark {STATUS_META[action.status].label}
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Recent events */}
                                                <div className="space-y-2">
                                                    <p className="text-[11px] font-black uppercase tracking-wider text-gray-400">Recent occurrences</p>
                                                    {(groupEvents[g.id] || []).slice(0, 10).map((ev) => (
                                                        <details key={ev.id} className="bg-white border border-gray-100 rounded-xl p-3">
                                                            <summary className="cursor-pointer text-xs text-gray-600 flex flex-wrap items-center gap-2">
                                                                <CircleDot className={`w-3 h-3 ${(SEVERITY_STYLES[ev.severity] || SEVERITY_STYLES.low).dot.replace('bg-', 'text-')}`} />
                                                                <span className="font-bold">{ev.user_name ? `👤 ${ev.user_name}` : '👤 Guest'}</span>
                                                                <span className="text-gray-400">{ev.session_id ? `· ${String(ev.session_id).slice(0, 12)}` : ''}</span>
                                                                <span className="text-gray-400">{ev.page}</span>
                                                                <span className="ml-auto text-gray-400">{timeAgo(ev.created_at)}</span>
                                                            </summary>
                                                            {ev.user_email && <p className="text-xs text-gray-500 mt-2">Email: {ev.user_email} {ev.user_id ? `(id ${ev.user_id})` : ''}</p>}
                                                            {ev.app_version && <p className="text-xs text-gray-500 mt-1">App version: {ev.app_version}</p>}
                                                            {ev.stack && <pre className="mt-2 p-2 bg-slate-900 text-slate-200 text-[10px] leading-relaxed rounded-lg overflow-x-auto max-h-40">{ev.stack}</pre>}
                                                            {ev.context_json && (
                                                                <pre className="mt-1 p-2 bg-slate-100 text-slate-700 text-[10px] leading-relaxed rounded-lg overflow-x-auto max-h-32">{ev.context_json}</pre>
                                                            )}
                                                        </details>
                                                    ))}
                                                    {!groupEvents[g.id] && <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading events…</div>}
                                                    {groupEvents[g.id]?.length === 0 && <p className="text-xs text-gray-400">No stored events (may have expired by retention policy).</p>}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </>
            ) : (
                /* Manual reports tab */
                reports.length === 0 ? (
                    <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                        <Bug className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="font-bold text-gray-700">No manual reports yet</p>
                        <p className="text-sm text-gray-400 mt-1">Reports users submit from the error screen will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {reports.map((r) => (
                            <div key={r.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black">{r.error_type || 'Report'}</span>
                                    {r.page && <span className="text-xs text-gray-400">{r.page}</span>}
                                    <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">{timeAgo(r.timestamp)} <ArrowUpRight className="w-3 h-3" /></span>
                                </div>
                                {r.description && <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{r.description}</p>}
                                <p className="text-xs text-gray-400 mt-2">
                                    {r.user_name ? `👤 ${r.user_name}` : '👤 Guest'}{r.user_email ? ` · ${r.user_email}` : ''}{r.user_id ? ` · id ${r.user_id}` : ''}
                                </p>
                            </div>
                        ))}
                    </div>
                )
            )}
        </div>
    )
}

// Small helper: json() can throw on empty bodies.
async function grpJsonSafe(res) {
    try { return await res.json() } catch { return {} }
}
