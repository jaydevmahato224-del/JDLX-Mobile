import { useState, useEffect } from 'react'
import { Settings, Save, AlertCircle } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

export default function AdminSettings() {
  const user = useStore((state) => state.adminUser)
  const token = useStore((state) => state.adminToken)
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    theme_primary_color: '#0D1B2A',
    theme_secondary_color: '#415A77',
    theme_tertiary_color: '#00B4D8',
    pwa_install_prompt_enabled: 'true',
    pwa_banner_title: 'Install JDLX Mobile',
    pwa_banner_description: 'Get the full premium experience on your home screen.',
    scheduled_delivery_time: 'Tomorrow by 11:00 AM',
    quick_delivery_max_distance: '5',
    scheduled_delivery_note: 'Reliable fulfillment from our central warehouse.',
    quick_delivery_note: 'Hyperlocal dispatch from the active dark store.',
    platform_fee: '7',
    free_delivery_threshold: '199',
    delivery_fee: '49',
    shiprocket_email: '',
    shiprocket_password: '',
    shiprocket_pickup_location: 'Primary',
    global_return_policy: '7 Days Return Policy',

    // Content Pages (Storefront)
    about_us_content: '',
    terms_and_conditions_content: '',
    ticker_text: 'Free delivery on orders above ₹499 • Better experience with fast delivery'
  })

  useEffect(() => {
    fetchSettings()
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
    setSettings({
      theme_primary_color: '#0D1B2A',
      theme_secondary_color: '#415A77',
      theme_tertiary_color: '#00B4D8',
      pwa_install_prompt_enabled: 'true',
      pwa_banner_title: 'Install JDLX Mobile',
      pwa_banner_description: 'Get the full premium experience on your home screen.'
    })
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
        {/* Theme Settings Section */}
        <section className="ui-card-standard p-6 md:p-10">
          <div className="mb-10">
            <h2 className="text-2xl font-black text-slate-900">Frontend Theme System</h2>
            <p className="text-slate-500 font-medium mt-1">Configure your brand identity and real-time storefront aesthetics.</p>
          </div>
          
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Color Pickers */}
            <div className="space-y-8">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Primary Identity</label>
                    <span className="text-[10px] font-bold text-primary bg-primary/5 px-2 py-0.5 rounded-full">Core Brand</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="relative group">
                      <input
                        type="color"
                        value={settings.theme_primary_color || '#0D1B2A'}
                        onChange={(e) => handleChange('theme_primary_color', e.target.value)}
                        className="w-16 h-16 rounded-2xl cursor-pointer border-4 border-white shadow-md transition-transform hover:scale-105"
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={settings.theme_primary_color || '#0D1B2A'}
                        onChange={(e) => handleChange('theme_primary_color', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-mono font-bold text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all"
                      />
                      <p className="mt-2 text-[11px] font-medium text-slate-400 leading-relaxed">
                        Changes: **Buttons, Active Navigation, and main branding elements.**
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Secondary / Gradients</label>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="color"
                      value={settings.theme_secondary_color || '#415A77'}
                      onChange={(e) => handleChange('theme_secondary_color', e.target.value)}
                      className="w-16 h-16 rounded-2xl cursor-pointer border-4 border-white shadow-md transition-transform hover:scale-105"
                    />
                    <div className="flex-1">
                      <input
                        type="text"
                        value={settings.theme_secondary_color || '#415A77'}
                        onChange={(e) => handleChange('theme_secondary_color', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-mono font-bold text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-secondary/5 focus:border-primary transition-all"
                      />
                      <p className="mt-2 text-[11px] font-medium text-slate-400 leading-relaxed">
                        Changes: **Header background gradients, decorative blurs, and secondary cards.**
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Accent / Highlights</label>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="color"
                      value={settings.theme_tertiary_color || '#00B4D8'}
                      onChange={(e) => handleChange('theme_tertiary_color', e.target.value)}
                      className="w-16 h-16 rounded-2xl cursor-pointer border-4 border-white shadow-md transition-transform hover:scale-105"
                    />
                    <div className="flex-1">
                      <input
                        type="text"
                        value={settings.theme_tertiary_color || '#00B4D8'}
                        onChange={(e) => handleChange('theme_tertiary_color', e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-mono font-bold text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-tertiary/5 focus:border-primary transition-all"
                      />
                      <p className="mt-2 text-[11px] font-medium text-slate-400 leading-relaxed">
                        Changes: **Product badges, category icons, and special promotional highlights.**
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Mockup Preview */}
            <div className="bg-slate-50/50 rounded-[2.5rem] p-8 border border-slate-100">
              <div className="mb-6 text-center">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Live Mockup Preview</h3>
                <p className="text-xs text-slate-500 mt-1">See how colors interact in the real Store UI</p>
              </div>

              <div className="bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden max-w-[280px] mx-auto scale-110">
                {/* Mockup Header */}
                <div className="p-4 border-b border-slate-100 flex items-center justify-between" 
                     style={{ background: `linear-gradient(135deg, ${settings.theme_primary_color}0a 0%, ${settings.theme_secondary_color}1a 100%)` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white text-[10px]" 
                       style={{ backgroundColor: settings.theme_primary_color }}>JX</div>
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-slate-200"></div>
                    <div className="w-2 h-2 rounded-full bg-slate-200"></div>
                  </div>
                </div>

                {/* Mockup Card */}
                <div className="p-4">
                  <div className="relative aspect-square rounded-2xl bg-slate-50 mb-4 overflow-hidden border border-slate-100 flex items-center justify-center">
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[7px] font-black uppercase text-white shadow-sm" 
                         style={{ backgroundColor: settings.theme_tertiary_color }}>NEW ARRIVAL</div>
                    <div className="w-12 h-12 rounded-full opacity-20" style={{ backgroundColor: settings.theme_primary_color }}></div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="h-3 w-3/4 rounded-full bg-slate-100"></div>
                    <div className="h-2 w-1/2 rounded-full bg-slate-50"></div>
                    <div className="flex items-center justify-between pt-2">
                      <div className="h-4 w-12 rounded bg-slate-100"></div>
                      <div className="w-8 h-8 rounded-full shadow-lg flex items-center justify-center text-white" 
                           style={{ backgroundColor: settings.theme_primary_color }}>+</div>
                    </div>
                  </div>
                </div>

                {/* Mockup Nav */}
                <div className="p-3 bg-white/80 backdrop-blur border-t border-slate-100 flex justify-around">
                   <div className="w-4 h-4 rounded-full" style={{ backgroundColor: settings.theme_primary_color }}></div>
                   <div className="w-4 h-4 rounded-full bg-slate-200 opacity-50"></div>
                   <div className="w-4 h-4 rounded-full bg-slate-200 opacity-50"></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Logistics & Delivery Section */}
        <section className="ui-card-standard p-6 md:p-10">
          <div className="mb-10">
            <h2 className="text-2xl font-black text-slate-900">Logistics & Delivery</h2>
            <p className="text-slate-500 font-medium mt-1">Configure delivery timeframes and eligibility rules.</p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Scheduled Delivery Time</label>
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Standard Fallback</span>
              </div>
              <input
                type="text"
                value={settings.scheduled_delivery_time || ''}
                onChange={(e) => handleChange('scheduled_delivery_time', e.target.value)}
                placeholder="e.g., Tomorrow by 11:00 AM"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
              />
              <div className="mt-4 space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scheduled Note</label>
                <input
                  type="text"
                  value={settings.scheduled_delivery_note || ''}
                  onChange={(e) => handleChange('scheduled_delivery_note', e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 outline-none focus:bg-white focus:border-primary transition-all"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Quick Delivery Radius (KM)</label>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Active Range</span>
              </div>
              <input
                type="number"
                value={settings.quick_delivery_max_distance || ''}
                onChange={(e) => handleChange('quick_delivery_max_distance', e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
              />
              <div className="mt-4 space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Quick Note</label>
                <input
                  type="text"
                  value={settings.quick_delivery_note || ''}
                  onChange={(e) => handleChange('quick_delivery_note', e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 outline-none focus:bg-white focus:border-primary transition-all"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6 pt-10 mt-10 border-t border-slate-100">
             <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-6 bg-blue-600 rounded-full"></div>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Platform & Checkout Fees</h3>
             </div>
             
             <div className="grid gap-8 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Fixed Platform Fee (₹)</label>
                  </div>
                  <input
                    type="number"
                    value={settings.platform_fee || ''}
                    onChange={(e) => handleChange('platform_fee', e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                  />
                  <p className="text-[10px] text-slate-400 font-medium">Applied to every order regardless of value.</p>
                </div>
             </div>
          </div>

            <div className="space-y-6 pt-8 mt-8 border-t border-slate-100">
               <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-6 bg-primary rounded-full"></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Delivery Charge Logic</h3>
               </div>
               
               <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Free Delivery Threshold (₹)</label>
                    <input
                      type="number"
                      value={settings.free_delivery_threshold || ''}
                      onChange={(e) => handleChange('free_delivery_threshold', e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                    <p className="text-[10px] text-slate-400 font-medium">Orders equal or above this amount will have ₹0 delivery fee.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Standard Delivery Fee (₹)</label>
                    <input
                      type="number"
                      value={settings.delivery_fee || ''}
                      onChange={(e) => handleChange('delivery_fee', e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-primary transition-all"
                    />
                    <p className="text-[10px] text-slate-400 font-medium">Fee applied to orders below the threshold.</p>
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
