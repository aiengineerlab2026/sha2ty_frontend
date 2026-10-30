"use client";

export function PlacementWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-1.5">
      {warnings.map((warning) => (
        <li key={warning} className="flex gap-2 leading-relaxed text-slate-700">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}
