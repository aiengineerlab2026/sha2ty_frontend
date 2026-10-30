import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/vendor/AuthForms";
import { AuthShell } from "@/components/vendor/AuthShell";

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="Enter your account email and we'll send you a link to choose a new password.">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
