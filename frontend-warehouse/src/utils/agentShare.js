// Add-Product Agent login-link helpers — used by the manager page
// (AddProductAgents) and the agent workspace (AgentWorkspace).
// Login route is PUBLIC (no panel auth) and doubles as the PWA start_url.

export const AGENT_LOGIN_PATH = '/warehouse/agent'

export const agentLoginUrl = () => window.location.origin + AGENT_LOGIN_PATH

const SHARE_TEXT = 'JDLX Add-Product Agent login — yahan se login karen:'

/**
 * Share the agent login link. Preference order:
 *   1. Native share sheet (mobile) — user cancel → 'cancelled' (not an error).
 *   2. WhatsApp web (desktop / no Web Share) — agents live on WhatsApp.
 *   3. Clipboard copy as the last resort.
 * Returns what happened so callers can toast accordingly:
 *   'shared' | 'cancelled' | 'whatsapp' | 'copied'
 */
export async function shareAgentLink(url = agentLoginUrl()) {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'JDLX Add-Product Agent', text: SHARE_TEXT, url })
      return 'shared'
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'
    // Any other share failure falls through to WhatsApp below.
  }
  try {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${url}`)}`, '_blank', 'noopener')
    return 'whatsapp'
  } catch {
    await navigator.clipboard?.writeText(url).catch(() => {})
    return 'copied'
  }
}
