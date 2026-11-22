import { z } from "zod";

export const STATUSES = ["Pending", "Dispensed", "Cancelled"];

const blank = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (max) => z.preprocess(blank, z.string().trim().max(max).optional());
const price = z.coerce.number({ message: "Enter a price." }).min(0, "The price can't be negative.").max(10_000_000).transform((v) => Math.round(v * 100) / 100);
const whole = (min, max, msg) => z.coerce.number({ message: msg }).int("Use a whole number.").min(min).max(max);

export const drugSchema = z.object({
  name: z.string().trim().min(1, "Enter the drug name.").max(120),
  strength: opt(40),
  form: opt(40),
  unitPrice: price,
  stockQty: z.preprocess(blank, whole(0, 1_000_000, "Enter the opening stock.").default(0)),
  reorderLevel: z.preprocess(blank, whole(0, 1_000_000, "Enter the reorder level.").default(10)),
});

// Stock quantity itself is never edited here: it only moves through the stock endpoint, so every change has a reason.
export const drugUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), strength: opt(40), form: opt(40), unitPrice: price.optional(), reorderLevel: whole(0, 1_000_000, "Enter the reorder level.").optional(), active: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });

export const stockSchema = z.object({
  delta: whole(-1_000_000, 1_000_000, "Enter how many to add (or take away, with a minus sign).").refine((n) => n !== 0, "The change can't be zero."),
  reason: z.string().trim().min(1, "Say why the stock changed (delivery, expired, damaged...).").max(255),
});

export const prescribeSchema = z.object({
  patientId: z.string().trim().min(1, "Choose a patient.").max(20),
  items: z
    .array(
      z.object({
        drugId: z.string().trim().min(1, "Choose a drug."),
        dose: z.string().trim().min(1, "Enter the dose.").max(80),
        frequency: z.string().trim().min(1, "Enter how often.").max(80),
        duration: opt(80),
        quantity: whole(1, 10000, "Enter the quantity to dispense."),
        instructions: opt(255),
      })
    )
    .min(1, "Add at least one drug.")
    .max(20, "A prescription can have at most 20 drugs."),
});

export const cancelSchema = z.object({ reason: z.string().trim().min(1, "Give the reason for cancelling.").max(255) });