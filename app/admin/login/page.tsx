import { AdminLoginForm } from "@/components/admin/AdminConsole";
import { AuthShell } from "@/components/vendor/AuthShell";

export default function AdminLoginPage() {
  return (
    <AuthShell title="Admin sign in" subtitle="Review and approve new vendor studios.">
      <AdminLoginForm />
    </AuthShell>
  );
}
