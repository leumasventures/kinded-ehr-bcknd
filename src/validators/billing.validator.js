import { z } from "zod";
import { isoDate } from "./common.validator.js";

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "POS", "Cheque", "HMO / Insurance"];
const amount = z.number({ invalid_type_error: "Enter the amount" }).finite().gt(0, "Enter an amount greater than zero").max(1_000_000_000_000);

export const createInvoiceBody = z.object({
  patientId: z.string().trim().min(1, "Choose a registered patient").max(20),
  date: isoDate.optional(),
  dueDate: isoDate.optional(),
  items: z
    .array(z.object({ description: z.string().trim().min(1, "Every line needs a description").max(255), qty: z.number().finite().gt(0, "Quantity must be more than zero").max(1_000_000), unitPrice: z.number().finite().min(0, "Price can't be negative").max(1_000_000_000) }))
    .min(1, "Add at least one line")
    .max(100),
  discount: z.number().finite().min(0).max(1_000_000_000_000).default(0),
  vatRate: z.number().finite().min(0).max(100).default(0),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});
export const paymentBody = z.object({ amount, method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Choose how the money was received" }) }), date: isoDate.optional(), reference: z.string().trim().max(80).optional().or(z.literal("")) });

export const createClaimBody = z.object({ payer: z.string().trim().min(1, "Choose the payer").max(160), payerType: z.string().trim().min(1).max(40), invoiceIds: z.array(z.string().trim().min(1).max(20)).min(1, "Choose at least one invoice").max(200) });
export const submitClaimBody = z.object({ submittedOn: isoDate.optional(), reference: z.string().trim().max(80).optional().or(z.literal("")) });
export const approveClaimBody = z.object({ approvedAmount: amount });
export const rejectClaimBody = z.object({ reason: z.string().trim().min(3, "Give the reason the payer rejected it").max(500) });
export const claimPaymentBody = z.object({ amount, date: isoDate.optional(), reference: z.string().trim().max(80).optional().or(z.literal("")) });
