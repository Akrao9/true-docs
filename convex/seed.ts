import { internalMutation } from "./_generated/server";

export const DEMO_USERS = [
  { email: "alice@example.com", name: "Alice Chen" },
  { email: "bob@example.com", name: "Bob Patel" },
  { email: "carol@example.com", name: "Carol Diaz" },
];

/**
 * Idempotent: safe to run on every deploy (`npx convex run seed:seed`). Demo users are matched by name, so changing
 * a demo email updates the existing user (keeping their documents and shares) instead of adding a second one.
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Only the seed creates users, so this is a handful of rows (same bound as auth.demoUsers).
    const users = await ctx.db.query("users").take(20);
    let created = 0;
    let updated = 0;
    for (const u of DEMO_USERS) {
      const existing = users.find((x) => x.name === u.name);
      if (!existing) {
        await ctx.db.insert("users", u);
        created++;
      } else if (existing.email !== u.email) {
        await ctx.db.patch(existing._id, { email: u.email });
        updated++;
      }
    }
    return { created, updated };
  },
});
