import { Suspense } from "react";
import { VendorPublicProfile } from "@/components/tasks/VendorPublicProfile";

type Params = Promise<{ id: string }>;

export default function VendorPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Vendor params={params} />
    </Suspense>
  );
}

async function Vendor({ params }: { params: Params }) {
  const { id } = await params;
  return <VendorPublicProfile id={id} />;
}
