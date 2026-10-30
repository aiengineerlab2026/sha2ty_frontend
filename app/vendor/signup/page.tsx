import { SignupForm } from "@/components/vendor/AuthForms";
import { Suspense } from "react";
import { AuthShell } from "@/components/vendor/AuthShell";

export default function SignupPage() {
  return (
    <AuthShell wide title="Create your account" subtitle="Shop and plan your home, or open a studio and sell your products.">
      <Suspense fallback={null}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
