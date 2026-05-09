import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, Navigation } from 'lucide-react';

// Fix for default marker icon in Leaflet + React
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

function LocationMarker({ position, setPosition }) {
    useMapEvents({
        click(e) {
            setPosition(e.latlng);
        },
    });

    return position === null ? null : (
        <Marker position={position} />
    );
}

function ChangeView({ center }) {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.setView(center, map.getZoom());
        }
    }, [center, map]);
    return null;
}

export default function MapPicker({ onLocationSelect }) {
    const [position, setPosition] = useState(null);
    const [address, setAddress] = useState('');
    const [loading, setLoading] = useState(false);

    // Default to some central location (e.g., Delhi) if geolocation fails
    const [center, setCenter] = useState([28.6139, 77.2090]);

    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    setCenter([newPos.lat, newPos.lng]);
                    setPosition(newPos);
                },
                () => {
                    console.log("Geolocation blocked or failed.");
                }
            );
        }
    }, []);

    const fetchAddress = useCallback(async (lat, lng) => {
        setLoading(true);
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
            const data = await res.json();
            if (data && data.address) {
                const addr = {
                    full: data.display_name,
                    house: data.address.suburb || data.address.neighbourhood || data.address.road || '',
                    city: data.address.city || data.address.town || data.address.village || '',
                    state: data.address.state || '',
                    pincode: data.address.postcode || '',
                    landmark: data.address.amenity || data.address.landmark || ''
                };
                setAddress(data.display_name);
                onLocationSelect(addr);
            }
        } catch (error) {
            console.error("Geocoding failed:", error);
        } finally {
            setLoading(false);
        }
    }, [onLocationSelect]);

    useEffect(() => {
        if (position) {
            fetchAddress(position.lat, position.lng);
        }
    }, [position, fetchAddress]);

    return (
        <div className="space-y-4">
            <div className="relative h-[300px] w-full overflow-hidden rounded-[24px] border-2 border-[var(--color-surface-high)] shadow-inner">
                <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                    <LocationMarker position={position} setPosition={setPosition} />
                    <ChangeView center={center} />
                </MapContainer>
                
                <div className="absolute bottom-4 left-4 z-[1000]">
                    <button 
                        type="button"
                        onClick={() => {
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition((pos) => {
                                    const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                                    setCenter([newPos.lat, newPos.lng]);
                                    setPosition(newPos);
                                });
                            }
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-lg text-primary hover:bg-slate-50 transition-colors"
                    >
                        <Navigation size={20} />
                    </button>
                </div>

                {!position && (
                    <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-black/20 backdrop-blur-[2px] pointer-events-none">
                        <div className="rounded-2xl bg-white/90 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-900 shadow-xl flex items-center gap-2">
                            <MapPin size={14} className="text-primary animate-bounce" />
                            Tap map to pick location
                        </div>
                    </div>
                )}
            </div>

            {position && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-500">
                    <div className="rounded-2xl bg-[var(--color-surface-low)] p-4 border border-[var(--color-surface-high)]">
                        <div className="flex items-start gap-3">
                            <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--color-on-surface)]/40">Detected Address</div>
                                <p className="text-[12px] font-bold text-[var(--color-on-surface)] leading-relaxed">
                                    {loading ? 'Fetching address details...' : address}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
