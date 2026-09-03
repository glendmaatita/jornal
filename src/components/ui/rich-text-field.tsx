import { useEffect } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { Bold, Italic, List, ListOrdered } from "lucide-react"

import { FieldShell } from "@/components/ui/field-shell"
import { cn } from "@/lib/utils"

export interface RichTextFieldProps {
  label?: string
  value: string // HTML
  onChange: (html: string) => void
  onBlur?: () => void
  error?: string
  hint?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  minHeight?: number
  className?: string
}

/**
 * Rich text field built on tiptap — replaces the native <textarea>.
 * Minimal toolbar (bold / italic / lists) in the teofin chrome.
 */
export function RichTextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  disabled,
  placeholder = "Tulis catatan…",
  className,
}: RichTextFieldProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false, blockquote: false, codeBlock: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: instance }) => {
      const html = instance.isEmpty ? "" : instance.getHTML()
      onChange(html)
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  // Sync external value changes (e.g. form reset) without fighting the editor
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? "" : editor.getHTML()
    if ((value || "") !== current) {
      editor.commands.setContent(value || "")
    }
  }, [editor, value])

  if (!editor) {
    return (
      <FieldShell label={label} hint={hint} error={error} disabled={disabled} className={className}>
        <div className="min-h-24 w-full animate-pulse rounded bg-secondary/50" />
      </FieldShell>
    )
  }

  const active = (name: string) => editor.isActive(name)

  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      required={required}
      disabled={disabled}
      hasValue={!editor.isEmpty}
      focused={editor.isFocused}
      className={className}
    >
      <div className="-mx-2 -my-1 w-full">
        <div className="rich-toolbar" role="toolbar" aria-label="Format catatan">
          <ToolbarButton active={active("bold")} label="Tebal" onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={active("italic")} label="Miring" onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={active("bulletList")} label="Daftar poin" onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton active={active("orderedList")} label="Daftar bernomor" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="size-3.5" />
          </ToolbarButton>
        </div>
        <div
          className="px-2 py-2"
          onBlur={() => onBlur?.()}
        >
          <EditorContent editor={editor} className={cn(disabled && "pointer-events-none opacity-60")} />
        </div>
      </div>
    </FieldShell>
  )
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rich-toolbar__btn", active && "rich-toolbar__btn--active")}
      aria-label={label}
      aria-pressed={active}
      tabIndex={-1}
    >
      {children}
    </button>
  )
}
