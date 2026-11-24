import assert from "node:assert/strict";
import { test } from "node:test";
import { MESHY_PHASES, phaseStates, progressFrom } from "../meshyPhases";

test("Meshy phases follow the backend's state machine, in order", () => {
  assert.deepEqual(MESHY_PHASES.map((p) => p.id), ["preparing", "image_preprocessing", "image_validation", "mesh_generation", "auto_split", "postprocessing"]);
});

test("a Meshy poll shows its phase, its warnings and the cleaned image", () => {
  const p = progressFrom({ status: "IN_PROGRESS", progress: 20, phase: "mesh_generation", warnings: ["Image cleaning failed (x). The original photo was used."], clean_image_url: "https://cdn/x.clean.png" }, 8);
  assert.equal(p.status, "Generating 3D model…");
  assert.equal(p.percent, 20);
  assert.deepEqual(p.warnings, ["Image cleaning failed (x). The original photo was used."]);
  assert.equal(p.cleanImageUrl, "https://cdn/x.clean.png");
});

test("progress never goes back and never shows 100 before the model exists", () => {
  assert.equal(progressFrom({ status: "IN_PROGRESS", progress: 5, phase: "auto_split" }, 90).percent, 90);
  assert.equal(progressFrom({ status: "IN_PROGRESS", progress: 100, phase: "postprocessing" }, 96).percent, 99);
});

test("an older backend (no phase) keeps its labels", () => {
  const p = progressFrom({ status: "IN_PROGRESS", progress: 50, steps: [{ id: "image", status: "SUCCEEDED", progress: 100 }, { id: "mesh", status: "IN_PROGRESS", progress: 40 }] }, 8);
  assert.equal(p.phase, undefined);
  assert.equal(p.status, "Building the 3D model…");
});

test("the checklist marks earlier phases done and the current one in progress", () => {
  const states = phaseStates("image_validation").map((p) => p.state);
  assert.deepEqual(states, ["Done", "Done", "In progress", "Waiting", "Waiting", "Waiting"]);
  assert.ok(phaseStates("completed").every((p) => p.state === "Done"));
});

test("an unchecked cleaned image waits for the user at the validation step, with its preview and check", () => {
  const p = progressFrom({ task_id: "t1", status: "IN_PROGRESS", progress: 20, phase: "awaiting_approval", review_image_url: "https://cdn/x.clean.png", cleaning_check: { status: "inconclusive", issues: [], notes: ["not compared"] } }, 8);
  assert.equal(p.status, "Waiting for your decision on the cleaned image");
  assert.equal(p.reviewImageUrl, "https://cdn/x.clean.png");
  assert.equal(p.cleaningCheck?.status, "inconclusive");
  assert.equal(p.cleanImageUrl, undefined); // not "used for 3D" until the user says so
  assert.equal(p.taskId, "t1");
  assert.deepEqual(phaseStates("awaiting_approval").map((s) => s.state), ["Done", "Done", "In progress", "Waiting", "Waiting", "Waiting"]);
});
