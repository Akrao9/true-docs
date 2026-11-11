"use client";

import { Dashboard } from "@/components/dashboard";
import { RequireSession } from "@/components/screen";

export default function Home() {
  return <RequireSession>{(token) => <Dashboard token={token} />}</RequireSession>;
}
