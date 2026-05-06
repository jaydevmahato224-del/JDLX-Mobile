import { useState, useEffect } from 'react'
import { MapPin, Navigation, X, Check, Search, Save } from 'lucide-react'
import { API_BASE_URL } from '../config'

function AddressPicker({ onSelect, onClose }) {
    const [location, setLocation] = useState({ lat: 28.6139, lng: 77.2090 }); // Default Delhi
    const [addressText, setAddressText] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const detectLocation = () => {
        setLoading(true);
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                const { latitude, longitude } = position.coords;
                setLocation({ lat: latitude, lng: longitude });
                // In a real app, we would reverse geocode here.
                // For now, we simulate a premium "Detected Address"
                setAddressText(`Detected Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
                setLoading(false);
            }, (error) => {
                console.error("GPS Error:", error);
                setLoading(false);
            });
        } else {
            alert("Geolocation is not supported by this browser.");
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!addressText) return;
        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/address/add`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    latitude: location.lat,
                    longitude: location.lng,
                    address_text: addressText,
                    is_default: 1
                })
            });
            if (res.ok) {
                const data = await res.json();
                onSelect({ address: addressText, latitude: location.lat, longitude: location.lng });
                onClose();
            }
        } catch (error) {
            console.error("Failed to save address:", error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
                    <h2 className="text-xl font-black text-gray-800 tracking-tight">Select Location</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* Simulated Map View */}
                <div className="relative h-64 bg-gray-100 flex items-center justify-center overflow-hidden">
                    {/* Visual Grid Mockup */}
                    <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

                    {/* Draggable Circle Mockup */}
                    <div className="relative group cursor-move">
                        <div className="w-12 h-12 bg-primary/20 rounded-full animate-ping absolute -inset-0 border-2 border-primary"></div>
                        <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-white shadow-lg relative z-10 scale-110">
                            <MapPin size={24} />
                        </div>
                    </div>

                    <p className="absolute bottom-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-[10px] font-bold text-gray-400 shadow-sm border border-gray-100">
                        {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                    </p>

                    <button
                        onClick={detectLocation}
                        className="absolute bottom-4 right-4 p-3 bg-white text-primary rounded-full shadow-xl hover:scale-105 transition-transform border border-gray-100 active:scale-95"
                    >
                        <Navigation size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Form Section */}
                <div className="p-6 space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Delivery Address</label>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                            <input
                                type="text"
                                value={addressText}
                                onChange={(e) => setAddressText(e.target.value)}
                                placeholder="House No, Floor, Landmark..."
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-gray-50 rounded-2xl text-sm font-medium focus:border-primary/30 focus:bg-white focus:outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={!addressText || saving}
                            className="w-full py-4 bg-primary text-white font-black rounded-2xl shadow-xl shadow-primary/20 hover:shadow-primary/40 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:scale-100"
                        >
                            {saving ? (
                                <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
                            ) : (
                                <><Save size={20} /> Save & Continue</>
                            )}
                        </button>
                    </div>
                    <p className="text-[10px] text-center text-gray-400 font-medium pb-2">Your location data is encrypted and used only for delivery optimization.</p>
                </div>
            </div>
        </div>
    );
}

export default AddressPicker;
