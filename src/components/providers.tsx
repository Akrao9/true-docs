"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { LeaveGuardProvider } from "@/lib/leave-guard";
import { SessionProvider } from "@/lib/session";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` first (see README).");
}
const convex = new ConvexReactClient(convexUrl);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConvexProvider client={convex}>
      <SessionProvider>
        <LeaveGuardProvider>{children}</LeaveGuardProvider>
      </SessionProvider>
      <Toaster position="bottom-right" />
    </ConvexProvider>
  );
}
