import DOMPurify from "dompurify";

/**
 * Sanitize HTML produced from an uploaded file before BlockNote parses it.
 *
 * marked and mammoth both leave sanitization to the caller. BlockNote 0.57 happens to parse HTML in an inert
 * document, but that's an internal detail rather than a documented guarantee, so we sanitize explicitly:
 * - DOMPurify defaults remove <script>, event-handler attributes and javascript:/data: URLs.
 * - Media and embed tags are dropped. The editor has no blocks for them, and they'd load remote or huge data URIs.
 * - URLs are limited to the protocols the server accepts for links (convex/lib/blocks.ts).
 */
export function sanitizeImportedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["img", "picture", "source", "video", "audio", "iframe", "object", "embed", "svg", "math", "style", "form"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
  });
}
