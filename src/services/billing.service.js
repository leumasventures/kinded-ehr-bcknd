// Invoices, automatic charges, payments and insurance claims.
//
// Everything that changes money runs inside ONE database transaction, and the rows it touches are locked first
// (the patient for charges, the invoice for payments, the claim for claim steps). Two people acting at the same moment
// therefore queue up instead of overwriting each other, and a failure half-way leaves nothing behind.
//
// Functions that other modules need to call from inside their own transaction (addCharges, removeCharges, recordPayment)
// take an optional `conn`. Pass the transaction's connection to make the charge part of the same all-or-nothing change as
// the event that caused it, for example completing an appointment. Without `conn` they open their own transaction.
//
// These functions do not write the audit log; the controller (or the module that calls them) does, once the work has succeeded.
import { query, tx } from "../config/database.js";
import { bad, conflict, notFound } from "../utils/errors.js";

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "POS", "Cheque", "HMO / Insurance"];
export const CLAIM_STATUSES = ["Draft", "Submitted", "Approved", "Rejected", "Paid"];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDaysISO = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const q = async (conn, sql, params = []) => (await conn.query(sql, params))[0];
const inTx = (conn, fn) => (conn ? fn(conn) : tx(fn));
const nextCounter = async (conn, name) => {
  await conn.query("UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = ?", [name]);
  return Number((await q(conn, "SELECT LAST_INSERT_ID() AS n"))[0].n);
};

// ---------- money maths (the same rules the web app uses) ----------

export function calcTotals({ items, discount = 0, vatRate = 0 }) {
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
  const disc = Math.min(discount, subtotal);
  const taxable = round2(subtotal - disc);
  const vat = round2((taxable * vatRate) / 100);
  return { subtotal, discount: disc, vat, total: round2(taxable + vat) };
}

const paidOf = (inv) => round2(inv.payments.reduce((s, p) => s + p.amount, 0));
export const balanceOf = (inv) => round2(calcTotals(inv).total - paidOf(inv));
function statusOf(inv) {
  const total = calcTotals(inv).total;
  const paid = paidOf(inv);
  if (paid >= total) return "Paid";
  if (inv.dueDate < todayISO()) return "Overdue";
  return paid > 0 ? "Partial" : "Unpaid";
}

function assertLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw bad("Add at least one line.");
  for (const l of lines) {
    if (!l.description || !String(l.description).trim()) throw bad("Every line needs a description.");
    if (!(Number(l.qty) > 0)) throw bad(`Quantity must be more than zero (${l.description}).`);
    if (!(Number(l.unitPrice) >= 0)) throw bad(`Price can't be negative (${l.description}).`);
  }
}

// ---------- reading invoices ----------

const itemOut = (r) => ({ id: String(r.id), description: r.description, qty: Number(r.qty), unitPrice: Number(r.unit_price), source: r.source ?? undefined });
const paymentOut = (r) => ({ id: String(r.id), date: r.pay_date, amount: Number(r.amount), method: r.method, reference: r.reference ?? undefined, claimId: r.claim_id ?? undefined });

export function invoiceOut(r, items, payments) {
  const inv = {
    id: r.id,
    number: r.id,
    patientId: r.patient_id,
    patient: r.patient_name,
    patientPhone: r.patient_phone || undefined,
    date: r.inv_date,
    dueDate: r.due_date,
    items: items.map(itemOut),
    discount: Number(r.discount),
    vatRate: Number(r.vat_rate),
    notes: r.notes ?? undefined,
    payments: payments.map(paymentOut),
  };
  const totals = calcTotals(inv);
  return { ...inv, totals, paid: paidOf(inv), balance: balanceOf(inv), status: statusOf(inv) };
}

const SELECT_INVOICE = `SELECT i.*, p.name AS patient_name, p.phone AS patient_phone FROM invoices i JOIN patients p ON p.id = i.patient_id`;

async function loadInvoices(conn, where = "", params = [], suffix = "ORDER BY i.inv_date DESC, i.id DESC") {
  const rows = await q(conn, `${SELECT_INVOICE} ${where} ${suffix}`, params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = await q(conn, "SELECT * FROM invoice_items WHERE invoice_id IN (?) ORDER BY id", [ids]);
  const pays = await q(conn, "SELECT * FROM payments WHERE invoice_id IN (?) ORDER BY id", [ids]);
  return rows.map((r) => invoiceOut(r, items.filter((x) => x.invoice_id === r.id), pays.filter((x) => x.invoice_id === r.id)));
}

export const getInvoice = async (id, conn = null) => (await loadInvoices(conn ?? { query: (s, p) => query(s, p).then((r) => [r]) }, "WHERE i.id = ?", [id]))[0];

export async function listInvoices({ patientId, status, from, to, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (patientId) (where.push("i.patient_id = ?"), args.push(patientId));
  if (from) (where.push("i.inv_date >= ?"), args.push(from));
  if (to) (where.push("i.inv_date <= ?"), args.push(to));
  const rows = await loadInvoices({ query: (s, p) => query(s, p).then((r) => [r]) }, where.length ? `WHERE ${where.join(" AND ")}` : "", args, `ORDER BY i.inv_date DESC, i.id DESC LIMIT ${Math.min(Math.max(Number(limit) || 200, 1), 500)}`);
  return status ? rows.filter((i) => i.status === status) : rows;
}

export const countInvoicesFor = async (patientId) => Number((await query("SELECT COUNT(*) AS n FROM invoices WHERE patient_id = ?", [patientId]))[0].n);

// ---------- creating invoices ----------

async function insertInvoice(conn, { patientId, date, dueDate, items, discount = 0, vatRate = 0, notes = null }, createdBy) {
  const id = `INV-${await nextCounter(conn, "invoice")}`;
  await conn.query("INSERT INTO invoices (id, patient_id, inv_date, due_date, discount, vat_rate, notes, created_by) VALUES (?,?,?,?,?,?,?,?)", [id, patientId, date, dueDate, discount, vatRate, notes, createdBy ?? null]);
  for (const l of items) {
    await conn.query("INSERT INTO invoice_items (invoice_id, patient_id, description, qty, unit_price, source) VALUES (?,?,?,?,?,?)", [id, patientId, String(l.description).trim().slice(0, 255), l.qty, l.unitPrice, l.source ?? null]);
  }
  return id;
}

/** A manual invoice entered by the cashier. Lines added by the system go through addCharges instead. */
export async function createInvoice({ patientId, date = todayISO(), dueDate, items, discount = 0, vatRate = 0, notes }, createdBy) {
  assertLines(items);
  if (!(discount >= 0) || !(vatRate >= 0 && vatRate <= 100)) throw bad("Check the discount and VAT rate.");
  const due = dueDate ?? addDaysISO(date, 14);
  if (due < date) throw bad("The due date can't be before the invoice date.");
  const id = await tx(async (conn) => {
    if (!(await q(conn, "SELECT id FROM patients WHERE id = ?", [patientId])).length) throw bad("That patient isn't registered. Register the patient first.");
    return insertInvoice(conn, { patientId, date, dueDate: due, items: items.map((l) => ({ ...l, source: null })), discount, vatRate, notes: notes || null }, createdBy);
  });
  return getInvoice(id);
}

// ---------- automatic charges ----------

/**
 * Adds charge lines to the patient's most recent unsettled invoice, or opens a new one.
 * `source` names the event ("lab:L-501"). A line with the same source and description is never added twice, so a retry
 * or a double click is harmless. The patient row is locked first, so two events for the same patient queue up.
 * Returns null when there was nothing new to charge.
 */
export async function addCharges(patient, source, lines, { createdBy = null, conn = null } = {}) {
  if (!source) throw bad("A charge needs the event it came from.");
  return inTx(conn, async (c) => {
    const found = await q(c, "SELECT id FROM patients WHERE id = ? FOR UPDATE", [patient.id]);
    if (!found.length) throw bad("That patient isn't registered.");
    const valid = lines.filter((l) => l.description && l.qty > 0 && l.unitPrice > 0);
    const done = new Set((await q(c, "SELECT description FROM invoice_items WHERE patient_id = ? AND source = ?", [patient.id, source])).map((r) => r.description));
    const fresh = valid.filter((l) => !done.has(String(l.description).trim().slice(0, 255)));
    const skipped = lines.length - fresh.length;
    if (!fresh.length) return null;
    if (new Set(fresh.map((l) => String(l.description).trim().slice(0, 255))).size !== fresh.length) throw bad("Two charge lines have the same description. Combine them into one line with a quantity.");
    const items = fresh.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, source }));

    const recent = await loadInvoices(c, "WHERE i.patient_id = ?", [patient.id], "ORDER BY i.inv_date DESC, i.id DESC LIMIT 20 FOR UPDATE");
    const open = recent.find((i) => i.balance > 0);
    let invoiceId;
    if (open) {
      invoiceId = open.id;
      for (const l of items) await c.query("INSERT INTO invoice_items (invoice_id, patient_id, description, qty, unit_price, source) VALUES (?,?,?,?,?,?)", [invoiceId, patient.id, String(l.description).trim().slice(0, 255), l.qty, l.unitPrice, source]);
    } else {
      invoiceId = await insertInvoice(c, { patientId: patient.id, date: todayISO(), dueDate: addDaysISO(todayISO(), 14), items, notes: "Charges added automatically from hospital activity." }, createdBy);
    }
    return { invoiceId, added: items.length, amount: calcTotals({ items, discount: 0, vatRate: 0 }).total, skipped, lines: items };
  });
}

/**
 * Takes back the charges an event added (for example a cancelled lab order). Lines on an invoice that has already been
 * paid beyond what would remain are kept ("blocked") and must be adjusted by hand. An emptied, unpaid invoice is removed.
 */
export async function removeCharges(patientId, source, { conn = null } = {}) {
  return inTx(conn, async (c) => {
    await q(c, "SELECT id FROM patients WHERE id = ? FOR UPDATE", [patientId]);
    const invoices = await loadInvoices(c, "WHERE i.patient_id = ? AND i.id IN (SELECT invoice_id FROM invoice_items WHERE source = ?)", [patientId, source], "ORDER BY i.id FOR UPDATE");
    let removed = 0;
    let amount = 0;
    let blocked = 0;
    let invoiceId;
    for (const inv of invoices) {
      const lines = inv.items.filter((x) => x.source === source);
      const rest = { ...inv, items: inv.items.filter((x) => x.source !== source) };
      invoiceId = inv.id;
      if (paidOf(inv) > calcTotals(rest).total) {
        blocked += lines.length;
        continue;
      }
      await c.query("DELETE FROM invoice_items WHERE invoice_id = ? AND source = ?", [inv.id, source]);
      removed += lines.length;
      amount += calcTotals({ items: lines, discount: 0, vatRate: 0 }).total;
      if (rest.items.length === 0 && inv.payments.length === 0) await c.query("DELETE FROM invoices WHERE id = ?", [inv.id]);
    }
    return { removed, amount: round2(amount), blocked, invoiceId };
  });
}

// ---------- payments ----------

/** Records money received against one invoice. Locks the invoice, so two cashiers can't both pay the last of the balance. */
export async function recordPayment(invoiceId, { amount, method, date = todayISO(), reference, claimId = null }, { createdBy = null, conn = null } = {}) {
  if (!PAYMENT_METHODS.includes(method)) throw bad("Choose how the money was received.");
  amount = round2(amount);
  if (!(amount > 0)) throw bad("Enter an amount greater than zero.");
  return inTx(conn, async (c) => {
    const [inv] = await loadInvoices(c, "WHERE i.id = ?", [invoiceId], "FOR UPDATE");
    if (!inv) throw notFound("Invoice not found.");
    if (amount > inv.balance + 0.001) throw conflict(`The balance on ${inv.number} is ${inv.balance.toFixed(2)}. A payment can't be more than that.`, { code: "overpayment", balance: inv.balance });
    await c.query("INSERT INTO payments (invoice_id, pay_date, amount, method, reference, claim_id, created_by) VALUES (?,?,?,?,?,?,?)", [inv.id, date, amount, method, reference?.toString().trim().slice(0, 80) || null, claimId, createdBy]);
    return { invoiceId: inv.id, patientId: inv.patientId, patient: inv.patient, amount, balance: round2(inv.balance - amount) };
  });
}

// ---------- insurance claims ----------

const claimTotal = (lines) => round2(lines.reduce((s, l) => s + l.amount, 0));
function claimOutstanding(c) {
  if (c.status === "Rejected" || c.status === "Paid") return 0;
  const target = c.status === "Approved" ? c.approvedAmount ?? 0 : claimTotal(c.lines);
  return Math.max(0, round2(target - c.receivedAmount));
}

async function loadClaims(conn, where = "", params = [], suffix = "ORDER BY c.created_at DESC, c.id DESC") {
  const rows = await q(conn, `SELECT c.* FROM claims c ${where} ${suffix}`, params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const lines = await q(conn, `SELECT cl.*, p.name AS patient_name FROM claim_lines cl JOIN patients p ON p.id = cl.patient_id WHERE cl.claim_id IN (?) ORDER BY cl.id`, [ids]);
  const events = await q(conn, "SELECT * FROM claim_events WHERE claim_id IN (?) ORDER BY id", [ids]);
  return rows.map((r) => {
    const claim = {
      id: r.id,
      number: r.id,
      payer: r.payer,
      payerType: r.payer_type,
      status: r.status,
      lines: lines.filter((l) => l.claim_id === r.id).map((l) => ({ invoiceId: l.invoice_id, number: l.invoice_id, patientId: l.patient_id, patient: l.patient_name, memberId: l.member_id ?? undefined, amount: Number(l.amount) })),
      submittedOn: r.submitted_on ?? undefined,
      reference: r.reference ?? undefined,
      approvedAmount: r.approved_amount === null ? undefined : Number(r.approved_amount),
      receivedAmount: Number(r.received_amount),
      rejectionReason: r.rejection_reason ?? undefined,
      createdBy: r.created_by ?? undefined,
      createdAt: r.created_at,
      history: events.filter((e) => e.claim_id === r.id).map((e) => ({ at: e.at, by: e.by_name, text: e.text })),
    };
    return { ...claim, total: claimTotal(claim.lines), outstanding: claimOutstanding(claim) };
  });
}

const direct = { query: (s, p) => query(s, p).then((r) => [r]) };
export const getClaim = async (id, conn = direct) => (await loadClaims(conn, "WHERE c.id = ?", [id]))[0];
export const listClaims = async ({ status, payer } = {}) => {
  const where = [];
  const args = [];
  if (CLAIM_STATUSES.includes(status)) (where.push("c.status = ?"), args.push(status));
  if (payer) (where.push("c.payer = ?"), args.push(String(payer).slice(0, 160)));
  return loadClaims(direct, where.length ? `WHERE ${where.join(" AND ")}` : "", args, "ORDER BY c.created_at DESC, c.id DESC LIMIT 300");
};

const addEvent = (conn, claimId, by, text) => conn.query("INSERT INTO claim_events (claim_id, by_name, text) VALUES (?,?,?)", [claimId, by.name, text.slice(0, 500)]);
const lockClaim = async (conn, id) => {
  const [row] = await q(conn, "SELECT id FROM claims WHERE id = ? FOR UPDATE", [id]);
  if (!row) throw notFound("Claim not found.");
  return (await loadClaims(conn, "WHERE c.id = ?", [id]))[0];
};

/**
 * Starts a Draft claim for one payer from unpaid invoices. Each invoice must belong to a patient covered by that payer,
 * have a balance, and not already sit in a live claim. The invoices are locked while this is checked, so two people
 * can't put the same invoice in two claims.
 */
export async function createClaim({ payer, payerType, invoiceIds }, by) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) throw bad("Choose at least one invoice.");
  const ids = [...new Set(invoiceIds)];
  const id = await tx(async (conn) => {
    await q(conn, "SELECT id FROM invoices WHERE id IN (?) ORDER BY id FOR UPDATE", [ids]);
    const invoices = (await loadInvoices(conn, "WHERE i.id IN (?)", [ids])).sort((x, y) => Number(x.id.replace(/\D/g, "")) - Number(y.id.replace(/\D/g, ""))); // oldest first: payments are shared out in this order
    if (invoices.length !== ids.length) throw notFound("One of the invoices doesn't exist.");
    const taken = await q(conn, "SELECT cl.invoice_id FROM claim_lines cl JOIN claims c ON c.id = cl.claim_id WHERE c.status <> 'Rejected' AND cl.invoice_id IN (?)", [ids]);
    if (taken.length) throw conflict(`${taken[0].invoice_id} is already in another claim.`);
    const patients = await q(conn, "SELECT id, payer, payer_name, member_id FROM patients WHERE id IN (?)", [[...new Set(invoices.map((i) => i.patientId))]]);
    const byId = new Map(patients.map((p) => [p.id, p]));
    for (const inv of invoices) {
      const p = byId.get(inv.patientId);
      if (!p || p.payer === "Self-pay") throw conflict(`${inv.number}: ${inv.patient} is not covered by an insurer.`);
      if ((p.payer_name?.trim() || p.payer) !== payer || p.payer !== payerType) throw conflict(`${inv.number}: ${inv.patient} is covered by ${p.payer_name?.trim() || p.payer}, not ${payer}.`);
      if (inv.balance <= 0) throw conflict(`${inv.number} has nothing left to pay.`);
    }
    const cid = `CLM-${await nextCounter(conn, "claim")}`;
    await conn.query("INSERT INTO claims (id, payer, payer_type, created_by) VALUES (?,?,?,?)", [cid, payer, payerType, by.id]);
    for (const inv of invoices) await conn.query("INSERT INTO claim_lines (claim_id, invoice_id, patient_id, member_id, amount) VALUES (?,?,?,?,?)", [cid, inv.id, inv.patientId, byId.get(inv.patientId).member_id, inv.balance]);
    await addEvent(conn, cid, by, `Claim created with ${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`);
    return cid;
  });
  return getClaim(id);
}

export const submitClaim = ({ id, submittedOn = todayISO(), reference }, by) =>
  tx(async (conn) => {
    const c = await lockClaim(conn, id);
    if (c.status !== "Draft") throw conflict(`A ${c.status.toLowerCase()} claim can't be submitted.`);
    await conn.query("UPDATE claims SET status = 'Submitted', submitted_on = ?, reference = ? WHERE id = ?", [submittedOn, reference?.trim().slice(0, 80) || null, id]);
    await addEvent(conn, id, by, `Submitted to ${c.payer}${reference ? ` (their reference ${reference})` : ""}`);
    return getClaim(id, conn);
  });

export const approveClaim = ({ id, approvedAmount }, by) =>
  tx(async (conn) => {
    const c = await lockClaim(conn, id);
    if (c.status !== "Submitted") throw conflict(`Only a submitted claim can be approved (this one is ${c.status.toLowerCase()}).`);
    approvedAmount = round2(approvedAmount);
    if (!(approvedAmount > 0) || approvedAmount > c.total + 0.001) throw bad(`The approved amount must be more than zero and no more than ${c.total.toFixed(2)}.`);
    await conn.query("UPDATE claims SET status = 'Approved', approved_amount = ? WHERE id = ?", [approvedAmount, id]);
    await addEvent(conn, id, by, `Approved for ${approvedAmount.toFixed(2)} of ${c.total.toFixed(2)}`);
    return getClaim(id, conn);
  });

/** A rejected claim lets go of its invoices, so they can go into a new claim or be paid another way. */
export const rejectClaim = ({ id, reason }, by) =>
  tx(async (conn) => {
    const c = await lockClaim(conn, id);
    if (c.status !== "Submitted") throw conflict(`Only a submitted claim can be rejected (this one is ${c.status.toLowerCase()}).`);
    if (!reason?.trim()) throw bad("Give the reason the payer rejected it.");
    await conn.query("UPDATE claims SET status = 'Rejected', rejection_reason = ? WHERE id = ?", [reason.trim().slice(0, 500), id]);
    await addEvent(conn, id, by, `Rejected: ${reason.trim()}`);
    return getClaim(id, conn);
  });

/**
 * Money received from the payer. It is shared out over the claim's invoices in order, each up to what that invoice still
 * owes, and posted as "HMO / Insurance" payments, all in the same transaction as the claim's own totals. If the money
 * can't all be placed (an invoice was paid some other way meanwhile) nothing is saved.
 */
export const recordClaimPayment = ({ id, amount, date = todayISO(), reference }, by) =>
  tx(async (conn) => {
    const c = await lockClaim(conn, id);
    if (c.status !== "Approved") throw conflict(`Payments can be recorded once a claim is approved (this one is ${c.status.toLowerCase()}).`);
    amount = round2(amount);
    if (!(amount > 0)) throw bad("Enter an amount greater than zero.");
    if (amount > c.outstanding + 0.001) throw conflict(`The payer still owes ${c.outstanding.toFixed(2)} on this claim.`, { code: "overpayment", outstanding: c.outstanding });
    let left = amount;
    const posted = [];
    for (const line of c.lines) {
      if (left <= 0.001) break;
      const [inv] = await loadInvoices(conn, "WHERE i.id = ?", [line.invoiceId], "FOR UPDATE");
      const part = round2(Math.min(left, inv.balance));
      if (part <= 0) continue;
      await recordPayment(inv.id, { amount: part, method: "HMO / Insurance", date, reference: reference || c.reference, claimId: id }, { createdBy: by.id, conn });
      posted.push({ invoiceId: inv.id, amount: part });
      left = round2(left - part);
    }
    if (left > 0.001) throw conflict(`${left.toFixed(2)} of this payment can't be placed because the invoices in the claim have been paid some other way. Nothing was saved.`, { code: "invoices_settled" });
    const received = round2(c.receivedAmount + amount);
    const paid = received >= (c.approvedAmount ?? 0) - 0.001;
    await conn.query("UPDATE claims SET received_amount = ?, status = ? WHERE id = ?", [received, paid ? "Paid" : "Approved", id]);
    await addEvent(conn, id, by, `Received ${amount.toFixed(2)} from ${c.payer}${paid ? ". Claim paid in full" : ""}`);
    return { claim: await getClaim(id, conn), posted };
  });

/** Unpaid invoices of insured patients that are not in a live claim, grouped by payer (what the "new claim" screen lists). */
export async function claimableByPayer() {
  const rows = await query(
    `SELECT i.id FROM invoices i JOIN patients p ON p.id = i.patient_id
     WHERE p.payer <> 'Self-pay' AND i.id NOT IN (SELECT cl.invoice_id FROM claim_lines cl JOIN claims c ON c.id = cl.claim_id WHERE c.status <> 'Rejected')`
  );
  if (!rows.length) return [];
  const invoices = (await loadInvoices(direct, "WHERE i.id IN (?)", [rows.map((r) => r.id)])).filter((i) => i.balance > 0);
  const patients = await query("SELECT id, payer, payer_name, member_id FROM patients WHERE id IN (?)", [[...new Set(invoices.map((i) => i.patientId))]]);
  const byId = new Map(patients.map((p) => [p.id, p]));
  const groups = new Map();
  for (const invoice of invoices) {
    const p = byId.get(invoice.patientId);
    const key = p.payer_name?.trim() || p.payer;
    const g = groups.get(key) ?? { payer: key, payerType: p.payer, rows: [] };
    g.rows.push({ invoice, memberId: p.member_id ?? undefined, balance: invoice.balance });
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.payer.localeCompare(b.payer));
}
