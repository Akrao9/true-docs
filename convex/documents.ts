import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getAccess, requireDocAccess, requireUser } from "./lib/access";
import { bodyHash, deleteContent, readContent, writeContent } from "./lib/content";
import { cleanContent, cleanTitle } from "./lib/validation";

type Summary = {
  _id: Id<"documents">;
  title: string;
  updatedAt: number;
  ownerName: string;
};

export const LIST_LIMIT = 50;
/** Unhashed keyed copies checked per create (the previous release scanned 20 per key, so it never made more). */
const UNHASHED_SCAN = 20;

async function userName(ctx: QueryCtx, id: Id<"users">) {
  return (await ctx.db.get(id))?.name ?? "Unknown user";
}

/**
 * Dashboard: documents I own and documents shared with me. Reads only metadata rows. Bodies live in
 * documentContents, so 50 rows stay small however large the documents are.
 */
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx, token);

    // Bounded: the dashboard shows the most recently edited documents in each section.
    const ownedDocs = await ctx.db
      .query("documents")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(LIST_LIMIT);
    const owned: Summary[] = ownedDocs.map((d) => ({
      _id: d._id,
      title: d.title,
      updatedAt: d.updatedAt,
      ownerName: user.name,
    }));

    const shares = await ctx.db
      .query("shares")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(LIST_LIMIT);
    const shared: (Summary & { role: Doc<"shares">["role"] })[] = [];
    for (const s of shares) {
      const d = await ctx.db.get(s.documentId);
      if (!d) continue;
      shared.push({
        _id: d._id,
        title: d.title,
        updatedAt: d.updatedAt,
        ownerName: await userName(ctx, d.ownerId),
        role: s.role,
      });
    }

    const byRecent = (a: Summary, b: Summary) => b.updatedAt - a.updatedAt;
    return { owned: owned.sort(byRecent), shared: shared.sort(byRecent) };
  },
});

/**
 * Returns null when the id is malformed, the document doesn't exist, or the caller has no access.
 * The UI shows one "not found" state for all three, so the API doesn't reveal which documents exist.
 */
export const get = query({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id: rawId }) => {
    const user = await requireUser(ctx, token);
    const id = ctx.db.normalizeId("documents", rawId);
    const doc = id ? await ctx.db.get(id) : null;
    const role = doc ? await getAccess(ctx, user._id, doc) : null;
    if (!doc || !role) return null;
    return {
      _id: doc._id,
      title: doc.title,
      content: await readContent(ctx, doc),
      version: doc.version,
      updatedAt: doc.updatedAt,
      updatedByName: await userName(ctx, doc.updatedBy),
      ownerName: await userName(ctx, doc.ownerId),
      role,
    };
  },
});

/**
 * Used for "New document", file import, and saving a refused draft as a copy.
 * `createKey` makes a create idempotent per owner: draft copies pass a key identifying one exact snapshot
 * (editing session + revision), so retries of the same snapshot (the dashboard's recovery retry, another tab,
 * a reload after the response was lost) return the existing copy instead of creating a duplicate.
 */
export const create = mutation({
  args: {
    token: v.string(),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    createKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    if (args.createKey !== undefined) {
      if (args.createKey.length === 0 || args.createKey.length > 100) {
        throw new ConvexError({ code: "INVALID", message: "Invalid request key." });
      }
    }
    const content = cleanContent(args.content); // validate before writing anything
    if (args.createKey !== undefined) {
      // A keyed copy is an ordinary editable document, so it may have changed since it was created. Return one
      // only if its *current* body is exactly this snapshot (exact index match on the body fingerprint, then a
      // full comparison); otherwise make a fresh copy, so the caller's "it's saved" is always true.
      const candidates = await ctx.db
        .query("documents")
        .withIndex("by_ownerId_and_createKey_and_bodyHash", (q) =>
          q.eq("ownerId", user._id).eq("createKey", args.createKey).eq("bodyHash", bodyHash(content)),
        )
        .take(5); // same fingerprint *and* key: more than one is practically impossible
      for (const doc of candidates) {
        if ((await readContent(ctx, doc)) === content) return doc._id;
      }
      // Transition: keyed copies made before bodyHash existed have no fingerprint, so the lookup above skips them.
      // Check them directly and give each its hash as we go, so they move into the indexed lookup for next time.
      // (migrations.backfillBodyHashes does the same for every row in one pass.)
      const unhashed = await ctx.db
        .query("documents")
        .withIndex("by_ownerId_and_createKey_and_bodyHash", (q) =>
          q.eq("ownerId", user._id).eq("createKey", args.createKey).eq("bodyHash", undefined),
        )
        .take(UNHASHED_SCAN);
      let match: Id<"documents"> | null = null;
      for (const doc of unhashed) {
        const body = await readContent(ctx, doc);
        await ctx.db.patch(doc._id, { bodyHash: bodyHash(body) });
        if (match === null && body === content) match = doc._id;
      }
      if (match !== null) return match;
    }
    const id = await ctx.db.insert("documents", {
      ownerId: user._id,
      title: cleanTitle(args.title),
      version: 1,
      updatedAt: Date.now(),
      updatedBy: user._id,
      ...(args.createKey !== undefined ? { createKey: args.createKey, bodyHash: bodyHash(content) } : {}),
    });
    await ctx.db.insert("documentContents", { documentId: id, content });
    return id;
  },
});

export const rename = mutation({
  args: { token: v.string(), id: v.id("documents"), title: v.string() },
  handler: async (ctx, { token, id, title }) => {
    const { user } = await requireDocAccess(ctx, token, id, "write");
    await ctx.db.patch(id, { title: cleanTitle(title), updatedAt: Date.now(), updatedBy: user._id });
  },
});

/**
 * Autosave. `baseVersion` is the version the client last loaded or saved.
 * If someone else saved in the meantime, we refuse instead of silently overwriting their work,
 * and the client offers to reload.
 */
export const save = mutation({
  args: { token: v.string(), id: v.id("documents"), content: v.string(), baseVersion: v.number() },
  handler: async (ctx, { token, id, content, baseVersion }) => {
    const { user, doc } = await requireDocAccess(ctx, token, id, "write");
    if (doc.version !== baseVersion) {
      return { ok: false as const, reason: "conflict" as const, version: doc.version };
    }
    const clean = cleanContent(content);
    const version = doc.version + 1;
    await writeContent(ctx, doc, clean);
    await ctx.db.patch(id, { version, updatedAt: Date.now(), updatedBy: user._id });
    return { ok: true as const, version };
  },
});

export const remove = mutation({
  args: { token: v.string(), id: v.id("documents") },
  handler: async (ctx, { token, id }) => {
    await requireDocAccess(ctx, token, id, "owner");
    // Shares per document are capped (MAX_SHARES), so this loop is bounded.
    for await (const s of ctx.db.query("shares").withIndex("by_documentId", (q) => q.eq("documentId", id))) {
      await ctx.db.delete(s._id);
    }
    await deleteContent(ctx, id);
    await ctx.db.delete(id);
  },
});
