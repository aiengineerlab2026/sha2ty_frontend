import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricQuote } from "../fabric";

test("a 2 m² cushion takes 2 × 1.1 ÷ 1.4 m of fabric, rounded up to 10 cm, priced per metre", () => {
  const quote = fabricQuote(2, 250);
  assert.equal(quote.metres, 1.6); // 1.571… → 1.6
  assert.equal(quote.total, 400);
});

test("an exact length is not rounded up, and no price means price on request", () => {
  assert.equal(fabricQuote(1.4 / 1.1, null).metres, 1);
  assert.equal(fabricQuote(1, null).total, null);
});
