import React, { useEffect, useState } from 'react';
import { MapPin, Navigation, Zap, Clock, CheckCircle2, X, RefreshCw, AlertCircle, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../config';

const LocationManager = () => {
  const { setDeliveryMode, setUserLocation, userLocation, deliveryMode, setNearestStoreId, setIsCheckingLocation } = useStore();
  const [showPrompt, setShowPrompt] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle', 'checking', 'error'
  const [errorMessage, setErrorMessage] = useState('');

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const handleGetLocation = async (isAuto = false) => {
    setStatus('checking');
    setIsCheckingLocation(true);
    if (!isAuto) {
        setShowPrompt(true);
        sessionStorage.setItem('location_prompt_shown', 'true');
    }

    const performVerification = async (lat, lng) => {
      try {
        const settingsRes = await fetch(`${API_BASE_URL}/warehouse/availability?_t=${Date.now()}`);
        const settings = await settingsRes.json();
        
        const isQuickEnabled = settings.quick_mode_enabled === true;
        const maxRadius = settings.quick_delivery_max_distance || 3;

        const response = await fetch(`${API_BASE_URL}/darkstores?_t=${Date.now()}`);
        const stores = await response.json();

        if (!stores || stores.length === 0 || !isQuickEnabled) {
          setDeliveryMode('scheduled');
          setNearestStoreId(null);
          if (isAuto) {
            toast.success("🕐 Scheduled Delivery available in your area", {
                icon: '🗓️',
                style: { borderRadius: '16px', background: '#3b82f6', color: '#fff', fontWeight: 'bold' }
            });
          }
          setShowPrompt(false);
        } else {
          let nearestStore = null;
          let minDistance = Infinity;

          stores.forEach(store => {
            const distance = calculateDistance(lat, lng, store.latitude, store.longitude);
            if (distance < minDistance) {
              minDistance = distance;
              nearestStore = store;
            }
          });

          const effectiveRadius = Math.max(maxRadius, 50.0); 

          if (nearestStore && minDistance <= effectiveRadius) {
            setDeliveryMode('quick');
            setNearestStoreId(nearestStore.id);
            if (isAuto) {
                toast.success("⚡ You qualify for 15-min Quick Delivery!", {
                    icon: '🚀',
                    style: { borderRadius: '16px', background: '#22c55e', color: '#fff', fontWeight: 'bold' }
                });
            }
          } else {
            setDeliveryMode('scheduled');
            setNearestStoreId(null);
            if (isAuto) {
                toast.success("🕐 Scheduled Delivery available in your area", {
                    icon: '🗓️',
                    style: { borderRadius: '16px', background: '#3b82f6', color: '#fff', fontWeight: 'bold' }
                });
            }
          }
          setShowPrompt(false);
        }
      } catch (error) {
        console.error("Error fetching stores:", error);
      } finally {
        setStatus('idle');
        setIsCheckingLocation(false);
      }
    };

    if (isAuto && userLocation?.lat && userLocation?.lng) {
      await performVerification(userLocation.lat, userLocation.lng);
      return;
    }

    if (!navigator.geolocation) {
      setErrorMessage("Geolocation is not supported by your browser.");
      setStatus('error');
      setIsCheckingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        await performVerification(latitude, longitude);
      },
      (error) => {
        let msg = "We couldn't verify your location.";
        if (error.code === 1) msg = "Location access denied. Please enable it in browser settings.";
        else if (error.code === 2) msg = "Position unavailable. Check your device GPS.";
        else if (error.code === 3) msg = "Location check timed out.";
        
        setErrorMessage(msg);
        setStatus('error');
        setIsCheckingLocation(false);
        if (!userLocation) {
            setDeliveryMode('scheduled');
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  };

  useEffect(() => {
    const checkPermissionAndDetect = async () => {
      try {
        if (!navigator.geolocation) return;
        
        const hasExplicitlyDenied = localStorage.getItem('location_permission_denied') === 'true';
        const promptShownThisSession = sessionStorage.getItem('location_prompt_shown') === 'true';
        const bannerShownThisSession = sessionStorage.getItem('location_banner_shown') === 'true';

        if (userLocation) {
          handleGetLocation(true);
          return;
        }

        const permission = await navigator.permissions.query({ name: 'geolocation' });
        
        if (permission.state === 'granted') {
          handleGetLocation(true);
        } else if (hasExplicitlyDenied) {
          if (!bannerShownThisSession) {
            setShowBanner(true);
            sessionStorage.setItem('location_banner_shown', 'true');
          }
        } else if (!promptShownThisSession) {
          const timer = setTimeout(() => setShowPrompt(true), 1500);
          return () => clearTimeout(timer);
        }
      } catch (err) {
        if (!userLocation && !sessionStorage.getItem('location_prompt_shown')) {
          const timer = setTimeout(() => setShowPrompt(true), 1500);
          return () => clearTimeout(timer);
        }
      }
    };
    
    checkPermissionAndDetect();

    const interval = setInterval(() => {
      if (userLocation) handleGetLocation(true);
    }, 120000);

    return () => clearInterval(interval);
  }, [userLocation]);

  return (
    <>
      {showBanner && !showPrompt && (
        <div className="fixed top-[var(--app-header-height)] inset-x-0 z-[60] flex justify-center p-4 animate-in slide-in-from-top duration-500">
            <div className="w-full max-w-xl bg-slate-900/90 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                        <MapPin size={16} />
                    </div>
                    <p className="text-[11px] font-bold tracking-tight">📍 Location access off - Enable for Quick Delivery eligibility check</p>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => {
                            setShowBanner(false);
                            handleGetLocation();
                        }}
                        className="text-[10px] font-black uppercase tracking-widest bg-primary text-[var(--color-on-primary)] px-3 py-1.5 rounded-lg hover:opacity-90 transition-all"
                    >
                        Enable
                    </button>
                    <button onClick={() => setShowBanner(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                        <X size={16} />
                    </button>
                </div>
            </div>
        </div>
      )}

      {showPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-500">
          <div className="ui-card-premium w-full max-w-sm p-8 space-y-6 text-center reveal-premium relative overflow-hidden">
            {status === 'checking' && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center space-y-4 animate-in fade-in duration-300">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                  <MapPin className="absolute inset-0 m-auto text-primary animate-bounce" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Checking Eligibility</h3>
                  <p className="text-xs text-slate-500 font-bold tracking-tight">Verifying your delivery zone...</p>
                </div>
              </div>
            )}

            <div className="flex justify-center">
              <div className="relative">
                <div className={`absolute inset-0 rounded-full blur-2xl animate-pulse ${status === 'error' ? 'bg-rose-500/20' : 'bg-primary/20'}`} />
                <div className={`relative h-20 w-20 rounded-3xl flex items-center justify-center text-[var(--color-on-primary)] shadow-2xl rotate-12 transition-colors duration-500 ${status === 'error' ? 'bg-rose-500 shadow-rose-500/40 text-white' : 'bg-primary shadow-primary/40'}`}>
                  {status === 'error' ? <AlertCircle size={40} /> : <MapPin size={40} />}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">
                {status === 'error' ? 'Oops! Location Error' : 'Delivery Zone Check'}
              </h2>
              <p className="text-sm text-slate-500 font-medium px-2">
                {status === 'error' 
                  ? errorMessage 
                  : 'Grant location access to see if you qualify for 15-min Quick Delivery.'}
              </p>
            </div>

            {status !== 'error' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center gap-2">
                  <Zap size={20} className="text-primary" />
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Under 3km</div>
                  <div className="text-xs font-bold text-slate-700">Quick Delivery</div>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center gap-2">
                  <Clock size={20} className="text-slate-400" />
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Over 3km</div>
                  <div className="text-xs font-bold text-slate-700">Scheduled</div>
                </div>
              </div>
            ) : (
              <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-left flex items-start gap-3">
                 <div className="h-8 w-8 shrink-0 rounded-full bg-white flex items-center justify-center text-rose-500 shadow-sm">
                    <Navigation size={16} />
                 </div>
                 <div>
                    <p className="text-xs font-bold text-rose-900 leading-tight">Quick Fix</p>
                    <p className="text-[10px] font-medium text-rose-700 mt-0.5">Please check your browser location settings and try again.</p>
                 </div>
              </div>
            )}

            <div className="space-y-3 pt-2">
              {status === 'error' ? (
                <button
                  onClick={() => handleGetLocation()}
                  className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:opacity-90 active:scale-95 transition-all"
                >
                  <RefreshCw size={20} />
                  Try Again
                </button>
              ) : (
                <button
                  onClick={() => handleGetLocation()}
                  className="w-full h-14 rounded-2xl bg-primary text-[var(--color-on-primary)] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:opacity-90 active:scale-95 transition-all"
                >
                  <Navigation size={20} />
                  Check Eligibility
                </button>
              )}
              
              <button
                onClick={() => {
                    setShowPrompt(false);
                    setDeliveryMode('scheduled');
                    localStorage.setItem('location_permission_denied', 'true');
                    sessionStorage.setItem('location_prompt_shown', 'true');
                    
                    toast.success("Continuing with Scheduled Delivery", {
                        icon: '🗓️',
                        style: { borderRadius: '16px', background: '#0f172a', color: '#fff' }
                    });
                }}
                className="w-full py-2 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-600 transition-colors group"
              >
                Continue with Scheduled
                <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LocationManager;
