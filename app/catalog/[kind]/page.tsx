import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HomePage } from "@/components/home/HomePage";
import type { CatalogKind } from "@/components/home/CatalogDetail";

const KINDS: CatalogKind[] = ["models", "paints", "carpets", "windows"];

type Params = Promise<{ kind: string }>;

/** Public list of every catalogue item of one kind (header links for guests and customers). */
export default function CatalogListPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <List params={params} />
    </Suspense>
  );
}

async function List({ params }: { params: Params }) {
  const { kind } = await params;
  if (!KINDS.includes(kind as CatalogKind)) notFound();
  return <HomePage only={kind as CatalogKind} />;
}
