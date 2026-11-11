"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AppHeader } from "@/components/app-header";
import { ImportDropzone } from "@/components/import-dropzone";
import { RecoveredDrafts } from "@/components/recovered-drafts";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { timeAgo } from "@/lib/format";

type Row = {
  _id: Id<"documents">;
  title: string;
  updatedAt: number;
  ownerName: string;
  role?: "viewer" | "editor";
};

export function Dashboard({ token }: { token: string }) {
  const router = useRouter();
  const docs = useQuery(api.documents.list, { token });
  const session = useSession();
  const create = useMutation(api.documents.create);
  const [creating, setCreating] = useState(false);

  async function newDocument() {
    setCreating(true);
    try {
      const id = await create({ token });
      router.push(`/doc/${id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setCreating(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">Documents</h1>
          <Button onClick={newDocument} disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />} New document
          </Button>
        </div>

        {session.status === "signedIn" && <RecoveredDrafts token={token} userId={session.user._id} />}

        <ImportDropzone token={token} />

        <Section
          title="My documents"
          icon={<FileText className="size-4" />}
          rows={docs?.owned}
          empty="You don't own any documents yet. Create one to get started."
        />
        <Section
          title="Shared with me"
          icon={<Users className="size-4" />}
          rows={docs?.shared}
          empty="Nothing has been shared with you yet."
          shared
        />
      </main>
    </>
  );
}

function Section(props: {
  title: string;
  icon: React.ReactNode;
  rows: Row[] | undefined;
  empty: string;
  shared?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {props.icon} {props.title}
        {props.rows && <span className="text-xs">({props.rows.length})</span>}
      </h2>
      <div className="overflow-hidden rounded-xl border bg-background">
        {props.rows === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : props.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{props.empty}</p>
        ) : (
          <ul className="divide-y">
            {props.rows.map((d) => (
              <li key={d._id}>
                <Link
                  href={`/doc/${d._id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/60"
                >
                  <FileText className="size-4 shrink-0 text-blue-600" />
                  <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                  {props.shared && (
                    <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                      by {d.ownerName}
                    </span>
                  )}
                  {d.role && (
                    <Badge variant={d.role === "editor" ? "default" : "secondary"}>
                      {d.role === "editor" ? "Can edit" : "View only"}
                    </Badge>
                  )}
                  <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                    {timeAgo(d.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
