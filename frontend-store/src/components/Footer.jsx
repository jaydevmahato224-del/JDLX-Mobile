import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Twitter, Facebook, Mail, Phone, MapPin, ShieldCheck, Truck, RotateCcw } from 'lucide-react';
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
      {/* Upper Footer: Value Props */}
      <div className="border-b border-slate-50">
        <div className="max-w-[1400px] mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-primary/5 flex items-center justify-center text-primary">
              <Truck size={24} />
            </div>
            <div>
              <h4 className="font-black text-sm uppercase tracking-wider">Swift Delivery</h4>
              <p className="text-xs text-slate-400 font-medium">Premium doorstep service</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-500">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h4 className="font-black text-sm uppercase tracking-wider">Quality Assured</h4>
              <p className="text-xs text-slate-400 font-medium">100% genuine products</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-500">
              <RotateCcw size={24} />
            </div>
            <div>
              <h4 className="font-black text-sm uppercase tracking-wider">Easy Returns</h4>
              <p className="text-xs text-slate-400 font-medium">Hassle-free 7-day policy</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="max-w-[1400px] mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-4 gap-12">
        {/* Brand Section */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20 font-black italic">J</div>
            <span className="text-2xl font-black tracking-tighter">JDLX <span className="text-primary">Mobile</span></span>
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
            <li><Link to="/profile/about-site" className="text-sm font-bold text-slate-600 hover:text-primary transition-colors">Privacy Policy</Link></li>
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
      <div className="border-t border-slate-50 py-8">
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
