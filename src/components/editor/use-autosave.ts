"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";

export type SaveStatus =
  | { kind: "saved" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  // Someone else saved a newer version. We stop autosaving rather than overwrite their work.
  | { kind: "conflict" };

/**
 * Debounced autosave against the versioned `documents.save` mutation.
 * - One save in flight at a time. Edits made during a save are sent right after it finishes.
 * - Each save sends the version it builds on. A conflict stops autosave until the user reloads.
 */
export function useAutosave(opts: {
  token: string;
  id: Id<"documents">;
  baseVersion: number;
  /** Called with the exact content the server accepted (also for the final save sent after unmount). */
  onSaved?: (content: string) => void;
}) {
  const onSavedRef = useRef(opts.onSaved);
  useEffect(() => {
    onSavedRef.current = opts.onSaved;
  });
  const save = useMutation(api.documents.save);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved" });
  const [version, setVersion] = useState(opts.baseVersion);

  const versionRef = useRef(opts.baseVersion);
  const pendingRef = useRef<string | null>(null); // latest content not yet sent
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false); // set on conflict

  const run = useCallback(async () => {
    if (inFlightRef.current) return; // the running loop will pick up the latest content
    inFlightRef.current = true;
    try {
      // Keep saving until nothing new arrived during the last save.
      while (pendingRef.current !== null && !stoppedRef.current) {
        const content = pendingRef.current;
        pendingRef.current = null;
        setStatus({ kind: "saving" });
        try {
          const result = await save({ token: opts.token, id: opts.id, content, baseVersion: versionRef.current });
          if (!result.ok) {
            stoppedRef.current = true;
            pendingRef.current ??= content;
            setStatus({ kind: "conflict" });
            return;
          }
          versionRef.current = result.version;
          setVersion(result.version);
          onSavedRef.current?.(content);
        } catch (err) {
          // Keep the content so the next edit (or Retry) sends it again.
          pendingRef.current ??= content;
          setStatus({ kind: "error", message: errorMessage(err, "Couldn't save. Check your connection.") });
          return;
        }
      }
      if (!stoppedRef.current) setStatus({ kind: "saved" });
    } finally {
      inFlightRef.current = false;
    }
  }, [save, opts.token, opts.id]);

  const debounced = useDebouncedCallback(run, 800, { maxWait: 5000 });

  const onChange = useCallback(
    (content: string) => {
      if (stoppedRef.current) return;
      pendingRef.current = content;
      setStatus((s) => (s.kind === "saving" ? s : { kind: "unsaved" }));
      debounced();
    },
    [debounced],
  );

  // Save immediately when leaving the page, and warn if something is still unsent.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current !== null || inFlightRef.current) {
        debounced.flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      debounced.flush();
    };
  }, [debounced]);

  return { status, version, onChange, retry: run };
}
