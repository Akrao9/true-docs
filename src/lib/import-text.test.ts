import { describe, expect, test } from "vitest";
import { validateBlocks } from "../../convex/lib/blocks";
import { CONTENT_MAX_BYTES } from "../../convex/lib/validation";
import {
  blocksHaveContent,
  checkImportFile,
  checkImportedSize,
  MAX_IMPORT_BYTES,
  textToBlocks,
  titleFromFileName,
} from "./import-text";

describe("checkImportFile", () => {
  test.each([
    ["notes.txt", "txt"],
    ["README.MD", "md"],
    ["plan.markdown", "md"],
    ["Report.docx", "docx"],
  ])("accepts %s as %s", (name, kind) => {
    expect(checkImportFile({ name, size: 10 })).toEqual({ ok: true, kind });
  });

  test.each([
    ["legacy.doc", /isn't supported/],
    ["slides.pdf", /isn't supported/],
    ["notes.txt.exe", /isn't supported/],
  ])("rejects %s", (name, error) => {
    expect(checkImportFile({ name, size: 10 })).toMatchObject({ ok: false, error });
  });

  test("rejects empty and oversized files", () => {
    expect(checkImportFile({ name: "a.txt", size: 0 })).toMatchObject({ ok: false, error: /empty/ });
    expect(checkImportFile({ name: "a.txt", size: MAX_IMPORT_BYTES + 1 })).toMatchObject({ ok: false, error: /larger than/ });
  });
});

describe("textToBlocks", () => {
  test("one paragraph per line; CRLF, BOM and outer blank lines handled", () => {
    const blocks = textToBlocks("﻿\r\nFirst line\r\n\r\nThird line\twith tab\r\n\r\n");
    expect(blocks).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "First line", styles: {} }] },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "Third line    with tab", styles: {} }] },
    ]);
  });

  test("markup in a .txt file stays literal text, never formatting or HTML", () => {
    const [block] = textToBlocks('# not a heading <img src=x onerror="alert(1)">');
    expect(block.content[0].text).toBe('# not a heading <img src=x onerror="alert(1)">');
  });

  test("output passes the server's block validation", () => {
    expect(validateBlocks(textToBlocks("a\n\nb"))).toEqual({ ok: true });
  });
});

describe("blocksHaveContent", () => {
  test("an empty file parsed to one empty paragraph has no content", () => {
    expect(blocksHaveContent([{ type: "paragraph", props: {}, content: [], children: [] }])).toBe(false);
    expect(blocksHaveContent([{ type: "paragraph", content: [{ type: "text", text: "   ", styles: {} }] }])).toBe(false);
    expect(blocksHaveContent(textToBlocks("\n \n"))).toBe(false);
  });

  test("text anywhere (nested, in a link, in a table cell) counts", () => {
    expect(blocksHaveContent([{ type: "paragraph", children: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }])).toBe(true);
    expect(blocksHaveContent([{ type: "paragraph", content: [{ type: "link", href: "https://a", content: [{ type: "text", text: "a" }] }] }])).toBe(true);
    expect(blocksHaveContent([{ type: "table", content: { type: "tableContent", rows: [] } }])).toBe(true);
  });
});

describe("titles and size", () => {
  test("title comes from the file name", () => {
    expect(titleFromFileName("Q4_launch  plan.final.txt")).toBe("Q4 launch plan.final");
    expect(titleFromFileName(".txt")).toBe("Imported document");
  });

  test("imported content over the byte cap is reported before upload", () => {
    const big = JSON.stringify(textToBlocks("€".repeat(Math.ceil(CONTENT_MAX_BYTES / 3) + 10)));
    expect(checkImportedSize(big)).toMatch(/too large/);
    expect(checkImportedSize(JSON.stringify(textToBlocks("small")))).toBeNull();
  });
});
