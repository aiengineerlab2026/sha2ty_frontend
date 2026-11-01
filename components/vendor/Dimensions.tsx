"use client";

import { useT } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Dimensions({
  width,
  height,
  depth,
  onWidth,
  onHeight,
  onDepth,
  labels = ["Width m", "Height m", "Depth m"],
  required = true,
}: {
  width: string;
  height: string;
  depth: string;
  onWidth: (value: string) => void;
  onHeight: (value: string) => void;
  onDepth: (value: string) => void;
  /** Field labels; L-shaped units call width "Length on wall A" and depth "Arm depth". */
  labels?: [string, string, string];
  /** false when generating from a photo: an empty size is estimated from the photo by the vision model. */
  required?: boolean;
}) {
  // The model is shown at exactly this size in plans (modelNormalization).
  return (
    <div className="grid grid-cols-3 gap-3">
      <Dim label={labels[0]} value={width} onChange={onWidth} required={required} />
      <Dim label={labels[1]} value={height} onChange={onHeight} required={required} />
      <Dim label={labels[2]} value={depth} onChange={onDepth} required={required} />
    </div>
  );
}

function Dim({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required: boolean }) {
  const t = useT();
  const id = label;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(label)}</Label>
      <Input id={id} type="number" min="0.01" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </div>
  );
}

export function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function metersToInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return String(value);
}
