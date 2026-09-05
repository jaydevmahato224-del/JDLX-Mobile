import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  UserPlus, Users, ShoppingBag, Mail, Copy, Check, ExternalLink,
  RefreshCw, ShieldCheck, ReceiptText, Loader2, KeyRound, Store,
  Power, Trash2, Send, Clock
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'

export default function BillingAgents() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [busyAction, setBusyAction] = useState(null) // `${action}:${staff_id}`
  const [copiedLink, setCopiedLink] = useState(null)

  // Registration form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [lastCreated, setLastCreated] = useState(null)

  const fetchAgents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/warehouse/staff')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load billing agents')
      }
      const data = await res.json()
      setAgents(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Fetch agents error:', err)
      toast.error(err.message || 'Failed to load billing agents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const ensureBillingRole = async () => {
    // Reuse the existing roles API — find (or create) a Billing Agent role with
    // the "billing" permission so the agent can access the POS endpoints.
    const rolesRes = await apiFetch('/warehouse/roles')
    if (!rolesRes.ok) throw new Error('Could not load roles')
    const roles = await rolesRes.json()

    const billingRole = Array.isArray(roles)
      ? roles.find((r) => (r.role_name || '').toLowerCase().includes('billing'))
      : null

    if (billingRole) return billingRole.role_id

    const createRes = await apiFetch('/warehouse/roles', {
      method: 'POST',
      body: JSON.stringify({
        role_name: 'Billing Agent',
        permissions: ['billing']
      })
    })
    if (!createRes.ok) {
      const data = await createRes.json().catch(() => ({}))
      throw new Error(data.error || 'Could not create billing role')
    }
    const created = await createRes.json()
    return created.role_id
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName || !trimmedEmail) {
      toast.error('Please enter agent name and email')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error('Please enter a valid email address')
      return
    }

    setSubmitting(true)
    try {
      const role_id = await ensureBillingRole()

      const res = await apiFetch('/warehouse/staff', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          login_email: trimmedEmail,
          role_id
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to register billing agent')
      }

      setLastCreated({
        name: trimmedName,
        email: trimmedEmail,
        setup_link: data.setup_link,
        message: data.message
      })
      toast.success(`Billing agent "${trimmedName}" registered! Invite sent to ${trimmedEmail}`)
      setName('')
      setEmail('')
      await fetchAgents()
    } catch (err) {
      console.error('Register agent error:', err)
      toast.error(err.message || 'Failed to register billing agent')
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleStatus = async (agent) => {
    const nextStatus = agent.status === 'active' ? 'inactive' : 'active'
    if (nextStatus === 'inactive') {
      const ok = window.confirm(
        `Deactivate ${agent.name}? They will immediately lose access to the Counter Billing (POS) until reactivated.`
      )
      if (!ok) return
    }

    setBusyAction(`toggle:${agent.staff_id}`)
    try {
      const res = await apiFetch(`/warehouse/staff/${agent.staff_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Could not update agent status')
      }
      toast.success(data.message || `Agent ${nextStatus === 'active' ? 'reactivated' : 'deactivated'}`)
      await fetchAgents()
    } catch (err) {
      console.error('Toggle agent error:', err)
      toast.error(err.message || 'Could not update agent status')
    } finally {
      setBusyAction(null)
    }
  }

  const handleDelete = async (agent) => {
    const ok = window.confirm(
      `Permanently delete ${agent.name} (${agent.login_email})? This cannot be undone and their POS access will be removed immediately.`
    )
    if (!ok) return

    setBusyAction(`delete:${agent.staff_id}`)
    try {
      const res = await apiFetch(`/warehouse/staff/${agent.staff_id}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Could not delete agent')
      }
      toast.success(data.message || 'Agent deleted')
      await fetchAgents()
    } catch (err) {
      console.error('Delete agent error:', err)
      toast.error(err.message || 'Could not delete agent')
    } finally {
      setBusyAction(null)
    }
  }

  const handleResendInvite = async (agent) => {
    setBusyAction(`resend:${agent.staff_id}`)
    try {
      const res = await apiFetch(`/warehouse/staff/${agent.staff_id}/resend-invite`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Could not resend invite')
      }
      setLastCreated({
        name: agent.name,
        email: agent.login_email,
        setup_link: data.setup_link,
        message: data.message
      })
      toast.success(data.message || 'Fresh invite sent!')
      await fetchAgents()
    } catch (err) {
      console.error('Resend invite error:', err)
      toast.error(err.message || 'Could not resend invite')
    } finally {
      setBusyAction(null)
    }
  }

  const copySetupLink = (link) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(link)
      toast.success('Invite link copied to clipboard!')
      setTimeout(() => setCopiedLink(null), 2000)
    }).catch(() => {
      toast.error('Could not copy link — select it manually')
    })
  }

  const stats = {
    total: agents.length,
    active: agents.filter((a) => a.status === 'active').length,
    pendingSetup: agents.filter((a) => a.setup_pending).length
  }

  const isBusy = (action, staffId) => busyAction === `${action}:${staffId}`

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 lg:p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-2xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
              <UserPlus className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Billing Agents</h1>
              <p className="text-xs text-slate-400">
                Register counter-staff to run offline sales at your store. Offline bills deduct stock from your warehouse inventory.
              </p>
            </div>
          </div>
          <Link
            to="/warehouse/billing"
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold px-4 py-2.5 rounded-xl shadow-lg transition text-sm"
          >
            <ShoppingBag className="w-4 h-4" />
            Open Counter Billing (POS)
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total Agents</p>
                <p className="text-2xl font-black text-white">{stats.total}</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Active Agents</p>
                <p className="text-2xl font-black text-white">{stats.active}</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Awaiting Setup</p>
                <p className="text-2xl font-black text-white">{stats.pendingSetup}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          {/* Registration form */}
          <div className="lg:col-span-5">
            <form
              onSubmit={handleRegister}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5"
            >
              <div className="flex items-center gap-2 border-b border-slate-800 pb-4">
                <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
                  <ReceiptText className="w-4 h-4" />
                </div>
                <h2 className="text-base font-bold text-white">Register Billing Agent</h2>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Agent Name</label>
                <input
                  type="text"
                  placeholder="e.g. Ravi Kumar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Agent Email</label>
                <input
                  type="email"
                  placeholder="agent@store.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" />
                  <span>
                    An invite email with a setup link is sent automatically to the agent.
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <Store className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Agent gets Billing Agent role with <b className="text-emerald-400">billing</b> permission — POS only, no inventory access.
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Registering & Sending Invite...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Register & Send Invite
                  </>
                )}
              </button>
            </form>

            {/* Last created / resent invite */}
            {lastCreated && (
              <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center gap-2 text-emerald-400 mb-2">
                  <ShieldCheck className="w-4 h-4" />
                  <p className="text-sm font-bold">Invite ready for {lastCreated.name}</p>
                </div>
                <p className="text-xs text-slate-300 mb-1">
                  <b>{lastCreated.name}</b> ({lastCreated.email})
                </p>
                <p className="text-[11px] text-slate-400 mb-3">{lastCreated.message}. You can also share this setup link:</p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={lastCreated.setup_link || ''}
                    className="flex-1 bg-slate-950 border border-emerald-500/30 rounded-lg px-3 py-2 text-[11px] text-emerald-300 font-mono focus:outline-none truncate"
                  />
                  <button
                    type="button"
                    onClick={() => copySetupLink(lastCreated.setup_link)}
                    className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition flex items-center gap-1.5 text-xs font-semibold"
                  >
                    {copiedLink === lastCreated.setup_link ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copiedLink === lastCreated.setup_link ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Agents list */}
          <div className="lg:col-span-7">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-base font-bold text-white">Registered Agents ({agents.length})</h2>
                </div>
                <button
                  onClick={fetchAgents}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
                  title="Refresh agents"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {loading ? (
                <div className="min-h-[240px] flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                </div>
              ) : agents.length === 0 ? (
                <div className="min-h-[240px] flex flex-col items-center justify-center text-slate-500">
                  <Users className="w-12 h-12 mb-2 opacity-40" />
                  <p>No billing agents registered yet.</p>
                  <p className="text-xs">Use the form to register your first counter-staff.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {agents.map((agent) => (
                    <div
                      key={agent.staff_id}
                      className={`bg-slate-950 border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                        agent.status === 'active' ? 'border-slate-800' : 'border-slate-800/60 opacity-70'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-white truncate">{agent.name}</p>
                          {agent.status === 'active' ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              Active
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                              Inactive
                            </span>
                          )}
                          {agent.setup_pending && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              Awaiting password setup
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5">{agent.login_email || agent.username}</p>
                        <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5">
                          <ShieldCheck className="w-3 h-3 text-indigo-400" />
                          Role: {agent.role_name || 'Billing Agent'}
                          <span className="text-slate-600">·</span>
                          <span>Staff ID: #{agent.staff_id}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {new Date(agent.created_at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>

                        <button
                          onClick={() => handleResendInvite(agent)}
                          disabled={isBusy('resend', agent.staff_id)}
                          className="p-2 bg-slate-800 hover:bg-amber-600 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition disabled:opacity-50"
                          title="Resend setup invite"
                        >
                          {isBusy('resend', agent.staff_id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => handleToggleStatus(agent)}
                          disabled={isBusy('toggle', agent.staff_id)}
                          className={`p-2 rounded-lg border transition disabled:opacity-50 ${
                            agent.status === 'active'
                              ? 'bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white border-slate-700'
                              : 'bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border-emerald-500/40'
                          }`}
                          title={agent.status === 'active' ? 'Deactivate agent' : 'Reactivate agent'}
                        >
                          {isBusy('toggle', agent.staff_id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Power className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => handleDelete(agent)}
                          disabled={isBusy('delete', agent.staff_id)}
                          className="p-2 bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition disabled:opacity-50"
                          title="Delete agent"
                        >
                          {isBusy('delete', agent.staff_id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>

                        <Link
                          to="/warehouse/billing"
                          className="p-2 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition"
                          title="Open POS"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            How Offline Billing Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs text-slate-400">
            {[
              {
                step: '1',
                title: 'Register agent',
                text: 'Add counter-staff with their email — an invite link is sent instantly.'
              },
              {
                step: '2',
                title: 'Agent sets password',
                text: 'Agent opens the invite link, creates a password and logs into the Billing POS.'
              },
              {
                step: '3',
                title: 'Offline sale at store',
                text: 'Agent picks products from your warehouse inventory and completes the bill.'
              },
              {
                step: '4',
                title: 'Stock auto-deducted',
                text: 'Every offline sale deducts the exact quantity from warehouse_inventory & products.'
              }
            ].map(({ step, title, text }) => (
              <div key={step} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-black text-xs flex items-center justify-center mb-2">
                  {step}
                </div>
                <p className="text-slate-200 font-bold mb-1">{title}</p>
                <p className="leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
