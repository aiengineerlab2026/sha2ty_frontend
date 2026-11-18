import assert from "node:assert/strict";
import { test } from "node:test";
import { shopName } from "../partNames";
import { meshNameAr } from "../../vendor/meshNames";

test("mesh names from generated files read as Arabic furniture parts, never as generic parts", () => {
  assert.equal(meshNameAr("Door_Right"), "باب أيمن");
  assert.equal(meshNameAr("Frame_Top"), "إطار علوي");
  assert.equal(meshNameAr("Frame_Left_Side"), "إطار جانب أيسر");
  assert.equal(meshNameAr("Right_Shelf_2"), "رف أيمن 2");
  assert.equal(meshNameAr("wardrobeBody"), "هيكل");
  assert.equal(meshNameAr("Wardrobe"), "دولاب");
  assert.equal(meshNameAr("Wardrobe_Bottom"), "قاع");
  assert.equal(meshNameAr("Wardrobe_Top_Interior"), "سطح داخلي");
  assert.equal(meshNameAr("Base_Plinth"), "قاعدة");
  assert.equal(meshNameAr("Zorbulator_3"), null); // unknown: shown as it is
  assert.equal(meshNameAr("Left"), null); // no part word
});

test("the report names a part the way a carpenter asks for it", () => {
  const part = { name: "Left door", name_ar: "باب أيسر", main_name: "Door", main_name_ar: "باب", group: "doors" };
  assert.equal(shopName(part, "ar"), "باب أيسر");
  assert.equal(shopName(part, "en"), "Left door");
  assert.equal(shopName({ name: "Part 3", name_ar: "جزء 3", main_name: "Part", main_name_ar: "جزء", group: "doors" }, "ar"), "باب 3");
  assert.equal(shopName({ name: "Part 3", name_ar: "", main_name: "Part", main_name_ar: "", group: "doors" }, "ar"), "باب 3");
  assert.equal(shopName({ name: "Part 3", name_ar: "جزء 3", main_name: "Part", main_name_ar: "جزء", group: "shelves" }, "en"), "Shelf 3");
});
