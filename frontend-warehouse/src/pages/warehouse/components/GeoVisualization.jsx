import { MapPin } from 'lucide-react'

const GeoVisualization = ({ pincode, radius }) => {
    return (
        <div className="relative overflow-hidden h-full bg-[var(--bg-card)] backdrop-blur-[12px] group rounded-[24px] border border-white/5 shadow-2xl min-h-[400px]">
            <div className="absolute inset-0 opacity-[0.2] transition-all duration-[20s] group-hover:scale-110 group-hover:rotate-1">
                <div className="absolute inset-0 bg-[url('https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/0,0,1/1600x1200?access_token=pk.eyJ1IjoiZGV2LWpkeCIsImEiOiJjbHR6NXE0ZGMwM3R4MmtvOHR6NXE0ZGMwIn0')] bg-cover bg-center grayscale brightness-[0.5] contrast-125" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[#06080a] via-transparent to-[#06080a]/80" />
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative">
                    <div className="absolute inset-0 bg-[var(--accent)]/10 blur-[100px] rounded-full scale-[4] animate-pulse" />
                    <div className="relative h-3 w-3 bg-[var(--accent)] rounded-full border-2 border-white shadow-[0_0_20px_rgba(255,215,0,0.8)] z-10" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[200px] w-[200px] border border-[var(--accent)]/10 rounded-full animate-[ping_4s_linear_infinite]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[400px] border border-[var(--accent)]/5 rounded-full animate-[ping_6s_linear_infinite]" />
                </div>
            </div>

            <div className="absolute top-6 left-8 flex flex-col gap-1.5">
                <h4 className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mb-1">Node Projection</h4>
                <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-black/40 px-4 py-2.5 backdrop-blur-xl shadow-2xl">
                    <div className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--accent)] shadow-[0_0_10px_rgba(255,215,0,0.8)]"></span>
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-primary)] italic">
                        {radius || '4.0'} KM Radius
                    </span>
                </div>
            </div>

            <div className="absolute bottom-6 right-8 flex flex-col items-end gap-2.5">
                <div className="px-4 py-2.5 rounded-2xl bg-black/40 border border-white/5 backdrop-blur-xl shadow-2xl">
                    <div className="flex items-center gap-2.5">
                        <MapPin size={12} className="text-[var(--accent)]" />
                        <span className="text-[9px] font-black text-[var(--text-primary)] uppercase tracking-[0.25em] italic">ACTIVE HUB: {pincode || '832108'}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-[9px] font-black text-slate-600 uppercase tracking-widest bg-black/20 px-3 py-1 rounded-full border border-white/5">
                    <div className="h-1 w-1 bg-emerald-500/50 rounded-full animate-pulse" />
                    Feed Sync Active
                </div>
            </div>
        </div>
    )
}

export default GeoVisualization
