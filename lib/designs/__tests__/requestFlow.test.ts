import assert from "node:assert/strict";
import { test } from "node:test";
import { fitScale, STRETCH_TOLERANCE } from "../../plan/modelNormalization";
import { bidTotals, planCost } from "../../plan/pricing";
import { furnitureType, shopperReady } from "../../plan/categories";
import { cm, sizeCm } from "../resize";
import type { PlacedItem, PlanGeometry } from "../../plan/types";
import { inServiceArea } from "../../serviceArea";

const close = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} ≠ ${b}`));

test("the model is shown at exactly the size on screen when its shape is close (the dining chair: 53 × 78 × 60 → 52 × 86 × 56)", () => {
  const mesh = { width: 0.53, height: 0.78, depth: 0.6 };
  const target = { width: 0.52, height: 0.86, depth: 0.56 };
  const f = fitScale(target, mesh);
  close([mesh.width * f[0], mesh.height * f[1], mesh.depth * f[2]], [0.52, 0.86, 0.56]);
});

test("a very different shape keeps one factor (no visible stretching) unless the customer sized each side", () => {
  const cube = { width: 1, height: 1, depth: 1 };
  const sofa = { width: 3, height: 1, depth: 1.5 };
  assert.ok(3 > 1 + STRETCH_TOLERANCE);
  const uniform = fitScale(sofa, cube);
  assert.ok(uniform[0] === uniform[1] && uniform[1] === uniform[2]);
  close(fitScale(sofa, cube, true), [3, 1, 1.5]); // "Lock proportions" off: each side as typed
  close(fitScale(null, cube), [1, 1, 1]);
});

test("sizes read the same everywhere: centimetres, a board's 1.8 kept", () => {
  assert.equal(sizeCm({ width: 0.52, height: 0.86, depth: 0.592 }), "52 × 86 × 59.2");
  assert.equal(cm(0.018), "1.8");
  assert.equal(cm(null), "—");
});

test("a bid quoted per piece and one quoted as a total compare on the same total", () => {
  assert.deepEqual(bidTotals({ price: 2750, price_basis: "per_item", quantity: 6 }, 6), { quantity: 6, total: 16500, each: 2750 });
  assert.deepEqual(bidTotals({ price: 13200, price_basis: "total", quantity: 6 }, 6), { quantity: 6, total: 13200, each: 2200 });
  // Older bids (no basis, no quantity): a total for what the customer asked.
  assert.deepEqual(bidTotals({ price: 9000 }, 3), { quantity: 3, total: 9000, each: 3000 });
});

test("shoppers see ready listings only, filtered by furniture type in English or Arabic", () => {
  const listing = (title: string, size: [number, number, number] = [0.52, 0.86, 0.56], thumbnail: string | null = "x.png") => ({ title, thumbnail, width_m: size[0], height_m: size[1], depth_m: size[2] });
  assert.ok(shopperReady(listing("كرسي طعام رمال الجوز")));
  assert.ok(!shopperReady({ ...listing("Oslo sofa"), listed: false })); // hidden by its vendor
  assert.ok(!shopperReady(listing("BedRoom", [0.2, 0.1, 0.3]))); // a bed 30 cm long: not a real size
  assert.ok(!shopperReady(listing("Sofa", undefined, null)));
  assert.equal(furnitureType("كرسي طعام رمال الجوز"), "chairs");
  assert.equal(furnitureType("Dining chair"), "chairs");
  assert.equal(furnitureType("خزانة ملابس بمرآة"), "storage");
  assert.equal(furnitureType("Lamp"), null);
  assert.equal(furnitureType({ title: "Oslo", furniture_type: "sofas" }), "sofas"); // the vendor's choice first
});

test("a customised design placed in a plan never goes to the cart: it is made to order", () => {
  const geometry = { rooms: [], zones: [], walls: [] } as unknown as PlanGeometry;
  const item = (extra: Partial<PlacedItem>) => ({ modelId: "chair", title: "Chair", price: 1000, price_unit: "item", width_m: 0.5, depth_m: 0.5, ...extra }) as unknown as PlacedItem;
  assert.equal(planCost(geometry, [item({}), item({ designId: "d1" })]).lines.find((l) => l.key === "model:chair")?.quantity, 1);
  assert.equal(planCost(geometry, [item({ designId: "d1" })]).lines.length, 0);
});

test("a request is in a vendor's service area when its delivery area names one of them", () => {
  assert.equal(inServiceArea("مدينة نصر، القاهرة", ["القاهرة", "دمياط"]), true);
  assert.equal(inServiceArea("Nasr City, Cairo", ["cairo"]), true);
  assert.equal(inServiceArea("الإسكندرية", ["القاهرة"]), false);
  assert.equal(inServiceArea("القاهرة", ["", " "]), false);
  assert.equal(inServiceArea("القاهرة", undefined), false);
});
