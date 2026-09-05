import { useState, useEffect } from 'react'
import { Settings, Save, AlertCircle, Trash2, Truck, Smartphone, FileText, Globe, CreditCard, Zap, MapPin, Send, Clock, ShieldCheck } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'

export default function AdminSettings() {
  const user = useStore((state) => state.adminUser)
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('delivery')
  const [settings, setSettings] = useState({
    theme_primary_color: '#f59e0b',
    theme_secondary_color: '#fbbf24',
    theme_tertiary_color: '#10b981',
    pwa_install_prompt_enabled: 'true',
    pwa_banner_title: 'Install JDLX Mobile',
    pwa_banner_description: 'Get the full premium experience on your home screen.',
    scheduled_delivery_time: 'Tomorrow by 11:00 AM',
    scheduled_delivery_note: 'Reliable fulfillment from our central warehouse.',
    // (quick_delivery_* settings removed — quick delivery is retired; every
    // order uses standard scheduled fulfillment.)
    platform_fee: '7',
    free_delivery_threshold: '499',
    delivery_fee: '49',
    
    // New Delivery & Payment Settings
    cod_enabled: 'true',
    cod_enabled_shiprocket: 'false',
    prepaid_delivery_charge: '49',
    cod_delivery_charge: '99',
    cod_advance_amount: '49',
    free_delivery_enabled: 'true',
    cod_alert_text: 'Save more with prepaid orders! FREE delivery on orders above ₹499.',
    prepaid_recommendation_enabled: 'true',
    priority_dispatch_enabled: 'true',
    min_order_cod: '0',

    shiprocket_email: '',
    shiprocket_password: '',
    shiprocket_pickup_location: 'Primary',
    global_return_policy: '7 Days Return Policy',

    // Footer & Brand Identity
    footer_email: 'support@jdlxmobile.com',
    footer_phone: '+91 98765 43210',
    footer_address: 'JDLX Premium Hub, Digital Estate, New Delhi',
    footer_insta_url: '',
    footer_twitter_url: '',
    footer_fb_url: '',
    footer_brand_story: 'Redefining mobile luxury with curated accessories and premium electronics. The gold standard for modern device enthusiasts.',
    
    // Content Pages (Storefront)
    about_us_content: '',
    terms_and_conditions_content: '',
    ticker_text: 'Free delivery on orders above ₹499 • Better experience with fast delivery',

    // Under Construction Settings
    construction_mode: 'false',
    construction_mode_message: 'Our website is currently undergoing scheduled maintenance and upgrades. JDLX Mobile will be back online with exciting new premium products soon. Thank you for your patience!',

    // User Session / Auto-Logout Settings
    user_session_duration_hours: '8760',

    // OTP Security (login/signup OTP cooldown — escalating on every resend)
    otp_resend_cooldown_base: '60',   // seconds to wait before the FIRST resend
    otp_resend_cooldown_step: '60',   // extra seconds added per resend
    otp_resend_cooldown_max: '300',   // cap on the per-resend wait
    otp_resend_max: '5',              // max resends before a fresh OTP is required
    otp_expiry_seconds: '600'         // OTP validity in seconds
  })

  // Helper Toggle Component
  const Toggle = ({ enabled, onChange, label, description }) => (
    <div className="flex items-center justify-between p-6 rounded-3xl bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-md transition-all">
      <div>
        <h3 className="font-bold text-slate-800">{label}</h3>
        {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(enabled === 'true' ? 'false' : 'true')}
        className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${
          enabled === 'true' ? 'bg-primary' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            enabled === 'true' ? 'translate-x-8' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )

  const [pincodeRules, setPincodeRules] = useState([])
  const [newPincode, setNewPincode] = useState({ pincode: '', cod_allowed: 'false' })

  useEffect(() => {
    fetchSettings()
    fetchPincodeRules()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE_URL}/settings`)
      const json = await res.json()
      if (res.ok) {
        setSettings(prev => ({
          ...prev,
          ...json.data
        }))
      }
    } catch {
      alert('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const fetchPincodeRules = async () => {
    try {
      const res = await apiFetch('/admin/pincode-rules')
      const json = await res.json()
      if (res.ok) setPincodeRules(json)
    } catch (err) {
      console.error(err)
    }
  }

  const handleAddPincodeRule = async () => {
    if (!newPincode.pincode) return
    try {
      const res = await apiFetch('/admin/pincode-rules', {
        method: 'POST',
        body: JSON.stringify({ 
          pincode: newPincode.pincode, 
          cod_allowed: newPincode.cod_allowed === 'true' ? 1 : 0 
        })
      })
      if (res.ok) {
        setNewPincode({ pincode: '', cod_allowed: 'false' })
        fetchPincodeRules()
      }
    } catch {
      alert('Error adding pincode rule')
    }
  }

  const handleDeletePincodeRule = async (pincode) => {
    try {
      const res = await apiFetch(`/admin/pincode-rules/${pincode}`, {
        method: 'DELETE',
      })
      if (res.ok) fetchPincodeRules()
    } catch {
      alert('Error deleting pincode rule')
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const res = await apiFetch('/admin/settings', {
        method: 'POST',
        body: JSON.stringify(settings)
      })
      const json = await res.json()
      if (res.ok) {
        alert('Settings saved successfully')
      } else {
        alert(json.error || 'Failed to save settings')
      }
    } catch {
      alert('Error saving settings')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (window.confirm('Reset all theme settings to Amber Brand defaults?')) {
      setSettings(prev => ({
        ...prev,
        theme_primary_color: '#f59e0b',
        theme_secondary_color: '#fbbf24',
        theme_tertiary_color: '#10b981',
        pwa_install_prompt_enabled: 'true',
        pwa_banner_title: 'Install JDLX Mobile',
        pwa_banner_description: 'Get the full premium experience on your home screen.',
        otp_resend_cooldown_base: '60',
        otp_resend_cooldown_step: '60',
        otp_resend_cooldown_max: '300',
        otp_resend_max: '5',
        otp_expiry_seconds: '600'
      }))
    }
  }

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (user?.role?.toLowerCase() !== 'super_admin') {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span className="font-bold">Access Denied: Super Admin privileges required.</span>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'delivery', label: 'Delivery & Logistics', icon: Truck, description: 'COD, pincodes, Shiprocket' },
    { id: 'app', label: 'App Experience', icon: Smartphone, description: 'PWA, Ticker, Under Construction' },
    { id: 'sessions', label: 'Sessions & Login', icon: Clock, description: 'Auto-logout, session duration' },
    { id: 'otp', label: 'OTP Security', icon: ShieldCheck, description: 'Login OTP cooldown & expiry' },
    { id: 'content', label: 'Legal & Policies', icon: FileText, description: 'Terms & conditions, About us content' },
    { id: 'brand', label: 'Brand & Footer', icon: Globe, description: 'Support, social handles, story' },
  ]

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Header section */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
            <Settings className="w-8 h-8 text-primary" />
            System Settings
          </h1>
          <p className="mt-2 text-slate-500 font-medium">Manage global configuration and storefront modules.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            disabled={saving || loading}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Reset Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="btn-primary shadow-xl shadow-primary/20"
          >
            {saving ? 'Saving...' : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
          </button>
        </div>
      </div>

      {/* Categories / Tabs Grid Selector */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {tabs.map((t) => {
          const Icon = t.icon
          const isActive = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex flex-col items-start p-5 rounded-3xl border transition-all text-left group relative ${
                isActive 
                  ? 'bg-slate-900 border-slate-950 text-white shadow-xl shadow-slate-900/10' 
                  : 'bg-white border-slate-100 text-slate-700 hover:bg-slate-50 hover:shadow-md'
              }`}
            >
              <div className={`p-3 rounded-2xl mb-4 transition-transform group-hover:scale-110 ${
                isActive ? 'bg-primary text-slate-950' : 'bg-slate-100 text-slate-500'
              }`}>
                <Icon className="w-5 h-5" />
              </div>
              <span className="font-black text-sm tracking-tight">{t.label}</span>
              <span className="text-[10px] font-medium mt-1 leading-tight text-slate-400">
                {t.description}
              </span>
            </button>
          )
        })}
      </div>

      {/* Tabs Container Content */}
      <div className="grid gap-10">
        
        {/* TAB 1: DELIVERY & LOGISTICS */}
        {activeTab === 'delivery' && (
          <>
            {/* Pincode Restrictions Section */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-10">
                <h2 className="text-2xl font-black text-slate-900">Pincode Restrictions</h2>
                <p className="text-slate-500 font-medium mt-1">Restrict COD for specific high-risk delivery locations.</p>
              </div>

              <div className="grid gap-8 lg:grid-cols-2">
                <div className="space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-6 bg-red-500 rounded-full"></div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Add New Restriction</h3>
                  </div>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Pincode</label>
                      <input
                        type="text"
                        value={newPincode.pincode}
                        onChange={(e) => setNewPincode({ ...newPincode, pincode: e.target.value })}
                        placeholder="e.g., 110001"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-red-500 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">COD Status</label>
                      <select
                        value={newPincode.cod_allowed}
                        onChange={(e) => setNewPincode({ ...newPincode, cod_allowed: e.target.value })}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-red-500 transition-all"
                      >
                        <option value="false">Blocked (Prepaid Only)</option>
                        <option value="true">Allowed</option>
                      </select>
                    </div>
                    <button
                      onClick={handleAddPincodeRule}
                      className="w-full py-3 bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-200 hover:scale-[1.02] active:scale-95 transition-all"
                    >
                      Add Restriction
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-6 bg-slate-900 rounded-full"></div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Active Restrictions</h3>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2">
                    {pincodeRules.length === 0 ? (
                      <p className="text-sm text-slate-400 italic">No restrictions defined yet.</p>
                    ) : (
                      pincodeRules.map((rule) => (
                        <div key={rule.pincode} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 group hover:bg-white hover:shadow-md transition-all">
                          <div>
                            <p className="font-black text-slate-800">{rule.pincode}</p>
                            <p className={`text-[10px] font-bold uppercase ${rule.cod_allowed ? 'text-emerald-500' : 'text-red-500'}`}>
                              {rule.cod_allowed ? 'COD Allowed' : 'Prepaid Only'}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDeletePincodeRule(rule.pincode)}
                            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
            {/* Card 1: Payment & Checkout Switches */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500/10 rounded-2xl text-amber-600">
                    <CreditCard size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900">Payment & Checkout Gateway</h2>
                    <p className="text-slate-500 font-medium text-xs mt-0.5">Enable or disable Cash on Delivery globally and adjust thresholds.</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <Toggle 
                    label="Enable Cash on Delivery (COD)" 
                    description="Allow customers to choose Cash on Delivery at checkout."
                    enabled={settings.cod_enabled}
                    onChange={(val) => handleChange('cod_enabled', val)}
                  />
                  <Toggle 
                    label="Enable Free Delivery" 
                    description="Automatically waive delivery fee when threshold is met."
                    enabled={settings.free_delivery_enabled}
                    onChange={(val) => handleChange('free_delivery_enabled', val)}
                  />
                </div>

                <div className="grid gap-8 md:grid-cols-2 pt-6 border-t border-slate-100">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                       <div className="w-1.5 h-6 bg-emerald-500 rounded-full"></div>
                       <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Prepaid Configuration</h3>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Prepaid Delivery Charge (₹)</label>
                      <input
                        type="number"
                        value={settings.prepaid_delivery_charge || ''}
                        onChange={(e) => handleChange('prepaid_delivery_charge', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Free Delivery Threshold (₹)</label>
                      <input
                        type="number"
                        value={settings.free_delivery_threshold || ''}
                        onChange={(e) => handleChange('free_delivery_threshold', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                       <div className="w-1.5 h-6 bg-amber-500 rounded-full"></div>
                       <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">COD Configuration</h3>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">COD Delivery Charge (₹)</label>
                      <input
                        type="number"
                        value={settings.cod_delivery_charge || ''}
                        onChange={(e) => handleChange('cod_delivery_charge', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-amber-500 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">COD Advance Amount (₹)</label>
                      <input
                        type="number"
                        value={settings.cod_advance_amount || ''}
                        onChange={(e) => handleChange('cod_advance_amount', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-amber-500 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Min. Order for COD (₹)</label>
                      <input
                        type="number"
                        value={settings.min_order_cod || ''}
                        onChange={(e) => handleChange('min_order_cod', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-amber-500 transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Card 2: Checkout Incentives & Badges */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-600">
                    <Zap size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900">Checkout Trust Signals</h2>
                    <p className="text-slate-500 font-medium text-xs mt-0.5">Configure badges and warnings to encourage prepaid orders and build customer trust.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <Toggle 
                     label="Prepaid Recommendation Tag" 
                     description="Show a prominent 'Recommended' tag on the prepaid checkout option."
                     enabled={settings.prepaid_recommendation_enabled}
                     onChange={(val) => handleChange('prepaid_recommendation_enabled', val)}
                  />
                  <Toggle 
                     label="Priority Dispatch Badge" 
                     description="Render a lightning priority shipping status badge on prepaid payments."
                     enabled={settings.priority_dispatch_enabled}
                     onChange={(val) => handleChange('priority_dispatch_enabled', val)}
                  />
                </div>

                <div className="space-y-2 pt-4 border-t border-slate-100">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">COD Alert Banner Warning Text</label>
                  <textarea
                    value={settings.cod_alert_text || ''}
                    onChange={(e) => handleChange('cod_alert_text', e.target.value)}
                    rows={2}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 outline-none focus:bg-white focus:border-blue-500 transition-all resize-none"
                    placeholder="Message shown when COD is selected..."
                  />
                  <p className="text-[10px] text-slate-400 font-medium">This notice appears at checkout when a customer clicks on the COD option to guide them toward prepaid benefits.</p>
                </div>
              </div>
            </section>

            {/* Card 3: Local Hyperlocal Operations */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-500/10 rounded-2xl text-purple-600">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900">Local Hyperlocal Dispatch</h2>
                    <p className="text-slate-500 font-medium text-xs mt-0.5">Configure operating limits and transactional platform fees for immediate store dispatch.</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-8 md:grid-cols-2">
                {/* (Quick Delivery Radius Limit removed — quick delivery is
                    retired; every order uses standard scheduled fulfillment.) */}
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Fixed Platform Fee (₹)</label>
                  <input
                    type="number"
                    value={settings.platform_fee || ''}
                    onChange={(e) => handleChange('platform_fee', e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-purple-500 transition-all"
                  />
                </div>
              </div>
            </section>

            {/* Card 4: Shiprocket Nationwide Courier */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[#6322b2]/10 rounded-2xl text-[#6322b2]">
                    <Send size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                      Shiprocket Courier & Standard Shipping
                      <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Shiprocket_Logo.svg/1200px-Shiprocket_Logo.svg.png" className="h-3 ml-1" alt="" />
                    </h2>
                    <p className="text-slate-500 font-medium text-xs mt-0.5">Connect your Shiprocket credentials to support automated nationwide shipping and manage Courier COD status.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                   <div className="space-y-2">
                     <label className="text-xs font-black uppercase tracking-widest text-slate-400">API Email Address</label>
                     <input
                       type="email"
                       value={settings.shiprocket_email || ''}
                       onChange={(e) => handleChange('shiprocket_email', e.target.value)}
                       className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#6322b2] transition-all"
                     />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs font-black uppercase tracking-widest text-slate-400">API Password Key</label>
                     <input
                       type="password"
                       value={settings.shiprocket_password || ''}
                       onChange={(e) => handleChange('shiprocket_password', e.target.value)}
                       className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#6322b2] transition-all"
                     />
                   </div>
                   <div className="space-y-2 md:col-span-2">
                     <label className="text-xs font-black uppercase tracking-widest text-slate-400">Registered Warehouse Pickup Location</label>
                     <input
                       type="text"
                       value={settings.shiprocket_pickup_location || ''}
                       onChange={(e) => handleChange('shiprocket_pickup_location', e.target.value)}
                       placeholder="e.g., Primary, Warehouse-1"
                       className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#6322b2] transition-all"
                     />
                   </div>
                </div>

                <div className="p-6 bg-purple-500/[0.03] rounded-3xl border border-purple-500/10 space-y-4">
                  <Toggle 
                     label="Enable Cash on Delivery (COD) for Courier Shipments" 
                     description="Turn ON to allow long-distance customers to place orders using COD through Shiprocket couriers."
                     enabled={settings.cod_enabled_shiprocket}
                     onChange={(val) => handleChange('cod_enabled_shiprocket', val)}
                  />
                  <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-3">
                     <p className="text-[10.5px] font-semibold text-amber-700 leading-relaxed">
                       ⚠️ <strong>RTO Warning:</strong> Nationwide Courier COD carries higher Return to Origin (RTO) risks. Ensure you monitor shipment rejections and verify customer addresses before dispatch.
                     </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-[#6322b2]/5 border border-[#6322b2]/10 flex items-start gap-3">
                  <p className="text-[10px] font-medium text-[#6322b2] leading-relaxed">
                    Connecting JDLX to your Shiprocket API lets the system automatically sync delivery addresses, request courier pickup agents, and update storefront order tracking in real-time.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}

        {/* TAB 2: APP EXPERIENCE */}
        {activeTab === 'app' && (
          <>
            {/* App Experience Section */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-10">
                <h2 className="text-2xl font-black text-slate-900">App Experience</h2>
                <p className="text-slate-500 font-medium mt-1">Manage how users interact with the web app and PWA features.</p>
              </div>

              <div className="space-y-8">
                <div className="flex items-center justify-between p-6 rounded-3xl bg-slate-50 border border-slate-100">
                  <div>
                    <h3 className="font-bold text-slate-800">App Install Prompt</h3>
                    <p className="text-xs text-slate-500 mt-1">Show a floating notification to browser users suggesting they install the app.</p>
                    <button 
                      onClick={() => window.open('http://localhost:5173?preview_pwa=1', '_blank')}
                      className="mt-3 text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
                    >
                      Click here to preview banner in store
                    </button>
                  </div>
                  <button
                    onClick={() => handleChange('pwa_install_prompt_enabled', settings.pwa_install_prompt_enabled === 'true' ? 'false' : 'true')}
                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${
                      settings.pwa_install_prompt_enabled === 'true' ? 'bg-primary' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        settings.pwa_install_prompt_enabled === 'true' ? 'translate-x-8' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {settings.pwa_install_prompt_enabled === 'true' && (
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Prompt Title</label>
                      <input
                        type="text"
                        value={settings.pwa_banner_title}
                        onChange={(e) => handleChange('pwa_banner_title', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Prompt Description</label>
                      <input
                        type="text"
                        value={settings.pwa_banner_description}
                        onChange={(e) => handleChange('pwa_banner_description', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                      />
                    </div>
                  </div>
                )}

                <div className="pt-8 mt-8 border-t border-slate-100">
                   <div className="flex items-center gap-2 mb-4">
                      <div className="w-1.5 h-6 bg-amber-500 rounded-full"></div>
                      <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Store Ticker / Announcement</h3>
                   </div>
                   <div className="space-y-4">
                     <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-slate-400">Top Header Ticker Text</label>
                        <input
                          type="text"
                          value={settings.ticker_text || ''}
                          onChange={(e) => handleChange('ticker_text', e.target.value)}
                          placeholder="e.g. Free delivery on orders above ₹499 • Fast Delivery"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                        />
                        <p className="text-[10px] text-slate-400 font-medium">This text scrolls at the very top of the storefront. Use "•" to separate points.</p>
                     </div>
                   </div>
                </div>
              </div>
            </section>

            {/* Under Construction Alert Section */}
            <section className="ui-card-standard p-6 md:p-10 border border-amber-200/50 bg-gradient-to-br from-white to-amber-50/20 animate-in fade-in duration-300">
              <div className="mb-10">
                <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                  <span className="flex h-3 w-3 relative">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${settings.construction_mode === 'true' ? 'bg-amber-500' : 'bg-slate-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${settings.construction_mode === 'true' ? 'bg-amber-500' : 'bg-slate-400'}`}></span>
                  </span>
                  Under Construction Mode
                </h2>
                <p className="text-slate-500 font-medium mt-1">
                  Display a beautiful, full-screen announcement overlay on the storefront when you are preparing for launch.
                </p>
              </div>

              <div className="space-y-8">
                <Toggle 
                  label="Enable Under Construction Mode" 
                  description="Activate this to block visitor navigation and show a gorgeous launching announcement page."
                  enabled={settings.construction_mode}
                  onChange={(val) => handleChange('construction_mode', val)}
                />

                {settings.construction_mode === 'true' && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <div className="space-y-2">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">English Announcement Message</label>
                      <textarea
                        value={settings.construction_mode_message || ''}
                        onChange={(e) => handleChange('construction_mode_message', e.target.value)}
                        rows={4}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-amber-500 transition-all resize-none"
                        placeholder="We're launching JDLX Mobile very soon! Stay tuned..."
                      />
                      <p className="text-[10px] text-slate-400 font-medium">This message will be shown on the storefront under-construction splash overlay in English.</p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {/* TAB 3: LEGAL & POLICIES */}
        {activeTab === 'content' && (
          <>
            {/* Store Policies Section */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-10">
                <h2 className="text-2xl font-black text-slate-900">Legal & Store Policies</h2>
                <p className="text-slate-500 font-medium mt-1">Configure default terms and conditions for customers.</p>
              </div>

              <div className="space-y-8">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Global Default Return Policy</label>
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">System Wide Fallback</span>
                  </div>
                  <textarea
                    value={settings.global_return_policy || ''}
                    onChange={(e) => handleChange('global_return_policy', e.target.value)}
                    placeholder="Enter the default return policy for all products..."
                    rows={5}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all resize-none"
                  />
                  <p className="text-[11px] font-medium text-slate-400 leading-relaxed">
                    This policy will be used as a fallback if neither the product nor the category has a specific return policy defined. 
                    Use **new lines** to separate bullet points.
                  </p>
                </div>
              </div>
            </section>

            {/* Content Pages Section */}
            <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
              <div className="mb-8">
                <h2 className="text-2xl font-black text-slate-900">Storefront Content Pages</h2>
                <p className="text-slate-500 font-medium mt-1">Control the “About Us” and “Terms & Conditions” pages shown in the Store app.</p>
              </div>

              <div className="grid gap-8">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">About Us Content</label>
                    <button 
                      onClick={() => handleChange('about_us_content', `# About JDLX MOBILE
- Premium mobile commerce platform for daily essentials.
- Designed for fast discovery, reliable stock, and smooth checkout.
- Single account experience across shopping, tracking, wallet, and support.

# How It Works
- Browse products and add to cart.
- Choose your delivery address and place the order.
- Track your order in real-time and get updates in your account.

# Delivery & Service
- Delivery time depends on location, store availability, and demand.
- Order updates show in “My Orders” and tracking page.
- For address issues, update your saved addresses before ordering.

# Payments
- Secure payment flow for a smoother checkout.
- Wallet (if enabled) can be used for faster repeat orders.
- Payment status is reflected in order history.

# Returns & Refunds
- Item eligibility depends on product type and order status.
- Report issues quickly from Support with order details.
- Refunds are provided as in-app wallet balance. Product replacements or original source refunds may be processed if possible.`)}
                      className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
                    >
                      Load Default Template
                    </button>
                  </div>
                  <textarea
                    value={settings.about_us_content || ''}
                    onChange={(e) => handleChange('about_us_content', e.target.value)}
                    rows={14}
                    placeholder={`Format:\n# Section Title\n- Point 1\n- Point 2\n\n# Another Section\n- Point...`}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all"
                  />
                  <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                    Use headings with <span className="font-mono">#</span> and bullet points with <span className="font-mono">-</span>. Leaving it empty will use the default Store page content.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Terms & Conditions Content</label>
                    <button 
                      onClick={() => handleChange('terms_and_conditions_content', `# JDLX Terms of Service
- By using JDLX MOBILE, you agree to our Terms & Conditions.
- We provide scheduled delivery services for all orders.
- Accuracy of delivery location is your responsibility.

# Orders & Payments
- Prices and stock availability may change without notice.
- Platform fees and delivery charges apply as shown at checkout.
- We use secure, encrypted payment gateways for all transactions.

# Returns & Refunds
- Return eligibility depends on product category and condition.
- Refunds are provided as in-app wallet balance. Product replacements or original source refunds may be processed if possible.

# Security
- Your data is protected using industry-standard security measures.
- We do not share your personal information with third parties.`)}
                      className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
                    >
                      Load Default Template
                    </button>
                  </div>
                  <textarea
                    value={settings.terms_and_conditions_content || ''}
                    onChange={(e) => handleChange('terms_and_conditions_content', e.target.value)}
                    rows={18}
                    placeholder={`# Section Title\n- Key Point 1\n- Key Point 2\n\n# Payments\n- Secure checkout via JDLX`}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all"
                  />
                  <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                    This content appears in the **Terms Gate** and the **T&C Page**. Use <span className="font-mono">#</span> for titles and <span className="font-mono">-</span> for points.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}

        {/* TAB 4: BRAND & FOOTER */}
        {activeTab === 'brand' && (
          <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
            <div className="mb-10">
              <h2 className="text-2xl font-black text-slate-900">Footer & Social Identity</h2>
              <p className="text-slate-500 font-medium mt-1">Manage contact details, social links, and brand storytelling in the storefront footer.</p>
            </div>

            <div className="grid gap-10 lg:grid-cols-2">
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-6 bg-primary rounded-full"></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Contact Information</h3>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Support Email</label>
                    <input
                      type="email"
                      value={settings.footer_email || ''}
                      onChange={(e) => handleChange('footer_email', e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Contact Phone</label>
                    <input
                      type="text"
                      value={settings.footer_phone || ''}
                      onChange={(e) => handleChange('footer_phone', e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Physical Address</label>
                    <textarea
                      value={settings.footer_address || ''}
                      onChange={(e) => handleChange('footer_address', e.target.value)}
                      rows={2}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-6 bg-blue-500 rounded-full"></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Social Media Links</h3>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Instagram URL</label>
                    <input
                      type="text"
                      value={settings.footer_insta_url || ''}
                      onChange={(e) => handleChange('footer_insta_url', e.target.value)}
                      placeholder="https://instagram.com/jdlxmobile"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Twitter URL</label>
                    <input
                      type="text"
                      value={settings.footer_twitter_url || ''}
                      onChange={(e) => handleChange('footer_twitter_url', e.target.value)}
                      placeholder="https://twitter.com/jdlxmobile"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Facebook URL</label>
                    <input
                      type="text"
                      value={settings.footer_fb_url || ''}
                      onChange={(e) => handleChange('footer_fb_url', e.target.value)}
                      placeholder="https://facebook.com/jdlxmobile"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-10 pt-10 border-t border-slate-100 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-6 bg-slate-900 rounded-full"></div>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Brand Storytelling</h3>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Short Brand Description</label>
                <textarea
                  value={settings.footer_brand_story || ''}
                  onChange={(e) => handleChange('footer_brand_story', e.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-600 outline-none focus:bg-white focus:border-primary transition-all resize-none"
                />
                <p className="text-[10px] text-slate-400 font-medium italic">Appears below the logo in the footer. Keep it under 200 characters for best results.</p>
              </div>
            </div>
          </section>
        )}

        {/* TAB: SESSIONS & LOGIN */}
        {activeTab === 'sessions' && (
          <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
            <div className="mb-10">
              <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                <Clock className="w-7 h-7 text-primary" />
                Sessions & Login
              </h2>
              <p className="text-slate-500 font-medium mt-1">
                Control how long store customers stay logged in before they are automatically signed out.
              </p>
            </div>

            <div className="space-y-8">
              <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100">
                <h3 className="font-bold text-slate-800">User Session Duration (Auto-Logout)</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Store users stay logged in for this many hours after login. Set a high value (e.g. 8760 = 1 year)
                  to keep users logged in without any auto-logout. This only applies to regular store customers —
                  admin sessions are always limited to 8 hours for security.
                </p>

                <div className="mt-6 space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Session Duration (hours)</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      value={settings.user_session_duration_hours || ''}
                      placeholder="8760"
                      onChange={(e) => {
                        const raw = e.target.value
                        const num = parseFloat(raw)
                        if (raw === '' || (!isNaN(num) && num >= 1)) {
                          handleChange('user_session_duration_hours', raw)
                        }
                      }}
                      className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleChange('user_session_duration_hours', '24')}
                      className="px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary transition-all"
                    >1 Day</button>
                    <button
                      type="button"
                      onClick={() => handleChange('user_session_duration_hours', '168')}
                      className="px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary transition-all"
                    >7 Days</button>
                    <button
                      type="button"
                      onClick={() => handleChange('user_session_duration_hours', '720')}
                      className="px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary transition-all"
                    >30 Days</button>
                    <button
                      type="button"
                      onClick={() => handleChange('user_session_duration_hours', '8760')}
                      className="px-3 py-2 text-xs font-bold rounded-xl border border-amber-400/60 bg-amber-50 text-amber-700 hover:border-amber-500 transition-all"
                    >365 Days (No logout)</button>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600">
                  {(() => {
                    const hrs = parseFloat(settings.user_session_duration_hours)
                    if (isNaN(hrs) || hrs <= 0) return 'Enter a session duration above (min 1 hour).'
                    if (hrs >= 8760) return '✅ Users stay logged in for 1 year+ — no practical auto-logout.'
                    const days = (hrs / 24).toFixed(1)
                    return `👤 Users stay logged in for ${hrs} hours (≈ ${days} days) after login.`
                  })()}
                </div>
              </div>

              <div className="p-6 rounded-3xl bg-amber-50/60 border border-amber-200/60">
                <h3 className="font-bold text-slate-800">How it works</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-600 font-medium">
                  <li>• Duration applies to <b>new logins</b> — users already logged in keep their current session until it naturally expires.</li>
                  <li>• Admin panel & warehouse staff sessions keep their existing security limits (8h / 7 days) — unchanged.</li>
                  <li>• Users are only logged out when they press "Logout" or when the session duration is reached.</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* TAB: OTP SECURITY */}
        {activeTab === 'otp' && (
          <section className="ui-card-standard p-6 md:p-10 animate-in fade-in duration-300">
            <div className="mb-10">
              <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                <ShieldCheck className="w-7 h-7 text-primary" />
                OTP Security
              </h2>
              <p className="text-slate-500 font-medium mt-1">
                Control the login/signup OTP behavior — the resend cooldown grows on every resend so automated
                retry / brute-force attempts slow down automatically.
              </p>
            </div>

            <div className="space-y-8">
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Base cooldown */}
                <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100">
                  <h3 className="font-bold text-slate-800">Resend Cooldown (first)</h3>
                  <p className="text-xs text-slate-500 mt-1">Seconds a user must wait before their <b>first</b> OTP resend. Default 60.</p>
                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Seconds</label>
                    <input
                      type="number"
                      min="0"
                      value={settings.otp_resend_cooldown_base || ''}
                      onChange={(e) => handleChange('otp_resend_cooldown_base', e.target.value)}
                      className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                </div>

                {/* Cooldown step */}
                <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100">
                  <h3 className="font-bold text-slate-800">Cooldown Increase per Resend</h3>
                  <p className="text-xs text-slate-500 mt-1">Extra seconds added after every resend. Default 60 (60s → 120s → 180s…).</p>
                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Seconds</label>
                    <input
                      type="number"
                      min="0"
                      value={settings.otp_resend_cooldown_step || ''}
                      onChange={(e) => handleChange('otp_resend_cooldown_step', e.target.value)}
                      className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                </div>

                {/* Max cooldown cap */}
                <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100">
                  <h3 className="font-bold text-slate-800">Max Cooldown Cap</h3>
                  <p className="text-xs text-slate-500 mt-1">The longest wait a resend can ever reach. Default 300s (5 min).</p>
                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Seconds</label>
                    <input
                      type="number"
                      min="0"
                      value={settings.otp_resend_cooldown_max || ''}
                      onChange={(e) => handleChange('otp_resend_cooldown_max', e.target.value)}
                      className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                </div>

                {/* Max resends */}
                <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100">
                  <h3 className="font-bold text-slate-800">Max Resends per OTP</h3>
                  <p className="text-xs text-slate-500 mt-1">After this many resends, further resends are blocked until the OTP expires. Default 5.</p>
                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Count</label>
                    <input
                      type="number"
                      min="0"
                      value={settings.otp_resend_max || ''}
                      onChange={(e) => handleChange('otp_resend_max', e.target.value)}
                      className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* OTP validity */}
              <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100">
                <h3 className="font-bold text-slate-800">OTP Validity (Expiry)</h3>
                <p className="text-xs text-slate-500 mt-1">How long an OTP stays valid before it expires and a new one is needed.</p>
                <div className="mt-4 space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Seconds</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="number"
                      min="30"
                      value={settings.otp_expiry_seconds || ''}
                      onChange={(e) => handleChange('otp_expiry_seconds', e.target.value)}
                      className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleChange('otp_expiry_seconds', '300')}
                      className="px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary transition-all"
                    >5 min</button>
                    <button
                      type="button"
                      onClick={() => handleChange('otp_expiry_seconds', '600')}
                      className="px-3 py-2 text-xs font-bold rounded-xl border border-amber-400/60 bg-amber-50 text-amber-700 hover:border-amber-500 transition-all"
                    >10 min</button>
                    <button
                      type="button"
                      onClick={() => handleChange('otp_expiry_seconds', '900')}
                      className="px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary transition-all"
                    >15 min</button>
                  </div>
                </div>
              </div>

              {/* Escalation preview */}
              <div className="p-6 rounded-3xl bg-amber-50/60 border border-amber-200/60">
                <h3 className="font-bold text-slate-800">Resend wait sequence with current settings</h3>
                {(() => {
                  const base = parseInt(settings.otp_resend_cooldown_base) || 60
                  const step = parseInt(settings.otp_resend_cooldown_step) || 60
                  const cap = parseInt(settings.otp_resend_cooldown_max) || 300
                  const seq = Array.from({ length: 5 }, (_, i) => Math.min(base + step * i, cap))
                  return (
                    <ul className="mt-3 space-y-2 text-sm text-slate-600 font-medium">
                      <li>• First resend waits <b>{seq[0]}s</b></li>
                      <li>• Second resend waits <b>{seq[1]}s</b></li>
                      <li>• Third resend waits <b>{seq[2]}s</b></li>
                      <li>• Fourth resend waits <b>{seq[3]}s</b></li>
                      <li>• Further resends cap at <b>{cap}s</b> — and stop entirely after max resends</li>
                    </ul>
                  )
                })()}
              </div>
            </div>
          </section>
        )}

      </div>
    </div>
  )
}
