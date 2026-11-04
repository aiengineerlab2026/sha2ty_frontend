import assert from "node:assert/strict";
import { test } from "node:test";
import { quote } from "../materials";

test("solid oak legs: board area is half the surface, × thickness, + 15% waste, priced per m³", () => {
  const q = quote({ id: "o", kind: "wood", name: "Oak", unit: "m3", price: 40000, thickness_mm: 40 }, 1);
  assert.equal(q.quantity, 0.023); // 0.5 m² × 1.15 × 0.04 m = 0.023 m³
  assert.equal(q.total, 920);
});

test("MDF with walnut veneer: whole sheets for the board, the veneer over the whole surface", () => {
  const q = quote({ id: "m", kind: "wood", name: "MDF 18", unit: "sheet", price: 900, sheet: [1.22, 2.44], thickness_mm: 18, finish: { id: "v", name: "Walnut veneer", unit: "m2", price: 300 } }, 6);
  assert.equal(q.quantity, 2); // 3 m² × 1.15 = 3.45 m² → 2 sheets of 2.98 m²
  assert.equal(q.finish_quantity, 6.9);
  assert.equal(q.total, 2 * 900 + 6.9 * 300);
});

test("a fabric keeps its running-metre quote; a missing price is price on request", () => {
  assert.equal(quote({ id: "f", kind: "fabric", name: "Linen", unit: "m", price: 250 }, 2).total, 400);
  assert.equal(quote({ id: "w", kind: "wood", name: "Pine", unit: "m3", price: null }, 2).total, null);
});

test("paint: surface × 2 coats ÷ coverage, rounded up to 0.1 L, priced per litre", () => {
  const q = quote({ id: "p", kind: "paint", name: "Navy satin", unit: "l", price: 200, coverage_m2: 10 }, 3.2);
  assert.equal(q.quantity, 0.7); // 3.2 m² × 2 coats ÷ 10 m²/L = 0.64 → 0.7 L
  assert.equal(q.total, 140);
});
