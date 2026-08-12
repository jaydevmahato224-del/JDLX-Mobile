import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { 
    ChevronRight, 
    MessageSquare, 
    PlusCircle, 
    Clock, 
    CheckCircle2, 
    Loader2, 
    Ticket, 
    History,
    AlertCircle
} from 'lucide-react'

function SupportPage() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    // Section A: New Ticket State
    const [submitting, setSubmitting] = useState(false);
    const [createdTicket, setCreatedTicket] = useState(null);
    const [form, setForm] = useState({
        subject: new URLSearchParams(window.location.search).get("subject") || '',
        message: ''
    });

    // Section B: Tickets List State
    const [tickets, setTickets] = useState([]);
    const [loadingTickets, setLoadingTickets] = useState(true);

    const fetchTickets = useCallback(async () => {
        setLoadingTickets(true);
        try {
            const res = await fetch(`${API_BASE_URL}/support/tickets`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                setTickets(data.data || data);
            }
        } catch (err) {
            console.error("Failed to load tickets", err);
        } finally {
            setLoadingTickets(false);
        }
    }, [token]);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }
        fetchTickets();
    }, [user, navigate, fetchTickets]);

    const handleCreateTicket = async (e) => {
        e.preventDefault();
        
        if (!form.subject || !form.message) {
            toast.error("Please fill in both subject and message");
            return;
        }

        if (form.message.length < 20) {
            toast.error("Message must be at least 20 characters long");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/support/ticket`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify(form)
            });
            const data = await res.json();
            
            if (res.ok) {
                toast.success("Ticket created successfully");
                setCreatedTicket(data.data || data);
                setForm({ subject: '', message: '' });
                fetchTickets(); // Refresh the list below
            } else {
                toast.error(data.message || "Failed to create ticket");
            }
        } catch {
            toast.error("Something went wrong. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const getStatusStyles = (status) => {
        const s = status?.toLowerCase();
        if (s === 'open') return 'bg-blue-100 text-blue-700 border-blue-200';
        if (s === 'in progress') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
        if (s === 'resolved') return 'bg-green-100 text-green-700 border-green-200';
        return 'bg-gray-100 text-gray-700 border-gray-200';
    };

    return (
        <div className="container-standard py-6 max-w-3xl space-y-12">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-black tracking-tight">Support Center</h1>
                <p className="text-gray-500 mt-1">We're here to help you with any issues.</p>
            </div>

            {/* SECTION A: New Ticket Form */}
            <div className="space-y-6">
                <div className="flex items-center gap-2 px-2">
                    <PlusCircle className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-black tracking-tight uppercase">Create New Ticket</h2>
                </div>

                {createdTicket ? (
                    <div className="glass-card p-8 bg-green-50/50 border-green-200 text-center animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 mx-auto mb-4">
                            <CheckCircle2 size={32} />
                        </div>
                        <h3 className="text-xl font-black mb-2 text-green-800">Your ticket number: {createdTicket.ticket_number}</h3>
                        <p className="text-green-700/70 text-sm mb-6">You will receive a reply within 24-48 hours. Your issue has been recorded.</p>
                        <button 
                            onClick={() => setCreatedTicket(null)}
                            className="btn-primary h-12 px-8"
                        >
                            Create Another Ticket
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleCreateTicket} className="glass-card p-6 md:p-8 space-y-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Subject</label>
                            <input 
                                type="text"
                                placeholder="e.g. Refund not received, Wrong item..."
                                value={form.subject}
                                onChange={e => setForm({...form, subject: e.target.value})}
                                className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Message</label>
                            <textarea 
                                placeholder="Describe your issue in detail (min 20 chars)..."
                                value={form.message}
                                onChange={e => setForm({...form, message: e.target.value})}
                                className="w-full min-h-[120px] rounded-2xl bg-[var(--color-surface-low)] p-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                            />
                            <p className="text-[9px] text-gray-400 ml-1 uppercase font-bold tracking-widest">
                                {form.message.length}/20 characters minimum
                            </p>
                        </div>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="btn-primary w-full h-14 text-base tracking-widest"
                        >
                            {submitting ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 size={20} className="animate-spin" /> Creating...
                                </span>
                            ) : (
                                "Open Support Ticket"
                            )}
                        </button>
                    </form>
                )}
            </div>

            {/* SECTION B: My Tickets List */}
            <div className="space-y-6">
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-black tracking-tight uppercase">My Ticket History</h2>
                    </div>
                    {tickets.length > 0 && (
                        <span className="text-[10px] font-black bg-primary/10 text-primary px-2 py-1 rounded-lg">
                            {tickets.length} Tickets
                        </span>
                    )}
                </div>

                {loadingTickets ? (
                    <div className="glass-card p-12 flex flex-col items-center gap-4">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Loading Tickets</span>
                    </div>
                ) : tickets.length === 0 ? (
                    <div className="glass-card p-12 text-center flex flex-col items-center">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-4">
                            <Ticket size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800">No tickets yet</h3>
                        <p className="text-gray-400 text-sm mt-2 max-w-xs">When you submit a support request, it will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {tickets.map(ticket => (
                            <div key={ticket.id} className="glass-card p-6 border-l-4 border-l-primary shadow-sm hover:shadow-md transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="space-y-1">
                                        <span className="px-2 py-0.5 bg-primary text-white rounded-md text-[9px] font-black uppercase tracking-widest">
                                            {ticket.ticket_number}
                                        </span>
                                        <h3 className="font-black text-gray-800 text-base">{ticket.subject}</h3>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyles(ticket.status)}`}>
                                        {ticket.status}
                                    </span>
                                </div>

                                <p className="text-sm text-gray-500 line-clamp-2 italic mb-4">
                                    "{ticket.last_message}"
                                </p>

                                <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                                    <div className="flex items-center gap-3 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                        <div className="flex items-center gap-1">
                                            <Clock size={12} />
                                            {new Date(ticket.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </div>
                                    </div>
                                    <Link 
                                        to={`/profile/support/ticket/${ticket.id}`}
                                        className="text-primary font-black uppercase tracking-widest text-[10px] flex items-center gap-1 hover:gap-2 transition-all"
                                    >
                                        View & Reply <ChevronRight size={14} />
                                    </Link>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default SupportPage
