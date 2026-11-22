import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { cancelOrder, collectSpecimen, createOrder, enterResults, getOrder, listCatalog, listOrders, reviewOrder } from "../services/laboratory.service.js";
import { PRIORITIES, STATUSES } from "../validators/laboratory.validator.js";

const money = (n) => Number(n).toFixed(2);
const who = (o) => `${o.patient} (${o.patientId})`;
const count = (n) => `${n} test${n === 1 ? "" : "s"}`;
// Test names, results, flags and clinical notes are clinical, so the audit log records the order number, the patient and
// counts only. It still shows who touched which order and when.

export const list = wrap(async (req, res) => {
  const { status, patientId, priority, unreviewed, mine } = req.query;
  const orders = await listOrders({
    status: STATUSES.includes(String(status)) ? String(status) : undefined,
    priority: PRIORITIES.includes(String(priority)) ? String(priority) : undefined,
    patientId: patientId ? String(patientId).slice(0, 20) : undefined,
    orderedBy: mine === "1" || mine === "true" ? req.user.id : undefined,
    unreviewed: unreviewed === "1" || unreviewed === "true",
    limit: req.query.limit,
  });
  res.json({ orders });
});

// The tests that can be ordered, with prices, for the order form.
export const tests = wrap(async (_req, res) => res.json({ tests: await listCatalog() }));

export const get = wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw notFound("Lab order not found.");
  res.json({ order });
});

export const create = wrap(async (req, res) => {
  const { order, charged } = await createOrder(req.body, req.user);
  await audit(req, { action: "Create", module: "Laboratory", summary: `Ordered ${count(order.tests.length)} (${order.id}, ${order.priority.toLowerCase()}) for ${who(order)}${charged ? `; ${money(charged.amount)} added to invoice ${charged.invoiceId}` : ""}` });
  res.status(201).json({ order, charged });
});

export const collect = wrap(async (req, res) => {
  const order = await collectSpecimen(req.params.id, req.user);
  await audit(req, { action: "Update", module: "Laboratory", summary: `Specimen collected for ${order.id} of ${who(order)}` });
  res.json({ order });
});

export const results = wrap(async (req, res) => {
  const order = await enterResults(req.params.id, req.body.results, req.user);
  await audit(req, { action: "Update", module: "Laboratory", summary: `Entered results for ${order.id} of ${who(order)} (${count(order.tests.length)})` });
  // The caller sees at once if any value was flagged Critical, so it can phone the doctor.
  res.json({ order, critical: order.critical });
});

export const review = wrap(async (req, res) => {
  const order = await reviewOrder(req.params.id, req.user);
  await audit(req, { action: "Update", module: "Laboratory", summary: `Reviewed results of ${order.id} for ${who(order)}` });
  res.json({ order });
});

export const cancel = wrap(async (req, res) => {
  const { order, charges } = await cancelOrder(req.params.id, req.body.reason, req.user);
  await audit(req, { action: "Update", module: "Laboratory", summary: `Cancelled ${order.id} of ${who(order)}: ${req.body.reason}${charges.removed ? `; ${money(charges.amount)} taken off the bill` : ""}${charges.blocked ? `; ${charges.blocked} paid line(s) left on the invoice` : ""}` });
  // charges.blocked > 0 means part of the bill was already paid, so someone must adjust that invoice by hand.
  res.json({ order, charges });
});