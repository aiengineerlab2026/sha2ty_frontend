/** Part names for people: in Arabic, without position, and hardware told apart (the request page, the report). */

const ARABIC = /[؀-ۿ]/;

/** Hardware and small fittings (handles, locks, keys, hinges, slides…): not listed among the main parts. */
export const FITTING = /\b(handles?|knobs?|pulls?|locks?|keys?|keyholes?|keyways?|rings?|blades?|tooth|teeth|escutcheons?|hinges?|screws?|bolts?|mounting|foot|feet|slides?|runners?|casters?|castors?)\b|(?:^|[\s\d_])(?:ال)?(?:مقبض|مقابض|قفل|أقفال|مفتاح|مفاتيح|مفصلة|مفصلات|برغي|حلقة|مجرى|مجاري)(?=$|[\s\d_])/i;
export const isFitting = (name: string) => FITTING.test(name.replace(/[_\-.]+/g, " "));

/** Bedding, not built by the vendor (mattresses, blankets, pillows): kept out of the report's close-ups and parts list
 * (backend app/services/request_report.py BEDDING matches the same words). */
export const SOFT = /\b(mattress(es)?|blankets?|duvets?|quilts?|comforters?|bedspreads?|throws?|pillows?|pillowcases?)\b|(?:^|[\s\d_])(?:ال)?(?:مرتبة|مراتب|فرشة|بطانية|بطانيات|لحاف|ألحفة|مخدة|مخدات|وسادة|وسائد|وسادات)(?=$|[\s\d_])/i;
export const isSoft = (name: string) => SOFT.test(name.replace(/[_\-.]+/g, " "));

/** A part's name without where it sits or its number ("Left wood grain door", "باب 3" → "Wood grain door", "باب"). */
const POSITION = /\b(left|right|top|bottom|upper|lower|middle|center|centre|central|leftmost|rightmost|inner|outer|first|second|third|last)\b|(?:^|\s)(?:ال)?(?:أيمن|أيسر|يمين|يسار|علوي|سفلي|أوسط|وسطى|أول|ثاني|ثالث|أخير|من)(?=$|\s)|\d+/gi;
export function mainName(name: string): string {
  const base = name.replace(/[_\-.]+/g, " ").replace(POSITION, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : name;
}

// Furniture words (English → Arabic); "" drops a word ("wood grain door": the grain is the wood's look).
const WORDS: Record<string, string> = {
  door: "باب", doors: "أبواب", drawer: "درج", drawers: "أدراج", shelf: "رف", shelves: "رفوف", side: "جانب", sides: "جوانب",
  panel: "لوح", panels: "ألواح", back: "خلفي", backing: "لوح خلفي", top: "علوي", bottom: "سفلي", cap: "غطاء", cover: "غطاء",
  cabinet: "خزانة", cupboard: "دولاب", wardrobe: "دولاب", closet: "دولاب", body: "هيكل", carcass: "هيكل", frame: "إطار", partition: "فاصل",
  divider: "فاصل", plinth: "قاعدة", base: "قاعدة", kick: "قاعدة", mirror: "مرآة", mirrored: "بمرآة", surround: "إطار", front: "واجهة",
  left: "أيسر", right: "أيمن", center: "أوسط", centre: "أوسط", central: "أوسط", middle: "أوسط", upper: "علوي", lower: "سفلي",
  internal: "داخلي", interior: "داخلي", inner: "داخلي", outer: "خارجي", vertical: "رأسي", horizontal: "أفقي", wood: "خشبي",
  wooden: "خشبي", grain: "", plain: "سادة", recessed: "غائر", tall: "طويل", inset: "مدمج", silver: "فضي", glass: "زجاج",
  rail: "قضيب", rod: "قضيب", hanging: "تعليق", leg: "رجل", legs: "أرجل", headboard: "لوح رأس", footboard: "لوح قدم",
  mattress: "مرتبة", seat: "مقعد", backrest: "ظهر", armrest: "مسند ذراع", arm: "ذراع", arms: "أذرع", cushion: "وسادة",
  pillow: "مخدة", table: "طاولة", tabletop: "سطح طاولة", desk: "مكتب", chair: "كرسي", sofa: "كنبة", bed: "سرير", lid: "غطاء",
  flap: "غطاء", roof: "سقف", crown: "تاج", cornice: "كورنيش", trim: "حلية", moulding: "حلية", molding: "حلية", decor: "زخرفة",
  decoration: "زخرفة", ornament: "زخرفة", handle: "مقبض", knob: "مقبض", pull: "مقبض", lock: "قفل", key: "مفتاح", hinge: "مفصلة",
  box: "صندوق", tray: "صينية", compartment: "قسم", niche: "تجويف", light: "إضاءة", lighting: "إضاءة", led: "إضاءة", strip: "شريط",
  part: "جزء", component: "مكون", main: "رئيسي", unit: "وحدة", storage: "تخزين", open: "مفتوح", small: "صغير", large: "كبير",
  upholstery: "تنجيد", upholstered: "منجد", fabric: "قماش", support: "دعامة", beam: "عارضة", slat: "شريحة", slats: "شرائح",
  apron: "إطار سفلي", stretcher: "عارضة", sliding: "منزلق", hinged: "مفصلي", single: "مفرد", double: "مزدوج", glazed: "زجاجي",
  edge: "حافة", corner: "ركن", counter: "سطح", worktop: "سطح عمل", sink: "حوض", oven: "فرن", tv: "تلفزيون", media: "وسائط",
  console: "كونسول", bookcase: "مكتبة", bookshelf: "مكتبة", nightstand: "كومود", dresser: "تسريحة", wall: "حائط", hood: "شفاط",
  "of": "", the: "", and: "و", with: "مع", for: "لـ",
};

/** A generated name with no furniture word ("Part 3", "جزء"). */
const GENERIC = /^(?:part|component|mesh|object|node|group|piece|primitive|geom|جزء|مكون|قطعة|عنصر)(?:[\s_\-]*\d+)?$/i;
const SHOP_NAME = {
  ar: { structure: "لوح الهيكل", doors: "باب", drawers: "درج", shelves: "رف", accessories: "إكسسوار" },
  en: { structure: "Carcass panel", doors: "Door", drawers: "Drawer", shelves: "Shelf", accessories: "Fitting" },
} as const;

/** The name a carpenter cuts by: the part's own name, keeping left/right and its number. A generic "Part 3" becomes
 * the piece it is ("باب 3"). */
export function shopName(p: { name: string; name_ar: string; main_name: string; main_name_ar: string; group: string }, lang: "ar" | "en"): string {
  const raw = (lang === "ar" ? p.name_ar : p.name).trim();
  const fallback = (lang === "ar" ? p.main_name_ar : p.main_name).trim();
  const generic = (s: string) => !s || GENERIC.test(s);
  if (!generic(raw)) return raw;
  if (!generic(fallback)) return fallback;
  const noun = SHOP_NAME[lang][p.group as keyof typeof SHOP_NAME.ar] ?? SHOP_NAME[lang].structure;
  const num = (raw || p.name).match(/\d+/);
  return num ? `${noun} ${num[0]}` : noun;
}

/** The part's name in Arabic: the vendor's own Arabic name when there is one; else its words translated, in Arabic order
 * (the noun first: "Left cabinet side" → "جانب خزانة أيسر"); numbers kept; an unknown word stays as written. */
export function arabicName(name: string, nameAr?: string | null): string {
  if (nameAr && ARABIC.test(nameAr)) return nameAr;
  if (ARABIC.test(name)) return name;
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").split(/\s+/).filter(Boolean);
  const numbers = words.filter((w) => /^\d+$/.test(w));
  const translated = words.filter((w) => !/^\d+$/.test(w)).map((w) => WORDS[w.toLowerCase()] ?? w).filter(Boolean);
  const out = [...translated.reverse(), ...numbers].join(" ").trim();
  return out || name;
}
