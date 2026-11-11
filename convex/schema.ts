import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const shareRole = v.union(v.literal("viewer"), v.literal("editor"));

export default defineSchema({
  // Seeded demo users. There are no passwords: this is a demo identity picker (see ARCHITECTURE.md).
  users: defineTable({
    email: v.string(),
    name: v.string(),
  }).index("by_email", ["email"]),

  // Opaque random tokens. The client sends a token, and the server resolves it to a user.
  // The client never sends a userId, so it can't claim to be someone else.
  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
  }).index("by_token", ["token"]),

  // Small metadata rows: listing, access checks and the dashboard read only these.
  documents: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    // Incremented on every content save. Used to detect stale writes (refused, not overwritten).
    version: v.number(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    // Idempotency for creates that may be retried (draft copies): the snapshot key, plus a fingerprint of the
    // document's *current* body (kept up to date on every save), so "is there a copy that still holds exactly
    // this snapshot?" is one bounded index lookup however many times copies were edited.
    createKey: v.optional(v.string()),
    bodyHash: v.optional(v.string()),
  })
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"])
    .index("by_ownerId_and_createKey_and_bodyHash", ["ownerId", "createKey", "bodyHash"]),

  // Document bodies: a BlockNote block array serialized as JSON (string keeps validation simple and
  // lets us enforce a byte cap). One row per document; read only when a document is opened or saved.
  documentContents: defineTable({
    documentId: v.id("documents"),
    content: v.string(),
  }).index("by_documentId", ["documentId"]),

  shares: defineTable({
    documentId: v.id("documents"),
    userId: v.id("users"),
    role: shareRole,
  })
    .index("by_documentId", ["documentId"])
    .index("by_userId", ["userId"])
    .index("by_documentId_and_userId", ["documentId", "userId"]),
});
