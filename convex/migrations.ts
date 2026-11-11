import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { bodyHash, readContent } from "./lib/content";

/**
 * One-off backfill: give keyed copies created before `bodyHash` existed their fingerprint, so idempotent creates
 * find them through the index. Safe to re-run (only touches rows still missing the hash). Pages through the
 * documents table and reschedules itself until done.
 *
 *   npx convex run migrations:backfillBodyHashes        (add --prod for production)
 */
export const backfillBodyHashes = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("documents").paginate({ cursor: cursor ?? null, numItems: 20 });
    let updated = 0;
    for (const doc of page.page) {
      if (doc.createKey === undefined || doc.bodyHash !== undefined) continue;
      await ctx.db.patch(doc._id, { bodyHash: bodyHash(await readContent(ctx, doc)) });
      updated++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillBodyHashes, { cursor: page.continueCursor });
    }
    return { updated, done: page.isDone };
  },
});
