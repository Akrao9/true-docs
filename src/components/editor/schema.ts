import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { ALLOWED_BLOCK_TYPES, validateBlocks } from "../../../convex/lib/blocks";

// Media blocks are removed: there's no file storage behind them, and in shared docs an arbitrary
// embed/download URL is something another user would be asked to trust. The server allows exactly these
// block types (convex/lib/blocks.ts).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { image, video, audio, file, ...blockSpecs } = defaultBlockSpecs;

export const schema = BlockNoteSchema.create({ blockSpecs });

// Fail fast in development if the editor and server ever disagree about which blocks exist.
if (process.env.NODE_ENV !== "production") {
  const editorTypes = Object.keys(blockSpecs).sort().join(",");
  const serverTypes = [...ALLOWED_BLOCK_TYPES].sort().join(",");
  if (editorTypes !== serverTypes) {
    console.error(`Editor blocks [${editorTypes}] don't match server blocks [${serverTypes}]`);
  }
}

export type DocEditorInstance = BlockNoteEditor<
  typeof schema.blockSchema,
  typeof schema.inlineContentSchema,
  typeof schema.styleSchema
>;

export type EditorBlocks =PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>[];

/**
 * Parse stored content for the editor. "[]" (a new document) becomes `undefined`: BlockNote rejects an
 * empty initialContent array and creates its own default empty paragraph when none is given.
 */
export function parseStoredContent(
  raw: string,
): { ok: true; blocks: EditorBlocks | undefined } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "The saved content isn't valid JSON." };
  }
  const result = validateBlocks(parsed);
  if (!result.ok) return { ok: false, reason: result.reason };
  const blocks = parsed as EditorBlocks;
  return { ok: true, blocks: blocks.length === 0 ? undefined : blocks };
}
