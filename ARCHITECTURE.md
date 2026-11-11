# Architecture

True Docs is a Next.js frontend on Vercel talking to a Convex backend. Convex provides the database, the server
functions, and live query subscriptions. The editor is BlockNote, which is built on ProseMirror.

```
Browser (Next.js app, client components)
  ├─ BlockNote editor ── autosave (debounced, versioned) ──┐
  ├─ dashboard, share dialog, import (file → blocks)        │  Convex mutations / live queries
  └─ per-tab session token (sessionStorage) ────────────────┤  every call carries the token
                                                            ▼
Convex
  ├─ auth.ts        demo sign-in: email → random session token
  ├─ documents.ts   list / get / create / rename / save / remove
  ├─ shares.ts      list / grant / revoke (owner only)
  └─ lib/access.ts  the single permission check every function goes through
     tables: users · sessions · documents (metadata) · documentContents (bodies) · shares
```

## Data model

| Table | Holds | Why it's separate |
|---|---|---|
| `users` | email, name (seeded demo users) | |
| `sessions` | opaque random token → user | The client never sends a user id, so it can't impersonate anyone. |
| `documents` | owner, title, `version`, updatedAt/By | Small rows. The dashboard and access checks read only these. |
| `documentContents` | the BlockNote block array as JSON | Bodies can reach ~800 KB, so they're read only when a document is opened or saved. |
| `shares` | document, user, role (`viewer` / `editor`) | One row per person per document, at most 50 per document. |

The owner is a column on `documents`, not a share row, so a document always has exactly one owner, and owner-only
actions (share, delete) can't be granted away.

## Access control

`convex/lib/access.ts` is the only place permissions are decided:

- `requireUser(token)` resolves the session or throws.
- `getAccess(user, doc)` returns `owner`, `editor`, `viewer` or nothing.
- `requireDocAccess(token, id, need)` combines the two. A missing document and a document you can't read give the
  same "not found", so the API doesn't reveal which documents exist.

Every public query and mutation calls these. The UI hides controls you can't use (viewers get a read-only editor
with no toolbar), but that's for convenience: the server checks every call either way. `convex/access.test.ts`
covers who can read, edit, rename, share and delete (owner, editor, viewer, no access), plus revoking access and
refusing stale saves.

**Sign-in is a demo identity picker, not authentication.** Anyone can pick any demo user, which keeps the demo one
click away. What's real is the authorization layer behind it. Swapping in real auth (e.g. Convex Auth) would
replace `auth.ts` and how a token becomes a user, and nothing else.

## Editing and saving

- **Load once, then edit locally.** The editor reads the document once and never has live updates pushed into it.
  A live update landing mid-keystroke would fight the user's typing. Viewers' editors remount when a new version
  arrives.
- **Versioned autosave.** Edits are debounced (800 ms, at most 5 s) and sent with the `version` they're based on.
  `documents.save` accepts the save only if that is still the current version. Otherwise it returns
  `{ ok: false, reason: "conflict" }` instead of overwriting someone else's save. One save is in flight at a time;
  edits made during a save go out right after.
- **Conflicts are surfaced, not merged.** If someone else saved first, you see a banner. If you'd already typed, your
  draft stays in the editor and you can **Save draft as a copy** (a new document you own) or copy it to the
  clipboard, then open the latest version. Leaving with an unsaved draft asks for confirmation. For exits that
  can't be intercepted (browser Back, refresh, close), the draft is kept in the browser and offered later under
  **Recovered drafts** on the dashboard. Copy creation is idempotent, so retries never duplicate a copy. The rules
  are pure functions with unit tests (`src/lib/draft-protection.ts`, `src/lib/draft-recovery.ts`).

## Content validation

Bodies are stored as a JSON string so the server can enforce a byte cap: 800,000 UTF-8 bytes, under Convex's
1 MB document limit. `cleanContent` checks the size, then runs `validateBlocks` (`convex/lib/blocks.ts`), which the
editor shares:

- Only the block types the editor offers (paragraph, headings, lists, quote, code, divider, table). Image, video,
  audio and file blocks are removed from the editor schema, because shared documents would load arbitrary URLs for
  other users.
- Links must be http(s), mailto, `#` or relative.
- Nesting depth is limited to 24.

The check is deliberately shallow: it validates structure and the risky parts, not every BlockNote property.

## Import

Conversion runs in the browser, then goes through the same validated `create` as any other document:

- `.txt`: one paragraph per line, with markup kept as literal text.
- `.md`: converted to HTML with marked.
- `.docx`: converted to HTML with mammoth.

HTML from Markdown or Word is sanitized with DOMPurify, then turned into BlockNote blocks. Empty results are
refused. Files are capped at 5 MB, and the converted document must fit the content cap.

## Deployment

Convex Cloud production deployment plus Vercel, both on free tiers, deployed from the CLI. Convex deploys first
when backend functions change, so a new frontend never calls functions that don't exist yet. The one Vercel
setting is `NEXT_PUBLIC_CONVEX_URL`.

## Trade-offs and what I'd do next

| Chose | Instead of | Because |
|---|---|---|
| Version check plus "save as a copy" | Real-time co-editing | Simple and predictable, and never loses or overwrites work. Next step: Convex's `prosemirror-sync` for live collaboration. |
| Demo identity picker | Real auth | Keeps the demo one click away. The token → user boundary is already there, ready for a real provider. |
| No images or embeds | File storage | Needs storage plus a trust model for shared content. Convex file storage is the natural next step. |
| Shallow block validation | A full schema | Covers what matters for safety and size without coupling to every editor property. |
| Browser-local draft recovery | Server-side draft history | Covers the gap with no extra tables. Version history would replace it. |
| One continuous page while editing, plus Print / Save as PDF (A4 or Letter) | Page breaks shown live in the editor | The editor shows one continuous column of text. Splitting it into pages live means measuring rendered blocks on every keystroke and splitting paragraphs, lists and tables across page boundaries, a layout engine in its own right. Drawing guide lines every 11 inches of screen height would be cheap but misleading: margins and line wrapping differ by screen, so they wouldn't match where a printed page really breaks. Instead, **Print / PDF** hands pagination to the browser's print engine via `react-to-print`: it copies just the page (not the toolbar or app) into a fresh iframe with an `@page` rule for A4 or Letter, and the browser's dialog offers Save as PDF. Print CSS keeps headings with the text after them and never splits a table row. A fresh iframe per print matters: a page-level `@page` rule changed in place kept the first paper size in Chrome. Known limit: a table's first row isn't repeated on each page, because BlockNote doesn't mark it as a header row. |

Not built: page breaks while editing, version history, comments, real-time cursors, real authentication, CI.
