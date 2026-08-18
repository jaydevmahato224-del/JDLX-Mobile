import { useState, useEffect, useRef } from 'react'
import { Image, Type, Link as LinkIcon, Save, Plus, Trash2, CheckCircle2, AlertCircle, ImagePlus, LayoutDashboard, Upload, Scissors } from 'lucide-react'
import toast from 'react-hot-toast'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { useStore } from '../../store/useStore'
import ImageCropperModal from '../../components/ImageCropperModal'

export default function AdminBanners() {
  const [banners, setBanners] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const adminToken = useStore((state) => state.adminToken)

  const [form, setForm] = useState({
    id: null,
    title: '',
    subtitle: '',
    cta_text: 'Explore Now',
    image_url: '',
    badge_text: 'Limited Offer',
    gradient: 'bg-slate-900',
    link_url: '',
    is_active: 1,
    overlay_opacity: 0.5
  })

  const [croppingImage, setCroppingImage] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    fetchBanners()
  }, [])

  const fetchBanners = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/banners`)
      const json = await res.json()
      if (json.success) {
        setBanners(json.data || [])
        if (json.data && json.data.length > 0) {
          setForm(json.data[0]) // Edit the first one by default
        }
      }
    } catch {
      toast.error('Failed to load banners')
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => setCroppingImage(reader.result)
      reader.readAsDataURL(file)
    }
  }

  const onCropComplete = async (blob) => {
    setCroppingImage(null)
    const formData = new FormData()
    formData.append('file', blob, 'banner.jpg')

    const loadingToast = toast.loading('Uploading cropped image...')
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        },
        body: formData
      })
      const json = await res.json()
      if (json.url) {
        setForm({ ...form, image_url: json.url })
        toast.success('Image uploaded!', { id: loadingToast })
      } else {
        toast.error(json.message || 'Upload failed', { id: loadingToast })
      }
    } catch {
      toast.error('Network error during upload', { id: loadingToast })
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this banner?')) return
    try {
      const res = await fetch(`${API_BASE_URL}/admin/banners/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      })
      const json = await res.json()
      if (json.success) {
        toast.success('Banner deleted')
        fetchBanners()
        if (form.id === id) resetForm()
      }
    } catch {
      toast.error('Failed to delete banner')
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE_URL}/admin/banners`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(form)
      })
      const json = await res.json()
      if (json.success) {
        toast.success('Banner updated successfully')
        fetchBanners()
      } else {
        toast.error(json.message || 'Update failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setForm({
      id: null,
      title: '',
      subtitle: '',
      cta_text: 'Explore Now',
      image_url: '',
      badge_text: '',
      gradient: 'bg-slate-900',
      link_url: '',
      is_active: 1,
      overlay_opacity: 0.5
    })
  }

  if (loading) return <div className="p-8 text-center animate-pulse">Loading manager...</div>

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
             <LayoutDashboard size={18} />
             <span className="text-[10px] font-black uppercase tracking-[0.3em]">Storefront Management</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Banner Manager</h1>
          <p className="text-slate-500 font-medium text-sm">Update the big banners seen on the home page</p>
        </div>
        
        <button 
          onClick={() => {
            resetForm();
            toast.success('Ready to create a new banner');
          }}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
        >
          <Plus size={16} /> Add New
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Editor Form */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-xl overflow-hidden">
          <div className="p-8 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
            <h2 className="text-xl font-black tracking-tight text-slate-900">Editor</h2>
            {form.id ? (
              <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest">
                Editing: ID #{form.id}
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-green-100 text-green-600 text-[10px] font-black uppercase tracking-widest">
                New Banner
              </span>
            )}
          </div>
          
          <form onSubmit={handleSave} className="p-8 space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Banner Title</label>
              <div className="relative">
                <Type className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                  type="text" 
                  value={form.title} 
                  onChange={e => setForm({...form, title: e.target.value})}
                  className="w-full h-14 bg-slate-50 border-none rounded-2xl pl-12 pr-4 text-sm font-bold focus:ring-2 focus:ring-primary/10 transition-all"
                  placeholder="e.g. MEGA SUMMER SALE"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Subtitle / Description</label>
              <textarea 
                value={form.subtitle} 
                onChange={e => setForm({...form, subtitle: e.target.value})}
                className="w-full min-h-[100px] bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-primary/10 transition-all resize-none"
                placeholder="Details about the promotion..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="space-y-2">
                 <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Badge Text</label>
                 <input 
                   type="text" 
                   value={form.badge_text} 
                   onChange={e => setForm({...form, badge_text: e.target.value})}
                   className="w-full h-14 bg-slate-50 border-none rounded-2xl px-4 text-sm font-bold focus:ring-2 focus:ring-primary/10 transition-all"
                   placeholder="e.g. FLASH SALE"
                 />
               </div>
               <div className="space-y-2">
                 <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">CTA Text</label>
                 <input 
                   type="text" 
                   value={form.cta_text} 
                   onChange={e => setForm({...form, cta_text: e.target.value})}
                   className="w-full h-14 bg-slate-50 border-none rounded-2xl px-4 text-sm font-bold focus:ring-2 focus:ring-primary/10 transition-all"
                 />
               </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Image URL / Upload</label>
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 px-2 py-1 rounded-lg transition-all"
                >
                  <Upload size={12} /> Upload File
                </button>
              </div>
              <div className="relative">
                <ImagePlus className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                  type="text" 
                  value={form.image_url} 
                  onChange={e => setForm({...form, image_url: e.target.value})}
                  className="w-full h-14 bg-slate-50 border-none rounded-2xl pl-12 pr-4 text-sm font-bold focus:ring-2 focus:ring-primary/10 transition-all"
                  placeholder="https://images.unsplash.com/..."
                />
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Click Link URL</label>
              <div className="relative">
                <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                  type="text" 
                  value={form.link_url} 
                  onChange={e => setForm({...form, link_url: e.target.value})}
                  className="w-full h-14 bg-slate-50 border-none rounded-2xl pl-12 pr-4 text-sm font-bold focus:ring-2 focus:ring-primary/10 transition-all"
                  placeholder="/category/electronics"
                />
              </div>
            </div>

            <div className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
               <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Background Darkness (Overlay)</label>
                  <span className="text-[10px] font-black text-primary px-2 py-0.5 bg-primary/10 rounded-md">{Math.round(form.overlay_opacity * 100)}%</span>
               </div>
               <input 
                 type="range" 
                 min="0" max="1" step="0.05"
                 value={form.overlay_opacity}
                 onChange={e => setForm({...form, overlay_opacity: parseFloat(e.target.value)})}
                 className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary"
               />
               <p className="text-[9px] text-slate-400 font-medium italic">Higher % makes the image darker to help text stand out.</p>
            </div>

            <div className="flex items-center gap-4 pt-4">
              <button 
                type="submit" 
                disabled={saving}
                className="flex-1 h-14 bg-primary text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:opacity-90 active:scale-95 transition-all shadow-xl shadow-primary/20 disabled:opacity-50"
              >
                {saving ? <Plus className="animate-spin" /> : <Save size={18} />}
                {form.id ? 'Update Banner' : 'Create Banner'}
              </button>
            </div>
          </form>
        </div>

        {/* Preview Section */}
        <div className="space-y-6">
           <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Live Preview</h2>
              <div className="flex items-center gap-2 text-green-500 text-[10px] font-black uppercase tracking-widest">
                 <CheckCircle2 size={12} /> Sync Active
              </div>
           </div>

           <div className="relative w-full aspect-video rounded-[3rem] bg-slate-900 overflow-hidden shadow-2xl group border-4 border-white shadow-slate-200/50">
              {form.image_url && (
                <img src={resolveMediaUrl(form.image_url)} alt="Preview" className="absolute inset-0 w-full h-full object-cover opacity-50" />
              )}
              <div className="absolute inset-0 p-10 flex flex-col justify-center" style={{ background: `linear-gradient(to right, rgba(0,0,0,${form.overlay_opacity + 0.2}), rgba(0,0,0,${form.overlay_opacity / 2}))` }}>
                 {form.badge_text && (
                   <div className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full border border-white/20 text-[8px] font-black !text-white w-fit mb-4 tracking-widest uppercase">
                     {form.badge_text}
                   </div>
                 )}
                 <h3 className="text-3xl font-black !text-white mb-2 leading-tight" style={{ textShadow: '0 4px 20px rgba(0,0,0,0.8)' }}>{form.title || 'Your Title Here'}</h3>
                 <p className="!text-white text-sm max-w-xs mb-6 line-clamp-2 font-bold" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.7)' }}>{form.subtitle || 'Your description will appear here...'}</p>
                 <button className="px-6 py-3 bg-white rounded-xl text-[10px] font-black text-slate-900 w-fit uppercase tracking-widest">
                   {form.cta_text}
                 </button>
              </div>
           </div>

           {/* History / Other Banners */}
           <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 space-y-6">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Manage Active Banners</h2>
              <div className="space-y-3">
                 {banners.map(b => (
                   <div key={b.id} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${form.id === b.id ? 'border-primary bg-primary/5' : 'border-slate-50 bg-slate-50/50'}`}>
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 rounded-xl bg-slate-200 overflow-hidden flex-shrink-0">
                            {b.image_url && <img src={resolveMediaUrl(b.image_url)} className="w-full h-full object-cover" />}
                         </div>
                         <div>
                            <div className="text-sm font-black text-slate-900 line-clamp-1">{b.title}</div>
                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">ID: #{b.id}</div>
                         </div>
                      </div>
                      <div className="flex items-center gap-2">
                         <button 
                           onClick={() => setForm(b)}
                           className="p-2 hover:bg-white rounded-lg text-primary transition-all"
                         >
                           <Image size={18} />
                         </button>
                         <button 
                            onClick={() => handleDelete(b.id)}
                            className="p-2 hover:bg-white rounded-lg text-red-400 transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                      </div>
                   </div>
                 ))}
              </div>
           </div>
        </div>
      </div>

      {croppingImage && (
        <ImageCropperModal 
          image={croppingImage}
          aspect={21 / 9} // Banners are usually wide
          onCropComplete={onCropComplete}
          onCancel={() => setCroppingImage(null)}
        />
      )}
    </div>
  )
}
