import { SignupForm } from "@/components/vendor/AuthForms";
import { Suspense } from "react";
import { AuthShell } from "@/components/vendor/AuthShell";

export default function SignupPage() {
  return (
    <AuthShell wide title="Create your vendor account" subtitle="Set up your studio in a minute. Your company name and logo appear with everything you sell.">
      <Suspense fallback={null}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
