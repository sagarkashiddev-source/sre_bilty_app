/**
 * Local-only cache used purely for offline resilience: recovering an
 * in-progress invoice draft if the browser/tab closes unexpectedly, and
 * queuing writes made while offline. The server is always the source of
 * truth — this cache is never read on normal app load once online.
 */

const DRAFT_KEY = "bilty_offline_draft_v1";

export const draftCache = {
  save(draft) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, savedAt: Date.now() }));
    } catch {
      /* storage full or unavailable — draft recovery is best-effort only */
    }
  },
  load() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.draft || null;
    } catch {
      return null;
    }
  },
  clear() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  },
};
