/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { MAX_NESTING_DEPTH, validateBlocks } from "./lib/blocks";
import { CONTENT_MAX_BYTES, utf8Bytes } from "./lib/validation";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const text = (t: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: t, styles });
const para = (t: string) => ({ id: "p", type: "paragraph", props: {}, content: [text(t)], children: [] });

describe("validateBlocks accepts what the editor produces", () => {
  test("formatted text, headings, nested lists", () => {
    const doc = [
      { id: "h", type: "heading", props: { level: 1 }, content: [text("Title", { bold: true })], children: [] },
      {
        id: "l",
        type: "bulletListItem",
        props: {},
        content: [text("parent", { italic: true, underline: true })],
        children: [{ id: "c", type: "numberedListItem", props: {}, content: [text("child")], children: [] }],
      },
      { id: "q", type: "paragraph", props: {}, content: [{ type: "link", href: "https://example.com", content: [text("link")] }], children: [] },
    ];
    expect(validateBlocks(doc)).toEqual({ ok: true });
  });

  test("table content is an object; dividers have no content; partial blocks omit fields", () => {
    const doc = [
      {
        type: "table",
        content: {
          type: "tableContent",
          columnWidths: [undefined, undefined],
          rows: [
            { cells: [[text("a")], [text("b")]] },
            { cells: [{ type: "tableCell", props: {}, content: [text("c")] }, { type: "tableCell", content: [] }] },
          ],
        },
      },
      { type: "divider" },
      { content: "bare paragraph from a partial block" },
    ];
    expect(validateBlocks(doc)).toEqual({ ok: true });
  });
});

describe("validateBlocks rejects what the editor can't reopen or shouldn't render", () => {
  test.each([
    ["not an array", { type: "paragraph" }, /array of blocks/],
    ["block types the editor doesn't expose", [{ type: "image", props: { url: "https://x/y.png" } }], /unsupported block type "image"/],
    ["table content as an array", [{ type: "table", content: [text("x")] }], /table content/],
    ["javascript: links", [{ type: "paragraph", content: [{ type: "link", href: "javascript:alert(1)", content: [] }] }], /link must use/],
    ["unknown inline content", [{ type: "paragraph", content: [{ type: "mention", user: "x" }] }], /unsupported inline content/],
    ["children that aren't an array", [{ type: "paragraph", children: {} }], /children must be an array/],
  ])("%s", (_label, doc, reason) => {
    const result = validateBlocks(doc);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(reason);
  });

  test(`nesting deeper than ${MAX_NESTING_DEPTH} levels`, () => {
    const nest = (depth: number): object =>
      depth === 1 ? para("leaf") : { ...para("x"), children: [nest(depth - 1)] };
    expect(validateBlocks([nest(MAX_NESTING_DEPTH)]).ok).toBe(true);
    expect(validateBlocks([nest(MAX_NESTING_DEPTH + 1)])).toMatchObject({ ok: false, reason: /nested more than/ });
  });
});

describe("content size is measured in UTF-8 bytes", () => {
  async function aliceWithDoc() {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seed, {});
    const { token } = await t.mutation(api.auth.login, { email: "alice@example.com" });
    const id = await t.mutation(api.documents.create, { token });
    return { t, token, id };
  }

  test("multibyte content under the old character cap but over the byte cap is rejected", async () => {
    const { t, token, id } = await aliceWithDoc();
    const content = JSON.stringify([para("€".repeat(300_000))]); // 1 JS char, 3 UTF-8 bytes each
    expect(content.length).toBeLessThan(CONTENT_MAX_BYTES); // would have passed the old char-length check
    expect(utf8Bytes(content)).toBeGreaterThan(CONTENT_MAX_BYTES);

    await expect(t.mutation(api.documents.save, { token, id, content, baseVersion: 1 })).rejects.toThrow(/too large/i);
    const doc = await t.query(api.documents.get, { token, id });
    expect(doc?.version).toBe(1); // nothing was written
  });

  test("ASCII content of the same length still saves", async () => {
    const { t, token, id } = await aliceWithDoc();
    const content = JSON.stringify([para("e".repeat(300_000))]);
    expect(await t.mutation(api.documents.save, { token, id, content, baseVersion: 1 })).toEqual({ ok: true, version: 2 });
  });

  test("bodies live in documentContents; deleting a document deletes its body", async () => {
    const { t, token, id } = await aliceWithDoc();
    await t.mutation(api.documents.save, { token, id, content: JSON.stringify([para("hello")]), baseVersion: 1 });
    const rows = await t.run((ctx) => ctx.db.query("documentContents").take(10));
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("hello");
    expect((await t.query(api.documents.get, { token, id }))?.content).toContain("hello");

    await t.mutation(api.documents.remove, { token, id });
    expect(await t.run((ctx) => ctx.db.query("documentContents").take(10))).toHaveLength(0);
  });

  test("retrying a create for the same snapshot returns the same copy, not a duplicate", async () => {
    const { t, token } = await aliceWithDoc();
    const content = JSON.stringify([para("refused draft")]);
    // The editor's exit save and the dashboard's retry race with the same snapshot key.
    const [a, b] = await Promise.all([
      t.mutation(api.documents.create, { token, title: "Plan (your draft)", content, createKey: "tabA:7" }),
      t.mutation(api.documents.create, { token, title: "Plan (your draft)", content, createKey: "tabA:7" }),
    ]);
    expect(a).toBe(b);
    // A different snapshot is a different copy; other users' keys never collide with yours.
    const c = await t.mutation(api.documents.create, { token, content, createKey: "tabA:8" });
    expect(c).not.toBe(a);
    const { token: bob } = await t.mutation(api.auth.login, { email: "bob@example.com" });
    const d = await t.mutation(api.documents.create, { token: bob, content, createKey: "tabA:7" });
    expect(d).not.toBe(a);
    const aliceDocs = await t.query(api.documents.list, { token });
    expect(aliceDocs.owned.filter((x) => x.title === "Plan (your draft)")).toHaveLength(1);
  });

  test("a keyed copy edited since creation is not returned for the original snapshot", async () => {
    const { t, token } = await aliceWithDoc();
    const draft = JSON.stringify([para("the recovered draft")]);
    const first = await t.mutation(api.documents.create, { token, content: draft, createKey: "tabA:3" });
    // The user opens the copy and replaces its body.
    await t.mutation(api.documents.save, { token, id: first, content: JSON.stringify([para("rewritten")]), baseVersion: 1 });

    // Retrying the original snapshot must yield a document that actually contains it.
    const retry = await t.mutation(api.documents.create, { token, content: draft, createKey: "tabA:3" });
    expect(retry).not.toBe(first);
    expect((await t.query(api.documents.get, { token, id: retry }))?.content).toBe(draft);
    expect((await t.query(api.documents.get, { token, id: first }))?.content).toContain("rewritten"); // untouched

    // …and stays idempotent from then on.
    expect(await t.mutation(api.documents.create, { token, content: draft, createKey: "tabA:3" })).toBe(retry);
  });

  test("retries stay idempotent after many edited copies of the same snapshot", async () => {
    const { t, token } = await aliceWithDoc();
    const draft = JSON.stringify([para("snapshot under retry")]);
    // 25 rounds: retry creates a copy, the user rewrites it, so the next retry needs a fresh one.
    for (let i = 0; i < 25; i++) {
      const id = await t.mutation(api.documents.create, { token, title: "R", content: draft, createKey: "tabA:9" });
      await t.mutation(api.documents.save, { token, id, content: JSON.stringify([para(`edit ${i}`)]), baseVersion: 1 });
    }
    const a = await t.mutation(api.documents.create, { token, title: "R", content: draft, createKey: "tabA:9" });
    const b = await t.mutation(api.documents.create, { token, title: "R", content: draft, createKey: "tabA:9" });
    expect(b).toBe(a); // previously: two new documents once the match fell outside the 20-row scan
    expect((await t.query(api.documents.get, { token, id: a }))?.content).toBe(draft);
    const owned = await t.query(api.documents.list, { token });
    expect(owned.owned.filter((d) => d.title === "R")).toHaveLength(26);
  });

  /** A keyed copy as the previous release wrote it: createKey but no bodyHash. */
  async function seedOldCopy(t: Awaited<ReturnType<typeof aliceWithDoc>>["t"], email: string, key: string, body: string) {
    return await t.run(async (ctx) => {
      const user = (await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique())!;
      const id = await ctx.db.insert("documents", {
        ownerId: user._id, title: "Old (your draft)", version: 1, updatedAt: 1, updatedBy: user._id, createKey: key,
      });
      await ctx.db.insert("documentContents", { documentId: id, content: body });
      return id;
    });
  }

  test("retrying a snapshot whose copy was made by the previous release returns that copy", async () => {
    const { t, token } = await aliceWithDoc();
    const draft = JSON.stringify([para("copied before the upgrade")]);
    const old = await seedOldCopy(t, "alice@example.com", "legacy-1700000000000:0", draft);
    // An edited old copy with the same key must not be returned, but does get its fingerprint.
    const edited = await seedOldCopy(t, "alice@example.com", "legacy-1700000000000:0", JSON.stringify([para("x")]));

    const retry = await t.mutation(api.documents.create, { token, content: draft, createKey: "legacy-1700000000000:0" });
    expect(retry).toBe(old); // previously: a second document
    const rows = await t.run(async (ctx) => [await ctx.db.get(old), await ctx.db.get(edited)]);
    expect(rows.every((r) => r?.bodyHash !== undefined)).toBe(true); // now found through the index
    expect(await t.mutation(api.documents.create, { token, content: draft, createKey: "legacy-1700000000000:0" })).toBe(old);
  });

  test("backfill gives every old keyed copy its fingerprint and leaves other documents alone", async () => {
    const { t, token, id: plain } = await aliceWithDoc();
    const draft = JSON.stringify([para("old copy")]);
    const old = await seedOldCopy(t, "alice@example.com", "tabZ:1", draft);
    expect(await t.mutation(internal.migrations.backfillBodyHashes, {})).toEqual({ updated: 1, done: true });
    const rows = await t.run(async (ctx) => [await ctx.db.get(old), await ctx.db.get(plain)]);
    expect(rows[0]?.bodyHash).toBeDefined();
    expect(rows[1]?.bodyHash).toBeUndefined();
    expect(await t.mutation(api.documents.create, { token, content: draft, createKey: "tabZ:1" })).toBe(old);
  });

  test("createKey is validated", async () => {
    const { t, token } = await aliceWithDoc();
    await expect(t.mutation(api.documents.create, { token, createKey: "" })).rejects.toThrow(/invalid request key/i);
    await expect(t.mutation(api.documents.create, { token, createKey: "x".repeat(101) })).rejects.toThrow(
      /invalid request key/i,
    );
  });

  test("unsupported blocks are rejected on save, not just in the validator", async () => {
    const { t, token, id } = await aliceWithDoc();
    const content = JSON.stringify([{ type: "file", props: { url: "javascript:alert(1)" } }]);
    await expect(t.mutation(api.documents.save, { token, id, content, baseVersion: 1 })).rejects.toThrow(
      /unsupported block type/,
    );
  });
});
