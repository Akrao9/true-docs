/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Seed users, sign each in, and have Alice create a doc shared with Bob (editor) and Carol (viewer). */
async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const signIn = async (email: string) => (await t.mutation(api.auth.login, { email })).token;
  const alice = await signIn("alice@example.com");
  const bob = await signIn("bob@example.com");
  const carol = await signIn("carol@example.com");

  const docId = await t.mutation(api.documents.create, { token: alice, title: "Plan" });
  await t.mutation(api.shares.grant, { token: alice, documentId: docId, email: "bob@example.com", role: "editor" });
  return { t, alice, bob, carol, docId };
}

const blocks = (text: string) =>
  JSON.stringify([{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }]);

describe("document access", () => {
  test("owner and editor can read and write; a user with no share sees nothing", async () => {
    const { t, alice, bob, carol, docId } = await setup();

    expect((await t.query(api.documents.get, { token: alice, id: docId }))?.role).toBe("owner");
    expect((await t.query(api.documents.get, { token: bob, id: docId }))?.role).toBe("editor");
    // Not shared with Carol: same response as a document that doesn't exist.
    expect(await t.query(api.documents.get, { token: carol, id: docId })).toBeNull();

    const saved = await t.mutation(api.documents.save, {
      token: bob,
      id: docId,
      content: blocks("hello from bob"),
      baseVersion: 1,
    });
    expect(saved).toEqual({ ok: true, version: 2 });

    await expect(
      t.mutation(api.documents.save, { token: carol, id: docId, content: blocks("x"), baseVersion: 2 }),
    ).rejects.toThrow(/not found/i);
  });

  test("viewer can read but not edit, rename, or share", async () => {
    const { t, alice, carol, docId } = await setup();
    await t.mutation(api.shares.grant, { token: alice, documentId: docId, email: "carol@example.com", role: "viewer" });

    expect((await t.query(api.documents.get, { token: carol, id: docId }))?.role).toBe("viewer");
    await expect(
      t.mutation(api.documents.save, { token: carol, id: docId, content: blocks("x"), baseVersion: 1 }),
    ).rejects.toThrow(/view-only/i);
    await expect(t.mutation(api.documents.rename, { token: carol, id: docId, title: "Mine now" })).rejects.toThrow(
      /view-only/i,
    );
    await expect(
      t.mutation(api.shares.grant, { token: carol, documentId: docId, email: "bob@example.com", role: "editor" }),
    ).rejects.toThrow(/only the owner/i);
  });

  test("only the owner can share or delete; editors cannot", async () => {
    const { t, bob, docId } = await setup();
    await expect(
      t.mutation(api.shares.grant, { token: bob, documentId: docId, email: "carol@example.com", role: "viewer" }),
    ).rejects.toThrow(/only the owner/i);
    await expect(t.mutation(api.documents.remove, { token: bob, id: docId })).rejects.toThrow(/only the owner/i);
  });

  test("dashboard separates owned from shared, and revoking removes access", async () => {
    const { t, alice, bob, docId } = await setup();

    const aliceList = await t.query(api.documents.list, { token: alice });
    expect(aliceList.owned.map((d) => d._id)).toEqual([docId]);
    expect(aliceList.shared).toEqual([]);

    const bobList = await t.query(api.documents.list, { token: bob });
    expect(bobList.owned).toEqual([]);
    expect(bobList.shared).toMatchObject([{ _id: docId, ownerName: "Alice Chen", role: "editor" }]);

    const bobId = (await t.query(api.auth.me, { token: bob }))!._id;
    await t.mutation(api.shares.revoke, { token: alice, documentId: docId, userId: bobId });
    expect((await t.query(api.documents.list, { token: bob })).shared).toEqual([]);
    expect(await t.query(api.documents.get, { token: bob, id: docId })).toBeNull();
  });

  test("a stale save is rejected instead of overwriting someone else's edit", async () => {
    const { t, alice, bob, docId } = await setup();
    await t.mutation(api.documents.save, { token: alice, id: docId, content: blocks("alice v2"), baseVersion: 1 });

    // Bob still has version 1 loaded.
    const stale = await t.mutation(api.documents.save, { token: bob, id: docId, content: blocks("bob"), baseVersion: 1 });
    expect(stale).toEqual({ ok: false, reason: "conflict", version: 2 });

    const doc = await t.query(api.documents.get, { token: alice, id: docId });
    expect(doc?.content).toContain("alice v2");
  });

  test("validation: bad tokens, sharing with yourself or unknown users, malformed content", async () => {
    const { t, alice, docId } = await setup();
    await expect(t.query(api.documents.list, { token: "nope" })).rejects.toThrow(/sign in/i);
    await expect(
      t.mutation(api.shares.grant, { token: alice, documentId: docId, email: "ALICE@example.com ", role: "editor" }),
    ).rejects.toThrow(/already own/i);
    await expect(
      t.mutation(api.shares.grant, { token: alice, documentId: docId, email: "nobody@x.com", role: "editor" }),
    ).rejects.toThrow(/no user/i);
    await expect(
      t.mutation(api.documents.save, { token: alice, id: docId, content: "{not json", baseVersion: 1 }),
    ).rejects.toThrow(/not valid/i);
    expect(await t.query(api.documents.get, { token: alice, id: "garbage-id" })).toBeNull();
  });
});
