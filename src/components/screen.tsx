"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { SignIn } from "@/components/sign-in";
import { useSession } from "@/lib/session";

export function FullPageSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

/** Shows the sign-in picker until there's a session, then renders children with the token. */
export function RequireSession({ children }: { children: (token: string) => ReactNode }) {
  const session = useSession();
  if (session.status === "loading") return <FullPageSpinner />;
  if (session.status === "signedOut") return <SignIn login={session.login} />;
  return <>{children(session.token)}</>;
}
