/** Meshy generation progress as the backend reports it (app/api/vendor.py get_task). Pure: no imports, so the
 * node:test build can load it. */

export type GenerateStep = { id: "image" | "mesh"; status: string; progress: number };

/** The backend's Meshy task phases, in order. "preparing" is the upload, before a task exists. */
export const MESHY_PHASES = [
  { id: "preparing", label: "Preparing furniture image" },
  { id: "image_preprocessing", label: "Cleaning image with Meshy" },
  { id: "image_validation", label: "Validating cleaned image" },
  { id: "mesh_generation", label: "Generating 3D model" },
  { id: "auto_split", label: "Separating furniture components" },
  { id: "postprocessing", label: "Finalizing model" },
] as const;

export type GenerateProgress = {
  percent: number;
  status: string;
  steps?: GenerateStep[];
  /** Meshy only: the current MESHY_PHASES id ("completed" / "failed" at the end). */
  phase?: string;
  /** e.g. image cleaning failed or was rejected, so the original photo was meshed. */
  warnings?: string[];
  /** The Meshy-cleaned image actually meshed (absent when the original photo was used). */
  cleanImageUrl?: string;
};

/** One poll's answer as progress. The percentage never goes back and never claims 100 before the model exists. */
export function progressFrom(task: Record<string, unknown>, last: number): GenerateProgress {
  const reported = Number(task.progress);
  const percent = Number.isFinite(reported) ? Math.max(last, Math.min(99, reported)) : last;
  const steps = Array.isArray(task.steps) ? (task.steps as GenerateStep[]) : undefined;
  const phase = typeof task.phase === "string" ? task.phase : undefined;
  return {
    percent,
    status: phaseLabel(phase) ?? conversionLabel(String(task.status || ""), percent, steps),
    steps,
    phase,
    warnings: Array.isArray(task.warnings) ? task.warnings.filter((w): w is string => typeof w === "string") : undefined,
    cleanImageUrl: typeof task.clean_image_url === "string" ? task.clean_image_url : undefined,
  };
}

/** Each phase's state for the checklist. */
export function phaseStates(phase?: string): { id: string; label: string; state: "Done" | "In progress" | "Waiting" }[] {
  const current = MESHY_PHASES.findIndex((p) => p.id === phase);
  const finished = phase === "completed";
  return MESHY_PHASES.map((p, i) => ({ id: p.id, label: p.label, state: finished || i < current ? "Done" : i === current ? "In progress" : "Waiting" }));
}

/** The phase's label while it runs; undefined for older backends (no phase) and the end states. */
function phaseLabel(phase?: string): string | undefined {
  const found = MESHY_PHASES.find((p) => p.id === phase);
  return found ? `${found.label}…` : undefined;
}

/** Older backends (no phase), and Astra / Sol tasks. */
function conversionLabel(status: string, percent: number, steps?: GenerateStep[]): string {
  const active = steps?.find((step) => step.status === "IN_PROGRESS" || step.status === "PENDING");
  if (active?.id === "image") return "Cleaning the photo…";
  if (active?.id === "mesh" && steps?.some((step) => step.id === "image")) return "Building the 3D model…";
  if (status === "PENDING") return "Queued for conversion…";
  if (percent < 35) return "Analyzing the photo…";
  if (percent < 75) return "Building the 3D mesh…";
  if (percent < 100) return "Texturing the model…";
  return "Finishing conversion…";
}
