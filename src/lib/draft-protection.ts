/**
 * Rules for protecting a draft the server refused (save conflict), kept pure so they can be unit tested.
 *
 * `rev` counts editor changes in this session. A copy protects the draft only as it was at the revision the
 * copy captured: typing after (or during) the copy save makes the draft unprotected again.
 */
export type SavedCopy = { id: string; version: number; title: string; rev: number };

export type SaveStatusKind = "saved" | "unsaved" | "saving" | "error" | "conflict";

export function isDraftProtected(copy: SavedCopy | null, rev: number): boolean {
  return copy !== null && copy.rev === rev;
}

/**
 * Work that leaving now would lose:
 * - a refused draft (conflict) not yet covered by a copy;
 * - edits that couldn't be sent (error) and aren't covered by a copy;
 * - unsent edits while someone else's newer version is already known (sending them will conflict).
 */
export function draftAtRisk(args: {
  status: SaveStatusKind;
  copy: SavedCopy | null;
  rev: number;
  remoteIsNewer: boolean;
}): boolean {
  if (isDraftProtected(args.copy, args.rev)) return false;
  if (args.status === "conflict" || args.status === "error") return true;
  return args.remoteIsNewer && (args.status === "unsaved" || args.status === "saving");
}

/**
 * What the exit safety net should do once any in-flight copy save has settled:
 * - "skip": the copy already holds the final draft (e.g. a manual save finished with no edits after it);
 * - "update": a copy exists but lacks the latest edits, so update that same copy;
 * - "create": no copy yet.
 */
export function planExitSave(copy: SavedCopy | null, finalRev: number): "skip" | "update" | "create" {
  if (!copy) return "create";
  return copy.rev === finalRev ? "skip" : "update";
}

/**
 * What leaving the editor should do with the current draft. Inputs are read from refs at exit time, so edits typed
 * in the same tick as Back count:
 * - stash locally whenever edits are at risk: a confirmed conflict, a failed save, or a stale editor (someone else
 *   saved a newer version) holding edits the server hasn't acknowledged yet;
 * - additionally create a server copy only for a confirmed conflict, so ordinary pending saves never make documents;
 * - nothing when a saved copy already holds this exact revision (`copiedRev`): after "Save draft as a copy", the
 *   original editor is still stale, but leaving it (Open my copy / Open latest version) loses nothing.
 */
export function exitActions(s: {
  hasDraft: boolean;
  discarded: boolean;
  conflict: boolean;
  failed: boolean;
  stale: boolean;
  rev: number;
  ackedRev: number;
  /** Revision the saved copy captured, or -1 when there is no copy. */
  copiedRev: number;
}): { stash: boolean; copy: boolean } {
  if (!s.hasDraft || s.discarded || s.rev <= s.copiedRev) return { stash: false, copy: false };
  const stash = s.conflict || s.failed || (s.stale && s.rev > s.ackedRev);
  return { stash, copy: stash && s.conflict };
}

const SUFFIX = " (your draft)";

export function draftCopyTitle(originalTitle: string, maxLength = 200): string {
  return originalTitle.slice(0, maxLength - SUFFIX.length).trimEnd() + SUFFIX;
}
