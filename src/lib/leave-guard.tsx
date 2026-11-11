"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * One discard guard for every in-app way of leaving an editing session (Reload, the logo, Switch user, Open…).
 * A screen with work at risk registers a guard. Exit actions call `requestLeave(action)`:
 * - no active guard → the action runs immediately;
 * - otherwise a confirm dialog opens. Cancel leaves everything as it was, Confirm tells the guard the user chose
 *   to discard (so no safety-net copy is made), then runs the action.
 * Browser refresh/close is covered separately by the beforeunload prompt in useAutosave.
 */
export type LeaveGuard = { title: string; message: string; confirmLabel: string; onDiscard: () => void };

type Ctx = {
  register: (read: () => LeaveGuard | null) => () => void;
  requestLeave: (action: () => void) => void;
};

const LeaveGuardContext = createContext<Ctx>({ register: () => () => {}, requestLeave: (action) => action() });

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const readers = useRef(new Set<() => LeaveGuard | null>());
  const [pending, setPending] = useState<{ guard: LeaveGuard; action: () => void } | null>(null);

  const register = useCallback((read: () => LeaveGuard | null) => {
    readers.current.add(read);
    return () => void readers.current.delete(read);
  }, []);

  const requestLeave = useCallback((action: () => void) => {
    for (const read of readers.current) {
      const guard = read();
      if (guard) return setPending({ guard, action });
    }
    action();
  }, []);

  function confirm() {
    if (!pending) return;
    setPending(null);
    pending.guard.onDiscard();
    pending.action();
  }

  return (
    <LeaveGuardContext.Provider value={{ register, requestLeave }}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{pending?.guard.title}</DialogTitle>
            <DialogDescription>{pending?.guard.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} autoFocus>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={confirm}>
              {pending?.guard.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LeaveGuardContext.Provider>
  );
}

/** Register a guard for as long as the calling component is mounted. `guard` is read fresh at each exit. */
export function useLeaveGuard(guard: LeaveGuard | null) {
  const { register } = useContext(LeaveGuardContext);
  const latest = useRef(guard);
  useEffect(() => {
    latest.current = guard;
  });
  useEffect(() => register(() => latest.current), [register]);
}

export function useRequestLeave() {
  return useContext(LeaveGuardContext).requestLeave;
}
