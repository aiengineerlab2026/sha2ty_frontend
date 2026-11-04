import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppModelEditor } from "@/components/vendor/AppModelEditor";

type Params = Promise<{ table: string; id: string }>;

/** The mobile app's model editor (opened in its browser view): a vendor's model or a customer's private one. */
export default function AppEditPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: Params }) {
  const { table, id } = await params;
  if (table !== "models" && table !== "user_models") notFound();
  return <AppModelEditor table={table} id={id} />;
}
