import { z } from "zod";
import { isoDate } from "./common.validator.js";

export const bookBody = z
  .object({
    name: z.string().min(1).max(120),
    kind: z.string().max(40).optional(),
    opening: z.number().optional(),
  })
  .strict();

export const txnBody = z
  .object({
    bookId: z.string().min(1).max(40),
    date: isoDate,
    type: z.enum(["Income", "Expense", "Transfer", "Payroll"]),
    category: z.string().max(80).optional(),
    amount: z.number().positive(),
    memo: z.string().max(255).optional(),
    reference: z.string().max(80).optional(),
  })
  .strict();
