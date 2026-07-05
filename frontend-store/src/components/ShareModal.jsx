import React, { useMemo } from 'react';
import { X, MessageCircle, Send, Facebook, Twitter, Link as LinkIcon } from 'lucide-react';
import { getProductShareUrl } from '../utils/productSlug';

const ShareModal = ({ isOpen, onClose, product, url }) => {
  const origin = useMemo(() => (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
    ? window.location.origin 
    : 'https://jdlxmobile.in', []);

  // Use short share URL format for social sharing
  const internalShareUrl = useMemo(() => getProductShareUrl(product, origin), [product, origin]);

  const shareUrl = url || internalShareUrl;
    
  const premiumText = useMemo(() => {
    if (!product) return '';
    return `Check out ${product.name} for just ₹${product.price} on JDLX - Premium Mobile Essentials. ✨`;
  }, [product]);

  const shareOptions = useMemo(() => [
    {
      name: 'WhatsApp',
      icon: MessageCircle,
      color: 'bg-[#25D366]',
      url: `https://wa.me/?text=${encodeURIComponent(premiumText + ' ' + shareUrl)}`,
    },
    {
      name: 'Telegram',
      icon: Send,
      color: 'bg-[#0088cc]',
      url: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(premiumText)}`,
    },
    {
      name: 'X / Twitter',
      icon: Twitter,
      color: 'bg-[#000000]',
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(premiumText)}&url=${encodeURIComponent(shareUrl)}`,
    },
    {
      name: 'Facebook',
      icon: Facebook,
      color: 'bg-[#1877F2]',
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
  ], [shareUrl, premiumText]);

  if (!isOpen || !product) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" 
        onClick={onClose} 
      />
      
      {/* Modal Content */}
      <div className="relative w-full max-w-md bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-8 sm:zoom-in-95 duration-500">
        <div className="bg-slate-900 p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <LinkIcon size={20} className="text-primary" />
            </div>
            <div>
              <h3 className="text-xl font-black tracking-tight">Share Product</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Premium Selection</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-8">
          <div className="grid grid-cols-4 gap-4">
            {shareOptions.map((option) => (
              <a
                key={option.name}
                href={option.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 group"
                onClick={() => setTimeout(onClose, 500)}
              >
                <div className={`${option.color} w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg group-hover:shadow-xl group-active:scale-90 transition-all duration-500 cubic-bezier-[0.34,1.56,0.64,1]`}>
                  <option.icon size={24} className="group-hover:scale-110 transition-transform duration-300" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 text-center">
                  {option.name}
                </span>
              </a>
            ))}
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            JDLX Luxury Experience
          </p>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;

