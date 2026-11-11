"use client";

import { BlockNoteEditor } from "@blocknote/core";
import { validateBlocks } from "../../convex/lib/blocks";
import { schema } from "@/components/editor/schema";
import { sanitizeImportedHtml } from "./sanitize-html";
import { blocksHaveContent, checkImportFile, checkImportedSize, textToBlocks, titleFromFileName } from "./import-text";

export type ImportResult = { ok: true; title: string; content: string } | { ok: false; error: string };

/**
 * Convert an uploaded file into a new document's title + BlockNote content, entirely in the browser.
 * - .txt: one paragraph per line (no HTML step, so no markup is ever interpreted).
 * - .md: marked → HTML → BlockNote. Markdown is parsed via HTML, not BlockNote's own Markdown parser,
 *   because that parser had a reported numbered-list bug.
 * - .docx: mammoth → HTML → BlockNote. Images are dropped: the editor schema has no image block.
 * The HTML is sanitized with DOMPurify before BlockNote sees it (sanitize-html.ts). Only block types in our
 * schema survive parsing, and the result is validated with the same rules the server applies.
 */
export async function convertFile(file: File): Promise<ImportResult> {
  const check = checkImportFile(file);
  if (!check.ok) return check;

  let blocks: unknown[];
  try {
    if (check.kind === "txt") {
      blocks = textToBlocks(await file.text());
    } else {
      const html =
        check.kind === "md"
          ? await (await import("marked")).marked.parse(await file.text(), { async: true })
          : (await (await import("mammoth")).convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value;
      const editor = BlockNoteEditor.create({ schema });
      blocks = editor.tryParseHTMLToBlocks(sanitizeImportedHtml(html));
    }
  } catch (err) {
    console.error("Import failed", err);
    return {
      ok: false,
      error:
        check.kind === "docx"
          ? `Couldn't read "${file.name}". Is it a valid .docx file? (Older .doc files aren't supported.)`
          : `Couldn't read "${file.name}".`,
    };
  }

  if (!blocksHaveContent(blocks)) return { ok: false, error: `"${file.name}" has no text to import.` };
  const valid = validateBlocks(blocks);
  if (!valid.ok) return { ok: false, error: `"${file.name}" contains content that can't be imported (${valid.reason}).` };

  const content = JSON.stringify(blocks);
  const tooBig = checkImportedSize(content);
  if (tooBig) return { ok: false, error: tooBig };

  return { ok: true, title: titleFromFileName(file.name), content };
}
