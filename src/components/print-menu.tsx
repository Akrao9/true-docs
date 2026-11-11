"use client";

import { Printer } from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The white page around the document body (doc-editor.tsx). The toolbar sits outside it, so it never prints. */
const printRoot = () => document.querySelector<HTMLElement>("[data-print-root]");

/** Paper size and margins for the browser's print engine, which does the actual splitting into pages. */
const PAGE_STYLE = {
  A4: "@page { size: A4; margin: 20mm 18mm; }",
  letter: "@page { size: letter; margin: 0.75in 0.7in; }",
};

/**
 * Print / Save as PDF via react-to-print: each print copies the page into a fresh iframe with the app's styles,
 * so the paper size always applies (a page-level @page rule can stick to the first size printed in a tab).
 * The document title becomes the PDF file name. What prints is what the editor shows, including unsaved edits.
 * Print-specific layout (no sheet border, page-break rules) is in globals.css under @media print.
 */
export function PrintMenu({ title }: { title: string }) {
  const documentTitle = title.trim() || "Untitled document";
  const printA4 = useReactToPrint({ documentTitle, pageStyle: PAGE_STYLE.A4 });
  const printLetter = useReactToPrint({ documentTitle, pageStyle: PAGE_STYLE.letter });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" aria-label="Print or save as PDF" title="Print or save as PDF" />}
      >
        <Printer />
        <span className="hidden lg:inline">Print / PDF</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => printA4(printRoot)}>A4 (210 × 297 mm)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => printLetter(printRoot)}>Letter (8.5 × 11 in)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
