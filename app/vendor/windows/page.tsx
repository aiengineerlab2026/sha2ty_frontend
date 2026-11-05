import { redirect } from "next/navigation";
import { WindowLibrary } from "@/components/vendor/CutoutLibrary";
import { WINDOWS_ENABLED } from "@/lib/features";

export default function WindowsPage() {
  if (!WINDOWS_ENABLED) redirect("/vendor");
  return <WindowLibrary />;
}
