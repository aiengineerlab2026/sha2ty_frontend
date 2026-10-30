"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bold, Heading3, Italic, List, ListOrdered, Redo2, RemoveFormatting, Underline, Undo2 } from "lucide-react";

// ponytail: contentEditable + execCommand (no editor dependency). It covers bold / italic / underline /
// heading / lists, which is all product descriptions use and what safeHtml keeps; swap in a real editor
// (e.g. Tiptap) if tables, links or images are ever needed.
type Command = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList";

const TOOLS: { cmd: Command; label: string; keys?: string; icon: ReactNode }[] = [
  { cmd: "bold", label: "Bold", keys: "⌘B", icon: <Bold className="size-4" /> },
  { cmd: "italic", label: "Italic", keys: "⌘I", icon: <Italic className="size-4" /> },
  { cmd: "underline", label: "Underline", keys: "⌘U", icon: <Underline className="size-4" /> },
  { cmd: "insertUnorderedList", label: "Bulleted list", icon: <List className="size-4" /> },
  { cmd: "insertOrderedList", label: "Numbered list", icon: <ListOrdered className="size-4" /> },
];

/** Product description editor. Emits HTML (b / i / u / h3 / ul / ol / li / p / br); readers sanitise it. */
export function RichText({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [empty, setEmpty] = useState(!value);

  // Load the saved description once (later edits come from the editor itself).
  useEffect(() => {
    if (ref.current && value && !ref.current.innerHTML) {
      ref.current.innerHTML = value;
      setEmpty(false);
    }
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent?.trim() ?? "";
    setEmpty(!text && !el.querySelector("li"));
    onChange(text || el.querySelector("li") ? el.innerHTML : "");
  }, [onChange]);

  // Toolbar state follows the caret: a button is "on" when the selection already has that format.
  const refresh = useCallback(() => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el || !sel?.anchorNode || !el.contains(sel.anchorNode)) return;
    const next: Record<string, boolean> = {};
    for (const t of TOOLS) next[t.cmd] = document.queryCommandState(t.cmd);
    next.heading = /^h3$/i.test(String(document.queryCommandValue("formatBlock")));
    setActive(next);
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refresh);
    return () => document.removeEventListener("selectionchange", refresh);
  }, [refresh]);

  const run = (cmd: string, arg?: string) => {
    const el = ref.current;
    if (!el) return;
    // Commands act on the current selection: make sure it is inside the editor first.
    if (document.activeElement !== el) {
      el.focus();
      const sel = document.getSelection();
      if (sel && !el.contains(sel.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    document.execCommand("styleWithCSS", false, "false"); // <b>/<i>, not inline styles that safeHtml would drop
    document.execCommand(cmd, false, arg);
    emit();
    refresh();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow focus-within:border-brand-amber focus-within:ring-4 focus-within:ring-brand-amber/15">
      <div role="toolbar" aria-label={t("Formatting")} className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50/70 p-1">
        {TOOLS.slice(0, 3).map((tool) => (
          <ToolButton key={tool.cmd} label={t(tool.label)} keys={tool.keys} on={active[tool.cmd]} onClick={() => run(tool.cmd)}>
            {tool.icon}
          </ToolButton>
        ))}
        <Divider />
        <ToolButton label={t("Heading")} on={active.heading} onClick={() => run("formatBlock", active.heading ? "p" : "h3")}>
          <Heading3 className="size-4" />
        </ToolButton>
        {TOOLS.slice(3).map((tool) => (
          <ToolButton key={tool.cmd} label={t(tool.label)} on={active[tool.cmd]} onClick={() => run(tool.cmd)}>
            {tool.icon}
          </ToolButton>
        ))}
        <Divider />
        <ToolButton label={t("Clear formatting")} onClick={() => run("removeFormat")}>
          <RemoveFormatting className="size-4" />
        </ToolButton>
        <span className="flex-1" />
        <ToolButton label={t("Undo")} keys="⌘Z" onClick={() => run("undo")}>
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton label={t("Redo")} keys="⇧⌘Z" onClick={() => run("redo")}>
          <Redo2 className="size-4" />
        </ToolButton>
      </div>
      <div className="relative">
        {empty && <p className="pointer-events-none absolute start-3.5 top-3 text-sm text-slate-400">{placeholder ?? t("Describe materials, finishes, care and what's included…")}</p>}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={t("Description")}
          onInput={emit}
          onKeyUp={refresh}
          onMouseUp={refresh}
          onPaste={(event) => {
            // Paste as plain text: no foreign fonts, colours or markup from other sites.
            event.preventDefault();
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          }}
          // Preflight resets lists and headings; give them back their look inside the editor.
          className="min-h-36 px-3.5 py-3 text-sm leading-relaxed text-slate-800 outline-none [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-brand-navy [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5"
        />
      </div>
    </div>
  );
}

function ToolButton({ label, keys, on = false, onClick, children }: { label: string; keys?: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={keys ? `${label} (${keys})` : label}
      // mousedown, not click: keep the editor's selection so the command applies to it.
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      // Keyboard (Enter / Space) fires click with detail 0; mouse clicks were handled on mousedown.
      onClick={(event) => event.detail === 0 && onClick()}
      className={`flex size-8 items-center justify-center rounded-md transition-colors ${on ? "bg-white text-brand-navy shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:bg-white hover:text-brand-navy"}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />;
}
