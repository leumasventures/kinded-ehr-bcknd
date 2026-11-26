import { bad, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { createInvoice, getInvoice, listInvoices, recordPayment } from "../services/billing.service.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const STATUSES = ["Unpaid", "Partial", "Paid", "Overdue"];
const money = (n) => Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const list = wrap(async (req, res) => {
  const { patientId, status, from, to } = req.query;
  res.json({ invoices: await listInvoices({ patientId: patientId ? String(patientId).slice(0, 20) : undefined, status: STATUSES.includes(String(status)) ? String(status) : undefined, from: isDay(from) ? from : undefined, to: isDay(to) ? to : undefined, limit: req.query.limit }) });
});

export const get = wrap(async (req, res) => {
  const invoice = await getInvoice(req.params.id);
  if (!invoice) throw notFound("Invoice not found.");
  res.json({ invoice });
});

export const create = wrap(async (req, res) => {
  const invoice = await createInvoice(req.body, req.user.id);
  await audit(req, { action: "Create", module: "Billing", summary: `Created invoice ${invoice.id} for ${invoice.patient} (${invoice.patientId}), total ${money(invoice.totals.total)}` });
  res.status(201).json({ invoice });
});

export const pay = wrap(async (req, res) => {
  const { amount, method, date, reference } = req.body;
  if (!(await getInvoice(req.params.id))) throw notFound("Invoice not found.");
  const done = await recordPayment(req.params.id, { amount, method, date, reference: reference || undefined }, { createdBy: req.user.id });
  await audit(req, { action: "Payment", module: "Billing", summary: `Received ${money(done.amount)} by ${method} on ${done.invoiceId} from ${done.patient} (${done.patientId}); balance ${money(done.balance)}` });
  res.status(201).json({ payment: done, invoice: await getInvoice(req.params.id) });
});

/** Totals for the billing screen: what is owed, what has been received, how much is overdue. */
export const totals = wrap(async (req, res) => {
  if (req.query.from && !isDay(req.query.from)) throw bad("Use the format YYYY-MM-DD.");
  const invoices = await listInvoices({ from: req.query.from, to: req.query.to, limit: 500 });
  const sum = (f) => Math.round(invoices.reduce((s, i) => s + f(i), 0) * 100) / 100;
  res.json({ count: invoices.length, billed: sum((i) => i.totals.total), received: sum((i) => i.paid), outstanding: sum((i) => i.balance), overdue: sum((i) => (i.status === "Overdue" ? i.balance : 0)) });
});
