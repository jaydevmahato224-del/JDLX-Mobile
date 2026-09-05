import toast from "react-hot-toast"
import { useState } from 'react'
import { X, Save, Info } from 'lucide-react'
import { API_BASE_URL } from '../config'
import MapPicker from './MapPicker'
import { apiFetch } from '../utils/apiFetch'

function AddressPicker({ onSelect, onClose }) {
    const [location, setLocation] = useState({ lat: 28.6139, lng: 77.2090 }); // Default Delhi
    const [formData, setFormData] = useState({
        flatNo: '',
        area: '',
        landmark: '',
        city: '',
        state: '',
        pincode: ''
    });
    const [saving, setSaving] = useState(false);
    const [pincodeStatus, setPincodeStatus] = useState('idle'); // 'idle', 'checking', 'serviceable', 'unserviceable', 'invalid'
    const [pincodeMessage, setPincodeMessage] = useState('');

    const fetchCityStateFromPincode = async (pin, updateStateFn) => {
        setPincodeStatus('checking');
        setPincodeMessage('Checking pincode validity and serviceability...');
        try {
            const res = await fetch(`${API_BASE_URL}/pincode/check/${pin}`);
            if (res.ok) {
                const checkData = await res.json();
                const details = checkData.data || checkData;
                
                if (details.invalid) {
                    setPincodeStatus('invalid');
                    setPincodeMessage('❌ Invalid Pincode! Please enter a valid Indian pincode.');
                    toast.error("Invalid Pincode. Please enter a valid 6-digit Indian postal code.");
                    return;
                }
                
                if (details.city && details.state) {
                    updateStateFn(prev => ({
                        ...prev,
                        city: details.city,
                        state: details.state
                    }));
                }
                
                if (details.serviceable) {
                    setPincodeStatus('serviceable');
                    if (!details.cod_allowed) {
                        setPincodeMessage('⚠️ Only PREPAID delivery available for this location.');
                        toast.success(`Pincode serviceable! Only prepaid delivery is supported here.`);
                    } else {
                        setPincodeMessage('✓ Serviceable by Shiprocket Express! COD & Prepaid available.');
                        if (details.city && details.state) {
                            toast.success(`Location detected: ${details.city}, ${details.state}`);
                        } else {
                            toast.success("Pincode verified successfully.");
                        }
                    }
                } else {
                    setPincodeStatus('unserviceable');
                    setPincodeMessage('⚠️ Courier service is not available for this location.');
                    toast.error("Shiprocket does not deliver to this pincode. Please enter a different one.");
                }
            } else {
                setPincodeStatus('invalid');
                setPincodeMessage('❌ Pincode check failed. Please check manually.');
            }
        } catch (err) {
            console.warn("Failed to auto-fetch pincode details:", err);
            setPincodeStatus('invalid');
            setPincodeMessage('❌ Connection error checking pincode.');
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === 'pincode') {
            const digits = value.replace(/\D/g, '').slice(0, 6);
            setFormData(prev => ({ ...prev, pincode: digits }));
            if (digits.length === 6) {
                fetchCityStateFromPincode(digits, setFormData);
            }
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    // Real map picked a point: save the exact coordinates and auto-fill the form
    // from the reverse-geocoded address (falling back to existing values). The
    // pincode is run through the same serviceability check as manual entry.
    const handleMapLocation = (data, lat, lng) => {
        if (typeof lat === 'number' && typeof lng === 'number') {
            setLocation({ lat, lng });
        }
        const pin = data.pincode || '';
        const hasNewPincode = /^\d{6}$/.test(pin) && pin !== formData.pincode;
        setFormData(prev => ({
            ...prev,
            area: data.house || prev.area,
            city: data.city || prev.city,
            state: data.state || prev.state,
            landmark: data.landmark || prev.landmark,
            pincode: data.pincode || prev.pincode
        }));
        if (hasNewPincode) {
            fetchCityStateFromPincode(pin, setFormData);
        }
    };

    const handleSave = async () => {
        if (!formData.flatNo.trim()) {
            toast.error("Please enter House/Flat/Office number");
            return;
        }
        if (!formData.area.trim()) {
            toast.error("Please enter Street, Sector, or Colony");
            return;
        }
        if (!formData.city.trim()) {
            toast.error("Please enter your City");
            return;
        }
        if (!formData.state.trim()) {
            toast.error("Please enter your State");
            return;
        }
        if (!formData.pincode || formData.pincode.length !== 6 || !/^\d{6}$/.test(formData.pincode)) {
            toast.error("Please enter a valid 6-digit Pincode");
            return;
        }
        if (pincodeStatus === 'unserviceable') {
            toast.error("Courier service is not available for this location.");
            return;
        }
        if (pincodeStatus === 'invalid') {
            toast.error("Invalid Pincode. Please enter a valid Indian pincode.");
            return;
        }

        const fullAddress = `${formData.flatNo}, ${formData.area}${formData.landmark ? `, Near ${formData.landmark}` : ''}, ${formData.city}, ${formData.state} - ${formData.pincode}`;
        setSaving(true);
        try {
            const res = await apiFetch('/address/add', {
                method: 'POST',
                body: JSON.stringify({
                    latitude: location.lat,
                    longitude: location.lng,
                    address_text: fullAddress,
                    is_default: 1
                })
            });
            if (res.ok) {
                onSelect({ address: fullAddress, latitude: location.lat, longitude: location.lng });
                onClose();
            } else {
                toast.error("Failed to save address");
            }
        } catch (error) {
            console.error("Failed to save address:", error);
            toast.error("Failed to save address");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-[var(--color-surface-card)] w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
                    <h2 className="text-xl font-black text-gray-800 tracking-tight">Select Location</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* Scrollable Form Section */}
                <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
                    {/* Real Interactive Map — tap (or drag) to pick your exact
                        delivery point; address fields auto-fill below. */}
                    <MapPicker onLocationSelect={handleMapLocation} />
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Flat / House No. *</label>
                            <input
                                type="text"
                                name="flatNo"
                                value={formData.flatNo}
                                onChange={handleChange}
                                placeholder="e.g. 202, 2nd Floor"
                                className="w-full px-4 py-3 bg-[var(--color-surface-low)] border-2 border-gray-50 rounded-2xl text-xs font-semibold focus:border-primary/30 focus:bg-[var(--color-surface-card)] focus:outline-none transition-all text-[var(--color-on-surface)]"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Street / Colony *</label>
                            <input
                                type="text"
                                name="area"
                                value={formData.area}
                                onChange={handleChange}
                                placeholder="e.g. Sector 15, Rohini"
                                className="w-full px-4 py-3 bg-[var(--color-surface-low)] border-2 border-gray-50 rounded-2xl text-xs font-semibold focus:border-primary/30 focus:bg-[var(--color-surface-card)] focus:outline-none transition-all text-[var(--color-on-surface)]"
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Landmark</label>
                            <input
                                type="text"
                                name="landmark"
                                value={formData.landmark}
                                onChange={handleChange}
                                placeholder="e.g. Near Metro Station"
                                className="w-full px-4 py-3 bg-[var(--color-surface-low)] border-2 border-gray-50 rounded-2xl text-xs font-semibold focus:border-primary/30 focus:bg-[var(--color-surface-card)] focus:outline-none transition-all text-[var(--color-on-surface)]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Pincode *</label>
                            <input
                                type="tel"
                                name="pincode"
                                value={formData.pincode}
                                onChange={handleChange}
                                placeholder="6-digit Pincode"
                                maxLength="6"
                                className="w-full px-4 py-3 bg-[var(--color-surface-low)] border-2 border-gray-50 rounded-2xl text-xs font-semibold focus:border-primary/30 focus:bg-[var(--color-surface-card)] focus:outline-none transition-all text-[var(--color-on-surface)]"
                                required
                            />
                            {pincodeMessage && (
                                <p className={`text-[9px] font-bold px-1 mt-1 transition-all duration-300 ${
                                    pincodeStatus === 'serviceable' ? 'text-emerald-600' :
                                    pincodeStatus === 'checking' ? 'text-blue-500' : 'text-red-500 animate-pulse'
                                }`}>
                                    {pincodeMessage}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">City *</label>
                            <input
                                type="text"
                                name="city"
                                value={formData.city}
                                onChange={handleChange}
                                placeholder="City"
                                className="w-full px-4 py-3 bg-[var(--color-surface-low)] border-2 border-gray-50 rounded-2xl text-xs font-semibold focus:border-primary/30 focus:bg-[var(--color-surface-card)] focus:outline-none transition-all text-[var(--color-on-surface)]"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">State *</label>
                            <input
                                type="text"
                                name="state"
                                value={formData.state}
                                onChange={handleChange}
                                placeholder="State"
                                className="w-full px-4 py-3 bg-[var(--color-surface-low)] border-2 border-gray-50 rounded-2xl text-xs font-semibold focus:border-primary/30 focus:bg-[var(--color-surface-card)] focus:outline-none transition-all text-[var(--color-on-surface)]"
                                required
                            />
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full py-4 bg-primary text-slate-950 font-black rounded-2xl shadow-xl shadow-primary/20 hover:shadow-primary/40 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:scale-100 text-sm uppercase tracking-widest"
                        >
                            {saving ? (
                                <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-950"></span>
                            ) : (
                                <><Save size={18} /> Save & Continue</>
                            )}
                        </button>
                    </div>
                    <p className="text-[9px] text-center text-gray-400 font-bold uppercase tracking-wider pb-2 flex items-center justify-center gap-1">
                        <Info size={10} /> Fields marked with * are mandatory
                    </p>
                </div>
            </div>
        </div>
    );
}

export default AddressPicker;
