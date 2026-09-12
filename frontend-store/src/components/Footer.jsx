import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Twitter, Facebook, Mail, Phone, MapPin } from 'lucide-react';
import { API_BASE_URL } from '../config';

const Footer = () => {
  const [settings, setSettings] = useState({
    footer_email: 'support@jdlxmobile.com',
    footer_phone: '+91 98765 43210',
    footer_address: 'JDLX Premium Hub, Digital Estate, New Delhi',
    footer_insta_url: '',
    footer_twitter_url: '',
    footer_fb_url: '',
    footer_brand_story: 'Redefining mobile luxury with curated accessories and premium electronics. The gold standard for modern device enthusiasts.'
  });

  useEffect(() => {
    fetch(`${API_BASE_URL}/settings`)
      .then(res => res.json())
      .then(json => {
        if (json?.success && json.data) {
          setSettings(prev => ({
            ...prev,
            ...json.data
          }));
        }
      })
      .catch(err => console.error('Failed to load footer settings:', err));
  }, []);

  return (
    <footer className="bg-[var(--color-surface-white)] border-t border-slate-100 mt-20">
      {/* Main Footer Content */}
      <div className="max-w-[1400px] mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-4 gap-12">
        {/* Brand Section */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <img 
              src="/logo192.png" 
              alt="JDLX Logo" 
              className="h-10 w-10 object-contain shadow-lg shadow-primary/10 rounded-xl"
            />
            <span className="text-2xl font-black tracking-tighter">
              <span className="text-[var(--color-on-surface)]">JDLX</span> <span className="text-primary">Mobile</span>
            </span>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed font-medium">
            {settings.footer_brand_story}
          </p>
          <div className="flex gap-4">
            {settings.footer_insta_url && (
              <a href={settings.footer_insta_url} target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full border border-slate-100 flex items-center justify-center text-slate-400 hover:text-primary hover:border-primary/20 transition-all">
                <Instagram size={18} />
              </a>
            )}
            {settings.footer_twitter_url && (
              <a href={settings.footer_twitter_url} target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full border border-slate-100 flex items-center justify-center text-slate-400 hover:text-primary hover:border-primary/20 transition-all">
                <Twitter size={18} />
              </a>
            )}
            {settings.footer_fb_url && (
              <a href={settings.footer_fb_url} target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full border border-slate-100 flex items-center justify-center text-slate-400 hover:text-primary hover:border-primary/20 transition-all">
                <Facebook size={18} />
              </a>
            )}
          </div>
        </div>

        {/* Quick Links */}
        <div className="space-y-6">
          <h4 className="font-black text-xs uppercase tracking-[0.2em] text-slate-400">Navigation</h4>
          <ul className="space-y-4">
            <li><Link to="/" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Home</Link></li>
            <li><Link to="/search" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Elite Catalog</Link></li>
            <li><Link to="/profile/orders" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Track Order</Link></li>
            <li><Link to="/profile/wishlist" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Your Favorites</Link></li>
          </ul>
        </div>

        {/* Support */}
        <div className="space-y-6">
          <h4 className="font-black text-xs uppercase tracking-[0.2em] text-slate-400">Support</h4>
          <ul className="space-y-4">
            <li><Link to="/profile/support" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Help Center</Link></li>
            <li><Link to="/profile/bug-report" className="text-sm font-bold text-slate-600 hover:text-red-500 transition-colors">Report a bug</Link></li>
            <li><Link to="/profile/terms" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Terms of Service</Link></li>
            <li><Link to="/profile/privacy" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Privacy Policy</Link></li>
            <li><Link to="/profile/support" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Shipping Policy</Link></li>
          </ul>
        </div>

        {/* Contact */}
        <div className="space-y-6">
          <h4 className="font-black text-xs uppercase tracking-[0.2em] text-slate-400">Contact Us</h4>
          <ul className="space-y-4">
            <li className="flex items-center gap-3 text-sm font-bold text-slate-600">
              <Mail size={16} className="text-primary" />
              {settings.footer_email}
            </li>
            <li className="flex items-center gap-3 text-sm font-bold text-slate-600">
              <Phone size={16} className="text-primary" />
              {settings.footer_phone}
            </li>
            <li className="flex items-start gap-3 text-sm font-bold text-slate-600">
              <MapPin size={16} className="text-primary mt-1" />
              <span className="whitespace-pre-line">{settings.footer_address}</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-slate-50 py-8 pb-28 md:pb-8">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs font-bold text-slate-400">
            © {new Date().getFullYear()} JDLX Mobile Elite. All rights reserved.
          </p>
          <div className="flex gap-6">
            <img src="https://img.icons8.com/color/48/visa.png" className="h-5 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all" alt="Visa" />
            <img src="https://img.icons8.com/color/48/mastercard.png" className="h-5 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all" alt="Mastercard" />
            <img src="https://img.icons8.com/color/48/google-pay.png" className="h-5 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all" alt="GPay" />
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
