import { Suspense } from "react";
import { TaskDetail } from "@/components/tasks/TaskDetail";

type Params = Promise<{ id: string }>;

// cacheComponents: `params` is runtime data, so it is read inside the Suspense boundary.
export default function TaskPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <Task params={params} />
    </Suspense>
  );
}

async function Task({ params }: { params: Params }) {
  const { id } = await params;
  return <TaskDetail id={id} />;
}
