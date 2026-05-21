import { memo } from 'react';
import { ChevronRight, Zap } from 'lucide-react';

const PromoBanner = memo(function PromoBanner({ title, subtitle, cta, image, badge, badge_text, gradient, overlay_opacity = 0.5, onClick, priority = false }) {
  const displayBadge = badge || badge_text;

  return (
    <div 
      className={`relative w-full h-[240px] md:h-[400px] rounded-[32px] md:rounded-[40px] overflow-hidden group cursor-pointer shadow-2xl transition-all duration-700 hover:scale-[1.01] ${gradient || 'bg-slate-900'}`}
      onClick={onClick}
    >
      {/* Background Image with Overlay */}
      {image && (
        <div className="absolute inset-0 z-0">
          <img 
            src={image} 
            alt={title} 
            className="w-full h-full object-cover opacity-60 group-hover:scale-110 transition-transform duration-[2000ms]" 
            decoding="async"
            loading={priority ? "eager" : "lazy"}
            fetchpriority={priority ? "high" : "auto"}
          />
          <div className="absolute inset-0" style={{ background: `linear-gradient(to right, rgba(0,0,0,${overlay_opacity + 0.2}), rgba(0,0,0,${overlay_opacity / 2}))` }} />
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-16 max-w-2xl animate-in fade-in slide-in-from-left-12 duration-1000">
        {displayBadge && (
          <div className="inline-flex items-center gap-1.5 px-3 md:px-4 py-1.5 md:py-2 bg-white/20 backdrop-blur-md rounded-full border border-white/30 mb-3 md:mb-6 w-fit animate-pulse-soft">
            <Zap size={12} className="text-yellow-400 fill-yellow-400" />
            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] !text-white">{displayBadge}</span>
          </div>
        )}

        <h2 className="text-2xl md:text-5xl font-black !text-white mb-2 md:mb-4 tracking-tighter leading-[1.1]" style={{ fontFamily: 'Manrope, sans-serif', textShadow: '0 2px 20px rgba(0,0,0,0.8)' }}>
          {title}
        </h2>
        
        <p className="!text-white text-sm md:text-xl font-bold mb-6 md:mb-10 max-w-md leading-relaxed line-clamp-2 md:line-clamp-none" style={{ textShadow: '0 1px 10px rgba(0,0,0,0.7)' }}>
          {subtitle}
        </p>

        <button className="flex items-center gap-2 md:gap-3 px-5 md:px-8 py-3 md:py-4 bg-white text-slate-900 rounded-xl md:rounded-2xl font-black uppercase tracking-widest text-[10px] md:text-xs hover:bg-slate-900 hover:text-white transition-all shadow-xl group/btn w-fit active:scale-95">
          {cta || 'Explore Now'}
          <ChevronRight size={16} className="group-hover/btn:translate-x-1 transition-transform" />
        </button>
      </div>

      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      <div className="absolute bottom-10 right-10 flex gap-1 items-center opacity-40">
         {[...Array(3)].map((_, i) => (
           <div key={i} className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
         ))}
      </div>
    </div>
  );
});

export default PromoBanner;
