// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { planExitSave } from "./draft-protection";
import {
  clearIfCovered,
  draftSnapshotKey,
  LEGACY_SESSION,
  listDrafts,
  pendingSave,
  recordKey,
  removeDraft,
  stashDraft,
  trackPendingSave,
  type RecoveredDraft,
} from "./draft-recovery";

const draft = (over: Partial<RecoveredDraft> = {}): RecoveredDraft => ({
  userId: "alice",
  documentId: "doc1",
  sessionId: "tabA",
  rev: 1,
  title: "Plan",
  content: '[{"type":"paragraph","content":"x"}]',
  savedAt: 1,
  ...over,
});

/** In-memory Storage that throws QuotaExceededError past a byte budget, like a full localStorage. */
class QuotaStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private budget: number) {}
  private used(except?: string) {
    let n = 0;
    for (const [k, v] of this.data) if (k !== except) n += k.length + v.length;
    return n;
  }
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.used(k) + k.length + v.length > this.budget) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("per-session recovery records", () => {
  test("tab A's acknowledgement doesn't delete tab B's newer draft of the same document", () => {
    stashDraft(draft({ sessionId: "tabA", rev: 3, content: '["A"]' }));
    // Tab A's server save for rev 3 is pending; meanwhile tab B (same user, same doc) stashes its own draft.
    stashDraft(draft({ sessionId: "tabB", rev: 7, content: '["B"]', savedAt: 2 }));
    clearIfCovered({ userId: "alice", documentId: "doc1", sessionId: "tabA" }, 3); // A's ack arrives
    expect(listDrafts("alice").map((d) => d.content)).toEqual(['["B"]']);
  });

  test("within one session, an ack for an older revision keeps a newer stash", () => {
    const ids = { userId: "alice", documentId: "doc1", sessionId: "tabA" };
    stashDraft(draft({ rev: 3 }));
    stashDraft(draft({ rev: 5, content: '["typed after the save started"]' })); // same record, newer rev
    clearIfCovered(ids, 3);
    expect(listDrafts("alice")).toHaveLength(1);
    clearIfCovered(ids, 5);
    expect(listDrafts("alice")).toHaveLength(0);
  });

  test("records are per user; explicit discard removes only that record", () => {
    stashDraft(draft());
    stashDraft(draft({ sessionId: "tabB" }));
    stashDraft(draft({ userId: "bob" }));
    removeDraft({ userId: "alice", documentId: "doc1", sessionId: "tabA" });
    expect(listDrafts("alice").map((d) => d.sessionId)).toEqual(["tabB"]);
    expect(listDrafts("bob")).toHaveLength(1);
  });

  test("corrupt entries are skipped", () => {
    localStorage.setItem("true-docs.recovery.alice.doc1.bad", "{not json");
    stashDraft(draft());
    expect(listDrafts("alice")).toHaveLength(1);
  });
});

describe("records saved by the previous release (no sessionId / rev)", () => {
  // Exactly what c746a97 wrote: key PREFIX<userId>.<documentId>, no session or revision.
  const legacyKey = "true-docs.recovery.alice.doc7";
  const legacy = { userId: "alice", documentId: "doc7", title: "Old plan", content: '["legacy body"]', savedAt: 42 };

  test("stay visible after the upgrade, migrated to the current shape", () => {
    localStorage.setItem(legacyKey, JSON.stringify(legacy));
    const [d] = listDrafts("alice");
    expect(d).toMatchObject({ documentId: "doc7", title: "Old plan", content: '["legacy body"]', rev: 0, savedAt: 42 });
    expect(d.sessionId).toBe("legacy-42");
    expect(localStorage.getItem(legacyKey)).toBeNull(); // moved, not copied
    expect(localStorage.getItem(recordKey(d))).not.toBeNull();
  });

  test("migrated records can be acknowledged and discarded like any other", () => {
    localStorage.setItem(legacyKey, JSON.stringify(legacy));
    const [d] = listDrafts("alice");
    clearIfCovered(d, d.rev);
    expect(listDrafts("alice")).toEqual([]);
  });

  test("migration is idempotent and leaves unreadable legacy entries untouched", () => {
    localStorage.setItem(legacyKey, JSON.stringify(legacy));
    localStorage.setItem("true-docs.recovery.alice.doc8", "{corrupt");
    listDrafts("alice");
    listDrafts("alice");
    expect(listDrafts("alice")).toHaveLength(1);
    expect(localStorage.getItem("true-docs.recovery.alice.doc8")).toBe("{corrupt");
  });

  test("storage too full to migrate: the legacy draft is still listed, retryable and discardable", () => {
    // A Storage with a byte quota, filled so a second copy of the record can't be written.
    const quota = new QuotaStorage(JSON.stringify(legacy).length + legacyKey.length + 10);
    quota.setItem(legacyKey, JSON.stringify(legacy));
    const [d] = listDrafts("alice", quota);
    expect(d).toMatchObject({ documentId: "doc7", content: '["legacy body"]', sessionId: LEGACY_SESSION });
    expect(quota.getItem(legacyKey)).not.toBeNull(); // bytes preserved, not migrated
    // Same snapshot key as it would get once migrated, so a retry before/after migration dedupes on the server.
    expect(draftSnapshotKey(d)).toBe("legacy-42:0");
    clearIfCovered(d, d.rev, quota); // acknowledging a retry removes the record at its original key
    expect(listDrafts("alice", quota)).toEqual([]);
    quota.setItem(legacyKey, JSON.stringify(legacy));
    removeDraft(listDrafts("alice", quota)[0], quota); // discard works too
    expect(listDrafts("alice", quota)).toEqual([]);
  });

  test("a migrated legacy record keeps the same snapshot key", () => {
    localStorage.setItem(legacyKey, JSON.stringify(legacy));
    expect(draftSnapshotKey(listDrafts("alice")[0])).toBe("legacy-42:0");
  });

  test("current-format records sit alongside migrated ones", () => {
    localStorage.setItem(legacyKey, JSON.stringify(legacy));
    stashDraft(draft({ savedAt: 100 }));
    expect(listDrafts("alice").map((d) => d.sessionId)).toEqual(["tabA", "legacy-42"]);
  });
});

describe("storage failures never escape", () => {
  test("blocked localStorage (getter throws SecurityError): every helper returns safely", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(() => window.localStorage).toThrow(/insecure/); // the failure is real: merely reading it throws
    const ids = { userId: "alice", documentId: "doc1", sessionId: "tabA" };
    expect(stashDraft(draft())).toBe(false);
    expect(() => clearIfCovered(ids, 1)).not.toThrow();
    expect(() => removeDraft(ids)).not.toThrow();
    expect(listDrafts("alice")).toEqual([]);
  });

  test("full storage (setItem throws) reports false instead of throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(stashDraft(draft())).toBe(false);
  });
});

describe("pending save registry (same tab)", () => {
  test("a record's in-flight save is visible until it settles, success or failure", async () => {
    const key = recordKey(draft());
    let resolveSave!: () => void;
    const save = new Promise<void>((r) => (resolveSave = r));
    trackPendingSave(key, save);
    expect(pendingSave(key)).toBe(save);
    resolveSave();
    await save;
    await Promise.resolve();
    expect(pendingSave(key)).toBeUndefined();

    const failing = Promise.reject(new Error("too large"));
    trackPendingSave(key, failing);
    await failing.catch(() => {});
    await Promise.resolve();
    expect(pendingSave(key)).toBeUndefined();
  });
});

describe("planExitSave (after any in-flight save has settled)", () => {
  const copy = (rev: number) => ({ id: "c", version: 1, title: "t", rev });
  test("no copy yet → create one", () => expect(planExitSave(null, 4)).toBe("create"));
  test("manual save already captured the final draft → nothing to do", () => expect(planExitSave(copy(4), 4)).toBe("skip"));
  test("edits after the manual save → update that same copy", () => expect(planExitSave(copy(3), 4)).toBe("update"));
});
