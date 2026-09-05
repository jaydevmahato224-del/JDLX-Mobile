import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import toast from 'react-hot-toast'
import { 
    ArrowLeft, 
    Send, 
    Loader2, 
    User, 
    ShieldCheck, 
    Clock,
    AlertCircle,
    CheckCircle2,
    Lock
} from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'

function TicketDetailPage() {
    const { ticketId } = useParams();
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const messagesEndRef = useRef(null);

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [reply, setReply] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const fetchTicketDetails = useCallback(async () => {
        try {
            const res = await apiFetch(`/support/tickets/${ticketId}`);
            const json = await res.json();
            if (res.ok) {
                setData(json.data || json);
            } else {
                toast.error(json.message || "Failed to load ticket details");
                navigate('/profile/support');
            }
        } catch (err) {
            console.error("Fetch error:", err);
            toast.error("Connection error");
        } finally {
            setLoading(false);
        }
    }, [ticketId, navigate]);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }
        fetchTicketDetails();
    }, [user, navigate, fetchTicketDetails]);

    useEffect(() => {
        scrollToBottom();
    }, [data?.messages]);

    const handleReply = async (e) => {
        e.preventDefault();
        if (!reply.trim()) return;

        setSubmitting(true);
        try {
            const res = await apiFetch(`/support/tickets/${ticketId}/reply`, {
                method: 'POST',
                body: JSON.stringify({ message: reply })
            });
            const json = await res.json();
            
            if (res.ok) {
                setReply('');
                // Optimistic update/refresh
                fetchTicketDetails();
                toast.success("Reply sent!");
            } else {
                toast.error(json.message || "Failed to send reply");
            }
        } catch {
            toast.error("Something went wrong");
        } finally {
            setSubmitting(false);
        }
    };

    const getStatusStyles = (status) => {
        const s = status?.toLowerCase();
        if (s === 'open') return 'bg-blue-100 text-blue-700 border-blue-200';
        if (s === 'in progress') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
        if (s === 'resolved') return 'bg-green-100 text-green-700 border-green-200';
        return 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] border-[var(--color-surface-high)]';
    };

    if (loading) {
        return (
            <div className="container-standard py-20 flex flex-col items-center justify-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Opening Conversation Thread</p>
            </div>
        );
    }

    if (!data || !data.ticket) return null;

    const { ticket, messages } = data;
    const isClosed = ticket.status.toLowerCase() === 'closed';

    return (
        <div className="container-standard py-6 max-w-3xl flex flex-col min-h-[calc(100vh-var(--app-header-offset)-40px)]">
            {/* Header Section */}
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/profile/support" className="p-2 hover:bg-[var(--color-surface-container)] rounded-full transition-colors">
                        <ArrowLeft size={20} className="text-[var(--color-on-surface-variant)]" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 bg-primary text-white rounded-md text-[9px] font-black uppercase tracking-widest">
                                {ticket.ticket_number}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${getStatusStyles(ticket.status)}`}>
                                {ticket.status}
                            </span>
                        </div>
                        <h1 className="text-xl font-black text-[var(--color-on-surface)] tracking-tight">{ticket.subject}</h1>
                    </div>
                </div>
            </div>

            {/* Messages Thread */}
            <div className="flex-1 glass-card p-4 md:p-6 mb-6 overflow-y-auto space-y-6 bg-white/30 backdrop-blur-md">
                <div className="text-center mb-8">
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 bg-[var(--color-surface-low)] px-3 py-1 rounded-full">
                        Thread Started {new Date(ticket.created_at).toLocaleDateString()}
                    </span>
                </div>

                {messages.map((msg, index) => {
                    const isAdmin = msg.sender === 'admin';
                    return (
                        <div key={msg.id || index} className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[85%] flex flex-col ${isAdmin ? 'items-start' : 'items-end'}`}>
                                {/* Sender Info */}
                                <div className="flex items-center gap-1.5 mb-1 px-1">
                                    {isAdmin ? (
                                        <>
                                            <ShieldCheck size={12} className="text-primary" />
                                            <span className="text-[9px] font-black uppercase tracking-widest text-primary">JDLX Support</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">You</span>
                                            <User size={12} className="text-gray-400" />
                                        </>
                                    )}
                                </div>

                                {/* Bubble */}
                                <div className={`p-4 rounded-2xl text-sm font-medium shadow-sm border ${
                                    isAdmin 
                                    ? 'bg-[var(--color-surface-card)] border-[var(--color-surface-high)] rounded-tl-none text-[var(--color-on-surface)]' 
                                    : 'bg-primary border-primary/10 rounded-tr-none text-white'
                                }`}>
                                    {msg.message}
                                </div>

                                {/* Time */}
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1.5 px-1">
                                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Reply Box Section */}
            <div className="sticky bottom-4">
                {isClosed ? (
                    <div className="glass-card p-5 bg-[var(--color-surface-low)] border-[var(--color-surface-high)] flex items-center justify-between">
                        <div className="flex items-center gap-3 text-[var(--color-on-surface-variant)]">
                            <Lock size={18} />
                            <p className="text-xs font-bold uppercase tracking-wider">
                                This ticket is closed. Please create a new ticket for any new issues.
                            </p>
                        </div>
                        <Link to="/profile/support" className="text-primary text-[10px] font-black uppercase tracking-widest hover:underline">
                            Support Home
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleReply} className="relative group">
                        <textarea
                            placeholder="Type your reply here..."
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            className="w-full h-24 rounded-3xl bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] p-5 pr-16 text-sm font-bold text-[var(--color-on-surface)] shadow-xl focus:ring-4 focus:ring-primary/10 focus:border-primary/20 outline-none transition-all resize-none"
                        />
                        <button
                            type="submit"
                            disabled={submitting || !reply.trim()}
                            className="absolute bottom-4 right-4 p-3 bg-primary text-white rounded-2xl shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all"
                        >
                            {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                        </button>
                    </form>
                )}
            </div>
        </div>
    )
}

export default TicketDetailPage
