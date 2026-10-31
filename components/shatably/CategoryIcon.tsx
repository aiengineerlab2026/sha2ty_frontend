import { AirVent, DoorClosed, DoorOpen, Frame, Lamp, LampCeiling, Sofa, Tv, Utensils } from "lucide-react";
import { categoryOf } from "@/lib/plan/categories";

const ICONS = { furniture: Sofa, table: Utensils, wardrobe: DoorClosed, door: DoorOpen, wall_art: Frame, tv: Tv, lighting: Lamp, ceiling_light: LampCeiling, air_conditioner: AirVent } as const;

export function CategoryIcon({ category, className = "size-4" }: { category: string | null | undefined; className?: string }) {
  const Icon = ICONS[categoryOf(category)];
  return <Icon className={className} aria-hidden />;
}
