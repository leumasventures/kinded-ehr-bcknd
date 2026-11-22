import { z } from "zod";
import { PAYMENT_METHODS } from "../services/billing.service.js";

// Statuses are worked out from the money (see statusOf in billing.service.js), not stored.
export const STATUSES = ["Unpaid", "Partial", "Paid", "Overdue"];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.");
const blank = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (schema) => z.preprocess(blank, schema.optional());
const today = () => new Date().toISOString().slice(0, 10);

const line = z.object({
  description: z.string().trim().min(1, "Every line needs a description.").max(255),
  qty: z.coerce.number({ message: "Enter a quantity." }).positive("The quantity must be more than zero.").max(100000),
  unitPrice: z.coerce.number({ message: "Enter a price." }).min(0, "The price can't be negative.").max(10_000_000),
});

export const createSchema = z.object({
  patientId: z.string().trim().min(1, "Choose a patient.").max(20),
  date: opt(day),
  dueDate: opt(day),
  items: z.array(line).min(1, "Add at least one line.").max(100, "An invoice can have at most 100 lines."),
  discount: z.preprocess(blank, z.coerce.number().min(0).max(100_000_000).default(0)),
  vatRate: z.preprocess(blank, z.coerce.number().min(0).max(100).default(0)),
  notes: opt(z.string().trim().max(500)),
});

// claimId is deliberately not accepted here: only the claims flow may tag a payment to a claim.
export const paySchema = z.object({
  amount: z.coerce.number({ message: "Enter the amount." }).positive("Enter an amount greater than zero.").max(100_000_000),
  method: z.enum(PAYMENT_METHODS, { message: "Choose how the money was received." }),
  date: opt(day.refine((d) => d <= today(), "The payment date can't be in the future.")),
  reference: opt(z.string().trim().max(80)),
});