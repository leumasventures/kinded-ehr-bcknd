// Read-only summaries over the whole system. Nothing here changes data, and the results are totals and counts, not
// individual clinical records, so there is nothing to audit. Money is added up in SQL with the same rounding steps as
// calcTotals in billing.service.js (see INVOICE_TOTALS), so a report and an invoice screen agree to the cent.
import { query } from "../config/database.js";

export const m = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const n = (v) => Number(v ?? 0);

/**
 * Every invoice with its total and amount paid, as a derived table with columns:
 * id, patient_id, inv_date, due_date, total, paid.   Use it as:  FROM ${INVOICE_TOTALS} t
 * total = taxable + VAT, where subtotal = sum of lines, discount is capped at the subtotal, VAT is rounded to cents.
 */
export const INVOICE_TOTALS = `(
  SELECT i.id, i.patient_id, i.inv_date, i.due_date,
         ROUND(b.taxable + ROUND(b.taxable * i.vat_rate / 100, 2), 2) AS total,
         COALESCE(py.paid, 0) AS paid
    FROM invoices i
    JOIN (
      SELECT s.invoice_id, ROUND(s.subtotal - LEAST(v.discount, s.subtotal), 2) AS taxable
        FROM (SELECT invoice_id, ROUND(SUM(qty * unit_price), 2) AS subtotal FROM invoice_items GROUP BY invoice_id) s
        JOIN invoices v ON v.id = s.invoice_id
    ) b ON b.invoice_id = i.id
    LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) py ON py.invoice_id = i.id
)`;

const dayEnd = "DATE_ADD(?, INTERVAL 1 DAY)"; // for DATETIME columns: >= from AND < day after "to"

// ---------- money ----------

export async function revenue(from, to) {
  const [billed] = await query(`SELECT COUNT(*) AS invoices, COALESCE(SUM(t.total), 0) AS amount FROM ${INVOICE_TOTALS} t WHERE t.inv_date BETWEEN ? AND ?`, [from, to]);
  const byMethod = await query("SELECT method, COUNT(*) AS payments, SUM(amount) AS total FROM payments WHERE pay_date BETWEEN ? AND ? GROUP BY method ORDER BY total DESC", [from, to]);
  const byDay = await query("SELECT DATE_FORMAT(pay_date, '%Y-%m-%d') AS day, SUM(amount) AS total FROM payments WHERE pay_date BETWEEN ? AND ? GROUP BY pay_date ORDER BY pay_date", [from, to]);
  return {
    from,
    to,
    billed: { invoices: n(billed.invoices), amount: m(billed.amount) },
    collected: {
      total: m(byMethod.reduce((s, r) => s + n(r.total), 0)),
      byMethod: byMethod.map((r) => ({ method: r.method, payments: n(r.payments), total: m(r.total) })),
      byDay: byDay.map((r) => ({ day: r.day, total: m(r.total) })),
    },
  };
}

const BUCKETS = ["Not yet due", "1-30 days", "31-60 days", "61-90 days", "Over 90 days"];

/** What is owed right now, by how late it is. */
export async function receivables(asOf) {
  const rows = await query(
    `SELECT CASE WHEN t.due_date >= ? THEN 'Not yet due'
                 WHEN DATEDIFF(?, t.due_date) <= 30 THEN '1-30 days'
                 WHEN DATEDIFF(?, t.due_date) <= 60 THEN '31-60 days'
                 WHEN DATEDIFF(?, t.due_date) <= 90 THEN '61-90 days'
                 ELSE 'Over 90 days' END AS bucket,
            COUNT(*) AS invoices, SUM(t.total - t.paid) AS owed
       FROM ${INVOICE_TOTALS} t WHERE t.total > t.paid GROUP BY bucket`,
    [asOf, asOf, asOf, asOf]
  );
  const by = new Map(rows.map((r) => [r.bucket, r]));
  const buckets = BUCKETS.map((b) => ({ bucket: b, invoices: n(by.get(b)?.invoices), owed: m(by.get(b)?.owed) }));
  const debtors = await query(
    `SELECT t.patient_id, p.name, COUNT(*) AS invoices, SUM(t.total - t.paid) AS owed
       FROM ${INVOICE_TOTALS} t JOIN patients p ON p.id = t.patient_id
      WHERE t.total > t.paid GROUP BY t.patient_id, p.name ORDER BY owed DESC LIMIT 10`
  );
  return {
    asOf,
    total: m(buckets.reduce((s, b) => s + b.owed, 0)),
    buckets,
    topDebtors: debtors.map((r) => ({ patientId: r.patient_id, patient: r.name, invoices: n(r.invoices), owed: m(r.owed) })),
  };
}

/** Claims created in the range, by payer and status. */
export async function claims(from, to) {
  const rows = await query(
    `SELECT c.payer, c.status, COUNT(*) AS claims, COALESCE(SUM(l.total), 0) AS claimed, COALESCE(SUM(c.approved_amount), 0) AS approved, COALESCE(SUM(c.received_amount), 0) AS received
       FROM claims c LEFT JOIN (SELECT claim_id, SUM(amount) AS total FROM claim_lines GROUP BY claim_id) l ON l.claim_id = c.id
      WHERE c.created_at >= ? AND c.created_at < ${dayEnd}
      GROUP BY c.payer, c.status ORDER BY c.payer, c.status`,
    [from, to]
  );
  const payers = new Map();
  for (const r of rows) {
    const p = payers.get(r.payer) ?? { payer: r.payer, claims: 0, claimed: 0, approved: 0, received: 0, byStatus: {} };
    p.claims += n(r.claims);
    p.claimed = m(p.claimed + n(r.claimed));
    p.approved = m(p.approved + n(r.approved));
    p.received = m(p.received + n(r.received));
    p.byStatus[r.status] = n(r.claims);
    payers.set(r.payer, p);
  }
  const list = [...payers.values()];
  return { from, to, totals: { claims: list.reduce((s, p) => s + p.claims, 0), claimed: m(list.reduce((s, p) => s + p.claimed, 0)), approved: m(list.reduce((s, p) => s + p.approved, 0)), received: m(list.reduce((s, p) => s + p.received, 0)) }, payers: list };
}

// ---------- clinical activity ----------

export async function admissions(from, to) {
  const [admitted] = await query(`SELECT COUNT(*) AS n FROM admissions WHERE admitted_at >= ? AND admitted_at < ${dayEnd}`, [from, to]);
  const [discharged] = await query(`SELECT COUNT(*) AS n, AVG(TIMESTAMPDIFF(HOUR, admitted_at, discharged_at)) / 24 AS days FROM admissions WHERE discharged_at >= ? AND discharged_at < ${dayEnd}`, [from, to]);
  const [now] = await query("SELECT COUNT(*) AS n FROM admissions WHERE status = 'Admitted'");
  const byWard = await query(`SELECT COALESCE(ward, 'Unassigned') AS ward, COUNT(*) AS n FROM admissions WHERE admitted_at >= ? AND admitted_at < ${dayEnd} GROUP BY ward ORDER BY ward`, [from, to]);
  const outcomes = await query(`SELECT COALESCE(outcome, 'Not recorded') AS outcome, COUNT(*) AS n FROM admissions WHERE discharged_at >= ? AND discharged_at < ${dayEnd} GROUP BY outcome ORDER BY n DESC`, [from, to]);
  return {
    from,
    to,
    admitted: n(admitted.n),
    discharged: n(discharged.n),
    averageStayDays: discharged.days == null ? null : Math.round(Number(discharged.days) * 10) / 10,
    inHospitalNow: n(now.n),
    admittedByWard: byWard.map((r) => ({ ward: r.ward, admitted: n(r.n) })),
    outcomes: outcomes.map((r) => ({ outcome: r.outcome, patients: n(r.n) })),
  };
}

export async function appointments(from, to) {
  const rows = await query("SELECT doctor, status, COUNT(*) AS n FROM appointments WHERE appt_date BETWEEN ? AND ? GROUP BY doctor, status", [from, to]);
  const byStatus = {};
  const doctors = new Map();
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + n(r.n);
    const d = doctors.get(r.doctor) ?? { doctor: r.doctor, total: 0, byStatus: {} };
    d.total += n(r.n);
    d.byStatus[r.status] = n(r.n);
    doctors.set(r.doctor, d);
  }
  const byDay = await query("SELECT DATE_FORMAT(appt_date, '%Y-%m-%d') AS day, COUNT(*) AS n FROM appointments WHERE appt_date BETWEEN ? AND ? GROUP BY appt_date ORDER BY appt_date", [from, to]);
  return {
    from,
    to,
    total: Object.values(byStatus).reduce((s, v) => s + v, 0),
    byStatus,
    byDoctor: [...doctors.values()].sort((a, b) => b.total - a.total),
    byDay: byDay.map((r) => ({ day: r.day, appointments: n(r.n) })),
  };
}

export async function laboratory(from, to) {
  const inRange = `o.ordered_at >= ? AND o.ordered_at < ${dayEnd}`;
  const byStatus = await query(`SELECT o.status, COUNT(*) AS n FROM lab_orders o WHERE ${inRange} GROUP BY o.status`, [from, to]);
  const byPriority = await query(`SELECT o.priority, COUNT(*) AS n FROM lab_orders o WHERE ${inRange} AND o.status <> 'Cancelled' GROUP BY o.priority`, [from, to]);
  const [speed] = await query(`SELECT AVG(TIMESTAMPDIFF(MINUTE, o.ordered_at, o.resulted_at)) AS from_order, AVG(TIMESTAMPDIFF(MINUTE, o.collected_at, o.resulted_at)) AS from_collection FROM lab_orders o WHERE ${inRange} AND o.resulted_at IS NOT NULL`, [from, to]);
  const [critical] = await query(`SELECT COUNT(DISTINCT o.id) AS n FROM lab_orders o JOIN lab_order_tests t ON t.order_id = o.id WHERE ${inRange} AND t.flag = 'Critical'`, [from, to]);
  const top = await query(`SELECT t.code, t.name, COUNT(*) AS n FROM lab_order_tests t JOIN lab_orders o ON o.id = t.order_id WHERE ${inRange} AND o.status <> 'Cancelled' GROUP BY t.code, t.name ORDER BY n DESC LIMIT 15`, [from, to]);
  const mins = (v) => (v == null ? null : Math.round(Number(v)));
  return {
    from,
    to,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, n(r.n)])),
    byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, n(r.n)])),
    averageMinutes: { orderToResult: mins(speed.from_order), collectionToResult: mins(speed.from_collection) },
    ordersWithCriticalResult: n(critical.n),
    topTests: top.map((r) => ({ code: r.code, test: r.name, ordered: n(r.n) })),
  };
}

export async function pharmacy(from, to) {
  // The value comes from the invoice line that dispensing created (source "rx:<id>"), so it is what the patient was charged.
  const dispensed = await query(
    `SELECT g.name, g.strength, g.form, SUM(x.quantity) AS quantity, COALESCE(SUM(ii.qty * ii.unit_price), 0) AS value
       FROM prescriptions x JOIN drugs g ON g.id = x.drug_id LEFT JOIN invoice_items ii ON ii.source = CONCAT('rx:', x.id)
      WHERE x.status = 'Dispensed' AND x.dispensed_at >= ? AND x.dispensed_at < ${dayEnd}
      GROUP BY g.id, g.name, g.strength, g.form ORDER BY quantity DESC LIMIT 20`,
    [from, to]
  );
  const low = await query("SELECT name, strength, form, stock_qty, reorder_level FROM drugs WHERE active = 1 AND stock_qty <= reorder_level ORDER BY stock_qty, name");
  const label = (r) => [r.name, r.strength, r.form].filter(Boolean).join(" ");
  return {
    from,
    to,
    dispensed: dispensed.map((r) => ({ drug: label(r), quantity: n(r.quantity), value: m(r.value) })),
    totalValue: m(dispensed.reduce((s, r) => s + n(r.value), 0)),
    lowStock: low.map((r) => ({ drug: label(r), inStock: n(r.stock_qty), reorderLevel: n(r.reorder_level) })),
  };
}