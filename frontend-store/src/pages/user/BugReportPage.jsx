import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, Camera, AlertCircle, CheckCircle2, Loader2, Smartphone, Monitor, ShieldCheck, Globe, ChevronDown, Check, Link2 } from 'lucide-react'

function BugReportPage() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const [form, setForm] = useState({
        page_location: '',
        severity: '',
        description: '',
        steps_to_reproduce: ''
    });

    const [deviceInfo, setDeviceInfo] = useState({
        browser: 'Detecting...',
        os: 'Detecting...',
        screen_resolution: 'Detecting...',
        page_url: '',
        user_agent: ''
    });

    const [screenshot, setScreenshot] = useState(null);
    const [preview, setPreview] = useState(null);
    const [pageLocationDropdownOpen, setPageLocationDropdownOpen] = useState(false);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        // Auto-capture device info
        const ua = navigator.userAgent;

        // Browser detection
        let browser = 'Unknown';
        if (ua.includes('Edg/')) browser = 'Microsoft Edge';
        else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera';
        else if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Safari')) browser = 'Safari';

        // OS detection
        let os = 'Unknown';
        if (ua.includes('Windows NT 10')) os = 'Windows 10/11';
        else if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac OS X')) os = 'macOS';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
        else if (ua.includes('Linux')) os = 'Linux';

        const capturedInfo = {
            browser,
            os,
            screen_resolution: window.screen.width + 'x' + window.screen.height,
            page_url: window.location.href,
            user_agent: ua
        };
        setDeviceInfo(capturedInfo);
    }, [user, navigate]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setScreenshot(file);
            setPreview(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!form.page_location || !form.severity || !form.description) {
            toast.error("Please fill in all required fields");
            return;
        }

        if (form.description.length < 20) {
            toast.error("Description must be at least 20 characters long");
            return;
        }

        setSubmitting(true);
        const formData = new FormData();
        formData.append('page_location', form.page_location);
        formData.append('severity', form.severity);
        formData.append('description', form.description);
        formData.append('steps_to_reproduce', form.steps_to_reproduce);
        
        // Include auto-captured info
        formData.append('browser', deviceInfo.browser);
        formData.append('os', deviceInfo.os);
        formData.append('screen_resolution', deviceInfo.screen_resolution);
        formData.append('page_url', deviceInfo.page_url);
        formData.append('user_agent', deviceInfo.user_agent);

        if (screenshot) {
            formData.append('screenshot', screenshot);
        }

        try {
            const res = await fetch(`${API_BASE_URL}/bug-report`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            
            if (res.ok) {
                toast.success("Bug report submitted successfully");
                setSuccess(true);
            } else {
                toast.error(data.message || "Failed to submit report");
            }
        } catch (err) {
            toast.error("Something went wrong. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="container-standard py-20 flex flex-col items-center justify-center text-center">
                <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-8 animate-bounce">
                    <CheckCircle2 size={48} />
                </div>
                <h2 className="text-4xl font-black mb-4">Bug report submitted! Thank you!</h2>
                <p className="text-gray-500 mb-10 max-w-md text-lg">Your feedback helps make JDLX Mobile better. Our tech team will check it soon.</p>
                <Link to="/profile/my-bug-reports" className="btn-primary h-16 px-12 text-lg">
                    View my reports <ChevronRight size={20} className="ml-2" />
                </Link>
            </div>
        );
    }

    return (
        <div className="container-standard py-8 max-w-4xl">
            <div className="mb-10">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-full text-xs font-black uppercase tracking-widest mb-4">
                    <AlertCircle size={14} /> System Debugger
                </div>
                <h1 className="text-4xl font-black tracking-tighter">Report a Bug</h1>
                <p className="text-gray-500 mt-2 text-lg">Help us fix issues and make JDLX Mobile faster for everyone.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8 pb-20">
                <div className="glass-card p-6 md:p-10 space-y-8">
                    {/* Page Location */}
                    <div className="space-y-3 relative">
                        <label className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Where did the issue occur?</label>
                        <button
                            type="button"
                            onClick={() => setPageLocationDropdownOpen(!pageLocationDropdownOpen)}
                            className="w-full h-14 rounded-2xl bg-gray-50 px-6 text-sm font-bold text-gray-900 border-2 border-transparent focus:border-primary/20 focus:bg-white transition-all outline-none flex items-center justify-between"
                        >
                            <span className={form.page_location ? 'text-gray-900' : 'text-gray-400'}>
                                {form.page_location || "Select Page..."}
                            </span>
                            <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${pageLocationDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {pageLocationDropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setPageLocationDropdownOpen(false)} />
                                <div className="absolute top-full left-0 right-0 z-50 mt-1.5 p-1 bg-white border border-gray-100 rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-xl">
                                    {[
                                        "Home page",
                                        "Product listing",
                                        "Product detail page",
                                        "Cart",
                                        "Checkout / Payment",
                                        "My orders",
                                        "Login / Signup",
                                        "Other"
                                    ].map(loc => (
                                        <button
                                            key={loc}
                                            type="button"
                                            onClick={() => {
                                                setForm({ ...form, page_location: loc });
                                                setPageLocationDropdownOpen(false);
                                            }}
                                            className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                                form.page_location === loc
                                                ? 'bg-primary text-white'
                                                : 'text-slate-700 hover:bg-slate-50'
                                            }`}
                                        >
                                            <span>{loc}</span>
                                            {form.page_location === loc && (
                                                <Check size={14} className="text-white shrink-0" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Severity Selection */}
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">How severe is the issue?</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                                { label: 'Low', color: 'bg-green-500', active: 'bg-green-500 text-white shadow-lg shadow-green-200', inactive: 'bg-green-50 text-green-600 hover:bg-green-100' },
                                { label: 'Medium', color: 'bg-yellow-500', active: 'bg-yellow-500 text-white shadow-lg shadow-yellow-200', inactive: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' },
                                { label: 'High', color: 'bg-orange-500', active: 'bg-orange-500 text-white shadow-lg shadow-orange-200', inactive: 'bg-orange-50 text-orange-700 hover:bg-orange-100' },
                                { label: 'Critical', color: 'bg-red-500', active: 'bg-red-500 text-white shadow-lg shadow-red-200', inactive: 'bg-red-50 text-red-700 hover:bg-red-100' }
                            ].map((item) => (
                                <button
                                    key={item.label}
                                    type="button"
                                    onClick={() => setForm({ ...form, severity: item.label })}
                                    className={`h-14 rounded-2xl text-sm font-black transition-all ${form.severity === item.label ? item.active : item.inactive}`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Bug Description</label>
                        <textarea
                            placeholder="What happened? What did you expect and what actually occurred?"
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            className="w-full min-h-[150px] rounded-2xl bg-gray-50 p-6 text-sm font-bold text-gray-900 border-2 border-transparent focus:border-primary/20 focus:bg-white transition-all outline-none resize-none"
                        />
                        <p className={`text-[10px] font-bold ${form.description.length < 20 ? 'text-gray-400' : 'text-green-500'}`}>
                            Minimum 20 characters required ({form.description.length}/20)
                        </p>
                    </div>

                    {/* Steps to Reproduce */}
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Steps to Reproduce (Optional)</label>
                        <textarea
                            placeholder="1. Went here... 2. Did this... 3. This error appeared..."
                            value={form.steps_to_reproduce}
                            onChange={e => setForm({ ...form, steps_to_reproduce: e.target.value })}
                            className="w-full min-h-[120px] rounded-2xl bg-gray-50 p-6 text-sm font-bold text-gray-900 border-2 border-transparent focus:border-primary/20 focus:bg-white transition-all outline-none resize-none"
                        />
                    </div>

                    {/* Screenshot Upload */}
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Attach Screenshot (Optional)</label>
                        <div className="flex flex-wrap items-center gap-6">
                            <label className="cursor-pointer flex flex-col items-center justify-center w-32 h-32 rounded-3xl border-2 border-dashed border-gray-200 hover:border-primary hover:bg-primary/5 transition-all text-gray-400 hover:text-primary">
                                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                                <Camera size={32} />
                                <span className="text-[10px] font-black uppercase mt-2">Upload File</span>
                            </label>
                            
                            {preview && (
                                <div className="relative w-32 h-32 rounded-3xl overflow-hidden border-4 border-white shadow-xl rotate-2">
                                    <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                                    <button 
                                        type="button"
                                        onClick={() => { setScreenshot(null); setPreview(null); }}
                                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 shadow-md hover:bg-red-600 transition-all"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Auto-captured Device Info */}
                <div className="bg-slate-900 rounded-[2rem] p-8 text-white space-y-6 shadow-2xl overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full -mr-32 -mt-32 blur-3xl"></div>
                    <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <div className="flex items-center gap-2 text-primary mb-2">
                                <ShieldCheck size={20} />
                                <span className="text-xs font-black uppercase tracking-widest">Automatic Diagnostic</span>
                            </div>
                            <h3 className="text-xl font-black">This info is automatically captured</h3>
                            <p className="text-slate-400 text-sm mt-1">Our tech team uses this to debug the reported issue.</p>
                        </div>
                    </div>

                    <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 bg-white/5 p-6 rounded-2xl border border-white/10">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <Globe size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Browser</span>
                            </div>
                            <p className="font-bold text-sm">{deviceInfo.browser}</p>
                        </div>
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <Monitor size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">OS</span>
                            </div>
                            <p className="font-bold text-sm">{deviceInfo.os}</p>
                        </div>
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <Smartphone size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Resolution</span>
                            </div>
                            <p className="font-bold text-sm">{deviceInfo.screen_resolution}</p>
                        </div>
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <Link2 size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Current URL</span>
                            </div>
                            <p className="font-bold text-xs truncate max-w-[150px]">{deviceInfo.page_url}</p>
                        </div>
                    </div>
                </div>

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary w-full h-20 text-xl font-black tracking-widest shadow-2xl shadow-primary/30"
                >
                    {submitting ? (
                        <span className="flex items-center gap-3">
                            <Loader2 size={24} className="animate-spin" /> Submitting Report...
                        </span>
                    ) : (
                        "SUBMIT BUG REPORT"
                    )}
                </button>
            </form>
        </div>
    )
}

// Helper X icon
const X = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
)

export default BugReportPage
