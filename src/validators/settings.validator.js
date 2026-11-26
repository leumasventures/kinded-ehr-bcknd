import { z } from "zod";

const hospital = z
  .object({
    name: z.string().max(160).optional(),
    address: z.string().max(255).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().max(190).optional(),
  })
  .strict()
  .optional();

const notify = z
  .object({
    appointments: z.boolean().optional(),
    lowStock: z.boolean().optional(),
    labResults: z.boolean().optional(),
    overdueInvoices: z.boolean().optional(),
  })
  .strict()
  .optional();

export const settingsBody = z
  .object({
    hospital,
    notify,
    lowStockThreshold: z.number().optional(),
    invoiceDueDays: z.number().optional(),
    vatPercent: z.number().optional(),
    invoiceFooter: z.string().max(500).optional(),
    sessionTimeoutMins: z.number().optional(),
    minPasswordLength: z.number().optional(),
  })
  .strict();
