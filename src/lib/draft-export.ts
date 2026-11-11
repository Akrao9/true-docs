"use client";

import { BlockNoteEditor } from "@blocknote/core";
import { schema, type EditorBlocks } from "@/components/editor/schema";

/**
 * Turn stored BlockNote JSON into Markdown with a headless editor (no DOM mount), for downloading a recovered
 * draft. If the blocks can't be rendered, fall back to the raw JSON so the user always gets their content.
 */
export async function draftToMarkdown(contentJson: string): Promise<string> {
  try {
    const blocks = JSON.parse(contentJson) as EditorBlocks;
    if (!Array.isArray(blocks) || blocks.length === 0) return "";
    const editor = BlockNoteEditor.create({ schema, initialContent: blocks });
    return editor.blocksToMarkdownLossy(editor.document);
  } catch {
    return contentJson;
  }
}
