"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/shatably/Header";
import { designForUserModel } from "@/lib/designs/api";
import { useT } from "@/lib/i18n";

/** Finds (or makes) the design of the user's own model, then opens it in the design editor in place of this page. */
export function OpenUserModelDesign({ userModelId }: { userModelId: string }) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    designForUserModel(userModelId).then(
      (id) => live && router.replace(`/designs/${id}${window.location.search}`),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [userModelId, router]);
  return (
    <div className="min-h-full bg-slate-50">
      <Header />
      <p className={`mx-auto max-w-xl px-4 py-16 text-center text-sm ${error ? "text-red-700" : "text-slate-500"}`}>{error ?? t("Opening your model…")}</p>
    </div>
  );
}
