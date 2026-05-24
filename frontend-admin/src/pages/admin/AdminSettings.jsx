import { useState, useEffect } from 'react'
import { Settings, Save, AlertCircle, Trash2 } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

export default function AdminSettings() {
  const user = useStore((state) => state.adminUser)
  const token = useStore((state) => state.adminToken)
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    theme_primary_color: '#f59e0b',
    theme_secondary_color: '#fbbf24',
    theme_tertiary_color: '#10b981',
    pwa_install_prompt_enabled: 'true',
    pwa_banner_title: 'Install JDLX Mobile',
    pwa_banner_description: 'Get the full premium experience on your home screen.',
    scheduled_delivery_time: 'Tomorrow by 11:00 AM',
    quick_delivery_max_distance: '5',
    scheduled_delivery_note: 'Reliable fulfillment from our central warehouse.',
    quick_delivery_note: 'Hyperlocal dispatch from the active dark store.',
    platform_fee: '7',
    free_delivery_threshold: '499',
    delivery_fee: '49',
    
    // New Delivery & Payment Settings
    cod_enabled: 'true',
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
    construction_mode_message: 'Our website is currently undergoing scheduled maintenance and upgrades. JDLX Mobile will be back online with exciting new premium products soon. Thank you for your patience!'
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
    } catch (err) {
      alert('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const fetchPincodeRules = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/pincode-rules`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const json = await res.json()
      if (res.ok) setPincodeRules(json)
    } catch (err) {
      console.error(err)
    }
  }

  const handleAddPincodeRule = async () => {
    if (!newPincode.pincode) return
    try {
      const res = await fetch(`${API_BASE_URL}/admin/pincode-rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          pincode: newPincode.pincode, 
          cod_allowed: newPincode.cod_allowed === 'true' ? 1 : 0 
        })
      })
      if (res.ok) {
        setNewPincode({ pincode: '', cod_allowed: 'false' })
        fetchPincodeRules()
      }
    } catch (err) {
      alert('Error adding pincode rule')
    }
  }

  const handleDeletePincodeRule = async (pincode) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/pincode-rules/${pincode}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) fetchPincodeRules()
    } catch (err) {
      alert('Error deleting pincode rule')
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const res = await fetch(`${API_BASE_URL}/admin/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      })
      const json = await res.json()
      if (res.ok) {
        alert('Settings saved successfully')
      } else {
        alert(json.error || 'Failed to save settings')
      }
    } catch (err) {
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
        pwa_banner_description: 'Get the full premium experience on your home screen.'
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

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
            <Settings className="w-8 h-8 text-primary" />
            System Settings
          </h1>
          <p className="mt-2 text-slate-500 font-medium">Manage global configuration and frontend themes.</p>
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

      <div className="grid gap-10">


        {/* Pincode Restrictions Section */}
        <section className="ui-card-standard p-6 md:p-10">
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

        {/* Delivery & Payment Controls */}
        <section className="ui-card-standard p-6 md:p-10">
          <div className="mb-10">
            <h2 className="text-2xl font-black text-slate-900">Delivery & Payment Controls</h2>
            <p className="text-slate-500 font-medium mt-1">Configure global delivery fees, COD rules, and checkout incentives.</p>
          </div>

          <div className="grid gap-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Toggle 
                label="Enable Cash on Delivery (COD)" 
                description="Allow customers to pay during delivery."
                enabled={settings.cod_enabled}
                onChange={(val) => handleChange('cod_enabled', val)}
              />
              <Toggle 
                label="Enable Free Delivery" 
                description="Automatically apply ₹0 delivery fee above threshold."
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Free Delivery Threshold (₹)</label>
                  <input
                    type="number"
                    value={settings.free_delivery_threshold || ''}
                    onChange={(e) => handleChange('free_delivery_threshold', e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
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

            <div className="space-y-6 pt-10 border-t border-slate-100">
               <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-6 bg-blue-600 rounded-full"></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Incentives & Badges</h3>
               </div>
               
               <div className="grid gap-6 md:grid-cols-2">
                 <Toggle 
                    label="Prepaid Recommendation" 
                    description="Show 'Recommended' tag on prepaid option."
                    enabled={settings.prepaid_recommendation_enabled}
                    onChange={(val) => handleChange('prepaid_recommendation_enabled', val)}
                  />
                  <Toggle 
                    label="Priority Dispatch Badge" 
                    description="Show lightning badge for prepaid orders."
                    enabled={settings.priority_dispatch_enabled}
                    onChange={(val) => handleChange('priority_dispatch_enabled', val)}
                  />
               </div>

               <div className="space-y-2 pt-4">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">COD Alert Banner Text</label>
                  <textarea
                    value={settings.cod_alert_text || ''}
                    onChange={(e) => handleChange('cod_alert_text', e.target.value)}
                    rows={2}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 outline-none focus:bg-white focus:border-primary transition-all resize-none"
                    placeholder="Message shown when COD is selected..."
                  />
                  <p className="text-[10px] text-slate-400 font-medium">This text is shown in the yellow alert box on the checkout page when COD is selected.</p>
               </div>
            </div>

            <div className="space-y-6 pt-10 border-t border-slate-100">
               <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-6 bg-purple-600 rounded-full"></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Delivery Logistics (Shiprocket)</h3>
               </div>
               <div className="grid gap-8 md:grid-cols-2">
                 <div className="space-y-2">
                   <label className="text-xs font-black uppercase tracking-widest text-slate-400">Quick Delivery Radius (KM)</label>
                   <input
                     type="number"
                     value={settings.quick_delivery_max_distance || ''}
                     onChange={(e) => handleChange('quick_delivery_max_distance', e.target.value)}
                     className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                   />
                 </div>
                 <div className="space-y-2">
                   <label className="text-xs font-black uppercase tracking-widest text-slate-400">Fixed Platform Fee (₹)</label>
                   <input
                     type="number"
                     value={settings.platform_fee || ''}
                     onChange={(e) => handleChange('platform_fee', e.target.value)}
                     className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                   />
                 </div>
               </div>
            </div>

            <div className="space-y-6 pt-8 mt-8 border-t border-slate-100">
               <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-6 bg-[#6322b2] rounded-full"></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                     Shiprocket Integration
                     <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Shiprocket_Logo.svg/1200px-Shiprocket_Logo.svg.png" className="h-3 ml-2" alt="" />
                  </h3>
               </div>
               
               <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">API Email</label>
                    <input
                      type="email"
                      value={settings.shiprocket_email || ''}
                      onChange={(e) => handleChange('shiprocket_email', e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#6322b2] transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">API Password</label>
                    <input
                      type="password"
                      value={settings.shiprocket_password || ''}
                      onChange={(e) => handleChange('shiprocket_password', e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#6322b2] transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Registered Pickup Location</label>
                    <input
                      type="text"
                      value={settings.shiprocket_pickup_location || ''}
                      onChange={(e) => handleChange('shiprocket_pickup_location', e.target.value)}
                      placeholder="e.g., Primary, Warehouse-1"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-[#6322b2] transition-all"
                    />
                  </div>
               </div>
               <div className="mt-4 p-4 rounded-2xl bg-[#6322b2]/5 border border-[#6322b2]/10 flex items-start gap-3">
                 <p className="text-[10px] font-medium text-[#6322b2] leading-relaxed">
                   Connecting your Shiprocket account allows JDLX to automatically create shipments, request pickups, and track orders in real-time. Make sure your pickup address matches what is registered in Shiprocket panel.
                 </p>
              </div>
            </div>
          </div>
        </section>

        {/* Store Policies Section */}
        <section className="ui-card-standard p-6 md:p-10">
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

        {/* App Experience Section */}
        <section className="ui-card-standard p-6 md:p-10">
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
        <section className="ui-card-standard p-6 md:p-10 border border-amber-200/50 bg-gradient-to-br from-white to-amber-50/20">
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

        {/* Footer & Brand Identity Section */}
        <section className="ui-card-standard p-6 md:p-10">
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

        {/* Content Pages Section */}
        <section className="ui-card-standard p-6 md:p-10">
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
- Hyperlocal quick commerce platform for daily essentials.
- Designed for fast discovery, reliable stock, and smooth checkout.
- Single account experience across shopping, tracking, wallet, and support.

# How It Works
- Browse products and add to cart.
- Choose delivery mode (quick/scheduled) where available.
- Place order, track in real-time, and get updates in your account.

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
- We provide hyperlocal quick commerce and scheduled delivery services.
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
      </div>
    </div>
  )
}
