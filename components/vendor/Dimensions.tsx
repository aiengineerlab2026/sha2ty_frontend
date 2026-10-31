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
}: {
  width: string;
  height: string;
  depth: string;
  onWidth: (value: string) => void;
  onHeight: (value: string) => void;
  onDepth: (value: string) => void;
  /** Field labels; L-shaped units call width "Length on wall A" and depth "Arm depth". */
  labels?: [string, string, string];
}) {
  // All three are required: the model is shown at exactly this size in plans (modelNormalization).
  return (
    <div className="grid grid-cols-3 gap-3">
      <Dim label={labels[0]} value={width} onChange={onWidth} />
      <Dim label={labels[1]} value={height} onChange={onHeight} />
      <Dim label={labels[2]} value={depth} onChange={onDepth} />
    </div>
  );
}

function Dim({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const t = useT();
  const id = label;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(label)}</Label>
      <Input id={id} type="number" min="0.01" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} required />
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
