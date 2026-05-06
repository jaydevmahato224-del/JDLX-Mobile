import React, { useState, useEffect } from 'react';
import { Users, Search, Filter, ShieldAlert, CheckCircle, Ban, X, Mail, Send, AlertTriangle, Info, Bell } from 'lucide-react';
import { API_BASE_URL } from '../../config';

const AdminUsers = () => {
    const [users, setUsers] = useState([]);
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Pagination
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    // Selected User Modal & Email
    const [selectedUser, setSelectedUser] = useState(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [updateReason, setUpdateReason] = useState('');
    const [mailSubject, setMailSubject] = useState('');
    const [mailMessage, setMailMessage] = useState('');
    const [sendingMail, setSendingMail] = useState(false);
    const [mailBanner, setMailBanner] = useState(null);
    const [updatingStatus, setUpdatingStatus] = useState(false);

    // Bulk Mail Tab State
    const [activeTab, setActiveTab] = useState('list'); // 'list' | 'bulk'
    const [bulkSubject, setBulkSubject] = useState('');
    const [bulkMessage, setBulkMessage] = useState('');
    const [sendingBulk, setSendingBulk] = useState(false);
    const [bulkStatus, setBulkStatus] = useState(null);

    // In-app broadcast
    const [inAppTitle, setInAppTitle] = useState('');
    const [inAppMessage, setInAppMessage] = useState('');
    const [sendingInApp, setSendingInApp] = useState(false);
    const [inAppStatus, setInAppStatus] = useState(null);
    
    // Mail History State
    const [mailHistory, setMailHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyPage, setHistoryPage] = useState(1);
    const [totalHistory, setTotalHistory] = useState(0);
    const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);

    const fetchUsers = async (pageNum = 1, append = false) => {
        try {
            if (!append) setLoading(true);
            setError('');
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/users?page=${pageNum}&limit=20&search=${encodeURIComponent(searchTerm)}&status=${statusFilter}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                const message = res.status === 401 ? 'Your admin session expired. Please log in again.' : 'Failed to fetch users';
                throw new Error(message);
            }
            const data = await res.json();

            setUsers((prevUsers) => append ? [...prevUsers, ...data.users] : data.users);
            setAnalytics(data.analytics);
            setHasMore(data.users.length === 20);
            setPage(pageNum);
        } catch (error) {
            console.error("Error loading users:", error);
            if (!append) {
                setUsers([]);
                setAnalytics(null);
            }
            setHasMore(false);
            setError(error.message || 'Failed to fetch users');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const debounce = setTimeout(() => {
            fetchUsers(1, false);
        }, 500);
        return () => clearTimeout(debounce);
    }, [searchTerm, statusFilter]);

    const handleAction = async (userId, action, reason = '') => {
        if (!window.confirm(`Are you sure you want to ${action} this user?`)) return;

        try {
            setUpdatingStatus(true);
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/status`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: action, reason })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Action failed (Super Admin or Admin rank required)');
            }

            // Re-fetch everything to get clean analytics
            await fetchUsers(1, false);
            if (selectedUser && selectedUser.id === userId) {
                setSelectedUser(prev => ({ ...prev, account_status: action }));
            }
            setUpdateReason('');
        } catch (e) {
            console.error("Status update error:", e);
            alert(e.message);
        } finally {
            setUpdatingStatus(false);
        }
    };

    const handleSendPersonalEmail = async () => {
        if (!selectedUser || !mailSubject || !mailMessage) return;
        
        try {
            setSendingMail(true);
            setMailBanner(null);
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/users/${selectedUser.id}/send-email`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ subject: mailSubject, message: mailMessage })
            });

            if (!res.ok) throw new Error('Failed to send email');

            setMailBanner({ type: 'success', text: 'Email sent successfully!' });
            setMailSubject('');
            setMailMessage('');
            
            setTimeout(() => setMailBanner(null), 3000);
        } catch (err) {
            setMailBanner({ type: 'error', text: err.message });
        } finally {
            setSendingMail(false);
        }
    };

    const loadUserDetails = async (user) => {
        setSelectedUser(user);
        setMailBanner(null);
        try {
            setDetailsLoading(true);
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/users/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSelectedUser(data);
            }
        } catch (e) {
            console.error("Failed to fetch detailed profile", e);
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleSendBulk = async (e) => {
        if (e) e.preventDefault();
        if (!bulkSubject || !bulkMessage) return;

        if (!window.confirm("Are you sure you want to send this email to ALL registered users? This action cannot be undone.")) {
            return;
        }

        try {
            setSendingBulk(true);
            setBulkStatus(null);
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/notifications/bulk`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ subject: bulkSubject, message: bulkMessage })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start bulk mailing');

            setBulkStatus({ type: 'success', text: data.message });
            setBulkSubject('');
            setBulkMessage('');
            // Refresh history
            fetchMailHistory(1, false);
        } catch (err) {
            setBulkStatus({ type: 'error', text: err.message });
        } finally {
            setSendingBulk(false);
        }
    };

    const handleSendInAppBroadcast = async (e) => {
        if (e) e.preventDefault();
        if (!inAppTitle || !inAppMessage) return;

        if (!window.confirm("Send this in-app notification to ALL users?")) return;

        try {
            setSendingInApp(true);
            setInAppStatus(null);
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/notifications/in-app-broadcast`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: inAppTitle, message: inAppMessage, type: 'SYSTEM' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send in-app notification');

            setInAppStatus({ type: 'success', text: data.message });
            setInAppTitle('');
            setInAppMessage('');
        } catch (err) {
            setInAppStatus({ type: 'error', text: err.message });
        } finally {
            setSendingInApp(false);
        }
    };

    const fetchMailHistory = async (pageNum = 1, append = false) => {
        try {
            setHistoryLoading(true);
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/mail-history?page=${pageNum}&limit=5`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setMailHistory(prev => append ? [...prev, ...data.history] : data.history);
                setTotalHistory(data.total);
                setHistoryPage(pageNum);
            }
        } catch (error) {
            console.error("Failed to fetch mail history", error);
        } finally {
            setHistoryLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'bulk') {
            fetchMailHistory(1, false);
        }
    }, [activeTab]);

    return (
        <div className="space-y-6 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 border-l-4 border-indigo-600 pl-3">User Management</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage accounts and send announcements.</p>
                </div>
                
                {/* Tab Switcher */}
                <div className="flex bg-gray-100 p-1 rounded-xl w-fit self-start md:self-auto shadow-inner border border-gray-200">
                    <button 
                        onClick={() => setActiveTab('list')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'list' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Users className="w-4 h-4" /> USER LIST
                    </button>
                    <button 
                        onClick={() => setActiveTab('bulk')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'bulk' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Mail className="w-4 h-4" /> BULK MAIL CENTER
                    </button>
                </div>
            </div>

            {activeTab === 'list' ? (
                <>
                    {/* Analytics */}
                    {analytics && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
                                <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Users className="w-6 h-6" /></div>
                                <div><p className="text-sm text-gray-500 font-medium">Total Users</p><p className="text-2xl font-bold text-gray-900">{analytics.total}</p></div>
                            </div>
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
                                <div className="p-3 bg-green-50 text-green-600 rounded-lg"><CheckCircle className="w-6 h-6" /></div>
                                <div><p className="text-sm text-gray-500 font-medium">Active Accounts</p><p className="text-2xl font-bold text-gray-900">{analytics.active}</p></div>
                            </div>
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
                                <div className="p-3 bg-red-50 text-red-600 rounded-lg"><Ban className="w-6 h-6" /></div>
                                <div><p className="text-sm text-gray-500 font-medium">Suspended</p><p className="text-2xl font-bold text-gray-900">{analytics.suspended}</p></div>
                            </div>
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
                                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg"><Users className="w-6 h-6" /></div>
                                <div><p className="text-sm text-gray-500 font-medium">New Today</p><p className="text-2xl font-bold text-gray-900">{analytics.new_today}</p></div>
                            </div>
                        </div>
                    )}

                    {/* Search & Filters */}
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search users..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="pl-4 pr-10 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                        >
                            <option value="">All Statuses</option>
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                            <option value="banned">Banned</option>
                        </select>
                    </div>

                    {/* Table */}
                    <div className="bg-white border text-gray-700 border-gray-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                        <th className="px-6 py-4 text-sm font-semibold text-gray-600">User</th>
                                        <th className="px-6 py-4 text-sm font-semibold text-gray-600">Joined</th>
                                        <th className="px-6 py-4 text-sm font-semibold text-gray-600">Status</th>
                                        <th className="px-6 py-4 text-sm font-semibold text-gray-600 text-center">T&C</th>
                                        <th className="px-6 py-4 text-sm font-semibold text-gray-600 text-center">Orders</th>
                                        <th className="px-6 py-4 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {users.map((user) => (
                                        <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-4 text-gray-900 font-medium">
                                                <div className="flex items-center gap-3">
                                                    {user.profile_image ? (
                                                        <img src={user.profile_image} className="w-10 h-10 rounded-full" />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">{user.name.charAt(0)}</div>
                                                    )}
                                                    <div>
                                                        <div className="font-semibold">{user.name}</div>
                                                        <div className="text-xs text-gray-500">{user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">{new Date(user.created_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${user.account_status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                                    {user.account_status.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`px-2 py-1 rounded-full text-[11px] font-bold border ${Number(user.terms_accepted_version || 0) > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                                    {Number(user.terms_accepted_version || 0) > 0 ? 'AGREED' : 'PENDING'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center font-bold text-gray-900">{user.total_orders || 0}</td>
                                            <td className="px-6 py-4 text-right">
                                                <button onClick={() => loadUserDetails(user)} className="text-indigo-600 hover:text-indigo-900 font-bold text-sm px-3 py-1 bg-indigo-50 hover:bg-indigo-100 rounded-md">View Profile</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Profile Modal */}
                    {selectedUser && (
                        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                            <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
                                <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
                                    <h2 className="text-xl font-bold text-gray-900">User Profile: {selectedUser.name}</h2>
                                    <button onClick={() => setSelectedUser(null)} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
                                </div>

                                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <div className="space-y-6">
                                        <div className="bg-gray-50 rounded-xl p-6 text-center border">
                                            <div className="w-20 h-20 rounded-full bg-indigo-100 border-2 border-white mx-auto flex items-center justify-center text-indigo-700 font-bold text-2xl shadow-sm mb-3">
                                                {selectedUser.name.charAt(0)}
                                            </div>
                                            <h3 className="font-bold text-gray-900">{selectedUser.name}</h3>
                                            <p className="text-xs text-gray-500">{selectedUser.email}</p>
                                            <p className="text-[10px] text-indigo-500 font-mono mt-2 uppercase tracking-tight">User ID: {selectedUser.id}</p>
                                            <div className="mt-3 flex items-center justify-center gap-2">
                                                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${Number(selectedUser.terms_accepted_version || 0) > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                                    T&C: {Number(selectedUser.terms_accepted_version || 0) > 0 ? 'AGREED' : 'PENDING'}
                                                </span>
                                                {Number(selectedUser.terms_accepted_version || 0) > 0 && (
                                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold border bg-slate-50 text-slate-700 border-slate-200">
                                                        v{Number(selectedUser.terms_accepted_version || 0)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Security Section */}
                                        <div className="bg-white border border-red-100 rounded-xl overflow-hidden shadow-sm">
                                            <div className="bg-red-50 py-2 px-4 border-b border-red-100 text-xs font-bold text-red-900 flex items-center gap-2">
                                                <ShieldAlert className="w-3.5 h-3.5" /> SECURITY CONTROLS
                                            </div>
                                            <div className="p-4 space-y-3">
                                                <input 
                                                    type="text" 
                                                    placeholder="Reason for change..."
                                                    value={updateReason}
                                                    onChange={(e) => setUpdateReason(e.target.value)}
                                                    className="w-full px-3 py-1.5 text-xs border rounded outline-none focus:ring-1 focus:ring-red-400"
                                                />
                                                <div className="grid grid-cols-1 gap-2">
                                                    {selectedUser.account_status !== 'active' && (
                                                        <button 
                                                            onClick={() => handleAction(selectedUser.id, 'active', updateReason)} 
                                                            disabled={updatingStatus}
                                                            className="py-2 bg-green-50 text-green-700 font-bold rounded text-xs disabled:opacity-50"
                                                        >
                                                            {updatingStatus ? 'PROCESSING...' : 'ACTIVATE'}
                                                        </button>
                                                    )}
                                                    {selectedUser.account_status !== 'suspended' && (
                                                        <button 
                                                            onClick={() => handleAction(selectedUser.id, 'suspended', updateReason)} 
                                                            disabled={updatingStatus}
                                                            className="py-2 bg-orange-50 text-orange-700 font-bold rounded text-xs disabled:opacity-50"
                                                        >
                                                            {updatingStatus ? 'PROCESSING...' : 'SUSPEND'}
                                                        </button>
                                                    )}
                                                    {selectedUser.account_status !== 'banned' && (
                                                        <button 
                                                            onClick={() => handleAction(selectedUser.id, 'banned', updateReason)} 
                                                            disabled={updatingStatus}
                                                            className="py-2 bg-red-600 text-white font-bold rounded text-xs disabled:opacity-50"
                                                        >
                                                            {updatingStatus ? 'PROCESSING...' : 'BAN ACCOUNT'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Send Email Section */}
                                        <div className="bg-white border border-indigo-100 rounded-xl overflow-hidden shadow-sm">
                                            <div className="bg-indigo-50 py-2 px-4 border-b border-indigo-100 text-xs font-bold text-indigo-900 flex items-center gap-2">
                                                <Mail className="w-3.5 h-3.5" /> SEND PERSONAL MAIL
                                            </div>
                                            <div className="p-4 space-y-3">
                                                <input 
                                                    type="text" 
                                                    placeholder="Subject"
                                                    value={mailSubject}
                                                    onChange={(e) => setMailSubject(e.target.value)}
                                                    className="w-full px-3 py-1.5 text-xs border rounded outline-none"
                                                />
                                                <textarea 
                                                    placeholder="Message..."
                                                    rows="3"
                                                    value={mailMessage}
                                                    onChange={(e) => setMailMessage(e.target.value)}
                                                    className="w-full px-3 py-1.5 text-xs border rounded outline-none resize-none"
                                                />
                                                <button 
                                                    onClick={handleSendPersonalEmail}
                                                    disabled={sendingMail || !mailSubject || !mailMessage}
                                                    className="w-full py-2 bg-indigo-600 text-white font-bold rounded text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    <Send className="w-3 h-3" /> {sendingMail ? 'SENDING...' : 'SEND MAIL'}
                                                </button>
                                                {mailBanner && <div className={`text-[10px] text-center font-bold px-2 py-1 rounded ${mailBanner.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{mailBanner.text}</div>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="md:col-span-2 border rounded-xl overflow-hidden shadow-sm bg-white">
                                        <div className="bg-gray-50 border-b py-3 px-5 font-bold text-gray-900 uppercase text-xs tracking-wider">Transaction History</div>
                                        <div className="p-0">
                                            {detailsLoading ? <div className="p-10 text-center text-gray-400 text-sm">Fetching records...</div> : selectedUser.orders?.length > 0 ? (
                                                <table className="w-full text-xs text-left">
                                                    <thead className="bg-white sticky top-0 border-b text-gray-500">
                                                        <tr><th className="px-4 py-2 uppercase">Order</th><th className="px-4 py-2 uppercase">Date</th><th className="px-4 py-2 uppercase">Status</th><th className="px-4 py-2 text-right uppercase">Amount</th></tr>
                                                    </thead>
                                                    <tbody className="divide-y">
                                                        {selectedUser.orders.map(o => (
                                                            <tr key={o.id} className="hover:bg-gray-50">
                                                                <td className="px-4 py-3 font-mono text-indigo-600">{o.order_number}</td>
                                                                <td className="px-4 py-3">{new Date(o.created_at).toLocaleDateString()}</td>
                                                                <td className="px-4 py-3 font-bold">{o.order_status.toUpperCase()}</td>
                                                                <td className="px-4 py-3 text-right font-bold">₹{o.total_amount.toFixed(2)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            ) : <div className="p-10 text-center text-gray-400 text-sm">No transaction history found.</div>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4">
                    <div className="lg:col-span-2">
                        <div className="space-y-6">
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
                                <div className="bg-indigo-600 p-6 text-white">
                                    <h2 className="text-xl font-bold flex items-center gap-2"><Send className="w-5 h-5" /> Bulk Email Announcement</h2>
                                    <p className="text-indigo-100 text-xs mt-1">Send an email to all registered users (with email).</p>
                                </div>
                                <form onSubmit={handleSendBulk} className="p-8 space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Email Subject</label>
                                        <input 
                                            type="text"
                                            placeholder="E.g. Important Maintenance Update / New Feature Announcement"
                                            value={bulkSubject}
                                            onChange={(e) => setBulkSubject(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-inner"
                                            required
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Message Content</label>
                                        <textarea 
                                            rows="10"
                                            placeholder="Write your announcement here..."
                                            value={bulkMessage}
                                            onChange={(e) => setBulkMessage(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-inner resize-none"
                                            required
                                        />
                                        <p className="text-[10px] text-gray-400 italic">Line breaks will be automatically converted to HTML br tags.</p>
                                    </div>

                                    <button 
                                        type="submit"
                                        disabled={sendingBulk || !bulkSubject || !bulkMessage}
                                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-transform active:scale-[0.98] disabled:bg-gray-400 shadow-lg shadow-indigo-100"
                                    >
                                        {sendingBulk ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                SENDING PROCESS STARTED...
                                            </>
                                        ) : (
                                            <>
                                                <Send className="w-5 h-5" />
                                                SEND EMAIL TO ALL USERS
                                            </>
                                        )}
                                    </button>

                                    {bulkStatus && (
                                        <div className={`p-4 rounded-xl border flex items-start gap-3 animate-in fade-in duration-300 ${bulkStatus.type === 'success' ? 'bg-green-50 border-green-100 text-green-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
                                            {bulkStatus.type === 'success' ? <CheckCircle className="w-5 h-5 mt-0.5" /> : <AlertTriangle className="w-5 h-5 mt-0.5" />}
                                            <div>
                                                <p className="font-bold">{bulkStatus.type === 'success' ? 'Success!' : 'Error Occurred'}</p>
                                                <p className="text-sm">{bulkStatus.text}</p>
                                            </div>
                                        </div>
                                    )}
                                </form>
                            </div>

                            <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
                                <div className="bg-emerald-600 p-6 text-white">
                                    <h2 className="text-xl font-bold flex items-center gap-2"><Bell className="w-5 h-5" /> In-App Notification</h2>
                                    <p className="text-emerald-100 text-xs mt-1">Creates an in-app notification for every user (shows in Store → Alerts).</p>
                                </div>
                                <form onSubmit={handleSendInAppBroadcast} className="p-8 space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Title</label>
                                        <input
                                            type="text"
                                            placeholder="E.g. Terms Updated"
                                            value={inAppTitle}
                                            onChange={(e) => setInAppTitle(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-inner"
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Message</label>
                                        <textarea
                                            rows="7"
                                            placeholder="Write the message users will see..."
                                            value={inAppMessage}
                                            onChange={(e) => setInAppMessage(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-inner resize-none"
                                            required
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={sendingInApp || !inAppTitle || !inAppMessage}
                                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-transform active:scale-[0.98] disabled:bg-gray-400 shadow-lg shadow-emerald-100"
                                    >
                                        {sendingInApp ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                SENDING...
                                            </>
                                        ) : (
                                            <>
                                                <Bell className="w-5 h-5" />
                                                SEND IN-APP NOTIFICATION
                                            </>
                                        )}
                                    </button>

                                    {inAppStatus && (
                                        <div className={`p-4 rounded-xl border flex items-start gap-3 animate-in fade-in duration-300 ${inAppStatus.type === 'success' ? 'bg-green-50 border-green-100 text-green-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
                                            {inAppStatus.type === 'success' ? <CheckCircle className="w-5 h-5 mt-0.5" /> : <AlertTriangle className="w-5 h-5 mt-0.5" />}
                                            <div>
                                                <p className="font-bold">{inAppStatus.type === 'success' ? 'Sent!' : 'Error Occurred'}</p>
                                                <p className="text-sm">{inAppStatus.text}</p>
                                            </div>
                                        </div>
                                    )}
                                </form>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-amber-50 rounded-2xl border border-amber-100 p-6 space-y-4 shadow-sm border-l-8 border-l-amber-400">
                            <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                                <AlertTriangle className="w-5 h-5" />
                                IMPORTANT RULES
                            </div>
                            <ul className="text-xs text-amber-900/80 space-y-3 list-disc pl-4 leading-relaxed font-medium">
                                <li>Emails are sent to <b>ALL</b> registered users who have an email address.</li>
                                <li>The process runs in the background to prevent server timeout.</li>
                                <li>Avoid sending multiple bulk emails in a short period to prevent spam flagging.</li>
                                <li>Check your SMTP limits before sending to thousands of users at once.</li>
                            </ul>
                        </div>

                        <div className="bg-gray-900 rounded-2xl p-6 text-white space-y-4 shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                <Mail className="w-20 h-20" />
                            </div>
                            <div className="flex items-center gap-2 font-bold text-sm">
                                <Info className="w-5 h-5 text-indigo-400" />
                                PREMIUM TIPS
                            </div>
                            <p className="text-xs text-gray-400 leading-relaxed relative z-10">
                                Professional emails should always start with a clear subject and a polite greeting. Use the message box to communicate updates directly to your customer base.
                            </p>
                            <div className="pt-2 border-t border-white/10 relative z-10">
                                 <div className="text-[10px] text-gray-500 font-mono">FROM: JDLX Official Support</div>
                                 <div className="text-[10px] text-gray-500 font-mono">CHANNEL: GMAIL SMTP SECURE</div>
                            </div>
                        </div>
                    </div>

                    {/* Sent History Section */}
                    <div className="lg:col-span-3 mt-4">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
                            <div className="bg-gray-800 p-5 text-white flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-bold flex items-center gap-2"><div className="p-1.5 bg-gray-700 rounded-lg"><Mail className="w-4 h-4 text-indigo-400" /></div> SENT MAIL RECENT HISTORY</h2>
                                    <p className="text-gray-400 text-[10px] mt-0.5 uppercase tracking-widest">Tracking communication logs for audit & reference</p>
                                </div>
                                <div className="text-xs bg-gray-700/50 px-3 py-1.5 rounded-full border border-gray-600 font-mono text-gray-300">
                                    TOTAL LOGS: {totalHistory}
                                </div>
                            </div>
                            
                            <div className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-gray-50/50 border-b border-gray-100">
                                                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">SENT ON</th>
                                                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">RECIPIENT(S)</th>
                                                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">SUBJECT</th>
                                                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">ACTION</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {mailHistory.length > 0 ? mailHistory.map((item) => (
                                                <tr key={item.id} className="hover:bg-gray-50/30 transition-colors group">
                                                    <td className="px-6 py-4">
                                                        <div className="text-xs font-bold text-gray-700">{new Date(item.sent_at).toLocaleDateString()}</div>
                                                        <div className="text-[10px] text-gray-400">{new Date(item.sent_at).toLocaleTimeString()}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {item.recipient_type === 'bulk' ? (
                                                            <div className="flex items-center gap-2">
                                                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded border border-indigo-100 uppercase">BULK ANNOUNCEMENT</span>
                                                                <span className="text-[10px] text-gray-500 font-medium">{item.recipient_count} USERS</span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col">
                                                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded border border-emerald-100 w-fit uppercase mb-1">INDIVIDUAL MAIL</span>
                                                                <span className="text-xs font-semibold text-gray-600 font-mono truncate max-w-[150px]">{item.recipient_email}</span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="text-sm font-bold text-gray-800 line-clamp-1 group-hover:text-indigo-600 transition-colors">{item.subject}</div>
                                                        <div className="text-xs text-gray-400 line-clamp-1 lowercase">{item.message}...</div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button 
                                                            onClick={() => setSelectedHistoryItem(item)}
                                                            className="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-[10px] font-bold hover:bg-gray-50 hover:border-indigo-200 hover:text-indigo-600 transition-all shadow-sm"
                                                        >
                                                            VIEW CONTENT
                                                        </button>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-12 text-center">
                                                        {historyLoading ? (
                                                            <div className="flex flex-col items-center gap-2">
                                                                <div className="w-6 h-6 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
                                                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Fetching logs...</div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col items-center gap-2 opacity-30">
                                                                <Mail className="w-8 h-8 text-gray-400" />
                                                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">No sent history found</div>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                
                                {mailHistory.length < totalHistory && (
                                    <div className="p-4 bg-gray-50/50 border-t border-gray-100 text-center">
                                        <button 
                                            onClick={() => fetchMailHistory(historyPage + 1, true)}
                                            disabled={historyLoading}
                                            className="px-6 py-2 bg-white border border-gray-200 text-gray-600 rounded-full text-xs font-bold hover:shadow-md transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {historyLoading ? 'LOADING...' : 'LOAD MORE HISTORY'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* History Detail Modal */}
                    {selectedHistoryItem && (
                        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
                            <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                                <div className="bg-gray-900 px-8 py-6 text-white flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="p-1.5 bg-indigo-600 rounded-lg"><Mail className="w-5 h-5" /></div>
                                            <h2 className="text-xl font-bold">Mail Log Details</h2>
                                        </div>
                                        <p className="text-gray-400 text-[10px] uppercase tracking-widest">Audit record ID: #{selectedHistoryItem.id}</p>
                                    </div>
                                    <button 
                                        onClick={() => setSelectedHistoryItem(null)}
                                        className="p-2 bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white rounded-xl transition-all"
                                    >
                                        <X className="w-6 h-6" />
                                    </button>
                                </div>
                                
                                <div className="p-8 space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                                           <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">SENT TO</p>
                                           <p className="font-bold text-gray-800">
                                               {selectedHistoryItem.recipient_type === 'bulk' ? `All Users (${selectedHistoryItem.recipient_count})` : selectedHistoryItem.recipient_email}
                                           </p>
                                        </div>
                                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                                           <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">SENT BY ADMIN</p>
                                           <p className="font-bold text-gray-800">{selectedHistoryItem.admin_name} <span className="text-[10px] text-gray-400 font-normal">({selectedHistoryItem.admin_email})</span></p>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">SUBJECT</p>
                                            <p className="text-lg font-bold text-gray-900">{selectedHistoryItem.subject}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">MESSAGE BODY</p>
                                            <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-medium shadow-inner">
                                                {selectedHistoryItem.message}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">TIMESTAMP: {new Date(selectedHistoryItem.sent_at).toLocaleString()}</div>
                                        <button 
                                            onClick={() => setSelectedHistoryItem(null)}
                                            className="px-6 py-2 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-all active:scale-95 shadow-lg shadow-gray-200"
                                        >
                                            CLOSE RECORD
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AdminUsers;
