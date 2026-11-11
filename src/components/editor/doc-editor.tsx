"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { BlockNoteViewEditor, FormattingToolbar, useCreateBlockNote } from "@blocknote/react";
import { useEffect, type RefObject } from "react";
import { schema, type DocEditorInstance, type EditorBlocks } from "./schema";

/**
 * Loaded with `dynamic(..., { ssr: false })`: BlockNote needs the DOM.
 * `initialContent` is read once, when the editor is created. To show newer content, the parent remounts
 * this component with a new `key` instead of pushing updates into a live editor (which would fight typing).
 */
export default function DocEditor(props: {
  initialContent: EditorBlocks | undefined;
  editable: boolean;
  onChange?: (contentJson: string) => void;
  /** Lets the parent read the live draft (e.g. "Copy my draft" after a save conflict). */
  editorRef?: RefObject<DocEditorInstance | null>;
  /** Classes for the "page" around the text. The toolbar sits outside it, like an app control. */
  pageClassName?: string;
}) {
  // Throws if BlockNote can't build a document from the content. The parent's error boundary catches it,
  // so a malformed document shows an error instead of an empty editor that would autosave over it.
  const editor = useCreateBlockNote({ schema, initialContent: props.initialContent });

  const { editorRef } = props;
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  // Static formatting toolbar (BlockNote's "Static Formatting Toolbar" example): the floating one is turned off and
  // the built-in toolbar is rendered above the page, outside its border, sticky below the app header while scrolling
  // (globals.css, .doc-editor-static). It has to stay inside BlockNoteView for the editor context, so the page is
  // drawn here around the text only. renderEditor={false} lets us place the toolbar *before* the editor in the DOM,
  // so keyboard (Tab) order matches what's on screen. BlockNoteViewEditor still renders the side menu, slash menu
  // and other default UI. Viewers get no toolbar.
  return (
    <BlockNoteView
      editor={editor}
      editable={props.editable}
      theme="light"
      formattingToolbar={!props.editable}
      renderEditor={false}
      className={props.editable ? "doc-editor-static" : undefined}
      onChange={() => {
        if (props.editable) props.onChange?.(JSON.stringify(editor.document));
      }}
    >
      {props.editable && <FormattingToolbar />}
      {/* data-print-root: what Print / PDF prints (print-menu.tsx). */}
      <div className={props.pageClassName} data-print-root="">
        <BlockNoteViewEditor />
      </div>
    </BlockNoteView>
  );
}
