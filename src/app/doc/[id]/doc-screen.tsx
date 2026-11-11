"use client";

import { useMutation, useQuery } from "convex/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertTriangle, Check, CloudOff, Copy, FileText, Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { AppHeader } from "@/components/app-header";
import { PrintMenu } from "@/components/print-menu";
import { EditorBoundary } from "@/components/editor/editor-boundary";
import { parseStoredContent, type DocEditorInstance } from "@/components/editor/schema";
import { useAutosave, type SaveStatus } from "@/components/editor/use-autosave";
import { useDraftCopy } from "@/components/editor/use-draft-copy";
import { FullPageSpinner, RequireSession } from "@/components/screen";
import { ShareDialog } from "@/components/share-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { draftAtRisk } from "@/lib/draft-protection";
import { errorMessage } from "@/lib/errors";
import { useLeaveGuard, useRequestLeave } from "@/lib/leave-guard";
import { useSession } from "@/lib/session";

const DocEditor = dynamic(() => import("@/components/editor/doc-editor"), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-md bg-muted/50" />,
});

type LoadedDoc = NonNullable<FunctionReturnType<typeof api.documents.get>>;

export function DocScreen() {
  const { id } = useParams<{ id: string }>();
  return <RequireSession>{(token) => <DocLoader token={token} id={id} />}</RequireSession>;
}

function DocLoader({ token, id }: { token: string; id: string }) {
  const doc = useQuery(api.documents.get, { token, id });
  if (doc === undefined) return <FullPageSpinner />;
  if (doc === null) return <NotFound />;
  return doc.role === "viewer" ? <ViewerDoc token={token} doc={doc} /> : <EditableDoc token={token} doc={doc} />;
}

/** Viewers can't type, so they can be shown every new version live: remount the editor on each one. */
function ViewerDoc({ token, doc }: { token: string; doc: LoadedDoc }) {
  return (
    <DocLayout token={token} doc={doc} status={null}>
      <EditorArea key={doc.version} content={doc.content} editable={false} />
    </DocLayout>
  );
}

/**
 * Editors work on a snapshot taken when the doc opened. Newer versions from other people are announced
 * with a banner, not pushed into the editor, so a remote save never moves the cursor or erases typing.
 */
function EditableDoc({ token, doc }: { token: string; doc: LoadedDoc }) {
  const [snapshot, setSnapshot] = useState({ content: doc.content, version: doc.version, n: 0 });
  const reload = () => setSnapshot((s) => ({ content: doc.content, version: doc.version, n: s.n + 1 }));
  return <EditSession key={snapshot.n} token={token} doc={doc} snapshot={snapshot} onReload={reload} />;
}

function EditSession(props: {
  token: string;
  doc: LoadedDoc;
  snapshot: { content: string; version: number };
  onReload: () => void;
}) {
  const { token, doc, snapshot, onReload } = props;
  const router = useRouter();
  const requestLeave = useRequestLeave();
  // onSaved is forwarded through a ref: the draft hook is created below.
  const onSavedRef = useRef<(content: string) => void>(() => {});
  const autosave = useAutosave({
    token,
    id: doc._id,
    baseVersion: snapshot.version,
    onSaved: (content) => onSavedRef.current(content),
  });
  const remoteIsNewer = doc.version > autosave.version && autosave.status.kind !== "saving";
  const editorRef = useRef<DocEditorInstance | null>(null);
  const session = useSession();
  const userId = session.status === "signedIn" ? session.user._id : "unknown";
  const draft = useDraftCopy({ token, userId, documentId: doc._id, title: doc.title, editorRef });

  const conflict = autosave.status.kind === "conflict";
  const atRisk = draftAtRisk({ status: autosave.status.kind, copy: draft.copy, rev: draft.rev, remoteIsNewer });

  // One guard for every in-app exit: Reload, the logo, Switch user, Open my copy / latest version.
  useLeaveGuard(
    atRisk
      ? {
          title: "Discard your unsaved draft?",
          message: conflict
            ? `Your draft wasn't saved because ${doc.updatedByName} saved a newer version first. Leaving now discards it. Use "Save draft as a copy" to keep it.`
            : "Some of your edits haven't been saved. Leaving now discards them.",
          confirmLabel: "Discard draft",
          onDiscard: draft.markDiscarded,
        }
      : null,
  );
  // Safety net for exits the guard can't intercept (browser Back, access removed): keep a refused draft as a copy.
  const { setCopyOnExit, setRiskContext, onServerSaved } = draft;
  useEffect(() => {
    // Server-driven risk signals; the edit revision itself is tracked synchronously inside the hook.
    setRiskContext({ stale: doc.version > autosave.version, failed: autosave.status.kind === "error" });
    setCopyOnExit(conflict && atRisk); // also save a server copy only once a conflict is confirmed
    onSavedRef.current = onServerSaved;
  });

  const reload = () => requestLeave(onReload);

  return (
    <DocLayout token={token} doc={doc} status={autosave.status} onRetry={autosave.retry}>
      {conflict ? (
        <ConflictBanner
          otherName={doc.updatedByName}
          draft={draft}
          protectedNow={!atRisk}
          onCopyToClipboard={() => copyDraft(editorRef.current)}
          onOpenCopy={(id) => requestLeave(() => router.push(`/doc/${id}`))}
          onOpenLatest={reload}
        />
      ) : remoteIsNewer ? (
        <Banner tone="info" onReload={reload}>
          {doc.updatedByName} saved a newer version.
          {autosave.status.kind === "unsaved" && " Reloading discards your unsaved edits."}
        </Banner>
      ) : null}
      <EditorArea
        content={snapshot.content}
        editable
        onChange={(json) => {
          draft.onEdit(json);
          autosave.onChange(json);
        }}
        editorRef={editorRef}
      />
    </DocLayout>
  );
}

function ConflictBanner(props: {
  otherName: string;
  draft: ReturnType<typeof useDraftCopy>;
  protectedNow: boolean;
  onCopyToClipboard: () => void;
  onOpenCopy: (id: string) => void;
  onOpenLatest: () => void;
}) {
  const { draft } = props;
  const saving = draft.op.kind === "saving";
  const saveLabel = draft.copy ? "Update my copy" : "Save draft as a copy";
  return (
    <div className="mb-3 grid gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
      <p>
        {props.protectedNow && draft.copy ? (
          <>
            Your draft is saved as <strong>{draft.copy.title}</strong>. {props.otherName}&apos;s newer version is
            unchanged.
          </>
        ) : draft.copy ? (
          <>You&apos;ve edited since saving your copy. Those edits aren&apos;t in it yet.</>
        ) : (
          <>
            Your latest edits weren&apos;t saved: {props.otherName} saved a newer version first. Your draft is still
            below. Save it as a copy before leaving this page.
          </>
        )}
      </p>
      {draft.op.kind === "error" && (
        <p role="alert" className="text-destructive">
          {draft.op.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!props.protectedNow && (
          <Button size="sm" onClick={draft.saveCopy} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} {saving ? "Saving copy…" : saveLabel}
          </Button>
        )}
        {draft.copy && (
          <Button size="sm" variant={props.protectedNow ? "default" : "outline"} onClick={() => props.onOpenCopy(draft.copy!.id)}>
            <FileText /> Open my copy
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={props.onOpenLatest}>
          <RefreshCw /> Open latest version
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onCopyToClipboard}>
          <Copy /> Copy to clipboard
        </Button>
      </div>
    </div>
  );
}

/**
 * Copies the unsaved draft to the clipboard: rich HTML so pasting into the reloaded doc keeps formatting, with
 * Markdown as the plain-text fallback.
 */
async function copyDraft(editor: DocEditorInstance | null) {
  if (!editor) return toast.error("The editor isn't ready yet.");
  const html = editor.blocksToHTMLLossy(editor.document);
  const markdown = editor.blocksToMarkdownLossy(editor.document);
  const copied = (await copyWithClipboardApi(html, markdown)) || copyWithExecCommand(html);
  if (copied) toast.success("Draft copied. Reload, then paste it where you need it.");
  else toast.error("Couldn't access the clipboard. Select the text in the editor and copy it manually.");
}

async function copyWithClipboardApi(html: string, markdown: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    return false; // e.g. clipboard permission denied in an embedded browser
  }
}

/**
 * Fallback for browsers or frames that block the async Clipboard API: select a rendered copy of the draft and
 * use the legacy copy command, which keeps formatting. The HTML comes from BlockNote's own export of the
 * editor's blocks, not from user-supplied markup.
 */
function copyWithExecCommand(html: string): boolean {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:fixed;left:-9999px;top:0;white-space:pre-wrap";
  document.body.appendChild(holder);
  const selection = window.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    selection?.removeAllRanges();
    if (previous) selection?.addRange(previous);
    holder.remove();
  }
}

function EditorArea(props: {
  content: string;
  editable: boolean;
  onChange?: (json: string) => void;
  editorRef?: RefObject<DocEditorInstance | null>;
}) {
  const parsed = useMemo(() => parseStoredContent(props.content), [props.content]);
  if (!parsed.ok) return <CouldNotOpen reason={parsed.reason} />;
  return (
    <EditorBoundary fallback={(message) => <CouldNotOpen reason={message} />}>
      <DocEditor
        initialContent={parsed.blocks}
        editable={props.editable}
        onChange={props.onChange}
        editorRef={props.editorRef}
        // The "page": white sheet on the gray app background, so the document's edges are easy to see.
        // In print the browser's paper is the page, so the on-screen sheet styling is dropped (globals.css).
        pageClassName="min-h-[70vh] rounded-lg border border-black bg-white py-8 shadow-sm sm:py-12 print:min-h-0 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      />
    </EditorBoundary>
  );
}

function DocLayout(props: {
  token: string;
  doc: LoadedDoc;
  status: SaveStatus | null;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  const { doc } = props;
  return (
    <>
      <AppHeader>
        <TitleField key={doc.title} token={props.token} doc={doc} />
        <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
          {doc.role === "owner" ? "Owner" : doc.role === "editor" ? "Can edit" : "View only"}
        </Badge>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {props.status && <SaveIndicator status={props.status} onRetry={props.onRetry} />}
          <PrintMenu title={doc.title} />
          <ShareDialog token={props.token} documentId={doc._id} isOwner={doc.role === "owner"} title={doc.title} />
        </div>
      </AppHeader>
      <main className="mx-auto w-full max-w-4xl flex-1 px-2 py-6 sm:px-4 print:max-w-none print:p-0">
        <p className="mb-2 px-2 text-xs text-muted-foreground print:hidden">
          {doc.role === "viewer"
            ? `View only · shared by ${doc.ownerName}`
            : "Format with the toolbar · type / for headings, lists, tables and more"}
        </p>
        {props.children}
      </main>
    </>
  );
}

function TitleField({ token, doc }: { token: string; doc: LoadedDoc }) {
  const rename = useMutation(api.documents.rename);
  const [value, setValue] = useState(doc.title);

  if (doc.role === "viewer") return <h1 className="truncate font-medium">{doc.title}</h1>;

  async function commit() {
    const next = value.trim();
    if (next === doc.title) return;
    try {
      await rename({ token, id: doc._id, title: next });
    } catch (err) {
      toast.error(errorMessage(err));
      setValue(doc.title);
    }
  }

  return (
    <input
      aria-label="Document title"
      value={value}
      maxLength={200}
      placeholder="Untitled document"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(doc.title);
          e.currentTarget.blur();
        }
      }}
      className="min-w-0 max-w-md flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 font-medium outline-none hover:border-border focus:border-ring"
    />
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  const base = "flex items-center gap-1.5 text-xs text-muted-foreground";
  switch (status.kind) {
    case "saved":
      return (
        <span className={base}>
          <Check className="size-3.5" /> Saved
        </span>
      );
    case "unsaved":
      return <span className={base}>Unsaved changes</span>;
    case "saving":
      return (
        <span className={base}>
          <Loader2 className="size-3.5 animate-spin" /> Saving…
        </span>
      );
    case "conflict":
      return (
        <span className={`${base} text-amber-700`}>
          <AlertTriangle className="size-3.5" /> Not saved
        </span>
      );
    case "error":
      return (
        <span className={`${base} text-destructive`} title={status.message}>
          <CloudOff className="size-3.5" /> Couldn&apos;t save
          <Button variant="ghost" size="xs" onClick={onRetry}>
            Retry
          </Button>
        </span>
      );
  }
}

function Banner(props: {
  tone: "info" | "error";
  onReload: () => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tone =
    props.tone === "error" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <div className={`mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm print:hidden ${tone}`}>
      <span className="flex-1">{props.children}</span>
      {props.extra}
      <Button size="sm" variant="outline" onClick={props.onReload}>
        <RefreshCw /> Reload
      </Button>
    </div>
  );
}

function CouldNotOpen({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-background p-6">
      <h2 className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 text-destructive" /> This document couldn&apos;t be opened
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Its saved content isn&apos;t in a format the editor supports, so it was left untouched instead of being
        replaced with a blank page.
      </p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Document not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may have been deleted, or it hasn&apos;t been shared with this account.
        </p>
        <Button nativeButton={false} render={<Link href="/" />}>
          Back to documents
        </Button>
      </main>
    </>
  );
}
