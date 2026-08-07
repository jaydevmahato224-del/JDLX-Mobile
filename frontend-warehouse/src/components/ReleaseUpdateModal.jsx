import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { WAREHOUSE_RELEASE_UPDATES } from '../config/releaseUpdates'

const STORAGE_KEY = 'jdlx_warehouse_seen_release_update'

export default function ReleaseUpdateModal() {
    const release = WAREHOUSE_RELEASE_UPDATES
    const [open, setOpen] = useState(false)

    useEffect(() => {
        try {
            const seenReleaseId = localStorage.getItem(STORAGE_KEY)
            setOpen(Boolean(release?.id) && seenReleaseId !== release.id)
        } catch (error) {
            setOpen(Boolean(release?.id))
        }
    }, [release?.id])

    useEffect(() => {
        if (!open) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [open])

    const releaseItems = useMemo(() => {
        return Array.isArray(release?.items) ? release.items.filter((item) => item?.title) : []
    }, [release?.items])

    const closeModal = () => {
        try {
            localStorage.setItem(STORAGE_KEY, release.id)
        } catch (error) {
            console.error('Failed to save warehouse release update state:', error)
        }
        setOpen(false)
    }

    if (!open || releaseItems.length === 0) return null

    return (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/72 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:items-center sm:p-6">
            <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0b1224] shadow-2xl">
                <div className="max-h-[calc(100dvh-24px)] overflow-y-auto">
                <div className="relative border-b border-white/10 bg-white/[0.03] px-5 py-5 sm:px-6">
                    <button
                        onClick={closeModal}
                        className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label="Close warehouse update notes"
                    >
                        <X size={18} />
                    </button>

                    <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-950/40">
                        <Sparkles size={22} />
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
                        {release.releasedAt}
                    </p>
                    <div className="mt-2 text-2xl font-black tracking-normal text-white" role="heading" aria-level="2">
                        {release.title}
                    </div>
                    <p className="mt-2 pr-8 text-sm font-semibold leading-6 text-slate-200">
                        {release.subtitle}
                    </p>
                </div>

                <div className="space-y-3 px-5 py-5 sm:px-6">
                    {releaseItems.map((item) => (
                        <div key={item.title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                            <div>
                                <div className="text-sm font-black tracking-normal text-white" role="heading" aria-level="3">{item.title}</div>
                                <p className="mt-1 text-xs font-medium leading-5 text-slate-200">{item.description}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                    <button
                        onClick={closeModal}
                        className="h-12 w-full rounded-2xl bg-amber-400 text-sm font-black text-slate-950 shadow-lg shadow-amber-950/30 transition-transform active:scale-[0.98]"
                    >
                        Got it
                    </button>
                </div>
                </div>
            </div>
        </div>
    )
}
