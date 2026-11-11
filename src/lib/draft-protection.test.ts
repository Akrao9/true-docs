import { describe, expect, test } from "vitest";
import { draftAtRisk, draftCopyTitle, exitActions, isDraftProtected, type SavedCopy } from "./draft-protection";

const copyAt = (rev: number): SavedCopy => ({ id: "c1", version: 1, title: "t (your draft)", rev });

describe("isDraftProtected", () => {
  test("no copy → unprotected", () => expect(isDraftProtected(null, 3)).toBe(false));
  test("copy of exactly this draft → protected", () => expect(isDraftProtected(copyAt(3), 3)).toBe(true));
  test("typing after the copy (or during its save) → unprotected again", () => {
    // Save started at rev 3; the user typed twice before it finished: the copy captured rev 3.
    expect(isDraftProtected(copyAt(3), 5)).toBe(false);
  });
});

describe("draftAtRisk", () => {
  const base = { copy: null, rev: 1, remoteIsNewer: false };

  test("a refused draft is at risk until a copy covers it", () => {
    expect(draftAtRisk({ ...base, status: "conflict" })).toBe(true);
    expect(draftAtRisk({ ...base, status: "conflict", copy: copyAt(1) })).toBe(false);
    expect(draftAtRisk({ ...base, status: "conflict", copy: copyAt(1), rev: 2 })).toBe(true);
  });

  test("a failed copy save leaves the draft at risk (copy state unchanged)", () => {
    expect(draftAtRisk({ ...base, status: "conflict", copy: null })).toBe(true);
  });

  test("edits that couldn't be sent are at risk", () => {
    expect(draftAtRisk({ ...base, status: "error" })).toBe(true);
  });

  test("unsent edits are at risk only once a newer remote version is known", () => {
    expect(draftAtRisk({ ...base, status: "unsaved" })).toBe(false);
    expect(draftAtRisk({ ...base, status: "unsaved", remoteIsNewer: true })).toBe(true);
    expect(draftAtRisk({ ...base, status: "saving", remoteIsNewer: true })).toBe(true);
  });

  test("nothing at risk when everything is saved", () => {
    expect(draftAtRisk({ ...base, status: "saved" })).toBe(false);
    expect(draftAtRisk({ ...base, status: "saved", remoteIsNewer: true })).toBe(false);
  });
});

describe("exitActions", () => {
  const base = { hasDraft: true, discarded: false, conflict: false, failed: false, stale: false, rev: 3, ackedRev: 3, copiedRev: -1 };

  test("stale editor + edits not yet acknowledged → stash locally, before any conflict response", () => {
    expect(exitActions({ ...base, stale: true, rev: 4 })).toEqual({ stash: true, copy: false });
  });
  test("ordinary pending save (not stale) → nothing: the final autosave carries it", () => {
    expect(exitActions({ ...base, rev: 4 })).toEqual({ stash: false, copy: false });
  });
  test("stale but everything acknowledged → nothing to keep", () => {
    expect(exitActions({ ...base, stale: true })).toEqual({ stash: false, copy: false });
  });
  test("confirmed conflict → stash and server copy", () => {
    expect(exitActions({ ...base, conflict: true })).toEqual({ stash: true, copy: true });
  });
  test("failed save → stash only", () => {
    expect(exitActions({ ...base, failed: true, rev: 4 })).toEqual({ stash: true, copy: false });
  });
  test("draft already saved as a copy, original still stale → nothing to stash", () => {
    // Bob saved v2; Alice's v1 edits (rev 4) were refused and she saved them as a copy at rev 4.
    expect(exitActions({ ...base, stale: true, conflict: true, rev: 4, ackedRev: 0, copiedRev: 4 })).toEqual({
      stash: false,
      copy: false,
    });
    expect(exitActions({ ...base, stale: true, rev: 4, ackedRev: 0, copiedRev: 4 })).toEqual({ stash: false, copy: false });
  });
  test("edits typed after the copy are newer than both saved versions → stashed again", () => {
    expect(exitActions({ ...base, stale: true, rev: 5, ackedRev: 0, copiedRev: 4 })).toEqual({ stash: true, copy: false });
    expect(exitActions({ ...base, conflict: true, rev: 5, ackedRev: 0, copiedRev: 4 })).toEqual({ stash: true, copy: true });
  });
  test("discarded or no draft → nothing", () => {
    expect(exitActions({ ...base, conflict: true, discarded: true })).toEqual({ stash: false, copy: false });
    expect(exitActions({ ...base, conflict: true, hasDraft: false })).toEqual({ stash: false, copy: false });
  });
});

test("copy titles stay within the 200-character limit", () => {
  expect(draftCopyTitle("Plan")).toBe("Plan (your draft)");
  const long = draftCopyTitle("x".repeat(300));
  expect(long.length).toBeLessThanOrEqual(200);
  expect(long.endsWith(" (your draft)")).toBe(true);
});
