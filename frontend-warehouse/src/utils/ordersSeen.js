// Seen/unseen tracking for the Orders nav badge. Assignment ids are
// monotonic, so "anything newer than what the partner last saw" is simply
// id > lastSeen. Persisted per browser so the badge survives refreshes.
const LAST_SEEN_KEY = 'wh_lastSeenAssignmentId'

export const readLastSeenId = () => {
    try {
        const parsed = parseInt(localStorage.getItem(LAST_SEEN_KEY), 10)
        return Number.isFinite(parsed) ? parsed : 0
    } catch {
        return 0
    }
}

// Exported so the Orders page can mark everything visible as seen.
export const markOrdersSeen = (latestAssignmentId) => {
    try {
        if (Number.isFinite(latestAssignmentId)) {
            localStorage.setItem(LAST_SEEN_KEY, String(latestAssignmentId))
        }
    } catch { /* storage unavailable — badge simply always shows */ }
}

// Custom event so the layout badge updates instantly when the Orders page
// marks seen, without waiting for the next poll cycle.
export const ORDERS_SEEN_EVENT = 'warehouse:orders-seen'
