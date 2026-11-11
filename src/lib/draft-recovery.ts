/**
 * Browser-local recovery copies of refused drafts, so leaving the editor can never leave the server save as the
 * only copy of someone's work (it can fail: over the size cap, offline…).
 *
 * - One record per *editing session* (tab × document open), so two tabs editing the same document never share
 *   or delete each other's record.
 * - Each record stores the edit revision it captured. A server acknowledgement for revision R clears the record
 *   only if the record is at R or older; a newer stash (typing after the save started) survives.
 * - Written before any network attempt; removed on acknowledgement or explicit discard.
 * - Every storage access, including resolving `localStorage` itself (which throws SecurityError when blocked),
 *   happens inside try/catch: recovery must never break saving or rendering.
 */
export type RecoveredDraft = {
  userId: string;
  documentId: string;
  sessionId: string;
  rev: number; // edit revision this content was captured at
  title: string;
  content: string; // BlockNote blocks as JSON
  savedAt: number;
};

const PREFIX = "true-docs.recovery.";
const CHANGE_EVENT = "true-docs:recovery-changed";

/**
 * Session id given to a previous-release record that couldn't be migrated (e.g. storage full). Such a record keeps
 * its original key, `PREFIX<userId>.<documentId>`, and recordKey maps back to it so retry / discard still work.
 */
export const LEGACY_SESSION = "legacy";

export const recordKey = (d: Pick<RecoveredDraft, "userId" | "documentId" | "sessionId">) =>
  d.sessionId === LEGACY_SESSION
    ? `${PREFIX}${d.userId}.${d.documentId}`
    : `${PREFIX}${d.userId}.${d.documentId}.${d.sessionId}`;

/** Server idempotency key for "create a copy of exactly this snapshot". */
export const snapshotKey = (sessionId: string, rev: number) => `${sessionId}:${rev}`;

/** Snapshot key for a stored record. A legacy record gets the same key whether or not it was migrated. */
export const draftSnapshotKey = (d: Pick<RecoveredDraft, "sessionId" | "rev" | "savedAt">) =>
  d.sessionId === LEGACY_SESSION ? snapshotKey(`legacy-${d.savedAt}`, 0) : snapshotKey(d.sessionId, d.rev);

function resolve(storage?: Storage): Storage {
  return storage ?? window.localStorage; // may throw (SecurityError): callers are inside try
}

function notify() {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // not in a browser
  }
}

/** Returns true if the draft is now stored locally. Never throws. */
export function stashDraft(draft: RecoveredDraft, storage?: Storage): boolean {
  try {
    resolve(storage).setItem(recordKey(draft), JSON.stringify(draft));
    notify();
    return true;
  } catch {
    return false; // full, blocked or unavailable: the caller still tries the server
  }
}

const isLegacyKey = (key: string) => key.slice(PREFIX.length).split(".").length === 2; // Convex ids have no dots

/** Reads a record in either format. A legacy record is read in place, so it stays usable even unmigrated. */
function read(key: string, s: Storage): RecoveredDraft | null {
  try {
    const d = JSON.parse(s.getItem(key) ?? "") as Partial<RecoveredDraft>;
    if (!d || typeof d.content !== "string" || typeof d.userId !== "string" || typeof d.documentId !== "string") {
      return null;
    }
    if (typeof d.rev === "number" && typeof d.sessionId === "string") return d as RecoveredDraft;
    if (!isLegacyKey(key)) return null;
    return {
      userId: d.userId,
      documentId: d.documentId,
      sessionId: LEGACY_SESSION,
      rev: 0,
      title: typeof d.title === "string" ? d.title : "Untitled document",
      content: d.content,
      savedAt: typeof d.savedAt === "number" ? d.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * The server acknowledged a copy of revision `ackRev` from this session: remove the record only if it isn't
 * newer than that. Never throws.
 */
export function clearIfCovered(
  ids: Pick<RecoveredDraft, "userId" | "documentId" | "sessionId">,
  ackRev: number,
  storage?: Storage,
) {
  try {
    const s = resolve(storage);
    const key = recordKey(ids);
    const current = read(key, s);
    if (current && current.rev > ackRev) return; // a newer draft was stashed after this save started
    s.removeItem(key);
    notify();
  } catch {
    // nothing to clear
  }
}

/** Explicit discard of one record. Never throws. */
export function removeDraft(ids: Pick<RecoveredDraft, "userId" | "documentId" | "sessionId">, storage?: Storage) {
  try {
    resolve(storage).removeItem(recordKey(ids));
    notify();
  } catch {
    // nothing to remove
  }
}

/**
 * The previous release stored one record per user + document (`PREFIX<userId>.<documentId>`) without a session
 * id or revision. Rewrite those into the current shape (new key first, then remove the old one) so drafts saved
 * before the upgrade stay recoverable. Idempotent and silent (no change event): it runs inside listDrafts.
 */
export function migrateLegacyDrafts(storage?: Storage) {
  try {
    const s = resolve(storage);
    const legacyKeys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      // Convex ids have no dots, so a legacy key has exactly two segments after the prefix.
      if (key?.startsWith(PREFIX) && isLegacyKey(key)) legacyKeys.push(key);
    }
    for (const key of legacyKeys) {
      try {
        const old = JSON.parse(s.getItem(key) ?? "") as Partial<RecoveredDraft>;
        if (typeof old.content !== "string" || typeof old.userId !== "string" || typeof old.documentId !== "string") {
          continue; // unreadable: leave it untouched rather than delete someone's data
        }
        const savedAt = typeof old.savedAt === "number" ? old.savedAt : 0; // same fallback as read()
        const migrated: RecoveredDraft = {
          userId: old.userId,
          documentId: old.documentId,
          sessionId: `legacy-${savedAt}`,
          rev: 0,
          title: typeof old.title === "string" ? old.title : "Untitled document",
          content: old.content,
          savedAt,
        };
        s.setItem(recordKey(migrated), JSON.stringify(migrated));
        s.removeItem(key); // only after the new record is written
      } catch {
        // keep the legacy record if anything fails; we'll retry next time
      }
    }
  } catch {
    // storage unavailable
  }
}

/** All records for a user, newest first (legacy records included). Never throws; [] when storage is unavailable. */
export function listDrafts(userId: string, storage?: Storage): RecoveredDraft[] {
  const drafts: RecoveredDraft[] = [];
  migrateLegacyDrafts(storage);
  try {
    const s = resolve(storage);
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(`${PREFIX}${userId}.`)) continue;
      const d = read(key, s);
      if (d && d.userId === userId) drafts.push(d);
    }
  } catch {
    return [];
  }
  return drafts.sort((a, b) => b.savedAt - a.savedAt);
}

// ---------- In-tab registry of server saves still in flight for a record ----------
// The editor registers its exit save here, so the dashboard (same tab) can show "Saving…" and make a retry wait
// for it instead of racing it. Cross-tab and closed-tab cases are covered by the server's snapshot idempotency.
const pending = new Map<string, Promise<unknown>>();

export function trackPendingSave(key: string, save: Promise<unknown>) {
  pending.set(key, save);
  notify();
  const done = () => {
    if (pending.get(key) === save) pending.delete(key);
    notify();
  };
  save.then(done, done);
}

export function pendingSave(key: string): Promise<unknown> | undefined {
  return pending.get(key);
}

/** For useSyncExternalStore: fires on changes from this tab and from other tabs. */
export function subscribeDrafts(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
