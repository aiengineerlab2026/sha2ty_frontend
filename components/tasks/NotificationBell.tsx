"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, MessageSquare } from "lucide-react";
import { onMessages, unreadMessages, vendorProfile, type Unread } from "@/lib/tasks";

/** In-app notifications: unread chat messages in the user's requests (a customer: from vendors, including their
 * questions before bidding; a vendor: from customers). Live over Realtime; each opens its conversation. */
export function NotificationBell({ me }: { me: string }) {
  const t = useT();
  const path = usePathname();
  const [items, setItems] = useState<Unread[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Unread | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => unreadMessages(me).then(setItems, () => undefined), [me]);
  useEffect(() => {
    void load();
  }, [load, path]); // reading a chat marks it read: re-count on navigation

  useEffect(
    () =>
      onMessages(null, (m) => {
        if (m.sender_id === me) return;
        void load();
        if (!path?.startsWith(`/tasks/${m.task_id}`)) {
          setToast({ ...m, task: null });
          setTimeout(() => setToast(null), 5000);
        }
      }),
    [me, load, path],
  );

  // Who wrote: a vendor's public name for customers; vendors hear from "the customer".
  useEffect(() => {
    const missing = [...new Set(items.filter((m) => m.task?.customer_id === me).map((m) => m.vendor_id))].filter((v) => !names[v]);
    if (!missing.length) return;
    void Promise.all(missing.map((v) => vendorProfile(v).then((p) => [v, p.vendor.name] as const, () => [v, ""] as const))).then((pairs) =>
      setNames((current) => ({ ...current, ...Object.fromEntries(pairs) })),
    );
  }, [items, me, names]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const from = (m: Unread) => (m.task?.customer_id === me ? names[m.vendor_id] || t("A vendor") : t("The customer"));
  const href = (m: Pick<Unread, "task_id" | "vendor_id">) => `/tasks/${m.task_id}?chat=${m.vendor_id}`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("Notifications")}
        aria-expanded={open}
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-navy"
      >
        <Bell className="size-4" aria-hidden />
        {items.length > 0 && (
          <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">{items.length > 9 ? "9+" : items.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 top-11 z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-brand-navy">{t("Notifications")}</p>
          {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">{t("You're all caught up.")}</p>}
          <ul className="max-h-96 overflow-y-auto">
            {items.map((m) => (
              <li key={m.id}>
                <Link href={href(m)} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-brand-amber" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-800">
                      {t("{who} wrote about “{title}”", { who: from(m), title: m.task?.title ?? t("a request") })}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{m.body || t("Attachment")}</span>
                    <span className="block text-[11px] text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {toast && (
        <Link href={href(toast)} onClick={() => setToast(null)} role="status" className="fixed bottom-4 end-4 z-50 flex max-w-sm gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
          <MessageSquare className="mt-0.5 size-5 shrink-0 text-brand-amber" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-brand-navy">{t("New message")}</span>
            <span className="block truncate text-sm text-slate-600">{toast.body || t("Attachment")}</span>
          </span>
        </Link>
      )}
    </div>
  );
}
