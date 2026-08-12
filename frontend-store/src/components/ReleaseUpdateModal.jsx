import { useMemo, useState } from 'react'
import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { CUSTOMER_RELEASE_UPDATES } from '../config/releaseUpdates'
import useScrollLock from '../hooks/useScrollLock'

const STORAGE_KEY = 'jdlx_customer_seen_release_update'

export default function ReleaseUpdateModal() {
  const release = CUSTOMER_RELEASE_UPDATES
  // Read the "seen" flag once at mount (the release payload is a module
  // constant, so a lazy initializer is equivalent to the old effect).
  const [open, setOpen] = useState(() => {
    try {
      const seenReleaseId = localStorage.getItem(STORAGE_KEY)
      return Boolean(release?.id) && seenReleaseId !== release.id
    } catch {
      return Boolean(release?.id)
    }
  })

  // Lock the page behind the release-notes modal while it is open.
  useScrollLock(open)

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
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/35 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md dark:bg-black/72 sm:items-center sm:p-6">
      <div className="w-full max-w-md overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 dark:border-white/10 dark:bg-neutral-950 dark:shadow-black/60">
        <div className="max-h-[calc(100dvh-24px)] overflow-y-auto">
        <div className="relative border-b border-slate-200 bg-slate-50 px-5 py-5 dark:border-white/10 dark:bg-neutral-900 sm:px-6">
          <button
            onClick={closeModal}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-slate-600 transition-colors hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Close update notes"
          >
            <X size={18} />
          </button>

          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-200/70">
            <Sparkles size={22} />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
            {release.releasedAt}
          </p>
          <div className="mt-2 text-2xl font-black tracking-normal text-slate-950 dark:text-white" role="heading" aria-level="2">
            {release.title}
          </div>
          <p className="mt-2 pr-8 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">
            {release.subtitle}
          </p>
        </div>

        <div className="space-y-3 px-5 py-5 sm:px-6">
          {releaseItems.map((item) => (
            <div key={item.title} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.06]">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <div className="text-sm font-black tracking-normal text-slate-950 dark:text-white" role="heading" aria-level="3">{item.title}</div>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-700 dark:text-slate-200">{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <button
            onClick={closeModal}
            className="h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-300/60 transition-transform active:scale-[0.98] dark:bg-amber-400 dark:text-slate-950 dark:shadow-none"
          >
            Got it
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
