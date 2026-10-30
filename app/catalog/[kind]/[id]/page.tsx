import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CatalogDetail, type CatalogKind } from "@/components/home/CatalogDetail";

const KINDS: CatalogKind[] = ["models", "paints", "carpets", "windows"];

type Params = Promise<{ kind: string; id: string }>;

// cacheComponents: `params` is runtime data, so it is read inside the Suspense boundary.
export default function CatalogItemPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Item params={params} />
    </Suspense>
  );
}

async function Item({ params }: { params: Params }) {
  const { kind, id } = await params;
  if (!KINDS.includes(kind as CatalogKind)) notFound();
  return <CatalogDetail kind={kind as CatalogKind} id={id} />;
}
