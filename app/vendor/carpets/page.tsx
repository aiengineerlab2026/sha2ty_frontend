import { redirect } from "next/navigation";
import { CarpetLibrary } from "@/components/vendor/CarpetLibrary";
import { CARPETS_ENABLED } from "@/lib/features";

export default function CarpetsPage() {
  if (!CARPETS_ENABLED) redirect("/vendor");
  return <CarpetLibrary />;
}
