import { Suspense } from "react";
import { DesignEditor } from "@/components/designs/DesignEditor";

type Params = Promise<{ id: string }>;
type Search = Promise<{ model?: string }>;

// cacheComponents: `params` is runtime data, so it is read inside the Suspense boundary.
// /designs/new?model=<catalogue id>: customising a listing that is not saved yet (the first Save names it).
export default function DesignPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={null}>
      <Design params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Design({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, { model }] = await Promise.all([params, searchParams]);
  return <DesignEditor key={id} id={id} model={model} />;
}
