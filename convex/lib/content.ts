import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Document bodies live in `documentContents`, one row per document, so anything that lists or
 * permission-checks documents reads only small metadata rows. Only opening and saving a doc touch the body.
 */
async function contentRow(ctx: QueryCtx, documentId: Id<"documents">) {
  return await ctx.db
    .query("documentContents")
    .withIndex("by_documentId", (q) => q.eq("documentId", documentId))
    .unique();
}

export async function readContent(ctx: QueryCtx, doc: Doc<"documents">): Promise<string> {
  const row = await contentRow(ctx, doc._id);
  // Every document gets a body row at creation; "[]" only guards against a row that's somehow missing.
  return row?.content ?? "[]";
}

export async function writeContent(ctx: MutationCtx, doc: Doc<"documents">, content: string) {
  const row = await contentRow(ctx, doc._id);
  if (row) await ctx.db.patch(row._id, { content });
  else await ctx.db.insert("documentContents", { documentId: doc._id, content });
  // Keyed copies index their current body, so idempotent creates can find a copy that still matches.
  if (doc.createKey !== undefined) await ctx.db.patch(doc._id, { bodyHash: bodyHash(content) });
}

/**
 * Fingerprint for index lookups only (cyrb53, two 32-bit lanes → 64 bits as hex). Not a security hash: a match
 * is always confirmed by comparing the full body.
 */
export function bodyHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export async function deleteContent(ctx: MutationCtx, documentId: Id<"documents">) {
  const row = await contentRow(ctx, documentId);
  if (row) await ctx.db.delete(row._id);
}
