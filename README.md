# True Docs

A lightweight collaborative document editor: create, edit, import and share rich-text documents.

**Stack:** Next.js 16 (App Router) · BlockNote editor · Convex (database + server functions) · shadcn/ui · Vitest + convex-test

**Live:** https://ajaia-docs-psi-three.vercel.app (shared sandbox, see Demo accounts)

**How it works:** [ARCHITECTURE.md](ARCHITECTURE.md)

**Try sharing in 1 minute:** open the live link, pick **Alice**, import a file or create a doc, click **Share**,
and add `bob@example.com`. Then open a **new tab**, pick **Bob**, and find it under **Shared with me**.

## Run locally

Requires Node 22.22+, 24.15+ or 26+ (developed on Node 26). The Convex CLI, Vitest and jsdom need it.

```bash
npm install
```

Terminal 1: start a local Convex backend. No Convex account is needed: anonymous local mode runs the backend
on your machine and writes `.env.local` for you. (If you have a Convex account, plain `npx convex dev` creates
a cloud dev deployment instead.)

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev
```

Seed the demo users (idempotent; run once while Terminal 1 is up):

```bash
npx convex run seed:seed
```

Terminal 2: start the web app, then open http://localhost:3000

```bash
npm run dev
```

## Demo accounts

Auth is a **demo identity picker**: choose a user, no password. Permissions are still enforced on the server
for whichever user you pick. The live deployment is a **shared sandbox**: every visitor can sign in as these
users, so use sample content only.

Each browser tab keeps its own user (sessionStorage), and refreshing keeps you signed in. To try sharing in one
browser, open a **new tab** (not a duplicated one), sign in as a different user, and keep both open.

| Name | Email |
|---|---|
| Alice Chen | alice@example.com |
| Bob Patel | bob@example.com |
| Carol Diaz | carol@example.com |

## Editing

- The formatting toolbar sits above the page, outside its border (BlockNote's static toolbar, first in Tab
  order), and stays visible below the header while you scroll: block type (paragraph, headings, lists, quote),
  bold, italic, underline, strikethrough, alignment, colour, and link (with text selected). Type `/` for the
  block menu. Viewers don't get the toolbar. On phones the page uses narrower margins and smaller headings.
- **Print / PDF** (header, anyone with access) prints the document, or saves it as a PDF, on A4 or Letter
  paper, via `react-to-print`. The browser splits it into pages, and only the page prints: no app, toolbar or
  banners. Headings stay with their text, and table rows aren't split. Page breaks aren't shown while editing
  (see ARCHITECTURE.md).
- Supported blocks: paragraph, headings, bullet / numbered / check / toggle lists, quote, code block, divider,
  table. **Images, video, audio and file embeds are deliberately disabled.** There's no file storage behind
  them, and in shared docs an arbitrary embed URL is something other users would have to trust.
- Autosave runs about 1s after you stop typing, and the header shows Saving… / Saved / Couldn't save (Retry).
- Concurrent edits: if someone else saves first, you get a banner instead of having their work overwritten. If
  you'd already typed, your save is refused and your draft stays in the editor:
  - **Save draft as a copy** (the main action) creates a new document you own, with formatting intact. Keep
    typing and the banner says the copy is out of date and offers **Update my copy**.
  - Then **Open my copy** or **Open latest version**. Leaving while the draft isn't covered by a copy (Reload,
    the logo, Switch user) asks you to confirm discarding it, and Cancel changes nothing.
  - Safety net for exits that can't be intercepted (browser Back, access removed, refresh or close): at-risk
    edits are kept in this browser, including edits typed after a newer version appeared but before the server
    has refused them. Edits already saved as a copy aren't stashed again, so Open my copy / Open latest version
    after saving one leaves nothing behind. Only a confirmed conflict also makes a server copy automatically.
    Each editing session (tab) has its own recovery record, and a server acknowledgement removes a record only
    if it covers that record's revision, so a newer draft (later typing, another tab) is never deleted. If the
    server save fails (offline, over the size cap), the dashboard shows **Recovered drafts** with Save as a copy,
    Download .md and Discard. If local storage is blocked, the server save still runs.
  - No duplicate copies: copy saves in a tab run one at a time; a dashboard retry waits for the tab's pending
    exit save ("Saving to server…"); and the server makes creating the same draft snapshot idempotent, which
    covers retries from another tab or after a lost response. A keyed copy is returned only if it still holds
    that exact snapshot; if someone has edited it since, a fresh copy is made, so "saved" always means the draft
    is in a document; the lookup uses a fingerprint of each copy's current body, so it stays one bounded query.
  - **Copy to clipboard** is there for pasting back a line or two.
  - Not built (deliberately): a side-by-side compare and version history.

## Sharing

- Only the owner sees the controls. **Share** adds people by email as **Viewer** (read only) or **Editor** (read
  and edit), and the owner can change a role or remove someone at any time. Everyone else sees the list of people
  with access, read-only.
- The dashboard separates **My documents** from **Shared with me**, where each shared doc shows its owner and your
  role.
- Changes apply live. A promoted viewer's open tab becomes editable, and a removed user's tab shows "Document not
  found".
- Errors appear inline: unknown email, sharing with yourself, and a 50-person limit per document.

## Import

Drop a file on the dashboard (or click to choose one) to create a new document you own.

| Type | How it's converted |
|---|---|
| `.txt` | One paragraph per line. Markup stays literal text: `# x` is not a heading, `<b>` is not bold. |
| `.md`, `.markdown` | Headings, bold/italic, links, bullet and numbered lists, code, quotes, tables. |
| `.docx` | Same, via mammoth. **Images are dropped**, and older `.doc` files aren't supported. |

Limits: 5 MB per file, and the converted document must fit the ~800 KB document cap. Empty files,
unsupported types and `javascript:` links are refused or stripped with a clear message. Conversion runs in the
browser. HTML from Markdown or Word is sanitized with DOMPurify before parsing, and the server re-validates the
result like any other save.

## Deployment

Backend on Convex Cloud (production deployment), frontend on Vercel. Both are on free tiers. Deploys are run
from the CLI; there's no CI.

```bash
npx convex deploy -y
```

```bash
npx convex run seed:seed --prod
```

```bash
npx vercel deploy --prod
```

- Vercel needs one environment variable, `NEXT_PUBLIC_CONVEX_URL`: the production Convex URL, set once with
  `vercel env add NEXT_PUBLIC_CONVEX_URL production`. It's inlined at build time, so redeploy after changing it.
- Deploy Convex **before** Vercel when backend functions change, so the new frontend never calls functions that
  don't exist yet.
- `vercel.json` pins `"framework": "nextjs"`. A project created from the CLI defaulted to "Other" and served
  404s.
- `.vercelignore` keeps `references/` and local env files out of the upload.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | 78 tests: access control, sharing, stale-save conflicts, draft protection, content validation, import conversion, HTML sanitizing |
| `npm run typecheck` | Typechecks the app and the Convex functions |
| `npm run lint` | ESLint |

## Project layout

```
convex/            backend: schema, queries/mutations, tests
  lib/access.ts    the one place document permissions are decided
  lib/blocks.ts    block validation shared by server and editor
  lib/content.ts   document bodies live in their own table; lists and access checks read only metadata
  lib/validation.ts
  migrations.ts    one-off data backfill (fingerprints for older draft copies)
src/app/           routes: / (sign-in + dashboard), /doc/[id]
src/components/    UI: editor/, share-dialog, import-dropzone (shadcn components in ui/)
src/lib/session.tsx  client session (per-tab token in sessionStorage, resolved server-side)
src/lib/import-*.ts  file → document conversion
```
