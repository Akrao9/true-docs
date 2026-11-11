"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { draftCopyTitle, exitActions, planExitSave, type SavedCopy } from "@/lib/draft-protection";
import {
  clearIfCovered,
  recordKey,
  removeDraft,
  snapshotKey,
  stashDraft,
  trackPendingSave,
} from "@/lib/draft-recovery";
import { errorMessage } from "@/lib/errors";
import type { DocEditorInstance } from "./schema";

/**
 * "Save draft as a copy" for a draft the server refused (save conflict).
 *
 * - The first save creates a new document owned by the user; later saves update that same copy.
 * - `rev` counts edits. A copy protects the draft only as it was at the revision it captured.
 * - Every copy write (manual or the exit safety net) runs through one queue, so they never overlap and the
 *   safety net can't create a second copy while a manual save is still in flight.
 * - On exit with an unprotected draft (browser Back, access removed, tab refresh/close), the draft is first
 *   stashed in this browser (draft-recovery.ts), then saved to the server. The local copy is removed only
 *   when the server acknowledges it, so a failed exit save leaves something to recover from the dashboard.
 */
export function useDraftCopy(opts: {
  token: string;
  userId: string;
  documentId: string;
  title: string;
  editorRef: RefObject<DocEditorInstance | null>;
}) {
  const create = useMutation(api.documents.create);
  const save = useMutation(api.documents.save);
  const [rev, setRev] = useState(0);
  const [copy, setCopy] = useState<SavedCopy | null>(null);
  const [op, setOp] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  // Identifies this editing session: its recovery record and the snapshot keys of the copies it creates.
  const [sessionId] = useState(() => crypto.randomUUID());
  const copyRef = useRef<SavedCopy | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Mutable state read after unmount / on pagehide. One stable object, so those handlers see current values.
  const exit = useRef({
    latestJson: null as string | null,
    rev: 0,
    copyOnExit: false, // a confirmed conflict: the exit safety net also saves a server copy
    // Risk context from server responses (already rendered, so current by the time the user can type):
    stale: false, // someone else saved a newer version: our next save will be refused
    failed: false, // our last save failed
    ackedRev: 0, // last edit revision the server accepted for the original document (0 = as loaded)
    stashedContent: null as string | null, // what our recovery record holds, to match a later server ack
    stashedRev: -1,
    discarded: false,
    stashed: false, // this session wrote a local recovery copy
  });
  // Latest props for handlers that outlive a render (unmount cleanup, pagehide).
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });

  /** Runs `task` after every previously queued copy write has settled. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => {});
    return run;
  }

  /** Create the copy, or update the existing one. Reads copyRef when it runs, i.e. after earlier writes. */
  async function writeCopy(content: string, capturedRev: number): Promise<SavedCopy> {
    const { token, title } = latest.current;
    const existing = copyRef.current;
    let next: SavedCopy | null = null;
    if (existing) {
      const result = await save({ token, id: existing.id as Id<"documents">, content, baseVersion: existing.version });
      // If the copy itself was changed elsewhere, don't overwrite it: fall through and make a fresh copy.
      if (result.ok) next = { ...existing, version: result.version, rev: capturedRev };
    }
    if (!next) {
      const copyTitle = draftCopyTitle(title);
      // Idempotent per snapshot: a retry of this same revision (dashboard, another tab) returns this copy.
      const id = await create({ token, title: copyTitle, content, createKey: snapshotKey(sessionId, capturedRev) });
      next = { id, version: 1, title: copyTitle, rev: capturedRev };
    }
    copyRef.current = next;
    setCopy(next);
    return next;
  }

  const ids = () => ({ userId: latest.current.userId, documentId: latest.current.documentId, sessionId });

  /** Writes this session's recovery record (its own key, so other tabs' records are never touched). */
  function stashLocally() {
    const s = exit.current;
    if (s.latestJson === null) return;
    const { title } = latest.current;
    const ok = stashDraft({ ...ids(), rev: s.rev, title, content: s.latestJson, savedAt: Date.now() });
    s.stashed = ok || s.stashed;
    if (ok) {
      s.stashedContent = s.latestJson;
      s.stashedRev = s.rev;
    }
  }

  /** The server acknowledged revision `ackRev`: drop our record unless a newer draft was stashed since. */
  function clearAcknowledged(ackRev: number) {
    clearIfCovered(ids(), ackRev);
  }

  async function saveCopy() {
    const editor = opts.editorRef.current;
    const content = editor ? JSON.stringify(editor.document) : exit.current.latestJson;
    if (content === null) return;
    const capturedRev = rev; // typing during the save increments rev, so the draft stays unprotected
    setOp({ kind: "saving" });
    try {
      const saved = await enqueue(() => writeCopy(content, capturedRev));
      clearAcknowledged(saved.rev);
      setOp({ kind: "idle" });
    } catch (err) {
      // The warning stays: nothing is marked protected unless the save succeeded.
      setOp({ kind: "error", message: errorMessage(err, "Couldn't save the copy. Check your connection and try again.") });
    }
  }

  // Exit safety net. Unmount covers in-app exits the guard can't intercept (browser Back, access removed);
  // pagehide covers refresh/close, where only a synchronous local stash can run.
  const writeRef = useRef(writeCopy);
  const enqueueRef = useRef(enqueue);
  useEffect(() => {
    writeRef.current = writeCopy;
    enqueueRef.current = enqueue;
  });
  useEffect(() => {
    const state = exit.current;
    // Decided from refs updated synchronously on each edit (not rendered state), so typing and pressing Back in
    // the same tick still counts the newest keystrokes. Rules: exitActions in draft-protection.ts.
    const actions = () =>
      exitActions({
        hasDraft: state.latestJson !== null,
        discarded: state.discarded,
        conflict: state.copyOnExit,
        failed: state.failed,
        stale: state.stale,
        rev: state.rev,
        ackedRev: state.ackedRev,
        // copyRef is set synchronously when a copy save succeeds, so this is current at exit.
        copiedRev: copyRef.current?.rev ?? -1,
      });
    const shouldStash = () => actions().stash;
    const shouldCopy = () => actions().copy;

    const onPageHide = () => {
      if (shouldStash()) stashLocally();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (!shouldStash()) return;
      try {
        stashLocally(); // local copy first, before any network
      } catch {
        // never let local storage problems stop the server save below
      }
      // Not a confirmed conflict: the editor's own final autosave is still on its way. If it succeeds,
      // onServerSaved clears the stash; if it's refused, the stash is what the dashboard recovers.
      if (!shouldCopy()) return;
      const content = state.latestJson!;
      const finalRev = state.rev;
      const exitSave = enqueueRef.current(async () => {
        // Runs after any in-flight manual save, so copyRef reflects it.
        const plan = planExitSave(copyRef.current, finalRev);
        return plan === "skip" ? copyRef.current! : writeRef.current(content, finalRev);
      });
      // Lets the dashboard (same tab) show "Saving…" and make a retry wait for this instead of racing it.
      trackPendingSave(recordKey(ids()), exitSave);
      exitSave.then(
          (c) => {
            clearAcknowledged(c.rev);
            toast.success(`Your unsaved draft was kept as "${c.title}".`);
          },
          (err) =>
            toast.error(
              `Your draft couldn't be saved to the server: ${errorMessage(err, "connection problem.")} ` +
                (state.stashed
                  ? "It's kept in this browser. Recover it from your dashboard."
                  : "This browser couldn't keep a copy either."),
              { duration: 15000 },
            ),
        );
    };
    // Mount/unmount only. The helpers used here read refs (`exit`, `latest`, `copyRef`) and the stable sessionId,
    // so the first render's versions always see current values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    rev,
    copy,
    op,
    saveCopy,
    onEdit: (json: string) => {
      exit.current.latestJson = json;
      exit.current.rev += 1;
      setRev(exit.current.rev);
    },
    markDiscarded: () => {
      exit.current.discarded = true;
      removeDraft(ids());
    },
    setRiskContext: (ctx: { stale: boolean; failed: boolean }) => {
      exit.current.stale = ctx.stale;
      exit.current.failed = ctx.failed;
    },
    /** Autosave acknowledged `content` on the original document: drop our stash if it holds exactly that. */
    onServerSaved: (content: string) => {
      const s = exit.current;
      if (content === s.latestJson) s.ackedRev = s.rev;
      if (s.stashedContent !== null && content === s.stashedContent) {
        clearAcknowledged(s.stashedRev);
        s.stashedContent = null;
      }
    },
    setCopyOnExit: (value: boolean) => {
      exit.current.copyOnExit = value;
    },
  };
}
