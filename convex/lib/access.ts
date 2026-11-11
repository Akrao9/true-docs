import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type Role = "owner" | "editor" | "viewer";
export type Need = "read" | "write" | "owner";

/** Resolve a session token to a user, or throw. Every public function goes through this. */
export async function requireUser(ctx: QueryCtx, token: string): Promise<Doc<"users">> {
  const user = await getUserByToken(ctx, token);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
  return user;
}

export async function getUserByToken(ctx: QueryCtx, token: string) {
  if (!token) return null;
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  return session ? await ctx.db.get(session.userId) : null;
}

/** The single source of truth for document permissions. */
export async function getAccess(
  ctx: QueryCtx,
  userId: Id<"users">,
  doc: Doc<"documents">,
): Promise<Role | null> {
  if (doc.ownerId === userId) return "owner";
  const share = await ctx.db
    .query("shares")
    .withIndex("by_documentId_and_userId", (q) => q.eq("documentId", doc._id).eq("userId", userId))
    .unique();
  return share?.role ?? null;
}

export function satisfies(role: Role | null, need: Need): boolean {
  if (role === null) return false;
  if (need === "read") return true;
  if (need === "write") return role === "owner" || role === "editor";
  return role === "owner";
}

/**
 * Load a document and check that the caller has at least `need` access.
 * A missing document and a document you can't read give the same error,
 * so the API doesn't reveal which documents exist.
 */
export async function requireDocAccess(
  ctx: QueryCtx,
  token: string,
  documentId: Id<"documents">,
  need: Need,
) {
  const user = await requireUser(ctx, token);
  const doc = await ctx.db.get(documentId);
  const role = doc ? await getAccess(ctx, user._id, doc) : null;
  if (!doc || !satisfies(role, "read")) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
  }
  if (!satisfies(role, need)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: need === "owner" ? "Only the owner can do that." : "You have view-only access.",
    });
  }
  return { user, doc, role: role as Role };
}
