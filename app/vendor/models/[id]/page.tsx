import { Suspense } from "react";
import { ModelDetail } from "@/components/vendor/ModelDetail";

type Params = Promise<{ id: string }>;

// cacheComponents: `params` is runtime data, so it is read inside the Suspense boundary.
export default function ModelPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Model params={params} />
    </Suspense>
  );
}

async function Model({ params }: { params: Params }) {
  const { id } = await params;
  return <ModelDetail id={id} />;
}
