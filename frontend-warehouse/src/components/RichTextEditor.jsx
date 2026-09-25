import { useEffect, useRef, useCallback } from 'react'

/**
 * Lightweight rich text editor for the warehouse description field.
 *
 * Zero dependencies — a controlled-ish contentEditable with document.execCommand
 * formatting. Produces the SAME simple HTML the panel has always saved
 * (<strong>, <b>, <em>, <u>, <br>, <ul>/<ol>/<li>), so the backend, DB schema
 * and the storefront's plain-text converter keep working unchanged.
 *
 * Behavior notes:
 * - The parent keeps `value` as the single source of truth; we sync it into
 *   the contentEditable ONLY when it differs from the DOM (and the editor
 *   isn't focused), so typing never fights with React re-renders.
 * - Every input/change bubbles the sanitized HTML up via onChange(html).
 * - Sanitization strips everything except the allow-listed tags/attributes,
 *   so even a paste from Word/Docs can't smuggle scripts or junk markup.
 */

const ALLOWED_TAGS = new Set([
  'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'P', 'DIV', 'SPAN', 'A',
])

function sanitizeHtml(html) {
  if (typeof window === 'undefined' || !html) return ''
  const host = document.createElement('div')
  host.innerHTML = html

  const walk = (node) => {
    [...node.children].forEach((el) => {
      walk(el)
      if (!ALLOWED_TAGS.has(el.tagName)) {
        // Unknown tag: unwrap (keep its text/children), never render it.
        el.replaceWith(...el.childNodes)
        return
      }
      // Drop every attribute except safe href on anchors.
      ;[...el.attributes].forEach((attr) => {
        const keep = el.tagName === 'A' && attr.name.toLowerCase() === 'href' && /^https?:/i.test(attr.value)
        if (!keep) el.removeAttribute(attr.name)
      })
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noreferrer noopener')
      }
    })
  }
  walk(host)
  return host.innerHTML
}

const TOOLS = [
  { cmd: 'bold', label: 'B', title: 'Bold (Ctrl+B)', className: 'font-black' },
  { cmd: 'italic', label: 'I', title: 'Italic (Ctrl+I)', className: 'italic font-serif' },
  { cmd: 'underline', label: 'U', title: 'Underline (Ctrl+U)', className: 'underline' },
  { cmd: 'strikeThrough', label: 'S', title: 'Strikethrough', className: 'line-through' },
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bullet list' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
]

export default function RichTextEditor({ value, onChange, placeholder, minHeight = '9rem', className = '' }) {
  const ref = useRef(null)

  // Sync external value → DOM only when it actually differs and the user
  // isn't mid-edit (prevents caret jumps while typing).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (document.activeElement === el) return
    if (el.innerHTML !== (value || '')) {
      el.innerHTML = value || ''
    }
  }, [value])

  const emit = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Browsers vary in what they emit; normalize + sanitize before storing.
    const html = sanitizeHtml(el.innerHTML)
    if (html !== value) onChange?.(html)
  }, [onChange, value])

  const exec = useCallback((cmd) => {
    const el = ref.current
    if (!el) return
    el.focus()
    document.execCommand(cmd, false, null)
    emit()
  }, [emit])

  return (
    <div className={`relative ${className}`}>
      <div className="flex flex-wrap items-center gap-1 mb-2 p-1.5 bg-slate-950/50 border border-white/10 rounded-2xl">
        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            title={t.title}
            onMouseDown={(e) => e.preventDefault()} // keep editor selection
            onClick={() => exec(t.cmd)}
            className={`px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 text-[11px] hover:text-amber-400 hover:border-amber-400/20 transition-all ${t.className || ''}`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto pr-2 text-[9px] font-black uppercase tracking-widest text-slate-600">
          B • I • U • Lists
        </span>
      </div>
      <div className="relative">
        <div
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder || 'Description'}
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          style={{ minHeight }}
          className="w-full max-h-72 overflow-y-auto bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all whitespace-pre-wrap break-words [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-slate-600 [&:empty]:before:pointer-events-none"
        />
      </div>
    </div>
  )
}
