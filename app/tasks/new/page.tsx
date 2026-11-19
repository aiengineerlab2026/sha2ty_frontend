import { Suspense } from "react";
import { CustomRequestForm } from "@/components/tasks/CustomRequest";

export default function NewRequestPage() {
  return (
    <Suspense fallback={null}>
      <CustomRequestForm />
    </Suspense>
  );
}
