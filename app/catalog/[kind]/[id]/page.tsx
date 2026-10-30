import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CatalogDetail, type CatalogKind } from "@/components/home/CatalogDetail";

const KINDS: CatalogKind[] = ["models", "paints", "carpets", "windows"];

export default async function CatalogItemPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!KINDS.includes(kind as CatalogKind)) notFound();
  // Suspense: the page reads the URL on the client (header nav state) under cacheComponents.
  return (
    <Suspense fallback={null}>
      <CatalogDetail kind={kind as CatalogKind} id={id} />
    </Suspense>
  );
}
