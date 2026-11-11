import { ConvexError } from "convex/values";
import { validateBlocks } from "./blocks";

export const TITLE_MAX = 200;
// Convex documents are capped at 1 MiB, measured in bytes, not JS string length.
// Leave headroom for the other fields on the document.
export const CONTENT_MAX_BYTES = 800_000;
export const DEFAULT_TITLE = "Untitled document";

export function cleanTitle(raw: string | undefined): string {
  const title = (raw ?? "").replace(/\s+/g, " ").trim();
  if (title.length === 0) return DEFAULT_TITLE;
  if (title.length > TITLE_MAX) {
    throw new ConvexError({ code: "INVALID", message: `Title must be ${TITLE_MAX} characters or fewer.` });
  }
  return title;
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/**
 * Content must be BlockNote blocks the editor can reopen, and must fit in a Convex document.
 * An empty document is stored as "[]". The client opens that as BlockNote's default empty paragraph.
 */
export function cleanContent(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "[]";
  if (utf8Bytes(raw) > CONTENT_MAX_BYTES) {
    throw new ConvexError({ code: "TOO_LARGE", message: "This document is too large to save (limit ~800 KB)." });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConvexError({ code: "INVALID", message: "Document content is not valid." });
  }
  const result = validateBlocks(parsed);
  if (!result.ok) {
    throw new ConvexError({ code: "INVALID", message: `Document content is not valid: ${result.reason}.` });
  }
  return raw;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
