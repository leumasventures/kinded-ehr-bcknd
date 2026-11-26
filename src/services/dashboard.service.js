// The numbers on the home screen. Two views so each can sit behind its own guard: operations (no money) and finance.
// Everything is a count or a total, never a patient record.
// Each query is isolated so a missing table or partial migrate still returns the rest of the overview.
import { query } from "../config/database.js";
import { INVOICE_TOTALS, m } from "./report.service.js";

const n = (v) => Number(v ?? 0);
const one = async (sql, params = []) => (await query(sql, params))[0];

async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[dashboard] ${label}:`, e?.message || e);
    return fallback;
  }
}

export async function operations(today) {
  const [patients, appts, admitted, wards, labs, rx, stock, duty] = await Promise.all([
    safe("patients", () => one("SELECT COUNT(*) AS n FROM patients"), { n: 0 }),
    safe(
      "appointments",
      () => query("SELECT status, COUNT(*) AS n FROM appointments WHERE appt_date = ? GROUP BY status", [today]),
      []
    ),
    safe("admitted", () => one("SELECT COUNT(*) AS n FROM admissions WHERE status = 'Admitted'"), { n: 0 }),
    safe(
      "wards",
      () =>
        query(
          "SELECT COALESCE(ward, 'Unassigned') AS ward, COUNT(*) AS occupied FROM admissions WHERE status = 'Admitted' GROUP BY ward ORDER BY ward"
        ),
      []
    ),
    safe(
      "labs",
      () =>
        one(
          `SELECT COALESCE(SUM(CASE WHEN o.status = 'Ordered' THEN 1 ELSE 0 END), 0) AS waiting_collection,
                  COALESCE(SUM(CASE WHEN o.status = 'Collected' THEN 1 ELSE 0 END), 0) AS waiting_results,
                  COALESCE(SUM(CASE WHEN o.status = 'Resulted' AND o.reviewed_at IS NULL THEN 1 ELSE 0 END), 0) AS unreviewed,
                  COALESCE(SUM(CASE WHEN o.status = 'Resulted' AND o.reviewed_at IS NULL AND EXISTS (
                    SELECT 1 FROM lab_order_tests t WHERE t.order_id = o.id AND t.flag = 'Critical'
                  ) THEN 1 ELSE 0 END), 0) AS critical_unreviewed
             FROM lab_orders o WHERE o.status IN ('Ordered', 'Collected', 'Resulted')`
        ),
      { waiting_collection: 0, waiting_results: 0, unreviewed: 0, critical_unreviewed: 0 }
    ),
    safe("prescriptions", () => one("SELECT COUNT(*) AS n FROM prescriptions WHERE status = 'Pending'"), { n: 0 }),
    safe("stock", () => one("SELECT COUNT(*) AS n FROM drugs WHERE active = 1 AND stock_qty <= reorder_level"), { n: 0 }),
    safe(
      "duty",
      () =>
        query(
          "SELECT r.shift, COUNT(*) AS n FROM duty_roster r JOIN users u ON u.id = r.staff_id WHERE r.shift_date = ? AND u.active = 1 GROUP BY r.shift",
          [today]
        ),
      []
    ),
  ]);

  const byStatus = Object.fromEntries((appts || []).map((r) => [r.status, n(r.n)]));
  return {
    date: today,
    patients: n(patients?.n),
    appointmentsToday: { total: Object.values(byStatus).reduce((s, v) => s + v, 0), byStatus },
    admitted: {
      total: n(admitted?.n),
      byWard: (wards || []).map((r) => ({ ward: r.ward, occupied: n(r.occupied) })),
    },
    laboratory: {
      waitingCollection: n(labs?.waiting_collection),
      waitingResults: n(labs?.waiting_results),
      resultsToReview: n(labs?.unreviewed),
      criticalToReview: n(labs?.critical_unreviewed),
    },
    pharmacy: { pendingPrescriptions: n(rx?.n), lowStockDrugs: n(stock?.n) },
    onDutyToday: Object.fromEntries((duty || []).map((r) => [r.shift, n(r.n)])),
  };
}

export async function finance(today) {
  const monthStart = `${today.slice(0, 8)}01`;
  const [billed, collectedToday, collectedMonth, owed, claimRows, submitted] = await Promise.all([
    safe(
      "billed",
      () =>
        one(
          `SELECT COUNT(*) AS invoices, COALESCE(SUM(t.total), 0) AS amount FROM ${INVOICE_TOTALS} t WHERE t.inv_date = ?`,
          [today]
        ),
      { invoices: 0, amount: 0 }
    ),
    safe(
      "collectedToday",
      () => query("SELECT method, SUM(amount) AS total FROM payments WHERE pay_date = ? GROUP BY method ORDER BY total DESC", [today]),
      []
    ),
    safe(
      "collectedMonth",
      () => one("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE pay_date BETWEEN ? AND ?", [monthStart, today]),
      { total: 0 }
    ),
    safe(
      "owed",
      () =>
        one(
          `SELECT COUNT(*) AS invoices, COALESCE(SUM(t.total - t.paid), 0) AS owed,
                  COALESCE(SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_invoices,
                  COALESCE(SUM(CASE WHEN t.due_date < ? THEN t.total - t.paid ELSE 0 END), 0) AS overdue_owed
             FROM ${INVOICE_TOTALS} t WHERE t.total > t.paid`,
          [today, today]
        ),
      { invoices: 0, owed: 0, overdue_invoices: 0, overdue_owed: 0 }
    ),
    safe(
      "claims",
      () =>
        query(
          "SELECT status, COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'Approved' THEN approved_amount - received_amount ELSE 0 END), 0) AS owed FROM claims GROUP BY status"
        ),
      []
    ),
    safe(
      "submitted",
      () =>
        one(
          "SELECT COALESCE(SUM(cl.amount), 0) AS total FROM claim_lines cl JOIN claims c ON c.id = cl.claim_id WHERE c.status = 'Submitted'"
        ),
      { total: 0 }
    ),
  ]);

  const claims = Object.fromEntries((claimRows || []).map((r) => [r.status, n(r.n)]));
  return {
    date: today,
    billedToday: { invoices: n(billed?.invoices), amount: m(billed?.amount) },
    collectedToday: {
      total: m((collectedToday || []).reduce((s, r) => s + n(r.total), 0)),
      byMethod: (collectedToday || []).map((r) => ({ method: r.method, total: m(r.total) })),
    },
    collectedThisMonth: m(collectedMonth?.total),
    outstanding: {
      invoices: n(owed?.invoices),
      amount: m(owed?.owed),
      overdueInvoices: n(owed?.overdue_invoices),
      overdueAmount: m(owed?.overdue_owed),
    },
    claims: {
      byStatus: claims,
      awaitingDecision: m(submitted?.total),
      awaitingPayment: m((claimRows || []).find((r) => r.status === "Approved")?.owed),
    },
  };
}