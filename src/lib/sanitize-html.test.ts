// @vitest-environment jsdom
import { marked } from "marked";
import { describe, expect, test } from "vitest";
import { sanitizeImportedHtml } from "./sanitize-html";

describe("sanitizeImportedHtml", () => {
  test("removes scripts, event handlers and inline styles' script vectors", () => {
    const out = sanitizeImportedHtml(
      '<p onclick="steal()">hi</p><script>steal()</script><a href="https://ok.dev" onmouseover="x()">ok</a>',
    );
    expect(out).not.toMatch(/script|onclick|onmouseover|steal/);
    expect(out).toContain('<a href="https://ok.dev">ok</a>');
  });

  test("drops media and embeds, including data-URI images from .docx", () => {
    const out = sanitizeImportedHtml(
      '<p>a<img src="data:image/png;base64,AAAA" onerror="x()"></p><iframe src="https://evil.dev"></iframe><svg onload="x()"></svg><video src="v.mp4"></video>',
    );
    expect(out).toBe("<p>a</p>");
  });

  test("links keep only protocols the server accepts", () => {
    const out = sanitizeImportedHtml(
      '<a href="javascript:alert(1)">js</a> <a href="data:text/html,x">data</a> <a href="vbscript:x">vb</a> ' +
        '<a href="https://a.dev">https</a> <a href="mailto:a@b.dev">mail</a> <a href="#top">anchor</a>',
    );
    expect(out).not.toMatch(/javascript:|data:|vbscript:/);
    expect(out).toContain('href="https://a.dev"');
    expect(out).toContain('href="mailto:a@b.dev"');
    expect(out).toContain('href="#top"');
  });

  test("keeps the structure import relies on (marked output)", async () => {
    const html = await marked.parse("# Title\n\n**bold** *it*\n\n1. one\n2. two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", {
      async: true,
    });
    const out = sanitizeImportedHtml(html);
    for (const tag of ["<h1>", "<strong>", "<em>", "<ol>", "<li>", "<table>", "<td>"]) expect(out).toContain(tag);
  });

  test("raw HTML embedded in Markdown is neutralised", async () => {
    const html = await marked.parse('text\n\n<img src=x onerror="window.pwned=1">\n\n<a href="javascript:alert(1)">x</a>', {
      async: true,
    });
    const out = sanitizeImportedHtml(html);
    expect(out).not.toMatch(/onerror|<img|javascript:/);
  });
});
