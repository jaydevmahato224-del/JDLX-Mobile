import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { User, Mail, Shield, MapPin, Phone, Building, Calendar, Award, ChevronLeft } from 'lucide-react';

function ProfileField({ icon, label, value, color = "amber" }) {
    const iconNode = icon
        ? React.createElement(icon, { className: `w-6 h-6 text-${color}-400` })
        : null;

    return (
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all group">
            <div className={`w-12 h-12 rounded-xl bg-${color}-500/10 flex items-center justify-center border border-${color}-500/20 group-hover:scale-110 transition-transform`}>
                {iconNode}
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{label}</span>
                <span className="text-sm font-bold text-slate-200">{value || 'Not provided'}</span>
            </div>
        </div>
    );
}

export default function WarehouseProfile() {
    const user = useStore((state) => state.warehouseUser);
    const navigate = useNavigate();
    const profileKycStatus = (user?.profile_kyc_status || 'verified').toLowerCase();
    const isProfilePending = profileKycStatus === 'pending';

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Navigation Header */}
            <div className="flex items-center gap-4">
                <button 
                    onClick={() => navigate(-1)}
                    className="p-3 rounded-2xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 group"
                >
                    <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-sm font-bold pr-2">Back</span>
                </button>
            </div>

            {/* Header Hero */}
            <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-[#1e293b] to-[#0f172a] border border-white/5 p-8 lg:p-12">
                <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 blur-[100px] -mr-48 -mt-48 rounded-full" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 blur-[80px] -ml-32 -mb-32 rounded-full" />
                
                <div className="relative flex flex-col md:flex-row items-center gap-8">
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-tr from-amber-500 to-orange-500 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                        <div className="relative w-32 h-32 md:w-40 md:h-40 bg-[#0f172a] border-2 border-white/10 rounded-3xl flex items-center justify-center text-5xl md:text-6xl font-black text-amber-500 shadow-2xl">
                            {user?.owner_name?.charAt(0) || 'W'}
                        </div>
                        <div className={`absolute -bottom-2 -right-2 w-10 h-10 border-4 border-[#0f172a] rounded-full flex items-center justify-center shadow-lg ${isProfilePending ? 'bg-amber-500' : 'bg-green-500'}`}>
                            <Shield className="w-4 h-4 text-white" />
                        </div>
                    </div>

                    <div className="flex-1 text-center md:text-left space-y-4">
                        <div className="space-y-1">
                            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
                                {user?.owner_name || 'Warehouse Partner'}
                            </h1>
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                                <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-black uppercase tracking-widest">
                                    {user?.role?.replace('_', ' ') || 'Partner'}
                                </span>
                                <span className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-widest">
                                    ID: {user?.partner_id || '953210'}
                                </span>
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isProfilePending ? 'bg-amber-500/10 border border-amber-400/30 text-amber-300' : 'bg-emerald-500/10 border border-emerald-400/30 text-emerald-300'}`}>
                                    {isProfilePending ? 'Profile Pending' : 'Profile Verified'}
                                </span>
                            </div>
                        </div>
                        <p className="text-slate-400 text-sm max-w-xl leading-relaxed font-medium">
                            Official warehouse partner of JDLX Logistics. Authorized to manage inventory, 
                            fulfill orders, and track fulfillment metrics for your assigned dark store.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Personal Information */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white/5 border border-white/5 rounded-[2rem] p-8 space-y-6 backdrop-blur-sm">
                        <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                            <User className="w-5 h-5 text-amber-500" />
                            <h2 className="text-lg font-black text-white tracking-tight uppercase tracking-[0.1em]">Partner Details</h2>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <ProfileField icon={User} label="Full Name" value={user?.owner_name} />
                            <ProfileField icon={Mail} label="Email Address" value={user?.email} color="blue" />
                            <ProfileField icon={Phone} label="Contact Number" value={user?.phone || '+91 98765 43210'} color="emerald" />
                            <ProfileField icon={MapPin} label="Location" value={user?.location || 'New Delhi, India'} color="rose" />
                        </div>
                    </div>

                    <div className="bg-white/5 border border-white/5 rounded-[2rem] p-8 space-y-6 backdrop-blur-sm">
                        <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                            <Building className="w-5 h-5 text-amber-500" />
                            <h2 className="text-lg font-black text-white tracking-tight uppercase tracking-[0.1em]">Warehouse Status</h2>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <ProfileField icon={Award} label="Partner Tier" value="Elite Partner" color="amber" />
                            <ProfileField icon={Calendar} label="Member Since" value="March 2024" color="purple" />
                            <ProfileField icon={Shield} label="KYC Profile" value={isProfilePending ? 'Profile Pending' : 'Profile Verified'} color={isProfilePending ? 'amber' : 'emerald'} />
                        </div>
                    </div>
                </div>

                {/* Sidebar Stats/Security */}
                <div className="space-y-6">
                    <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-[2rem] p-8 text-slate-900 shadow-2xl shadow-amber-500/10">
                        <h3 className="text-xl font-black mb-2">Operational Score</h3>
                        <p className="text-slate-900/60 text-xs font-bold uppercase tracking-widest mb-6">Performance Rating</p>
                        
                        <div className="flex items-end gap-2">
                            <span className="text-6xl font-black leading-none tracking-tighter">9.8</span>
                            <span className="text-xl font-bold mb-1">/10</span>
                        </div>
                        
                        <div className="mt-8 pt-8 border-t border-slate-900/10 space-y-4">
                            <div className="flex justify-between items-center text-sm font-bold">
                                <span>Efficiency</span>
                                <span>99%</span>
                            </div>
                            <div className="w-full h-2 bg-slate-900/10 rounded-full overflow-hidden">
                                <div className="w-[99%] h-full bg-slate-900" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white/5 border border-white/5 rounded-[2rem] p-6 space-y-4">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] px-2">Account Security</h4>
                        <button className="w-full flex items-center justify-between px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-all font-bold text-sm">
                            <div className="flex items-center gap-3">
                                <Shield className="w-4 h-4" />
                                <span>Two-Factor Auth</span>
                            </div>
                            <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest">Active</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
