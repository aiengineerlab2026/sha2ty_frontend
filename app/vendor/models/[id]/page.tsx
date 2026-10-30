import { ModelDetail } from "@/components/vendor/ModelDetail";

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModelDetail id={id} />;
}
