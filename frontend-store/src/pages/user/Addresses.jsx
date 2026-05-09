import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'
import { MapPin, Plus, Trash2, Edit3, CheckCircle2, ChevronRight, X, Navigation, RefreshCw } from 'lucide-react'
import MapPicker from '../../components/MapPicker'
import toast from 'react-hot-toast'

function Addresses() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    
    const [addresses, setAddresses] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [loading, setLoading] = useState(false);
    
    const [form, setForm] = useState({ 
        full_name: '', 
        phone: '', 
        house: '', 
        city: '', 
        state: '', 
        pincode: '', 
        landmark: '', 
        is_default: 0 
    });

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }
    }, [user, navigate]);

    const fetchAddresses = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/user/addresses`, { 
                headers: { Authorization: `Bearer ${token}` } 
            });
            if (res.ok) setAddresses(await res.json());
        } catch (err) {
            toast.error("Failed to load addresses");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAddresses(); }, []);

    const handleSave = async e => {
        if (e) e.preventDefault();
        
        // Basic validation
        if (!form.full_name || !form.phone || !form.house || !form.city) {
            toast.error("Please fill required fields");
            return;
        }

        const method = editing ? 'PUT' : 'POST';
        const body = editing ? { ...form, id: editing } : form;
        
        try {
            const res = await fetch(`${API_BASE_URL}/user/addresses`, {
                method,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body)
            });
            
            if (res.ok) {
                toast.success(editing ? 'Address updated' : 'Address added');
                setForm({ full_name: '', phone: '', house: '', city: '', state: '', pincode: '', landmark: '', is_default: 0 });
                setEditing(null);
                setShowForm(false);
                fetchAddresses();
            } else {
                toast.error("Failed to save address");
            }
        } catch (err) {
            toast.error("Something went wrong");
        }
    };

    const handleDelete = async id => {
        if (!confirm("Are you sure you want to delete this address?")) return;
        
        try {
            const res = await fetch(`${API_BASE_URL}/user/addresses`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                toast.success('Address deleted');
                fetchAddresses();
            }
        } catch (err) {
            toast.error("Failed to delete address");
        }
    };

    const handleLocationSelect = (data) => {
        setForm(prev => ({
            ...prev,
            house: data.house || prev.house,
            city: data.city || prev.city,
            state: data.state || prev.state,
            pincode: data.pincode || prev.pincode,
            landmark: data.landmark || prev.landmark
        }));
    };

    return (
        <div className="container-standard py-8 space-y-8 animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--color-on-surface)]/40">My Account</span>
                    </div>
                    <h1 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)]">Saved Addresses</h1>
                </div>
                {!showForm && (
                    <button 
                        onClick={() => setShowForm(true)}
                        className="btn-primary gap-2 shadow-lg shadow-primary/20"
                    >
                        <Plus size={18} />
                        Add New
                    </button>
                )}
            </div>

            {/* Form Section (Conditional) */}
            {showForm && (
                <div className="glass-card p-6 md:p-8 space-y-8 border-primary/20 bg-primary/[0.02]">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-black tracking-tight text-[var(--color-on-surface)] flex items-center gap-3">
                            <MapPin className="text-primary" />
                            {editing ? 'Edit Address' : 'New Address Details'}
                        </h2>
                        <button 
                            onClick={() => {
                                setShowForm(false);
                                setEditing(null);
                                setForm({ full_name: '', phone: '', house: '', city: '', state: '', pincode: '', landmark: '', is_default: 0 });
                            }}
                            className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-high)] text-[var(--color-on-surface)]/40 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                        {/* Map Picker Column */}
                        <div className="space-y-4">
                            <div className="text-sm font-black text-[var(--color-on-surface)]/60 flex items-center gap-2">
                                <Navigation size={14} />
                                Pin Location on Map
                            </div>
                            <MapPicker onLocationSelect={handleLocationSelect} />
                        </div>

                        {/* Form Inputs Column */}
                        <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2 space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40 ml-1">Full Name</label>
                                <input 
                                    placeholder="e.g. John Doe" 
                                    value={form.full_name} 
                                    onChange={e => setForm({ ...form, full_name: e.target.value })} 
                                    className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all" 
                                />
                            </div>
                            <div className="sm:col-span-2 space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40 ml-1">Phone Number</label>
                                <input 
                                    placeholder="+91 00000 00000" 
                                    value={form.phone} 
                                    onChange={e => setForm({ ...form, phone: e.target.value })} 
                                    className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all" 
                                />
                            </div>
                            <div className="sm:col-span-2 space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40 ml-1">House / Flat / Area</label>
                                <input 
                                    placeholder="Door No, Building, Street" 
                                    value={form.house} 
                                    onChange={e => setForm({ ...form, house: e.target.value })} 
                                    className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all" 
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40 ml-1">City</label>
                                <input 
                                    placeholder="City" 
                                    value={form.city} 
                                    onChange={e => setForm({ ...form, city: e.target.value })} 
                                    className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all" 
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40 ml-1">State</label>
                                <input 
                                    placeholder="State" 
                                    value={form.state} 
                                    onChange={e => setForm({ ...form, state: e.target.value })} 
                                    className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all" 
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40 ml-1">Pincode</label>
                                <input 
                                    placeholder="000 000" 
                                    value={form.pincode} 
                                    onChange={e => setForm({ ...form, pincode: e.target.value })} 
                                    className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all" 
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40 ml-1">Landmark</label>
                                <input 
                                    placeholder="Optional" 
                                    value={form.landmark} 
                                    onChange={e => setForm({ ...form, landmark: e.target.value })} 
                                    className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all" 
                                />
                            </div>
                            <div className="sm:col-span-2 pt-4">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className="relative flex items-center">
                                        <input 
                                            type="checkbox" 
                                            checked={form.is_default === 1} 
                                            onChange={e => setForm({ ...form, is_default: e.target.checked ? 1 : 0 })} 
                                            className="sr-only"
                                        />
                                        <div className={`w-10 h-6 rounded-full transition-all duration-300 ${form.is_default ? 'bg-primary shadow-[0_0_15px_rgba(var(--color-primary-rgb),0.4)]' : 'bg-[var(--color-surface-high)]'}`}>
                                            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-all duration-300 ${form.is_default ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </div>
                                    </div>
                                    <span className="text-xs font-black uppercase tracking-widest text-[var(--color-on-surface)]/60 group-hover:text-primary transition-colors">Set as Default Address</span>
                                </label>
                            </div>
                            <div className="sm:col-span-2 pt-6">
                                <button className="btn-primary w-full h-14 text-base tracking-widest">
                                    {editing ? 'Update Saved Address' : 'Save New Address'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* List Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {loading ? (
                   <div className="col-span-full py-20 flex flex-col items-center justify-center gap-4 text-[var(--color-on-surface)]/20">
                      <RefreshCw className="animate-spin" size={40} />
                      <p className="text-sm font-black uppercase tracking-widest">Loading Addresses...</p>
                   </div>
                ) : addresses.length === 0 ? (
                    <div className="col-span-full py-20 glass-card flex flex-col items-center justify-center gap-6 border-dashed border-2">
                        <div className="h-20 w-20 rounded-full bg-[var(--color-surface-high)] flex items-center justify-center text-[var(--color-on-surface)]/20">
                            <MapPin size={40} />
                        </div>
                        <div className="text-center space-y-2">
                            <h3 className="text-xl font-black tracking-tight text-[var(--color-on-surface)]">No addresses saved yet</h3>
                            <p className="text-sm text-[var(--color-on-surface)]/40 font-medium">Add an address to speed up your checkout process.</p>
                        </div>
                        {!showForm && (
                            <button onClick={() => setShowForm(true)} className="btn-primary px-8">Add My First Address</button>
                        )}
                    </div>
                ) : (
                    addresses.map(a => (
                        <div key={a.id} className="group relative glass-card p-6 flex flex-col gap-5 hover:border-primary/40 hover:-translate-y-1 transition-all duration-500">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-black text-lg tracking-tight text-[var(--color-on-surface)]">{a.full_name}</h3>
                                        {a.is_default === 1 && (
                                            <span className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase text-primary tracking-widest">
                                                <CheckCircle2 size={10} />
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[12px] font-bold text-primary">{a.phone}</p>
                                </div>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                        onClick={() => { setEditing(a.id); setForm(a); setShowForm(true); }}
                                        className="h-10 w-10 flex items-center justify-center rounded-xl bg-[var(--color-surface-high)] text-[var(--color-on-surface)] hover:text-primary transition-all active:scale-90"
                                    >
                                        <Edit3 size={18} />
                                    </button>
                                    <button 
                                        onClick={() => handleDelete(a.id)}
                                        className="h-10 w-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-90"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                            
                            <div className="flex items-start gap-4 p-4 rounded-2xl bg-[var(--color-surface-low)] border border-[var(--color-surface-high)]">
                                <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-surface-white)] text-primary shadow-sm shrink-0">
                                    <MapPin size={16} />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-bold text-[var(--color-on-surface)] leading-relaxed">{a.house}</p>
                                    <p className="text-[11px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40">
                                        {a.city}, {a.state} • {a.pincode}
                                    </p>
                                    {a.landmark && (
                                        <p className="text-[10px] font-bold italic text-primary/60">Near {a.landmark}</p>
                                    )}
                                </div>
                            </div>

                            <div className="absolute bottom-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
                                <ChevronRight size={48} />
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default Addresses
