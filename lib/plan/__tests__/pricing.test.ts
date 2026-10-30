import assert from "node:assert/strict";
import { test } from "node:test";
import { planCost } from "../pricing";
import type { PlacedItem, PlanGeometry } from "../types";

test("paints by covered area, models and carpets by the piece", () => {
  const geometry = {
    rooms: [],
    zones: [{ id: "z", kind: "living", polygon: [[0, 0], [4, 0], [4, 5], [0, 5]] }],
    walls: [
      { id: "w1", start: [0, 0], end: [4, 0], height: 2.5, thickness: 0.2, length: 4 },
      { id: "w2", start: [4, 0], end: [4, 5], height: 2.5, thickness: 0.2, length: 5 },
    ],
    wall_paints: {
      "w1:L": { paint_id: "p", name: "Sand", color: "#eeeeee", texture_url: null, tile_m: 1, price: 10, price_unit: "m2" },
      "w2:L": { paint_id: "p", name: "Sand", color: "#eeeeee", texture_url: null, tile_m: 1, price: 10, price_unit: "m2" },
    },
    floor_paints: { z: { paint_id: "f", name: "Oak", color: "#aa8855", texture_url: "x", tile_m: 1, price: 30, price_unit: "m2" } },
    rugs: [{ id: "r", carpetId: "c", name: "Rug", image_url: "x", width: 2, length: 3, x: 1, z: 1, rotation: 0, price: 500, price_unit: "item" }],
  } as unknown as PlanGeometry;
  const sofa = { modelId: "m", title: "Sofa", width_m: 2, depth_m: 1, price: 1000, price_unit: "item" } as PlacedItem;
  const { lines, total } = planCost(geometry, [sofa, { ...sofa, instanceId: "b" } as PlacedItem]);
  const by = Object.fromEntries(lines.map((l) => [l.key, l]));
  assert.equal(by["wall:p"].quantity, (4 + 5) * 2.5); // 22.5 m² of wall
  assert.equal(by["wall:p"].total, 225);
  assert.equal(by["floor:f"].total, 600); // 20 m² × 30
  assert.equal(by["model:m"].quantity, 2);
  assert.equal(by["carpet:c"].total, 500);
  assert.equal(total, 225 + 600 + 2000 + 500);
});

test("finish usage: rooms using a floor finish, their area and tile count", async () => {
  const { finishUsage, tilesFor } = await import("../pricing");
  const geometry = {
    rooms: [],
    zones: [
      { id: "a", name: "Living", polygon: [[0, 0], [4, 0], [4, 5], [0, 5]] },
      { id: "b", name: "Hall", polygon: [[4, 0], [5, 0], [5, 2], [4, 2]] },
    ],
    walls: [],
    floor_paints: {
      a: { paint_id: "oak", name: "Oak", color: "#a85", texture_url: "x", tile_m: 0.6 },
      b: { paint_id: "tile", name: "Tile", color: "#ccc", texture_url: "y", tile_m: 0.3 },
    },
  } as unknown as PlanGeometry;
  const u = finishUsage(geometry, "oak");
  assert.deepEqual(u.floors.map((f) => [f.name, f.area]), [["Living", 20]]);
  assert.equal(tilesFor(u.area, 0.6, 0.6), 56); // 20 / 0.36 = 55.6 → 56 tiles
  assert.equal(tilesFor(0, 0.6, 0.6), 0);
});
