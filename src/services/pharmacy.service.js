// The drug list with its stock, prescriptions, and dispensing.
// Dispensing takes the stock down, writes the stock movement, marks the prescription dispensed AND puts the drug on the
// patient's bill (addCharges, source "rx:<id>") in ONE transaction, with the prescription and the drug locked first, so
// two pharmacists can't dispense the last box twice. Every change to stock leaves a row in stock_movements.
// These functions do not write the audit log; the controller does, once the work has succeeded.
import { randomUUID } from "node:crypto";
import { query, tx } from "../config/database.js";
import { bad, conflict, notFound } from "../utils/errors.js";
import { addCharges } from "./billing.service.js";

/** mysql2 needs one placeholder per value for IN lists. */
const expandIn = (ids) => {
  const list = Array.isArray(ids) ? ids : [ids];
  if (!list.length) return { sql: "(NULL)", params: [] };
  return { sql: `(${list.map(() => "?").join(",")})`, params: list };
};


const q = async (conn, sql, params = []) => (await conn.query(sql, params))[0];
const direct = { query: (s, p) => query(s, p).then((r) => [r]) };
const nextCounter = async (conn, name) => {
  await conn.query("INSERT IGNORE INTO counters (name, value) VALUES (?, 1000)", [name]);
  await conn.query("UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = ?", [name]);
  const rows = await q(conn, "SELECT LAST_INSERT_ID() AS n");
  return Number(rows[0]?.n) || 1;
};
const like = (s) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;
const drugLabel = (d) => [d.name, d.strength, d.form].filter(Boolean).join(" ");

// ---------- drugs and stock ----------

export const drugOut = (r) => ({ id: r.id, name: r.name, strength: r.strength || null, form: r.form || null, label: drugLabel(r), unitPrice: Number(r.unit_price), stockQty: Number(r.stock_qty), reorderLevel: Number(r.reorder_level), low: Number(r.stock_qty) <= Number(r.reorder_level), active: !!r.active });

export async function getDrug(id) {
  const [row] = await query("SELECT * FROM drugs WHERE id = ?", [id]);
  return row;
}

export async function listDrugs({ q: text, lowStock, includeInactive, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (!includeInactive) where.push("active = 1");
  if (lowStock) where.push("stock_qty <= reorder_level");
  if (text) (where.push("name LIKE ?"), args.push(like(text)));
  const n = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const rows = await query(`SELECT * FROM drugs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY name, strength LIMIT ${n}`, args);
  return rows.map(drugOut);
}

const movement = (conn, { drugId, delta, balance, reason, ref = null, by }) =>
  conn.query("INSERT INTO stock_movements (id, drug_id, delta, balance, reason, ref, by_id, at) VALUES (?,?,?,?,?,?,?, NOW())", [randomUUID(), drugId, delta, balance, reason.slice(0, 255), ref, by?.id ?? null]);

export async function createDrug(d, by) {
  const id = randomUUID();
  try {
    await tx(async (conn) => {
      await conn.query("INSERT INTO drugs (id, name, strength, form, unit_price, stock_qty, reorder_level, active) VALUES (?,?,?,?,?,?,?,1)", [id, d.name, d.strength || "", d.form || "", d.unitPrice, d.stockQty, d.reorderLevel]);
      if (d.stockQty > 0) await movement(conn, { drugId: id, delta: d.stockQty, balance: d.stockQty, reason: "Opening stock", by });
    });
  } catch (e) {
    if (e?.errno === 1062) throw conflict("That drug (same name, strength and form) is already on the list.");
    throw e;
  }
  return getDrug(id);
}

/** Applies only what changed. Returns descriptions of the changes. */
export async function updateDrug(row, d) {
  const sets = [];
  const vals = [];
  const changed = [];
  const text = { name: "name", strength: "strength", form: "form" };
  for (const [key, col] of Object.entries(text)) {
    if (d[key] === undefined) continue;
    const v = d[key] ?? "";
    if (v === (row[col] ?? "")) continue;
    sets.push(`${col} = ?`);
    vals.push(v);
    changed.push(key);
  }
  if (d.unitPrice !== undefined && d.unitPrice !== Number(row.unit_price)) (sets.push("unit_price = ?"), vals.push(d.unitPrice), changed.push(`price ${Number(row.unit_price).toFixed(2)} to ${d.unitPrice.toFixed(2)}`));
  if (d.reorderLevel !== undefined && d.reorderLevel !== Number(row.reorder_level)) (sets.push("reorder_level = ?"), vals.push(d.reorderLevel), changed.push("reorder level"));
  if (d.active !== undefined && d.active !== !!row.active) (sets.push("active = ?"), vals.push(d.active ? 1 : 0), changed.push(d.active ? "switched on" : "switched off"));
  if (!sets.length) return [];
  try {
    await query(`UPDATE drugs SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  } catch (e) {
    if (e?.errno === 1062) throw conflict("Another drug already has that name, strength and form.");
    throw e;
  }
  return changed;
}

/** Adds or removes stock with a reason. Stock can't go below zero. */
export const adjustStock = (id, delta, reason, by) =>
  tx(async (conn) => {
    const [drug] = await q(conn, "SELECT * FROM drugs WHERE id = ? FOR UPDATE", [id]);
    if (!drug) throw notFound("Drug not found.");
    const balance = Number(drug.stock_qty) + delta;
    if (balance < 0) throw conflict(`Only ${drug.stock_qty} in stock, so ${-delta} can't be taken out.`, { code: "out_of_stock", inStock: Number(drug.stock_qty) });
    await conn.query("UPDATE drugs SET stock_qty = ? WHERE id = ?", [balance, id]);
    await movement(conn, { drugId: id, delta, balance, reason, by });
    return drugOut((await q(conn, "SELECT * FROM drugs WHERE id = ?", [id]))[0]);
  });

export async function listMovements(drugId, limit = 100) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = await query(`SELECT m.*, u.name AS by_name FROM stock_movements m LEFT JOIN users u ON u.id = m.by_id WHERE m.drug_id = ? ORDER BY m.at DESC, m.id DESC LIMIT ${n}`, [drugId]);
  return rows.map((r) => ({ id: r.id, delta: Number(r.delta), balance: Number(r.balance), reason: r.reason, ref: r.ref ?? null, by: r.by_name ?? null, at: r.at }));
}

// ---------- prescriptions ----------

const HEAD = `SELECT x.*, p.name AS patient_name, g.name AS drug_name, g.strength, g.form, g.stock_qty, u.name AS prescriber_name
  FROM prescriptions x JOIN patients p ON p.id = x.patient_id JOIN drugs g ON g.id = x.drug_id LEFT JOIN users u ON u.id = x.prescriber_id`;
const WORKLIST = "ORDER BY FIELD(x.status, 'Pending', 'Dispensed', 'Cancelled'), x.created_at DESC";

export const rxOut = (r) => ({
  id: r.id,
  number: r.id,
  patientId: r.patient_id,
  patient: r.patient_name,
  drugId: r.drug_id,
  drug: drugLabel({ name: r.drug_name, strength: r.strength, form: r.form }),
  dose: r.dose,
  frequency: r.frequency,
  duration: r.duration ?? null,
  quantity: Number(r.quantity),
  instructions: r.instructions ?? null,
  status: r.status,
  prescribedBy: r.prescriber_name ?? null,
  prescriberId: r.prescriber_id,
  createdAt: r.created_at,
  dispensedAt: r.dispensed_at ?? null,
  cancelReason: r.cancel_reason ?? null,
  // For a pending prescription: can the pharmacy fill it from current stock?
  inStock: r.status === "Pending" ? Number(r.stock_qty) >= Number(r.quantity) : undefined,
});

export const getPrescription = async (id, conn = direct) => (await q(conn, `${HEAD} WHERE x.id = ?`, [id])).map(rxOut)[0];

export async function listPrescriptions({ status, patientId, prescriberId, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (status) (where.push("x.status = ?"), args.push(status));
  if (patientId) (where.push("x.patient_id = ?"), args.push(patientId));
  if (prescriberId) (where.push("x.prescriber_id = ?"), args.push(prescriberId));
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return (await query(`${HEAD} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ${WORKLIST} LIMIT ${n}`, args)).map(rxOut);
}

/** One prescription row per drug. Nothing is taken from stock or billed until the pharmacy dispenses it. */
export const prescribe = ({ patientId, items }, by) =>
  tx(async (conn) => {
    if (!(await q(conn, "SELECT id FROM patients WHERE id = ?", [patientId])).length) throw bad("That patient isn't registered. Register the patient first.");
    const ids = items.map((i) => i.drugId);
    if (new Set(ids).size !== ids.length) throw bad("The same drug is listed twice. Combine it into one line.");
    const _di = expandIn(ids);
    const drugs = await q(conn, `SELECT id FROM drugs WHERE active = 1 AND id IN ${_di.sql}`, _di.params);
    if (drugs.length !== ids.length) throw bad("One of those drugs isn't on the list, or has been switched off.");
    const created = [];
    for (const i of items) {
      const id = `RX-${await nextCounter(conn, "rx")}`;
      await conn.query("INSERT INTO prescriptions (id, patient_id, prescriber_id, drug_id, dose, frequency, duration, quantity, instructions, status, created_at) VALUES (?,?,?,?,?,?,?,?,?, 'Pending', NOW())", [id, patientId, by.id, i.drugId, i.dose, i.frequency, i.duration || null, i.quantity, i.instructions || null]);
      created.push(id);
    }
    const _ci = expandIn(created);
    return (await q(conn, `${HEAD} WHERE x.id IN ${_ci.sql} ORDER BY x.id`, _ci.params)).map(rxOut);
  });

/** Dispenses a pending prescription: stock out, movement written, bill charged, all or nothing. */
export const dispense = (id, by) =>
  tx(async (conn) => {
    const [rx] = await q(conn, "SELECT id, patient_id, drug_id, quantity, status FROM prescriptions WHERE id = ? FOR UPDATE", [id]);
    if (!rx) throw notFound("Prescription not found.");
    if (rx.status !== "Pending") throw conflict(`A ${rx.status.toLowerCase()} prescription can't be dispensed.`);
    const [drug] = await q(conn, "SELECT * FROM drugs WHERE id = ? FOR UPDATE", [rx.drug_id]);
    if (!drug.active) throw conflict("This drug has been switched off. Ask the prescriber to change the prescription.");
    const qty = Number(rx.quantity);
    if (Number(drug.stock_qty) < qty) throw conflict(`Only ${drug.stock_qty} of ${drugLabel(drug)} in stock; ${qty} needed.`, { code: "out_of_stock", inStock: Number(drug.stock_qty), needed: qty });

    const balance = Number(drug.stock_qty) - qty;
    await conn.query("UPDATE drugs SET stock_qty = ? WHERE id = ?", [balance, drug.id]);
    await movement(conn, { drugId: drug.id, delta: -qty, balance, reason: "Dispensed", ref: id, by });
    await conn.query("UPDATE prescriptions SET status = 'Dispensed', dispensed_by = ?, dispensed_at = NOW() WHERE id = ?", [by.id, id]);
    const charged = await addCharges({ id: rx.patient_id }, `rx:${id}`, [{ description: drugLabel(drug), qty, unitPrice: Number(drug.unit_price) }], { createdBy: by.id, conn });
    return { prescription: await getPrescription(id, conn), charged: charged ? { invoiceId: charged.invoiceId, amount: charged.amount } : null, lowStock: balance <= Number(drug.reorder_level) };
  });

export async function cancelPrescription(id, reason) {
  return tx(async (conn) => {
    const [rx] = await q(conn, "SELECT id, status FROM prescriptions WHERE id = ? FOR UPDATE", [id]);
    if (!rx) throw notFound("Prescription not found.");
    if (rx.status !== "Pending") throw conflict(`A ${rx.status.toLowerCase()} prescription can't be cancelled.`);
    await conn.query("UPDATE prescriptions SET status = 'Cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?", [reason, id]);
    return getPrescription(id, conn);
  });
}