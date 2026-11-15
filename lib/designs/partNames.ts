/** Part names for people: in Arabic, without position, and hardware told apart (the request page, the report). */

const ARABIC = /[؀-ۿ]/;

/** Hardware and small fittings (handles, locks, keys, hinges, slides…): not listed among the main parts. */
export const FITTING = /\b(handles?|knobs?|pulls?|locks?|keys?|keyholes?|keyways?|rings?|blades?|tooth|teeth|escutcheons?|hinges?|screws?|bolts?|mounting|foot|feet|slides?|runners?|casters?|castors?)\b|(?:^|[\s\d_])(?:ال)?(?:مقبض|مقابض|قفل|أقفال|مفتاح|مفاتيح|مفصلة|مفصلات|برغي|حلقة|مجرى|مجاري)(?=$|[\s\d_])/i;
export const isFitting = (name: string) => FITTING.test(name.replace(/[_\-.]+/g, " "));

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
