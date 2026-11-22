import { z } from "zod";

const price = z.coerce.number({ message: "Enter a price." }).min(0, "The price can't be negative.").max(10_000_000, "That price is too high.").transform((v) => Math.round(v * 100) / 100);
const name = z.string().trim().min(1, "Enter a name.").max(160);
const category = z.string().trim().min(1, "Enter a category.").max(60);

export const createSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,30}$/, "The code can use letters, digits, dot, dash and underscore (up to 30)."),
  name,
  category,
  price,
});

// The code never changes: invoices and reports refer to it.
export const updateSchema = z
  .object({ name: name.optional(), category: category.optional(), price: price.optional(), active: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });