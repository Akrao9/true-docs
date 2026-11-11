/**
 * Pure, DOM-free parts of file import: which files are accepted, titles, and plain text → blocks.
 * Kept separate from the BlockNote/mammoth code so they can be unit tested.
 */
import { CONTENT_MAX_BYTES, TITLE_MAX } from "../../convex/lib/validation";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const IMPORT_KINDS = {
  txt: { label: "Plain text", extensions: [".txt"], mime: "text/plain" },
  md: { label: "Markdown", extensions: [".md", ".markdown"], mime: "text/markdown" },
  docx: {
    label: "Word",
    extensions: [".docx"],
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
} as const;
export type ImportKind = keyof typeof IMPORT_KINDS;

export const ACCEPTED_EXTENSIONS = Object.values(IMPORT_KINDS).flatMap((k) => k.extensions);

/** Decides by extension. MIME types for .md vary by OS (often empty), so they aren't trusted. */
export function importKindFor(fileName: string): ImportKind | null {
  const lower = fileName.toLowerCase();
  for (const [kind, spec] of Object.entries(IMPORT_KINDS) as [ImportKind, (typeof IMPORT_KINDS)[ImportKind]][]) {
    if (spec.extensions.some((ext) => lower.endsWith(ext))) return kind;
  }
  return null;
}

export function checkImportFile(file: { name: string; size: number }): { ok: true; kind: ImportKind } | { ok: false; error: string } {
  const kind = importKindFor(file.name);
  if (!kind) {
    return { ok: false, error: `"${file.name}" isn't supported. Import a ${ACCEPTED_EXTENSIONS.join(", ")} file.` };
  }
  if (file.size === 0) return { ok: false, error: `"${file.name}" is empty.` };
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: `"${file.name}" is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.` };
  }
  return { ok: true, kind };
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Imported document").slice(0, TITLE_MAX);
}

type ParagraphBlock = { type: "paragraph"; content: { type: "text"; text: string; styles: Record<string, never> }[] };

/**
 * Plain text → one paragraph per line, so the document looks like the file. Blank lines become empty
 * paragraphs, and leading/trailing blank lines are dropped.
 */
export function textToBlocks(raw: string): ParagraphBlock[] {
  const lines = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((line) => ({
    type: "paragraph",
    content: line.length ? [{ type: "text", text: line, styles: {} }] : [],
  }));
}

/**
 * True if any block holds visible text (or is a table/divider). Parsers turn an empty file into one empty
 * paragraph, so "has blocks" isn't the same as "has content".
 */
export function blocksHaveContent(blocks: unknown[]): boolean {
  const hasText = (v: unknown): boolean => {
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.some(hasText);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.type === "table" || o.type === "divider") return true;
      if (typeof o.text === "string") return o.text.trim().length > 0;
      return hasText(o.content) || hasText(o.rows) || hasText(o.cells) || hasText(o.children);
    }
    return false;
  };
  return blocks.some(hasText);
}

/** The same byte cap the server enforces, checked first so the user gets a clear message. */
export function checkImportedSize(contentJson: string): string | null {
  const bytes = new TextEncoder().encode(contentJson).byteLength;
  return bytes > CONTENT_MAX_BYTES
    ? `The imported document is too large to save (${Math.round(bytes / 1024)} KB; limit ~${CONTENT_MAX_BYTES / 1000} KB).`
    : null;
}
