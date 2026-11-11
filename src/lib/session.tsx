"use client";

import { useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const STORAGE_KEY = "true-docs.session";

type User = { _id: Id<"users">; email: string; name: string };

type Session =
  | { status: "loading" }
  | { status: "signedOut"; login: (email: string) => Promise<void> }
  | { status: "signedIn"; token: string; user: User; logout: () => Promise<void> };

const SessionContext = createContext<Session>({ status: "loading" });

// --- Token store ---
// sessionStorage, not localStorage: each tab has its own session that survives a refresh. That lets
// you be Alice in one tab and Bob in another in the same browser. A fresh tab asks for a user again.
// (A tab opened by script with an opener can inherit a copy, so app links that open new tabs use noopener.)
let memoryToken: string | null = null;
const listeners = new Set<() => void>();

function readToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryToken;
  }
}

function writeToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: fall back to memory (lasts until refresh).
  }
  listeners.forEach((l) => l());
}

// Only same-tab changes need notifying: sessionStorage isn't shared between tabs.
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // Server render returns undefined ("not known yet"). The client reads the real value after hydration.
  const token = useSyncExternalStore<string | null | undefined>(subscribe, readToken, () => undefined);

  const user = useQuery(api.auth.me, token ? { token } : "skip");
  const loginMutation = useMutation(api.auth.login);
  const logoutMutation = useMutation(api.auth.logout);

  // The server no longer recognises this token (for example, the database was reset), so forget it.
  useEffect(() => {
    if (token && user === null) writeToken(null);
  }, [token, user]);

  const login = useCallback(
    async (email: string) => {
      const { token } = await loginMutation({ email });
      writeToken(token);
    },
    [loginMutation],
  );

  const logout = useCallback(async () => {
    const current = token;
    writeToken(null);
    if (current) await logoutMutation({ token: current });
  }, [token, logoutMutation]);

  let value: Session;
  if (token === undefined || (token && user === undefined)) value = { status: "loading" };
  else if (token && user) value = { status: "signedIn", token, user, logout };
  else value = { status: "signedOut", login };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
