/** Meshy generation progress as the backend reports it (app/api/vendor.py get_task). Pure: no imports, so the
 * node:test build can load it. */

export type GenerateStep = { id: "image" | "mesh"; status: string; progress: number };

/** The cleaned image's check as a task reports it (mirrors parts.ts CleaningCheck; no imports here). */
export type TaskCleaningCheck = { status?: "passed" | "failed" | "inconclusive"; issues?: string[]; notes?: string[]; decision?: string };

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
  /** phase "awaiting_approval": the unchecked cleaned image the user is asked to accept or reject. */
  reviewImageUrl?: string;
  cleaningCheck?: TaskCleaningCheck;
  /** The backend task, for the decision and retry actions. */
  taskId?: string;
};

/** The cleaned image could not be checked: the user chooses it or the original photo (POST /tasks/{id}/cleaning). */
export const AWAITING_APPROVAL = "awaiting_approval";

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
    reviewImageUrl: typeof task.review_image_url === "string" ? task.review_image_url : undefined,
    cleaningCheck: task.cleaning_check && typeof task.cleaning_check === "object" ? (task.cleaning_check as TaskCleaningCheck) : undefined,
    taskId: typeof task.task_id === "string" ? task.task_id : undefined,
  };
}

/** Each phase's state for the checklist. */
export function phaseStates(phase?: string): { id: string; label: string; state: "Done" | "In progress" | "Waiting" }[] {
  // Waiting for the user's decision is still the validation step.
  const current = MESHY_PHASES.findIndex((p) => p.id === (phase === AWAITING_APPROVAL ? "image_validation" : phase));
  const finished = phase === "completed";
  return MESHY_PHASES.map((p, i) => ({ id: p.id, label: p.label, state: finished || i < current ? "Done" : i === current ? "In progress" : "Waiting" }));
}

/** The phase's label while it runs; undefined for older backends (no phase) and the end states. */
function phaseLabel(phase?: string): string | undefined {
  if (phase === AWAITING_APPROVAL) return "Waiting for your decision on the cleaned image";
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
