"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FileText, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useRequestLeave } from "@/lib/leave-guard";
import { useSession } from "@/lib/session";

export function AppHeader({ children }: { children?: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const requestLeave = useRequestLeave();
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold"
          onClick={(e) => {
            // Let modified clicks (new tab/window) through; they don't leave this editor.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            requestLeave(() => router.push("/"));
          }}
        >
          <FileText className="size-5 text-blue-600" />
          <span className="hidden sm:inline">True Docs</span>
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
        {session.status === "signedIn" && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-muted-foreground md:inline">{session.user.name}</span>
            <Button variant="ghost" size="sm" onClick={() => requestLeave(() => void session.logout())} title="Sign out / switch user">
              <LogOut />
              <span className="hidden sm:inline">Switch user</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
