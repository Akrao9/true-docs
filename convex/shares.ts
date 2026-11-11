import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireDocAccess } from "./lib/access";
import { normalizeEmail } from "./lib/validation";
import { shareRole } from "./schema";

/** Keeps every per-document share read bounded. */
export const MAX_SHARES = 50;

/** Anyone with access can see who else has access. Only the owner can change it. */
export const list = query({
  args: { token: v.string(), documentId: v.id("documents") },
  handler: async (ctx, { token, documentId }) => {
    const { doc } = await requireDocAccess(ctx, token, documentId, "read");
    const owner = await ctx.db.get(doc.ownerId);
    const shares = await ctx.db
      .query("shares")
      .withIndex("by_documentId", (q) => q.eq("documentId", documentId))
      .take(MAX_SHARES);
    const people = [];
    for (const s of shares) {
      const u = await ctx.db.get(s.userId);
      if (u) people.push({ userId: u._id, name: u.name, email: u.email, role: s.role });
    }
    return {
      owner: owner ? { userId: owner._id, name: owner.name, email: owner.email } : null,
      people: people.sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

/** Grant access, or change the role if the person already has access. */
export const grant = mutation({
  args: { token: v.string(), documentId: v.id("documents"), email: v.string(), role: shareRole },
  handler: async (ctx, { token, documentId, email, role }) => {
    const { user } = await requireDocAccess(ctx, token, documentId, "owner");
    const normalized = normalizeEmail(email);
    if (!normalized) throw new ConvexError({ code: "INVALID", message: "Enter an email address." });

    const target = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (!target) {
      throw new ConvexError({ code: "NOT_FOUND", message: `No user with email ${normalized}.` });
    }
    if (target._id === user._id) {
      throw new ConvexError({ code: "INVALID", message: "You already own this document." });
    }

    const existing = await ctx.db
      .query("shares")
      .withIndex("by_documentId_and_userId", (q) => q.eq("documentId", documentId).eq("userId", target._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { role });
    } else {
      const current = await ctx.db
        .query("shares")
        .withIndex("by_documentId", (q) => q.eq("documentId", documentId))
        .take(MAX_SHARES);
      if (current.length >= MAX_SHARES) {
        throw new ConvexError({ code: "LIMIT", message: `A document can be shared with at most ${MAX_SHARES} people.` });
      }
      await ctx.db.insert("shares", { documentId, userId: target._id, role });
    }
    return { name: target.name };
  },
});

export const revoke = mutation({
  args: { token: v.string(), documentId: v.id("documents"), userId: v.id("users") },
  handler: async (ctx, { token, documentId, userId }) => {
    await requireDocAccess(ctx, token, documentId, "owner");
    const existing = await ctx.db
      .query("shares")
      .withIndex("by_documentId_and_userId", (q) => q.eq("documentId", documentId).eq("userId", userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
