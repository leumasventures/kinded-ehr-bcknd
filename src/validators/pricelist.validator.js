import { z } from "zod";

// Keep these in step with CATEGORIES and CATEGORY_PREFIX in the web app (src/types/pricing.ts).
export const CATEGORIES = ["Consultation", "Laboratory", "Imaging & Diagnostics", "Pharmacy", "Nursing Care", "Procedures", "Admission & Ward", "Maternity", "Surgery"];
export const CATEGORY_PREFIX = { Consultation: "CON", Laboratory: "LAB", "Imaging & Diagnostics": "IMG", Pharmacy: "PHM", "Nursing Care": "NUR", Procedures: "PRO", "Admission & Ward": "ADM", Maternity: "MAT", Surgery: "SUR" };

const blank = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const price = z.coerce.number({ message: "Enter a price." }).min(0, "The price can't be negative.").max(10_000_000, "That price is too high.").transform((v) => Math.round(v * 100) / 100);
const name = z.string().trim().min(1, "Enter a name.").max(160);
const category = z.enum(CATEGORIES, { message: "Choose a category." });
const unit = z.string().trim().min(1, "Enter the unit.").max(40);

// The server makes the code (CON-001, LAB-014...) so two people adding items at once can't clash.
// A code is only accepted when importing items that already have one.
export const createSchema = z.object({
  code: z.preprocess(blank, z.string().trim().regex(/^[A-Za-z0-9._-]{1,30}$/, "The code can use letters, digits, dot, dash and underscore (up to 30).").optional()),
  name,
  category,
  unit: z.preprocess(blank, unit.default("each")),
  price,
});

export const updateSchema = z
  .object({ name: name.optional(), category: category.optional(), unit: unit.optional(), price: price.optional(), active: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });