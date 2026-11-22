import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.");
const blank = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (schema) => z.preprocess(blank, schema.optional());
const today = () => new Date().toISOString().slice(0, 10);
const amount = (msg) => z.coerce.number({ message: msg }).positive("Enter an amount greater than zero.").max(100_000_000, "That amount is too high.");

// payer and payerType should be copied from the "claimable" list (they are checked against each patient's cover).
export const createSchema = z.object({
  payer: z.string().trim().min(1, "Choose the payer.").max(160),
  payerType: z.string().trim().min(1, "Choose the type of payer.").max(40),
  invoiceIds: z.array(z.string().trim().min(1).max(30)).min(1, "Choose at least one invoice.").max(100, "A claim can have at most 100 invoices."),
});

export const submitSchema = z.object({
  submittedOn: opt(day.refine((d) => d <= today(), "The submission date can't be in the future.")),
  reference: opt(z.string().trim().max(80)),
});

export const approveSchema = z.object({ approvedAmount: amount("Enter the approved amount.") });

export const rejectSchema = z.object({ reason: z.string().trim().min(1, "Give the reason the payer rejected it.").max(500) });

export const paySchema = z.object({
  amount: amount("Enter the amount received."),
  date: opt(day.refine((d) => d <= today(), "The payment date can't be in the future.")),
  reference: opt(z.string().trim().max(80)),
});