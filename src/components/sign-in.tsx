"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";

/** Mocked auth: pick a seeded demo user. See ARCHITECTURE.md for why this was chosen over real auth. */
export function SignIn({ login }: { login: (email: string) => Promise<void> }) {
  const users = useQuery(api.auth.demoUsers);
  const [pending, setPending] = useState<string | null>(null);

  async function choose(email: string) {
    setPending(email);
    try {
      await login(email);
    } catch (err) {
      toast.error(errorMessage(err));
      setPending(null);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-lg font-semibold">
            <FileText className="size-6 text-blue-600" /> True Docs
          </div>
          <CardTitle>Choose a demo identity</CardTitle>
          <CardDescription>
            No passwords: this is a demo identity picker. Permissions are still enforced on the server
            for whichever user you pick. To try sharing, open a second tab and sign in as a different
            user. Each tab keeps its own user.
          </CardDescription>
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Shared sandbox.</strong> Anyone with this link can sign in as these users and see
            their documents. Use sample content only.
          </p>
        </CardHeader>
        <CardContent className="grid gap-2">
          {users === undefined && <p className="text-sm text-muted-foreground">Loading accounts…</p>}
          {users?.length === 0 && (
            <p className="text-sm text-destructive">
              No demo users found. Run <code>npx convex run seed:seed</code>.
            </p>
          )}
          {users?.map((u) => (
            <button
              key={u.email}
              onClick={() => choose(u.email)}
              disabled={pending !== null}
              className="flex items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-muted disabled:opacity-60"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-blue-600/10 font-medium text-blue-700">
                {u.name[0]}
              </span>
              <span className="flex-1">
                <span className="block font-medium">{u.name}</span>
                <span className="block text-sm text-muted-foreground">{u.email}</span>
              </span>
              {pending === u.email && <Loader2 className="size-4 animate-spin" />}
            </button>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
