import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getUserByToken } from "./lib/access";
import { normalizeEmail } from "./lib/validation";

/** Public list of demo accounts for the sign-in picker. Mocked auth: there are no passwords. */
export const demoUsers = query({
  args: {},
  handler: async (ctx) => {
    // Users are only created by the seed script, so this is a handful of rows; still bounded.
    const users = await ctx.db.query("users").take(20);
    return users
      .map((u) => ({ email: u.email, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const login = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "No demo user with that email." });
    const token = crypto.randomUUID();
    await ctx.db.insert("sessions", { userId: user._id, token });
    return { token };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

/** Returns null (not an error) so the client can fall back to the sign-in screen. */
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getUserByToken(ctx, token);
    return user ? { _id: user._id, email: user.email, name: user.name } : null;
  },
});
