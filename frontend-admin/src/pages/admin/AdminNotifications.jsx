import { useState, useEffect } from 'react'
import { Bell, Mail, Edit, Save, X, AlertCircle, Info, CheckCircle2, Send, Smartphone, Users } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

export default function AdminNotifications() {
    const token = useStore((state) => state.adminToken);
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingTemplate, setEditingTemplate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    // Broadcast composer state (in-app + push, and email)
    const [broadcast, setBroadcast] = useState({ title: '', message: '', type: 'SYSTEM', send_push: true });
    const [emailBroadcast, setEmailBroadcast] = useState({ subject: '', message: '', app_installed_only: false });
    const [sendingInApp, setSendingInApp] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);

    useEffect(() => {
        fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
    }, []);

    const sendInAppBroadcast = async (e) => {
        e.preventDefault();
        if (!broadcast.title || !broadcast.message) {
            setMessage({ type: 'error', text: 'Title and message are required' });
            return;
        }
        setSendingInApp(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin/notifications/in-app-broadcast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(broadcast),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Broadcast failed');
            setMessage({ type: 'success', text: data.message || 'Broadcast sent!' });
            setBroadcast({ title: '', message: '', type: 'SYSTEM', send_push: true });
            setTimeout(() => setMessage(null), 4000);
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSendingInApp(false);
        }
    };

    const sendEmailBroadcast = async (e) => {
        e.preventDefault();
        if (!emailBroadcast.subject || !emailBroadcast.message) {
            setMessage({ type: 'error', text: 'Subject and message are required' });
            return;
        }
        setSendingEmail(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin/notifications/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(emailBroadcast),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Email broadcast failed');
            setMessage({ type: 'success', text: data.message || 'Email broadcast started!' });
            setEmailBroadcast({ subject: '', message: '', app_installed_only: false });
            setTimeout(() => setMessage(null), 4000);
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSendingEmail(false);
        }
    };

    const fetchTemplates = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_BASE_URL}/admin/notification-templates`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                setTemplates(data);
            }
        } catch (error) {
            console.error('Failed to fetch templates:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin/notification-templates/${editingTemplate.template_key}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editingTemplate)
            });
            if (res.ok) {
                setMessage({ type: 'success', text: 'Template updated successfully!' });
                setEditingTemplate(null);
                fetchTemplates();
                setTimeout(() => setMessage(null), 3000);
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.error || 'Update failed' });
            }
        } catch {
            setMessage({ type: 'error', text: 'Connection error' });
        } finally {
            setSaving(false);
        }
    };

    const getPlaceholderGuide = (key) => {
        if (key.includes('low_stock')) {
            return ['{user_name}', '{product_name}', '{stock_left}'];
        }
        if (key.includes('order')) {
            return ['{order_id}'];
        }
        if (key.includes('review')) {
            return ['{user_name}', '{product_name}'];
        }
        return [];
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        <Bell className="w-8 h-8 text-primary" />
                        Notification Control
                    </h1>
                    <p className="mt-2 text-slate-500 font-medium italic">
                        Customize how JDLX Mobile communicates with users.
                    </p>
                </div>
            </header>

            {message && (
                <div className={`p-4 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 ${
                    message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-red-50 text-red-800 border border-red-100'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    <span className="font-bold">{message.text}</span>
                </div>
            )}

            {/* Send broadcast to users */}
            <section className="bg-white rounded-[2rem] p-6 md:p-8 border border-slate-200 shadow-sm">
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-3 mb-2">
                    <Send className="w-6 h-6 text-primary" />
                    Send Notification to Users
                </h2>
                <p className="text-sm text-slate-500 font-medium mb-6">
                    Broadcast an in-app notification (optionally to phones via web push) to all users, or send an email
                    to everyone — including users who installed the app and later uninstalled, who can no longer be
                    reached by push.
                </p>
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* In-app + push broadcast */}
                    <form onSubmit={sendInAppBroadcast} className="space-y-4 p-5 rounded-2xl bg-slate-50/70 border border-slate-100">
                        <h3 className="font-black text-slate-800 flex items-center gap-2">
                            <Smartphone className="w-4 h-4 text-purple-600" /> In-App + Push Broadcast
                        </h3>
                        <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-widest text-slate-400">Title</label>
                            <input
                                type="text"
                                value={broadcast.title}
                                onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })}
                                placeholder="e.g. Flash Sale is Live!"
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white focus:border-primary outline-none font-bold text-slate-700 transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-widest text-slate-400">Message</label>
                            <textarea
                                value={broadcast.message}
                                onChange={(e) => setBroadcast({ ...broadcast, message: e.target.value })}
                                rows="3"
                                placeholder="Notification text…"
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white focus:border-primary outline-none font-bold text-slate-700 transition-all resize-none"
                            />
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="space-y-2 flex-1">
                                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Type</label>
                                <select
                                    value={broadcast.type}
                                    onChange={(e) => setBroadcast({ ...broadcast, type: e.target.value })}
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white outline-none font-bold text-slate-700 transition-all"
                                >
                                    <option value="SYSTEM">System</option>
                                    <option value="PROMO">Promo</option>
                                    <option value="ORDER">Order</option>
                                    <option value="ALERT">Alert</option>
                                </select>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer mt-5">
                                <input
                                    type="checkbox"
                                    checked={broadcast.send_push}
                                    onChange={(e) => setBroadcast({ ...broadcast, send_push: e.target.checked })}
                                    className="w-4 h-4 accent-primary"
                                />
                                <span className="text-xs font-bold text-slate-600">Also send to phones (push)</span>
                            </label>
                        </div>
                        <button
                            type="submit"
                            disabled={sendingInApp}
                            className="w-full py-3.5 rounded-2xl bg-purple-600 text-white font-black hover:bg-purple-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {sendingInApp ? 'Sending…' : <><Send className="w-4 h-4" /> Send to All Users</>}
                        </button>
                    </form>

                    {/* Email broadcast */}
                    <form onSubmit={sendEmailBroadcast} className="space-y-4 p-5 rounded-2xl bg-slate-50/70 border border-slate-100">
                        <h3 className="font-black text-slate-800 flex items-center gap-2">
                            <Mail className="w-4 h-4 text-blue-600" /> Email Broadcast
                        </h3>
                        <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-widest text-slate-400">Email Subject</label>
                            <input
                                type="text"
                                value={emailBroadcast.subject}
                                onChange={(e) => setEmailBroadcast({ ...emailBroadcast, subject: e.target.value })}
                                placeholder="e.g. Big News from JDLX!"
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white focus:border-primary outline-none font-bold text-slate-700 transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-widest text-slate-400">Message (HTML allowed)</label>
                            <textarea
                                value={emailBroadcast.message}
                                onChange={(e) => setEmailBroadcast({ ...emailBroadcast, message: e.target.value })}
                                rows="3"
                                placeholder="Your announcement…"
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white focus:border-primary outline-none font-bold text-slate-700 transition-all resize-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-widest text-slate-400">Recipients</label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setEmailBroadcast({ ...emailBroadcast, app_installed_only: false })}
                                    className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-black transition-all border ${
                                        !emailBroadcast.app_installed_only
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                                    }`}
                                >
                                    All Users
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEmailBroadcast({ ...emailBroadcast, app_installed_only: true })}
                                    className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-black transition-all border ${
                                        emailBroadcast.app_installed_only
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                                    }`}
                                >
                                    App-Installed Users
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                                <Users className="inline w-3 h-3 mr-1" />
                                “App-Installed Users” emails only those who installed the app (and may have uninstalled) —
                                push can’t reach them, email can. This list grows as users install the app.
                            </p>
                        </div>
                        <button
                            type="submit"
                            disabled={sendingEmail}
                            className="w-full py-3.5 rounded-2xl bg-blue-600 text-white font-black hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {sendingEmail ? 'Sending…' : <><Send className="w-4 h-4" /> Send Email</>}
                        </button>
                    </form>
                </div>
            </section>

            {loading ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-48 bg-slate-100 animate-pulse rounded-3xl" />
                    ))}
                </div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {templates.map((tpl) => (
                        <div key={tpl.template_key} className="group relative bg-white rounded-[2rem] p-6 border border-slate-200 shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-300">
                            <div className="flex items-start justify-between mb-4">
                                <div className={`p-3 rounded-2xl ${tpl.type === 'email' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                                    {tpl.type === 'email' ? <Mail className="w-6 h-6" /> : <Bell className="w-6 h-6" />}
                                </div>
                                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${tpl.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {tpl.is_active ? 'Active' : 'Inactive'}
                                </div>
                            </div>

                            <h3 className="text-lg font-black text-slate-900 mb-1">{tpl.title || tpl.template_key}</h3>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Key: {tpl.template_key}</p>
                            
                            <p className="text-sm text-slate-600 line-clamp-3 mb-6 min-h-[4.5rem]">
                                {tpl.message}
                            </p>

                            <button 
                                onClick={() => setEditingTemplate({ ...tpl })}
                                className="w-full py-3 rounded-2xl bg-slate-50 text-slate-600 font-bold text-sm hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-2 border border-slate-100"
                            >
                                <Edit className="w-4 h-4" /> Edit Template
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Edit Modal */}
            {editingTemplate && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-6 md:p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                                    <Edit className="w-6 h-6 text-primary" />
                                    Edit Template
                                </h2>
                                <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">{editingTemplate.template_key}</p>
                            </div>
                            <button onClick={() => setEditingTemplate(null)} className="p-2 hover:bg-white rounded-full transition-colors">
                                <X className="w-6 h-6 text-slate-400" />
                            </button>
                        </div>

                        <form onSubmit={handleUpdate} className="p-6 md:p-8 space-y-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Display Title</label>
                                    <input 
                                        id="template-title-editor"
                                        type="text"
                                        value={editingTemplate.title || ''}
                                        onChange={e => setEditingTemplate({...editingTemplate, title: e.target.value})}
                                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-primary outline-none font-bold text-slate-700 transition-all"
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        {getPlaceholderGuide(editingTemplate.template_key).map(tag => (
                                            <button
                                                key={`title-${tag}`}
                                                type="button"
                                                onClick={() => {
                                                    const input = document.getElementById('template-title-editor');
                                                    const start = input.selectionStart;
                                                    const end = input.selectionEnd;
                                                    const text = editingTemplate.title || '';
                                                    const before = text.substring(0, start);
                                                    const after = text.substring(end);
                                                    const newValue = before + tag + after;
                                                    setEditingTemplate({ ...editingTemplate, title: newValue });
                                                    setTimeout(() => {
                                                        input.focus();
                                                        input.setSelectionRange(start + tag.length, start + tag.length);
                                                    }, 0);
                                                }}
                                                className="px-2 py-1 rounded-lg bg-primary/5 text-primary text-[9px] font-black uppercase tracking-wider hover:bg-primary hover:text-white transition-all border border-primary/10"
                                            >
                                                + {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Status</label>
                                    <select 
                                        value={editingTemplate.is_active}
                                        onChange={e => setEditingTemplate({...editingTemplate, is_active: parseInt(e.target.value)})}
                                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-primary outline-none font-bold text-slate-700 transition-all"
                                    >
                                        <option value={1}>Active (Enabled)</option>
                                        <option value={0}>Inactive (Disabled)</option>
                                    </select>
                                </div>
                            </div>

                            {editingTemplate.type === 'email' && (
                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Email Subject</label>
                                    <input 
                                        id="template-subject-editor"
                                        type="text"
                                        value={editingTemplate.subject || ''}
                                        onChange={e => setEditingTemplate({...editingTemplate, subject: e.target.value})}
                                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-primary outline-none font-bold text-slate-700 transition-all"
                                        placeholder="Enter catchy email subject..."
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        {getPlaceholderGuide(editingTemplate.template_key).map(tag => (
                                            <button
                                                key={`sub-${tag}`}
                                                type="button"
                                                onClick={() => {
                                                    const input = document.getElementById('template-subject-editor');
                                                    const start = input.selectionStart;
                                                    const end = input.selectionEnd;
                                                    const text = editingTemplate.subject || '';
                                                    const before = text.substring(0, start);
                                                    const after = text.substring(end);
                                                    const newValue = before + tag + after;
                                                    setEditingTemplate({ ...editingTemplate, subject: newValue });
                                                    setTimeout(() => {
                                                        input.focus();
                                                        input.setSelectionRange(start + tag.length, start + tag.length);
                                                    }, 0);
                                                }}
                                                className="px-2 py-1 rounded-lg bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-wider hover:bg-blue-600 hover:text-white transition-all border border-blue-100"
                                            >
                                                + {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Message Content</label>
                                    <div className="group relative">
                                        <Info className="w-4 h-4 text-slate-300 cursor-help" />
                                        <div className="absolute bottom-full right-0 mb-2 w-64 p-4 bg-slate-900 text-white text-[10px] rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
                                            <p className="font-black uppercase tracking-wider mb-2 text-primary">Placeholders Guide:</p>
                                            <ul className="space-y-1 font-mono">
                                                {getPlaceholderGuide(editingTemplate.template_key).map(p => (
                                                    <li key={p} className="flex items-center gap-2">
                                                        <span className="text-primary">{p}</span> - Will be replaced automatically
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                                <textarea 
                                    id="template-message-editor"
                                    rows={5}
                                    value={editingTemplate.message || ''}
                                    onChange={e => setEditingTemplate({...editingTemplate, message: e.target.value})}
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-primary outline-none font-medium text-slate-600 transition-all resize-none"
                                    placeholder="Enter message content..."
                                />
                                
                                {/* Shortcut Buttons */}
                                <div className="flex flex-wrap gap-2 pt-2">
                                    {getPlaceholderGuide(editingTemplate.template_key).map(tag => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => {
                                                const textarea = document.getElementById('template-message-editor');
                                                const start = textarea.selectionStart;
                                                const end = textarea.selectionEnd;
                                                const text = editingTemplate.message || '';
                                                const before = text.substring(0, start);
                                                const after = text.substring(end);
                                                const newValue = before + tag + after;
                                                setEditingTemplate({ ...editingTemplate, message: newValue });
                                                
                                                // Refocus and set cursor
                                                setTimeout(() => {
                                                    textarea.focus();
                                                    textarea.setSelectionRange(start + tag.length, start + tag.length);
                                                }, 0);
                                            }}
                                            className="px-3 py-1.5 rounded-xl bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider hover:bg-primary hover:text-white transition-all border border-primary/20"
                                        >
                                            + {tag}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-4 pt-4 border-t border-slate-100">
                                <button 
                                    type="button"
                                    onClick={() => setEditingTemplate(null)}
                                    className="px-6 py-3 rounded-2xl text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit"
                                    disabled={saving}
                                    className="px-8 py-3 rounded-2xl bg-primary text-white font-black text-sm shadow-xl shadow-primary/20 hover:scale-105 transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Template</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
