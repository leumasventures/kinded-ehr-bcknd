// Laboratory orders: ordering, specimen collection, results, and the doctor's review.
// Ordering puts the tests on the patient's bill and cancelling takes them back, in the SAME transaction as the order
// itself (addCharges / removeCharges in billing.service.js, source "lab:<order id>"), so an order and its charge never disagree.
// These functions do not write the audit log; the controller does, once the work has succeeded.
import { query, tx } from "../config/database.js";
import { bad, conflict, notFound } from "../utils/errors.js";
import { addCharges, removeCharges } from "./billing.service.js";

/** mysql2 needs one placeholder per value for IN lists. */
const expandIn = (ids) => {
  const list = Array.isArray(ids) ? ids : [ids];
  if (!list.length) return { sql: "(NULL)", params: [] };
  return { sql: `(${list.map(() => "?").join(",")})`, params: list };
};


// ASSUMPTION: orderable tests are the active items of this price_list category.
export const LAB_CATEGORY = "Laboratory";

const q = async (conn, sql, params = []) => (await conn.query(sql, params))[0];
const direct = { query: (s, p) => query(s, p).then((r) => [r]) };
const nextCounter = async (conn, name) => {
  await conn.query("UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = ?", [name]);
  return Number((await q(conn, "SELECT LAST_INSERT_ID() AS n"))[0].n);
};

const HEAD = `SELECT o.*, p.name AS patient_name, u.name AS ordered_by_name,
  EXISTS(SELECT 1 FROM lab_order_tests t WHERE t.order_id = o.id AND t.flag = 'Critical') AS critical
  FROM lab_orders o JOIN patients p ON p.id = o.patient_id LEFT JOIN users u ON u.id = o.ordered_by`;

// Open work first, most urgent first; finished orders after, newest first.
const WORKLIST = "ORDER BY FIELD(o.status, 'Ordered', 'Collected', 'Resulted', 'Cancelled'), FIELD(o.priority, 'Stat', 'Urgent', 'Routine'), o.ordered_at DESC";

const testOut = (t, withResults) => ({
  id: t.id,
  code: t.code,
  name: t.name,
  ...(withResults ? { result: t.result_value ?? null, unit: t.unit ?? null, referenceRange: t.reference_range ?? null, flag: t.flag ?? null } : {}),
});

// Lists carry test names only. Results and clinical notes are returned when one order is opened.
export const orderOut = (r, tests, withResults = true) => ({
  id: r.id,
  number: r.id,
  patientId: r.patient_id,
  patient: r.patient_name,
  priority: r.priority,
  status: r.status,
  orderedById: r.ordered_by,
  orderedBy: r.ordered_by_name ?? null,
  orderedAt: r.ordered_at,
  collectedAt: r.collected_at ?? null,
  resultedAt: r.resulted_at ?? null,
  reviewedAt: r.reviewed_at ?? null,
  cancelledAt: r.cancelled_at ?? null,
  critical: Number(r.critical) > 0,
  tests: tests.map((t) => testOut(t, withResults)),
  ...(withResults ? { clinicalNotes: r.clinical_notes ?? null, cancelReason: r.cancel_reason ?? null } : {}),
});

async function loadOrders(conn, where = "", params = [], suffix = WORKLIST, withResults = true) {
  const rows = await q(conn, `${HEAD} ${where} ${suffix}`, params);
  if (!rows.length) return [];
  const orderIds = rows.map((r) => r.id);
  const _oi = expandIn(orderIds);
  const tests = orderIds.length
    ? await q(conn, `SELECT id, order_id, code, name, result_value, unit, reference_range, flag FROM lab_order_tests WHERE order_id IN ${_oi.sql} ORDER BY id`, _oi.params)
    : [];
  return rows.map((r) => orderOut(r, tests.filter((t) => t.order_id === r.id), withResults));
}

export const getOrder = async (id, conn = direct) => (await loadOrders(conn, "WHERE o.id = ?", [id]))[0];

export async function listOrders({ status, patientId, orderedBy, priority, unreviewed, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (status) (where.push("o.status = ?"), args.push(status));
  if (patientId) (where.push("o.patient_id = ?"), args.push(patientId));
  if (orderedBy) (where.push("o.ordered_by = ?"), args.push(orderedBy));
  if (priority) (where.push("o.priority = ?"), args.push(priority));
  if (unreviewed) where.push("o.status = 'Resulted' AND o.reviewed_at IS NULL");
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return loadOrders(direct, where.length ? `WHERE ${where.join(" AND ")}` : "", args, `${WORKLIST} LIMIT ${n}`, false);
}

/** The tests that can be ordered. */
export async function listCatalog() {
  const rows = await query("SELECT id, code, name, price FROM price_list WHERE active = 1 AND category = ? ORDER BY name", [LAB_CATEGORY]);
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, price: Number(r.price) }));
}

async function lock(conn, id) {
  const [row] = await q(conn, "SELECT id, patient_id, status, reviewed_at FROM lab_orders WHERE id = ? FOR UPDATE", [id]);
  if (!row) throw notFound("Lab order not found.");
  return row;
}

/**
 * Places an order and puts its tests on the patient's bill (add-on to their open invoice, or a new one).
 * Returns { order, charged } where charged is null when every test was free.
 */
export async function createOrder({ patientId, priority = "Routine", clinicalNotes, testIds }, by) {
  const ids = [...new Set(testIds)];
  if (ids.length !== testIds.length) throw bad("The same test is listed twice.");
  return tx(async (conn) => {
    if (!(await q(conn, "SELECT id FROM patients WHERE id = ?", [patientId])).length) throw bad("That patient isn't registered. Register the patient first.");
    if (!ids.length) throw bad("Choose at least one test.");
    const placeholders = ids.map(() => "?").join(",");
    const found = await q(
      conn,
      `SELECT id, code, name, price FROM price_list WHERE active = 1 AND category = ? AND id IN (${placeholders})`,
      [LAB_CATEGORY, ...ids]
    );
    if (found.length !== ids.length) throw bad("One of those tests isn't on the laboratory price list, or has been switched off. Open Price List and ensure Laboratory items exist in the database.");
    const byId = new Map(found.map((t) => [t.id, t]));
    const tests = ids.map((id) => byId.get(id)); // keep the order they were chosen in

    const orderId = `L-${await nextCounter(conn, "lab")}`;
    await conn.query("INSERT INTO lab_orders (id, patient_id, ordered_by, priority, status, clinical_notes, ordered_at) VALUES (?,?,?,?, 'Ordered', ?, NOW())", [orderId, patientId, by.id, priority, clinicalNotes || null]);
    for (const t of tests) await conn.query("INSERT INTO lab_order_tests (order_id, price_item_id, code, name) VALUES (?,?,?,?)", [orderId, t.id, t.code, t.name]);

    const charged = await addCharges({ id: patientId }, `lab:${orderId}`, tests.map((t) => ({ description: t.name, qty: 1, unitPrice: Number(t.price) })), { createdBy: by.id, conn });
    return { order: await getOrder(orderId, conn), charged: charged ? { invoiceId: charged.invoiceId, amount: charged.amount } : null };
  });
}

export const collectSpecimen = (id, by) =>
  tx(async (conn) => {
    const o = await lock(conn, id);
    if (o.status !== "Ordered") throw conflict(`A ${o.status.toLowerCase()} order can't be marked as collected.`);
    await conn.query("UPDATE lab_orders SET status = 'Collected', collected_at = NOW(), collected_by = ? WHERE id = ?", [by.id, id]);
    return getOrder(id, conn);
  });

/** Results for every test on the order, entered together. */
export const enterResults = (id, results, by) =>
  tx(async (conn) => {
    const o = await lock(conn, id);
    if (o.status !== "Collected") throw conflict(`Results can be entered once the specimen is collected (this order is ${o.status.toLowerCase()}).`);
    const want = new Set((await q(conn, "SELECT id FROM lab_order_tests WHERE order_id = ?", [id])).map((t) => t.id));
    const got = new Set(results.map((r) => r.testId));
    if (got.size !== results.length) throw bad("A test appears twice in the results.");
    if (got.size !== want.size || [...got].some((t) => !want.has(t))) throw bad("Enter a result for every test on the order, and only those.");
    for (const r of results) {
      await conn.query("UPDATE lab_order_tests SET result_value = ?, unit = ?, reference_range = ?, flag = ? WHERE id = ? AND order_id = ?", [r.value, r.unit || null, r.referenceRange || null, r.flag, r.testId, id]);
    }
    await conn.query("UPDATE lab_orders SET status = 'Resulted', resulted_at = NOW(), resulted_by = ? WHERE id = ?", [by.id, id]);
    return getOrder(id, conn);
  });

/** A doctor confirms they have seen the results. */
export const reviewOrder = (id, by) =>
  tx(async (conn) => {
    const o = await lock(conn, id);
    if (o.status !== "Resulted") throw conflict(`Only an order with results can be reviewed (this one is ${o.status.toLowerCase()}).`);
    if (o.reviewed_at) throw conflict("These results have already been reviewed.");
    await conn.query("UPDATE lab_orders SET reviewed_at = NOW(), reviewed_by = ? WHERE id = ?", [by.id, id]);
    return getOrder(id, conn);
  });

/** Cancels an order that has no results yet and takes its tests back off the bill. */
export const cancelOrder = (id, reason, by) =>
  tx(async (conn) => {
    const o = await lock(conn, id);
    if (!["Ordered", "Collected"].includes(o.status)) throw conflict(`A ${o.status.toLowerCase()} order can't be cancelled.`);
    await conn.query("UPDATE lab_orders SET status = 'Cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?", [reason, id]);
    // blocked > 0 means the invoice was already paid past what would remain, so those lines stay and need adjusting by hand.
    const charges = await removeCharges(o.patient_id, `lab:${id}`, { conn });
    return { order: await getOrder(id, conn), charges };
  });