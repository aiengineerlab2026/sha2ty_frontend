"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send } from "lucide-react";
import { markRead, sendMessage, type Message } from "@/lib/tasks";
import { uploadPublicFile } from "@/lib/vendor/storage";

/** One conversation of a task: its customer and one vendor. `messages` are this thread's, kept live by the page. */
export function TaskChat({
  taskId,
  vendorId,
  me,
  title,
  messages,
  canSend,
  onSent,
}: {
  taskId: string;
  vendorId: string;
  me: string;
  title: string;
  messages: Message[];
  canSend: boolean;
  onSent: (message: Message) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const unread = messages.some((m) => m.sender_id !== me && !m.read_at);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
    if (unread) void markRead(taskId, vendorId, me);
  }, [messages.length, unread, taskId, vendorId, me]);

  const send = async (body: string, file?: File) => {
    if (busy || (!body.trim() && !file)) return;
    setBusy(true);
    setError(null);
    try {
      const url = file ? await uploadPublicFile(me, file, `tasks/${taskId}`) : null;
      onSent(await sendMessage(taskId, vendorId, body.trim(), url));
      setText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-[28rem] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-brand-navy">{title}</p>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-center text-xs text-slate-400">{t("No messages yet. Ask about sizes, materials, delivery or timing.")}</p>}
        {messages.map((m) => {
          const mine = m.sender_id === me;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-brand-navy text-white" : "bg-slate-100 text-slate-800"}`}>
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachment_url && (
                  /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m.attachment_url) ? (
                    <a href={m.attachment_url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.attachment_url} alt="" className="mt-1 max-h-48 rounded-lg" />
                    </a>
                  ) : (
                    <a href={m.attachment_url} target="_blank" rel="noreferrer" className="underline">{t("Attachment")}</a>
                  )
                )}
                <p className={`mt-0.5 text-[10px] ${mine ? "text-white/60" : "text-slate-400"}`}>
                  {new Date(m.created_at).toLocaleString()}
                  {mine && m.read_at ? ` · ${t("Read")}` : ""}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {error && <p className="px-4 text-xs text-red-700">{error}</p>}
      {canSend ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
          className="flex items-center gap-2 border-t border-slate-100 p-2"
        >
          <label className="cursor-pointer rounded-lg p-2 text-slate-500 hover:bg-slate-50" title={t("Attach a photo or file")}>
            <Paperclip className="size-4" aria-hidden />
            <input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => e.target.files?.[0] && void send(text, e.target.files[0])} />
          </label>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={t("Write a message")} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-brand-amber p-2 text-brand-navy disabled:opacity-50" aria-label={t("Send")}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4 rtl:-scale-x-100" aria-hidden />}
          </button>
        </form>
      ) : (
        <p className="border-t border-slate-100 p-3 text-center text-xs text-slate-400">{t("This conversation is closed.")}</p>
      )}
    </section>
  );
}
