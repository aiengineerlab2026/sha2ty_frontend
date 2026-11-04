import { Suspense } from "react";
import { OpenUserModelDesign } from "@/components/designs/OpenUserModelDesign";

type Params = Promise<{ id: string }>;

/** /designs/mine/<user model id>: the customer's own model opened in the design editor (its design, made once). */
export default function MyModelDesignPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Open params={params} />
    </Suspense>
  );
}

async function Open({ params }: { params: Params }) {
  const { id } = await params;
  return <OpenUserModelDesign userModelId={id} />;
}
