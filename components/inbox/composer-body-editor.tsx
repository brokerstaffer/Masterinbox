"use client";

import {
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
} from "lucide-react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";

// Rich-text body editor for the reply / forward composer. Same TipTap
// engine the template editor uses, but with a composer-tuned toolbar
// (no Insert-variable button — templates handle variables; the composer
// is for free-form writing on top of a template-inserted body).
//
// Imperative handle:
//   - insertContent(html) → drop HTML at the current caret. Used when
//     a template is picked from the dropdown.
//   - setContent(html)    → replace the whole editor content. Used when
//     the AI draft endpoint returns a fresh body.
//   - focus()             → focus the editor (useful after content swap).
//   - getHtml() / getText() → snapshot helpers (state is also kept via
//     onChange).
//
// onChange fires on every user keystroke AND on imperative commands —
// the parent component holds the canonical state, this editor is only
// a controlled view of it. Initial value lives on the `initialHtml`
// prop; the parent does NOT re-push value on every render (that would
// fight with the user's typing).

export interface ComposerBodyHandle {
  insertContent: (html: string) => void;
  setContent: (html: string) => void;
  focus: () => void;
  getHtml: () => string;
  getText: () => string;
}

export const ComposerBodyEditor = forwardRef<
  ComposerBodyHandle,
  {
    initialHtml?: string;
    placeholder?: string;
    onChange: (next: { html: string; text: string }) => void;
  }
>(function ComposerBodyEditor(
  { initialHtml = "", placeholder = "Write your reply…", onChange },
  ref,
) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "tiptap min-h-[200px] outline-none text-sm leading-relaxed",
          "[&_p]:my-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_a]:text-blue-600 [&_a]:underline",
        ),
      },
    },
    onUpdate: ({ editor }) => {
      // TipTap separates blocks with \n\n — collapse runs of 3+ newlines
      // (caused by empty paragraphs the user hits Enter through) to 2 so
      // the plain-text projection (used for empty-body checks + the
      // forward-marker safety net) stays tidy.
      const text = editor.getText().replace(/\n{3,}/g, "\n\n").trim();
      onChange({ html: editor.getHTML(), text });
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertContent: (html: string) => {
        editor?.chain().focus().insertContent(html).run();
      },
      setContent: (html: string) => {
        editor?.commands.setContent(html, { emitUpdate: true });
      },
      focus: () => {
        editor?.commands.focus();
      },
      getHtml: () => editor?.getHTML() ?? "",
      getText: () => editor?.getText() ?? "",
    }),
    [editor],
  );

  if (!editor) {
    return (
      <div className="min-h-[200px] text-xs text-muted-foreground flex items-center">
        Loading editor…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
});

function Toolbar({ editor }: { editor: Editor }) {
  const isActive = (name: string) => editor.isActive(name);

  function setLink() {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 -mx-1">
      <ToolbarButton
        active={isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (⌘B)"
      >
        <Bold className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (⌘I)"
      >
        <Italic className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (⌘U)"
      >
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <Strikethrough className="size-3.5" />
      </ToolbarButton>
      <Sep />
      <ToolbarButton
        active={isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bulleted list"
      >
        <List className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        <ListOrdered className="size-3.5" />
      </ToolbarButton>
      <Sep />
      <ToolbarButton
        active={isActive("link")}
        onClick={setLink}
        title="Add / edit link"
      >
        <LinkIcon className="size-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded text-foreground/70 hover:bg-accent transition-colors",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />;
}
