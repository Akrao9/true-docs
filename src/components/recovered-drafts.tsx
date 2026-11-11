"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Download, LifeBuoy, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { draftCopyTitle } from "@/lib/draft-protection";
import {
  clearIfCovered,
  listDrafts,
  pendingSave,
  recordKey,
  removeDraft,
  draftSnapshotKey,
  subscribeDrafts,
  type RecoveredDraft,
} from "@/lib/draft-recovery";
import { errorMessage } from "@/lib/errors";
import { timeAgo } from "@/lib/format";

/**
 * Drafts kept in this browser because saving them to the server failed when the user left the editor (see
 * draft-recovery.ts). Each can be retried as a copy, downloaded as Markdown (works even when the server
 * refuses it, e.g. over the size cap), or discarded.
 */
export function RecoveredDrafts({ token, userId }: { token: string; userId: string }) {
  const raw = useSyncExternalStore(
    subscribeDrafts,
    // `pending`: the editor's exit save for this record is still in flight in this tab.
    () => JSON.stringify(listDrafts(userId).map((d) => ({ ...d, pending: pendingSave(recordKey(d)) !== undefined }))),
    () => "[]",
  );
  const drafts = useMemo(() => JSON.parse(raw) as (RecoveredDraft & { pending: boolean })[], [raw]);
  if (drafts.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <LifeBuoy className="size-4" /> Recovered drafts ({drafts.length})
      </h2>
      <p className="mb-3 text-sm">
        These drafts couldn&apos;t be saved to the server when you left the editor, so this browser kept them.
        They aren&apos;t in your documents yet.
      </p>
      <ul className="grid gap-2">
        {drafts.map((d) => (
          <DraftRow key={recordKey(d)} token={token} draft={d} />
        ))}
      </ul>
    </section>
  );
}

function DraftRow({ token, draft }: { token: string; draft: RecoveredDraft & { pending: boolean } }) {
  const router = useRouter();
  const create = useMutation(api.documents.create);
  const [busy, setBusy] = useState<"save" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function saveAsCopy() {
    setBusy("save");
    setError(null);
    try {
      // If the editor's exit save for this record is still running, wait for it rather than racing it.
      const inFlight = pendingSave(recordKey(draft));
      if (inFlight) {
        await inFlight.catch(() => {});
        const stillThere = listDrafts(draft.userId).some((d) => recordKey(d) === recordKey(draft));
        if (!stillThere) return toast.success("Your draft was already saved as a copy.");
      }
      const title = draftCopyTitle(draft.title);
      // Same snapshot key as the editor uses, so even a save we can't see (another tab, a lost response)
      // returns the existing copy instead of creating a second one.
      const id = await create({ token, title, content: draft.content, createKey: draftSnapshotKey(draft) });
      clearIfCovered(draft, draft.rev); // only after the server acknowledged it
      toast.success(`Saved as "${title}"`);
      router.push(`/doc/${id}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save it. Check your connection and try again."));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    try {
      const { draftToMarkdown } = await import("@/lib/draft-export");
      const markdown = await draftToMarkdown(draft.content);
      const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${draft.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "draft"} (recovered).md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't prepare the download.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-lg border border-amber-200 bg-background px-3 py-2 text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{draft.title}</span>
          <span className="block text-xs text-muted-foreground">
            Unsaved draft · {timeAgo(draft.savedAt)} · {Math.round(new Blob([draft.content]).size / 1024)} KB
          </span>
        </span>
        {confirmDiscard ? (
          <>
            <span className="text-sm">Discard permanently?</span>
            <Button size="sm" variant="destructive" onClick={() => removeDraft(draft)}>
              Discard
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={saveAsCopy} disabled={busy !== null || draft.pending}>
              {busy === "save" || draft.pending ? <Loader2 className="animate-spin" /> : <Save />}{" "}
              {draft.pending ? "Saving to server…" : "Save as a copy"}
            </Button>
            <Button size="sm" variant="outline" onClick={download} disabled={busy !== null}>
              {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />} Download .md
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDiscard(true)}
              disabled={draft.pending}
              aria-label={`Discard ${draft.title}`}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error} You can still download it.
        </p>
      )}
    </li>
  );
}
