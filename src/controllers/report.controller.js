import { bad, wrap } from "../utils/errors.js";
import { addDaysISO } from "../services/billing.service.js";
import * as reports from "../services/report.service.js";

// Reports only read, and return totals and counts rather than individual records, so there is nothing to audit here.
// Every dated report takes ?from=YYYY-MM-DD&to=YYYY-MM-DD and defaults to the last 30 days, capped at a year.
// Money reports (revenue, receivables, claims) and clinical ones should sit behind different route guards.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const todayISO = () => new Date().toISOString().slice(0, 10);
const realDay = (s) => DAY.test(s) && new Date(Date.parse(`${s}T00:00:00Z`)).toISOString().slice(0, 10) === s;

function range(req) {
  const to = req.query.to === undefined ? todayISO() : String(req.query.to);
  const from = req.query.from === undefined ? addDaysISO(to, -29) : String(req.query.from);
  if (!realDay(from) || !realDay(to)) throw bad("Use real dates in the form YYYY-MM-DD for from and to.");
  if (from > to) throw bad("The start date is after the end date.");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw bad("Choose a range of at most one year.");
  return [from, to];
}

const dated = (fn) => wrap(async (req, res) => res.json({ report: await fn(...range(req)) }));

export const revenue = dated(reports.revenue);
export const claims = dated(reports.claims);
export const admissions = dated(reports.admissions);
export const appointments = dated(reports.appointments);
export const laboratory = dated(reports.laboratory);
export const pharmacy = dated(reports.pharmacy);

// What is owed today, by how late it is. It is a snapshot, so it takes no date range.
export const receivables = wrap(async (_req, res) => res.json({ report: await reports.receivables(todayISO()) }));
