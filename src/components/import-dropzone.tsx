"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { IMPORT_KINDS, MAX_IMPORT_BYTES } from "@/lib/import-text";

// Picker filter only. The real check (by extension) is in checkImportFile, because .md MIME types vary by OS.
const accept = Object.fromEntries(Object.values(IMPORT_KINDS).map((k) => [k.mime, [...k.extensions]]));

/** Import .txt / .md / .docx as a new document owned by the current user. */
export function ImportDropzone({ token }: { token: string }) {
  const router = useRouter();
  const create = useMutation(api.documents.create);
  const [status, setStatus] = useState<{ busy: string } | { error: string } | null>(null);

  async function importFile(file: File) {
    setStatus({ busy: file.name });
    try {
      const { convertFile } = await import("@/lib/import-file"); // BlockNote + mammoth load only when needed
      const result = await convertFile(file);
      if (!result.ok) {
        setStatus({ error: result.error });
        return;
      }
      const id = await create({ token, title: result.title, content: result.content });
      toast.success(`Imported "${result.title}"`);
      router.push(`/doc/${id}`);
    } catch (err) {
      setStatus({ error: errorMessage(err, `Couldn't import "${file.name}". Please try again.`) });
    }
  }

  const busy = status !== null && "busy" in status;
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    multiple: false,
    disabled: busy,
    // Selection is filtered by `accept`; anything else that's dropped still goes through our own check.
    onDrop: (accepted, rejected) => {
      const file = accepted[0] ?? rejected[0]?.file;
      if (file) void importFile(file);
    },
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed bg-background px-4 py-3 text-sm transition hover:bg-muted/50 ${
          isDragActive ? "border-blue-500 bg-blue-50" : ""
        } ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        <input {...getInputProps()} aria-label="Import a file" />
        {busy ? (
          <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <FileUp className="size-5 shrink-0 text-blue-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {busy ? `Importing ${status.busy}…` : isDragActive ? "Drop to import" : "Import a file as a new document"}
          </p>
          <p className="text-xs text-muted-foreground">
            Drop or click to choose · .txt, .md or .docx up to {MAX_IMPORT_BYTES / 1024 / 1024} MB · headings, lists and
            basic formatting are kept; images aren&apos;t imported
          </p>
        </div>
      </div>
      {status && "error" in status && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {status.error}
        </p>
      )}
    </div>
  );
}
