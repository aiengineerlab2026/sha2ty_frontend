import { Suspense } from "react";
import { LoginForm, LoginIntro } from "@/components/vendor/AuthForms";
import { AuthShell } from "@/components/vendor/AuthShell";

export default function LoginPage() {
  return (
    <AuthShell
      title={
        <Suspense fallback="Welcome back">
          <LoginIntro part="title" />
        </Suspense>
      }
      subtitle={
        <Suspense fallback="Log in to manage your catalogue and floor plans.">
          <LoginIntro part="subtitle" />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
