import { Suspense } from "react";
import { ProposalEditor } from "@/components/tasks/ProposalEditor";

type Params = Promise<{ id: string }>;

export default function ProposePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Propose params={params} />
    </Suspense>
  );
}

async function Propose({ params }: { params: Params }) {
  const { id } = await params;
  return <ProposalEditor taskId={id} />;
}
