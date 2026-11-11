"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";

type Role = "viewer" | "editor";

const selectClass =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * Owners grant, change and revoke access. Everyone else sees who has access, read-only.
 * The server enforces all of this (convex/shares.ts); the UI only hides controls that would be refused.
 */
export function ShareDialog(props: { token: string; documentId: Id<"documents">; isOwner: boolean; title: string }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant={props.isOwner ? "default" : "outline"} />}>
        <Share2 /> Share
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share &ldquo;{props.title}&rdquo;</DialogTitle>
          <DialogDescription>
            {props.isOwner
              ? "Viewers can read. Editors can read and edit. Only you, the owner, can change access."
              : "Only the owner can change who has access."}
          </DialogDescription>
        </DialogHeader>
        <ShareBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ token, documentId, isOwner }: { token: string; documentId: Id<"documents">; isOwner: boolean }) {
  const access = useQuery(api.shares.list, { token, documentId });
  const demoUsers = useQuery(api.auth.demoUsers);
  const grant = useMutation(api.shares.grant);
  const revoke = useMutation(api.shares.revoke);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // which action is in flight

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError("Enter an email address.");
    setBusy("add");
    setError(null);
    try {
      const { name } = await grant({ token, documentId, email, role });
      toast.success(`Shared with ${name} (${role === "editor" ? "can edit" : "view only"})`);
      setEmail("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(personEmail: string, next: Role) {
    setBusy(personEmail);
    try {
      await grant({ token, documentId, email: personEmail, role: next });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: Id<"users">, name: string) {
    setBusy(userId);
    try {
      await revoke({ token, documentId, userId });
      toast.success(`Removed ${name}'s access`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // Suggest the demo accounts that don't have access yet, so nobody has to remember emails.
  const taken = new Set([access?.owner?.email, ...(access?.people.map((p) => p.email) ?? [])]);
  const suggestions = demoUsers?.filter((u) => !taken.has(u.email)) ?? [];

  return (
    <div className="grid gap-4">
      {isOwner && (
        <form onSubmit={add} className="grid gap-2" noValidate>
          <Label htmlFor="share-email">Add people</Label>
          <div className="flex gap-2">
            <Input
              id="share-email"
              type="email"
              list="share-suggestions"
              placeholder="name@example.com"
              value={email}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
            <datalist id="share-suggestions">
              {suggestions.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name}
                </option>
              ))}
            </datalist>
            <select
              aria-label="Role for new person"
              className={selectClass}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <Button type="submit" size="sm" className="h-8" disabled={busy === "add"}>
              {busy === "add" ? <Loader2 className="animate-spin" /> : null} Share
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {suggestions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Demo accounts:{" "}
              {suggestions.map((u, i) => (
                <span key={u.email}>
                  {i > 0 && ", "}
                  <button type="button" className="underline underline-offset-2" onClick={() => setEmail(u.email)}>
                    {u.email}
                  </button>
                </span>
              ))}
            </p>
          )}
        </form>
      )}

      <div className="grid gap-1">
        <p className="text-sm font-medium">People with access</p>
        {access === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {access.owner && (
              <PersonRow name={access.owner.name} email={access.owner.email}>
                <Badge variant="secondary">Owner</Badge>
              </PersonRow>
            )}
            {access.people.map((p) => (
              <PersonRow key={p.userId} name={p.name} email={p.email}>
                {isOwner ? (
                  <>
                    <select
                      aria-label={`Role for ${p.name}`}
                      className={selectClass}
                      value={p.role}
                      disabled={busy === p.email}
                      onChange={(e) => changeRole(p.email, e.target.value as Role)}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${p.name}`}
                      disabled={busy === p.userId}
                      onClick={() => remove(p.userId, p.name)}
                    >
                      <X />
                    </Button>
                  </>
                ) : (
                  <Badge variant="outline">{p.role === "editor" ? "Editor" : "Viewer"}</Badge>
                )}
              </PersonRow>
            ))}
            {access.people.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Not shared with anyone yet.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function PersonRow(props: { name: string; email: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600/10 text-xs font-medium text-blue-700">
        {props.name[0]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{props.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{props.email}</span>
      </span>
      {props.children}
    </li>
  );
}
