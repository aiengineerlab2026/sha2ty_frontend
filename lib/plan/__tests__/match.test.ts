import { test } from "node:test";
import assert from "node:assert/strict";
import { matchForm, stepIndex, stepsFor, toCm } from "../../match/match";

test("carpets skip the position step; furniture and wall paint ask for it", () => {
  assert.ok(!stepsFor("carpet").includes("position"));
  assert.ok(stepsFor("furniture").includes("position"));
  assert.ok(stepsFor("wall_paint").includes("position"));
  assert.equal(stepsFor("carpet").at(-1), "variations");
  for (const type of ["carpet", "furniture", "wall_paint"] as const) assert.ok(!(stepsFor(type) as string[]).includes("calibrate"));
});

test("a picked cart / bought item skips size and photo; only furniture asks for the position", () => {
  assert.deepEqual(stepsFor("furniture", { modelSizeMissing: false }), ["type", "position", "variations"]);
  assert.deepEqual(stepsFor("carpet", { modelSizeMissing: false }), ["type", "variations"]);
  assert.deepEqual(stepsFor("wall_paint", { modelSizeMissing: true }), ["type", "dimensions", "variations"]);
});

test("dimensions convert to centimetres", () => {
  assert.equal(toCm(2.4, "m"), 240);
  assert.equal(toCm(180, "cm"), 180);
});

test("carousel stops at the first and last variation", () => {
  assert.equal(stepIndex(0, 5, -1), 0);
  assert.equal(stepIndex(0, 5, 1), 1);
  assert.equal(stepIndex(4, 5, 1), 4);
  assert.equal(stepIndex(0, 1, 1), 0);
});

test("the request form skips empty fields", () => {
  const form = matchForm({ modelId: "m1", matchType: "carpet", width: 240, height: 300, unit: "cm", variationsCount: 3, depth: 40 });
  assert.equal(form.get("width"), "240");
  assert.equal(form.get("depth"), "40");
  assert.equal(form.get("position"), null);
});

test("progress stream lines are split, keeping a half-received line for later", async () => {
  const { splitLines } = await import("../../match/match");
  const first = splitLines('{"progress": 5}\n{"progress": 2');
  assert.deepEqual(first.events, [{ progress: 5 }]);
  assert.equal(first.rest, '{"progress": 2');
  const second = splitLines(first.rest + '7}\n{"progress": 100, "success": true}\n');
  assert.deepEqual(second.events, [{ progress: 27 }, { progress: 100, success: true }]);
  assert.equal(second.rest, "");
});
