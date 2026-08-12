import { useEffect, useState } from 'react'
import { FileText, ShieldCheck, ChevronDown, CheckCircle2, AlertCircle } from 'lucide-react'
import { API_BASE_URL } from '../config'
import { useStore } from '../store/useStore'

function parseTermsVersion(settingsData) {
  const raw = settingsData?.terms_and_conditions_version
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function TermsGate() {
  const user = useStore((s) => s.user)
  const token = useStore.getState().token
  const setUser = useStore((s) => s.setUser)

  const [requiredVersion, setRequiredVersion] = useState(1)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const [termsContent, setTermsContent] = useState('')
  const [scrolledToBottom, setScrolledToBottom] = useState(false)

  useEffect(() => {
    // Read the freshest user from the store instead of the subscribed `user`
    // so the effect only re-runs when the user id changes (user?.id dep below).
    const currentUser = useStore.getState().user
    const activeToken = token || localStorage.getItem('token');
    if (!currentUser || !activeToken || activeToken === 'null' || activeToken === 'undefined') {
      setOpen(false)
      return
    }

    const run = async () => {
      try {
        const [settingsRes, profileRes] = await Promise.all([
          fetch(`${API_BASE_URL}/settings`),
          fetch(`${API_BASE_URL}/user/profile`, { headers: { Authorization: `Bearer ${activeToken}` } }),
        ])

        const settingsJson = await settingsRes.json().catch(() => null)
        const profileJson = await profileRes.json().catch(() => null)

        const version = parseTermsVersion(settingsJson?.data)
        setRequiredVersion(version)
        setTermsContent(settingsJson?.data?.terms_and_conditions_content || '')

        let freshAcceptedVersion = Number(currentUser?.terms_accepted_version || 0)

        if (profileRes.ok && profileJson) {
          setUser(profileJson, token)
          freshAcceptedVersion = Number(profileJson.terms_accepted_version || 0)
        }
        
        setOpen(freshAcceptedVersion < version)
      } catch {
        // ignore; do not block app due to transient errors
      }
    }

    run()
  }, [user?.id, token, setUser])

  const accept = async () => {
    if (!token) return
    try {
      setSubmitting(true)
      setErr('')
      const res = await fetch(`${API_BASE_URL}/user/terms/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(json?.error || 'Failed to accept terms')
        return
      }
      setUser(json, token)
      setOpen(false)
    } catch {
      setErr('Connection error while accepting terms')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (open) {
      const check = () => {
        const el = document.getElementById('terms-scroll-container');
        if (el) {
          const isScrollable = el.scrollHeight > el.clientHeight + 20;
          if (!isScrollable) {
            setScrolledToBottom(true);
          }
        }
      };
      
      check();
      const t1 = setTimeout(check, 100);
      const t2 = setTimeout(check, 1000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      setScrolledToBottom(false);
    }
  }, [open, termsContent]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 30) {
      setScrolledToBottom(true)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-500" />
      
      {/* Premium Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="bg-slate-900 p-8 text-white relative">
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-white/10 rounded-2xl">
                    <ShieldCheck size={24} className="text-emerald-400" />
                </div>
                <div>
                    <h3 className="text-2xl font-black tracking-tight">Terms Required</h3>
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">Update v{requiredVersion}.0</p>
                </div>
            </div>
        </div>

        <div id="terms-scroll-container" className="p-8 max-h-[50vh] overflow-y-auto no-scrollbar bg-slate-50" onScroll={handleScroll}>
            <div className="space-y-6">
                <p className="text-[13px] font-bold text-slate-500 leading-relaxed italic">
                    We've updated our Terms of Service. Please review the key points below before continuing.
                </p>
                
                <div className="space-y-4">
                  {(termsContent || `# JDLX Terms of Service
- By using JDLX MOBILE, you agree to our Terms & Conditions.
- We provide premium mobile commerce and reliable delivery services.
- Accuracy of delivery location is your responsibility.
# Orders & Payments
- Prices and stock availability may change without notice.
- Platform fees and delivery charges apply as shown at checkout.
- We use secure, encrypted payment gateways for all transactions.
# Returns & Refunds
- Return eligibility depends on product category and condition.
- Refunds are provided as in-app wallet balance. Product replacements or original source refunds may be processed if possible.
# Security
- Your data is protected using industry-standard security measures.
- We do not share your personal information with third parties.`)
                    .split('\n')
                    .filter(l => l.trim())
                    .map((line, i) => {
                      const isHeading = line.startsWith('#');
                      const cleanText = line.replace(/^#{1,6}\s+/, '').replace(/^[-•]\s+/, '').trim();
                      
                      if (isHeading) {
                        return (
                          <h4 key={i} className="text-[11px] font-black uppercase tracking-widest text-slate-900 pt-2">
                            {cleanText}
                          </h4>
                        );
                      }
                      
                      return (
                        <div key={i} className="flex items-start gap-3">
                          <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                          <p className="text-sm font-bold text-slate-700 leading-relaxed">{cleanText}</p>
                        </div>
                      );
                    })}
                </div>
            </div>
            {!scrolledToBottom && (
              <div className="mt-8 flex justify-center animate-bounce opacity-40">
                <ChevronDown size={20} />
              </div>
            )}
        </div>

        <div className="p-8 bg-white border-t border-slate-100">
            {err && (
              <div className="mb-4 p-4 rounded-2xl bg-red-50 border border-red-100 flex items-center gap-3 text-red-600">
                <AlertCircle size={16} />
                <span className="text-xs font-bold">{err}</span>
              </div>
            )}
            
            <button 
                onClick={accept}
                disabled={submitting || !scrolledToBottom}
                className={`w-full py-5 rounded-[1.5rem] font-black text-sm uppercase tracking-widest transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3
                    ${(submitting || !scrolledToBottom) ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/20'}
                `}
            >
                {submitting ? 'Updating...' : !scrolledToBottom ? 'Scroll to Read' : (
                    <>
                        <CheckCircle2 size={18} />
                        Confirm & Accept
                    </>
                )}
            </button>
            <p className="mt-4 text-[10px] text-center font-bold text-slate-400 uppercase tracking-tight">
                {!scrolledToBottom ? 'Please scroll to the bottom to enable acceptance' : 'Terms reviewed. You may now proceed.'}
            </p>
        </div>
      </div>
    </div>
  )
}

export default TermsGate

