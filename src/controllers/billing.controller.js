import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { PAYMENT_METHODS, createInvoice, getInvoice, listInvoices, recordPayment } from "../services/billing.service.js";
import { STATUSES } from "../validators/billing.validator.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const money = (n) => Number(n).toFixed(2);
// Invoice lines can reveal a diagnosis or procedure, so audit lines carry numbers, totals and amounts, never line descriptions.
// The service does the locking and the money maths; this file only checks input, calls it, and writes the audit entry once it has succeeded.

export const list = wrap(async (req, res) => {
  const { patientId, status, from, to } = req.query;
  const invoices = await listInvoices({
    patientId: patientId ? String(patientId).slice(0, 20) : undefined,
    status: STATUSES.includes(String(status)) ? String(status) : undefined,
    from: isDay(from) ? from : undefined,
    to: isDay(to) ? to : undefined,
    limit: req.query.limit,
  });
  res.json({ invoices });
});

export const get = wrap(async (req, res) => {
  const invoice = await getInvoice(req.params.id);
  if (!invoice) throw notFound("Invoice not found.");
  res.json({ invoice });
});

export const methods = wrap(async (_req, res) => res.json({ methods: PAYMENT_METHODS }));

export const create = wrap(async (req, res) => {
  const invoice = await createInvoice(req.body, req.user.id);
  await audit(req, { action: "Create", module: "Billing", summary: `Created invoice ${invoice.number} for ${invoice.patient} (${invoice.patientId}), total ${money(invoice.totals.total)}` });
  res.status(201).json({ invoice });
});

export const pay = wrap(async (req, res) => {
  const done = await recordPayment(req.params.id, req.body, { createdBy: req.user.id });
  await audit(req, { action: "Update", module: "Billing", summary: `Recorded ${req.body.method} payment of ${money(done.amount)} on ${done.invoiceId} for ${done.patient} (${done.patientId}); balance now ${money(done.balance)}` });
  res.status(201).json({ invoice: await getInvoice(done.invoiceId) });
});

// There is no edit or delete here, matching the service: charges are added and taken back by the modules that cause them
// (addCharges / removeCharges), and money is only ever added by a payment.