import { z } from "zod";
import { isoDate } from "./common.validator.js";

export const ACCOUNT_KINDS = ["Cash", "Bank", "POS / Mobile money"];
export const INCOME_CATEGORIES = ["Patient payments", "HMO / NHIA claims", "Donations & grants", "Other income"];
export const EXPENSE_CATEGORIES = ["Salaries & wages", "Drugs & medical supplies", "Laboratory consumables", "Electricity & fuel", "Water", "Rent", "Equipment & maintenance", "Cleaning & sanitation", "Transport", "Insurance", "Taxes, pension & levies", "Bank charges", "Training", "Other expense"];

const money = (label) => z.number({ invalid_type_error: `${label} must be a number` }).finite().min(0, `${label} can't be negative`).max(1_000_000_000_000);
const positive = z.number({ invalid_type_error: "Enter the amount" }).finite().gt(0, "Enter an amount greater than zero").max(1_000_000_000_000);

const accountFields = {
  name: z.string().trim().min(2, "Enter a name").max(120),
  kind: z.enum(ACCOUNT_KINDS, { errorMap: () => ({ message: "Choose the kind of account" }) }),
  bankName: z.string().trim().max(120).default(""),
  accountNumber: z.string().trim().max(40).default(""),
  opening: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000).default(0),
  openingDate: isoDate,
  active: z.boolean(),
};
export const createMoneyAccountBody = z.object({ ...accountFields, active: accountFields.active.default(true) });
export const updateMoneyAccountBody = z.object({ name: accountFields.name, bankName: accountFields.bankName, accountNumber: accountFields.accountNumber, active: accountFields.active }).partial();

const txnCommon = {
  date: isoDate,
  description: z.string().trim().max(255).default(""),
  party: z.string().trim().max(160).default(""),
  reference: z.string().trim().max(80).default(""),
  amount: positive,
  accountId: z.string().trim().min(1, "Choose an account").max(20),
};
export const createTxnBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Income"), category: z.enum(INCOME_CATEGORIES, { errorMap: () => ({ message: "Choose a category" }) }), ...txnCommon }),
  z.object({ type: z.literal("Expense"), category: z.enum(EXPENSE_CATEGORIES, { errorMap: () => ({ message: "Choose a category" }) }), ...txnCommon }),
  z.object({ type: z.literal("Transfer"), toAccountId: z.string().trim().min(1, "Choose the account it goes to").max(20), ...txnCommon }),
]);
export const voidTxnBody = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(255) });

export const employeeBody = z.object({
  name: z.string().trim().min(2, "Enter the employee's name").max(120),
  title: z.string().trim().max(120).default(""),
  department: z.string().trim().max(120).default(""),
  bankName: z.string().trim().max(120).default(""),
  accountNumber: z.string().trim().max(40).default(""),
  basic: money("Basic pay"),
  housing: money("Housing").default(0),
  transport: money("Transport").default(0),
  otherAllowance: money("Other allowance").default(0),
  pensionPct: z.number().finite().min(0).max(100).default(8),
  paye: money("PAYE").default(0),
  otherDeduction: money("Other deduction").default(0),
  active: z.boolean().default(true),
});
export const updateEmployeeBody = employeeBody.partial();

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM");
export const preparePayrollBody = z.object({ month, bonuses: z.record(z.string(), money("Bonus")).default({}) });
export const payPayrollBody = z.object({ accountId: z.string().trim().min(1, "Choose the account the salaries are paid from").max(20), date: isoDate.optional() });
export const remitPayrollBody = z.object({ accountId: z.string().trim().min(1, "Choose the account the remittance is paid from").max(20), date: isoDate.optional() });
