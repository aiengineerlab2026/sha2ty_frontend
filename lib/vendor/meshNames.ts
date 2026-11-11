/** Furniture words in mesh names, nouns first as Arabic orders them: "Door_Right" → "باب أيمن", "Frame_Top" → "إطار علوي".
 * Any unknown word → null, and the name shows as it is.
 * ponytail: word by word, no grammar (no ال, no agreement); plain but meaningful. */
const NOUN_AR: Record<string, string> = {
  door: "باب", doors: "أبواب", drawer: "درج", drawers: "أدراج", handle: "مقبض", handles: "مقابض", knob: "مقبض", pull: "مقبض", shelf: "رف", shelves: "أرفف",
  frame: "إطار", body: "هيكل", carcass: "هيكل", cabinet: "خزانة", wardrobe: "دولاب", closet: "دولاب", side: "جانب", panel: "لوح", divider: "فاصل",
  partition: "فاصل", base: "قاعدة", plinth: "قاعدة", leg: "رجل", legs: "أرجل", foot: "قاعدة", rail: "قضيب", rod: "قضيب", hanging: "تعليق",
  compartment: "خانة", cubby: "خانة", top: "سطح", bottom: "قاع", back: "ظهر", front: "واجهة", mirror: "مرآة", hinge: "مفصلة", cushion: "وسادة",
  seat: "مقعد", armrest: "مسند", headboard: "لوح الرأس", mattress: "مرتبة", pillow: "مخدة", tabletop: "سطح الطاولة", leaf: "ضلفة", trim: "حلية",
};
const ADJ_AR: Record<string, string> = {
  left: "أيسر", right: "أيمن", center: "أوسط", centre: "أوسط", middle: "أوسط", upper: "علوي", lower: "سفلي", inner: "داخلي", interior: "داخلي",
  outer: "خارجي", top: "علوي", bottom: "سفلي", back: "خلفي", rear: "خلفي", front: "أمامي", main: "رئيسي", open: "مفتوح", sliding: "منزلق",
};

const CONTAINER = new Set(["wardrobe", "closet", "cabinet"]);

export function meshNameAr(name: string): string | null {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_\-.]+/).filter(Boolean);
  // "Wardrobe_Bottom" is the bottom panel: the container word only names the part when nothing else does.
  const parts = words.filter((w) => !CONTAINER.has(w));
  if (parts.some((w) => NOUN_AR[w] || ADJ_AR[w])) words.splice(0, words.length, ...parts);
  const nouns: string[] = [], adjs: string[] = [], nums: string[] = [];
  for (const w of words) {
    if (/^\d+$/.test(w)) nums.push(w);
    // The first furniture word is the noun; top/back/front after it describe it ("Frame_Top" → "إطار علوي").
    else if (NOUN_AR[w] && !(nouns.length && ADJ_AR[w])) nouns.push(NOUN_AR[w]);
    else if (ADJ_AR[w]) adjs.push(ADJ_AR[w]);
    else return null;
  }
  return nouns.length ? [...new Set([...nouns, ...adjs]), ...nums].join(" ") : null;
}
