import { wrap } from "../utils/errors.js";
import { finance, operations } from "../services/dashboard.service.js";

// Two endpoints so the money figures can sit behind a finance-only guard while the operations view is open to clinical staff.
// Both only read counts and totals, never patient records, so there is nothing to audit.
const todayISO = () => new Date().toISOString().slice(0, 10);

// Appointments today, who is admitted, lab and pharmacy queues, low stock, who is on duty.
export const overview = wrap(async (_req, res) => res.json({ overview: await operations(todayISO()) }));

// Billed and collected today and this month, what is owed and overdue, and the state of insurance claims.
export const money = wrap(async (_req, res) => res.json({ finance: await finance(todayISO()) }));