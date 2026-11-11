/**
 * Shallow structural validation of BlockNote documents, shared by the server (before saving) and the
 * client (before opening). Pure TypeScript with no Convex or BlockNote imports, so both sides can use it.
 *
 * Deliberately not a full mirror of BlockNote's schema: it checks what decides whether the editor can
 * reopen a document and whether shared content is safe to render.
 * See https://www.blocknotejs.org/docs/foundations/document-structure
 */

/** The block types our editor exposes. Must match the schema in src/components/editor/schema.ts. */
export const INLINE_BLOCKS = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "codeBlock",
] as const;
export const NO_CONTENT_BLOCKS = ["divider"] as const;
export const TABLE_BLOCKS = ["table"] as const;
export const ALLOWED_BLOCK_TYPES: readonly string[] = [...INLINE_BLOCKS, ...NO_CONTENT_BLOCKS, ...TABLE_BLOCKS];

export const MAX_NESTING_DEPTH = 24;
const SAFE_LINK = /^(https?:|mailto:|#|\/)/i;

type Result = { ok: true } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function validateBlocks(value: unknown): Result {
  if (!Array.isArray(value)) return fail("content must be an array of blocks");
  try {
    value.forEach((b, i) => checkBlock(b, `block ${i}`, 1));
    return { ok: true };
  } catch (e) {
    if (e instanceof InvalidBlocks) return fail(e.message);
    throw e;
  }
}

class InvalidBlocks extends Error {}
const fail = (reason: string): Result => ({ ok: false, reason });
const invalid = (msg: string): never => {
  throw new InvalidBlocks(msg);
};

function checkBlock(block: unknown, path: string, depth: number) {
  if (depth > MAX_NESTING_DEPTH) invalid(`${path}: nested more than ${MAX_NESTING_DEPTH} levels`);
  if (!isObject(block)) invalid(`${path}: not an object`);
  const b = block as Record<string, unknown>;

  // Partial blocks may omit type (paragraph is the default), id, props, content and children.
  const type = b.type ?? "paragraph";
  if (typeof type !== "string" || !ALLOWED_BLOCK_TYPES.includes(type)) {
    invalid(`${path}: unsupported block type ${JSON.stringify(type)}`);
  }
  if (b.id !== undefined && typeof b.id !== "string") invalid(`${path}: id must be a string`);
  if (b.props !== undefined && !isObject(b.props)) invalid(`${path}: props must be an object`);

  const content = b.content;
  if ((NO_CONTENT_BLOCKS as readonly string[]).includes(type as string)) {
    if (content !== undefined && !(Array.isArray(content) && content.length === 0)) {
      invalid(`${path}: ${type} blocks have no content`);
    }
  } else if ((TABLE_BLOCKS as readonly string[]).includes(type as string)) {
    if (content !== undefined) checkTable(content, path);
  } else if (content !== undefined) {
    checkInline(content, path);
  }

  if (b.children !== undefined) {
    if (!Array.isArray(b.children)) invalid(`${path}: children must be an array`);
    (b.children as unknown[]).forEach((c, i) => checkBlock(c, `${path}.children[${i}]`, depth + 1));
  }
}

function checkTable(content: unknown, path: string) {
  if (!isObject(content) || content.type !== "tableContent" || !Array.isArray(content.rows)) {
    invalid(`${path}: table content must be { type: "tableContent", rows: [...] }`);
  }
  (content as { rows: unknown[] }).rows.forEach((row, r) => {
    if (!isObject(row) || !Array.isArray(row.cells)) invalid(`${path}: table row ${r} has no cells array`);
    (row as { cells: unknown[] }).cells.forEach((cell, c) => {
      const where = `${path} cell ${r},${c}`;
      // A cell is either inline content directly or { type: "tableCell", content }.
      if (isObject(cell)) {
        if (cell.type !== "tableCell") invalid(`${where}: unknown cell type`);
        if (cell.content !== undefined) checkInline(cell.content, where);
      } else {
        checkInline(cell, where);
      }
    });
  });
}

/** Inline content: a plain string, or an array of text / link items. */
function checkInline(content: unknown, path: string) {
  if (typeof content === "string") return;
  if (!Array.isArray(content)) invalid(`${path}: inline content must be an array`);
  for (const item of content as unknown[]) {
    if (typeof item === "string") continue;
    if (!isObject(item)) invalid(`${path}: inline item is not an object`);
    const i = item as Record<string, unknown>;
    if (i.type === "text") {
      if (typeof i.text !== "string") invalid(`${path}: text item without text`);
    } else if (i.type === "link") {
      // Shared docs are rendered for other users: never store javascript:/data: links.
      if (typeof i.href !== "string" || !SAFE_LINK.test(i.href.trim())) {
        invalid(`${path}: link must use http(s), mailto, or a relative URL`);
      }
      if (i.content !== undefined) checkInline(i.content, path);
    } else {
      invalid(`${path}: unsupported inline content ${JSON.stringify(i.type)}`);
    }
  }
}
