import { test } from "node:test";
import assert from "node:assert/strict";
import { on, publish } from "../../events";

test("events: subscribers of a type hear it until they unsubscribe", () => {
  const heard: number[] = [];
  const off = on("generation.started", ({ remaining }) => heard.push(remaining));
  on("generation.finished", () => heard.push(-1));
  publish("generation.started", { provider: "meshy", remaining: 29 });
  off();
  publish("generation.started", { provider: "meshy", remaining: 28 });
  assert.deepEqual(heard, [29]);
});
