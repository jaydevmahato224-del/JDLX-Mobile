import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { CUSTOMER_RELEASE_UPDATES } from '../config/releaseUpdates'

const STORAGE_KEY = 'jdlx_customer_seen_release_update'

export default function ReleaseUpdateModal() {
  const release = CUSTOMER_RELEASE_UPDATES
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
      console.error('Failed to save release update state:', error)
    }
    setOpen(false)
  }

  if (!open || releaseItems.length === 0) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-950">
        <div className="relative border-b border-slate-100 bg-slate-50 px-6 py-5 dark:border-white/10 dark:bg-neutral-900">
          <button
            onClick={closeModal}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-slate-500 transition-colors hover:bg-white hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Close update notes"
          >
            <X size={18} />
          </button>

          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-200/70">
            <Sparkles size={22} />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-600">
            {release.releasedAt}
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
            {release.title}
          </h2>
          <p className="mt-2 pr-8 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
            {release.subtitle}
          </p>
        </div>

        <div className="space-y-3 px-6 py-5">
          {releaseItems.map((item) => (
            <div key={item.title} className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-3 dark:border-white/10 dark:bg-white/5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <h3 className="text-sm font-black text-slate-950 dark:text-white">{item.title}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={closeModal}
            className="h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-300/60 transition-transform active:scale-[0.98] dark:bg-amber-400 dark:text-slate-950 dark:shadow-none"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
