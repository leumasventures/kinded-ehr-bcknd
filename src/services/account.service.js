// Money accounts, the ledger and payroll.
//
// Every change that moves money runs in one transaction and takes the ledger lock first, so two people recording at the
// same moment queue up. Recorded money is never edited or deleted: a mistake is voided (kept, with who, when and why).
import { query, tx } from "../config/database.js";
import { bad, conflict, notFound } from "../utils/errors.js";
import { lockName, nextCounter, round2, todayISO } from "./ids.js";

// ---------- money accounts ----------
export const accountOut = (r, balance) => ({ id: r.id, name: r.name, kind: r.kind, bankName: r.bank_name, accountNumber: r.account_number, opening: Number(r.opening), openingDate: r.opening_date, active: !!r.active, ...(balance === undefined ? {} : { balance }) });

const effect = (t, accountId) => {
  if (t.void_at) return 0;
  const amt = Number(t.amount);
  if (t.type === "Income") return t.account_id === accountId ? amt : 0;
  if (t.type === "Expense") return t.account_id === accountId ? -amt : 0;
  if (t.account_id === accountId) return -amt;
  return t.to_account_id === accountId ? amt : 0;
};

export async function listAccounts() {
  const accts = await query("SELECT * FROM money_accounts ORDER BY active DESC, name");
  const txns = await query("SELECT * FROM transactions WHERE void_at IS NULL");
  return accts.map((a) => accountOut(a, round2(Number(a.opening) + txns.filter((t) => t.txn_date >= a.opening_date).reduce((s, t) => s + effect(t, a.id), 0))));
}
export const getAccountRow = async (id, conn = null) => (conn ? (await conn.query("SELECT * FROM money_accounts WHERE id = ?", [id]))[0][0] : (await query("SELECT * FROM money_accounts WHERE id = ?", [id]))[0]);

export async function createAccount(d) {
  if ((await query("SELECT id FROM money_accounts WHERE name = ?", [d.name])).length) throw conflict("You already have an account with this name.");
  const id = await tx(async (conn) => {
    const id = `ACC-${String(await nextCounter(conn, "money_account", 0)).padStart(2, "0")}`;
    await conn.query("INSERT INTO money_accounts (id, name, kind, bank_name, account_number, opening, opening_date, active) VALUES (?,?,?,?,?,?,?,?)", [id, d.name, d.kind, d.bankName, d.accountNumber, d.opening, d.openingDate, d.active ? 1 : 0]);
    return id;
  });
  return accountOut(await getAccountRow(id));
}

export async function updateAccount(row, d) {
  if (d.name && d.name !== row.name && (await query("SELECT id FROM money_accounts WHERE name = ? AND id <> ?", [d.name, row.id])).length) throw conflict("You already have an account with this name.");
  const sets = [];
  const vals = [];
  for (const [k, col] of [["name", "name"], ["bankName", "bank_name"], ["accountNumber", "account_number"]]) if (d[k] !== undefined) (sets.push(`${col} = ?`), vals.push(d[k]));
  if (d.active !== undefined) (sets.push("active = ?"), vals.push(d.active ? 1 : 0));
  if (sets.length) await query(`UPDATE money_accounts SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  return accountOut(await getAccountRow(row.id));
}

// ---------- transactions ----------
export const txnOut = (r) => ({
  id: r.id, date: r.txn_date, type: r.type, category: r.category, description: r.description, party: r.party, reference: r.reference, amount: Number(r.amount),
  accountId: r.account_id, toAccountId: r.to_account_id ?? undefined, source: r.source, recordedBy: r.recorded_by, recordedAt: new Date(r.recorded_at).getTime(),
  voided: r.void_at ? { at: new Date(r.void_at).getTime(), by: r.void_by, reason: r.void_reason } : undefined,
});

export async function listTxns({ from, to, accountId, type, includeVoided = true, limit = 500 } = {}) {
  const where = [];
  const args = [];
  if (from) (where.push("txn_date >= ?"), args.push(from));
  if (to) (where.push("txn_date <= ?"), args.push(to));
  if (accountId) (where.push("(account_id = ? OR to_account_id = ?)"), args.push(accountId, accountId));
  if (type) (where.push("type = ?"), args.push(type));
  if (!includeVoided) where.push("void_at IS NULL");
  const rows = await query(`SELECT * FROM transactions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY txn_date DESC, recorded_at DESC, id DESC LIMIT ${Math.min(Math.max(Number(limit) || 500, 1), 2000)}`, args);
  return rows.map(txnOut);
}
export const getTxnRow = async (id) => (await query("SELECT * FROM transactions WHERE id = ?", [id]))[0];

/** Writes one ledger row. `conn` is the caller's transaction, so payroll can post its expense atomically. */
export async function insertTxn(conn, t, byName) {
  const [acct] = await conn.query("SELECT * FROM money_accounts WHERE id = ?", [t.accountId]);
  if (!acct.length) throw notFound("That account doesn't exist.");
  if (!acct[0].active) throw conflict(`${acct[0].name} is switched off. Turn it on or choose another account.`);
  if (t.date < acct[0].opening_date) throw bad(`${acct[0].name} was opened on ${acct[0].opening_date}. A transaction can't be dated before that.`);
  if (t.date > todayISO()) throw bad("The date can't be in the future.");
  if (t.type === "Transfer") {
    if (t.toAccountId === t.accountId) throw bad("Choose two different accounts.");
    const [to] = await conn.query("SELECT * FROM money_accounts WHERE id = ?", [t.toAccountId]);
    if (!to.length) throw notFound("The account it goes to doesn't exist.");
    if (!to[0].active) throw conflict(`${to[0].name} is switched off.`);
    if (t.date < to[0].opening_date) throw bad(`${to[0].name} was opened on ${to[0].opening_date}. A transaction can't be dated before that.`);
  }
  const id = `TXN-${await nextCounter(conn, "transaction", 1000)}`;
  await conn.query("INSERT INTO transactions (id, txn_date, type, category, description, party, reference, amount, account_id, to_account_id, source, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
    id, t.date, t.type, t.category ?? (t.type === "Transfer" ? "Transfer" : ""), t.description ?? "", t.party ?? "", t.reference ?? "", round2(t.amount), t.accountId, t.type === "Transfer" ? t.toAccountId : null, t.source ?? "manual", byName,
  ]);
  return id;
}

export async function createTxn(t, by) {
  const id = await tx(async (conn) => {
    await lockName(conn, "ledger");
    return insertTxn(conn, t, by.name);
  });
  return txnOut(await getTxnRow(id));
}

export async function voidTxn(id, reason, by) {
  await tx(async (conn) => {
    await lockName(conn, "ledger");
    const [[t]] = await conn.query("SELECT * FROM transactions WHERE id = ? FOR UPDATE", [id]);
    if (!t) throw notFound("Transaction not found.");
    if (t.void_at) throw conflict("This transaction has already been voided.");
    if (t.source === "payroll") throw conflict("A payroll payment can't be voided here. It belongs to a payroll run.");
    await conn.query("UPDATE transactions SET void_at = ?, void_by = ?, void_reason = ? WHERE id = ?", [new Date(), by.name, reason, id]);
  });
  return txnOut(await getTxnRow(id));
}

/** Money in, money out and the net, by month, over live transactions only. Transfers are neither. Billing receipts are listed on their own line. */
export async function summary({ from, to }) {
  const txnRows = await query("SELECT DATE_FORMAT(txn_date, '%Y-%m') AS m, type, SUM(amount) AS total FROM transactions WHERE void_at IS NULL AND txn_date BETWEEN ? AND ? AND type <> 'Transfer' GROUP BY m, type", [from, to]);
  const billing = await query("SELECT DATE_FORMAT(pay_date, '%Y-%m') AS m, SUM(amount) AS total FROM payments WHERE pay_date BETWEEN ? AND ? GROUP BY m", [from, to]);
  const months = new Map();
  const slot = (m) => months.get(m) ?? months.set(m, { month: m, income: 0, expense: 0, billingReceipts: 0 }).get(m);
  for (const r of txnRows) slot(r.m)[r.type === "Income" ? "income" : "expense"] = round2(r.total);
  for (const r of billing) slot(r.m).billingReceipts = round2(r.total);
  const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, net: round2(m.income - m.expense) }));
  return { months: list, accounts: await listAccounts() };
}

// ---------- employees ----------
export const employeeOut = (r) => ({ id: r.id, name: r.name, title: r.title, department: r.department, bankName: r.bank_name, accountNumber: r.account_number, basic: Number(r.basic), housing: Number(r.housing), transport: Number(r.transport), otherAllowance: Number(r.other_allowance), pensionPct: Number(r.pension_pct), paye: Number(r.paye), otherDeduction: Number(r.other_deduction), active: !!r.active });
export const listEmployees = async () => (await query("SELECT * FROM employees ORDER BY active DESC, name")).map(employeeOut);
export const getEmployeeRow = async (id) => (await query("SELECT * FROM employees WHERE id = ?", [id]))[0];

export async function createEmployee(d) {
  const id = await tx(async (conn) => {
    const id = `EMP-${String(await nextCounter(conn, "employee", 0)).padStart(2, "0")}`;
    await conn.query("INSERT INTO employees (id, name, title, department, bank_name, account_number, basic, housing, transport, other_allowance, pension_pct, paye, other_deduction, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [id, d.name, d.title, d.department, d.bankName, d.accountNumber, d.basic, d.housing, d.transport, d.otherAllowance, d.pensionPct, d.paye, d.otherDeduction, d.active ? 1 : 0]);
    return id;
  });
  return employeeOut(await getEmployeeRow(id));
}
export async function updateEmployee(row, d) {
  const map = { name: "name", title: "title", department: "department", bankName: "bank_name", accountNumber: "account_number", basic: "basic", housing: "housing", transport: "transport", otherAllowance: "other_allowance", pensionPct: "pension_pct", paye: "paye", otherDeduction: "other_deduction" };
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) (sets.push(`${col} = ?`), vals.push(d[k]));
  if (d.active !== undefined) (sets.push("active = ?"), vals.push(d.active ? 1 : 0));
  if (sets.length) await query(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  return employeeOut(await getEmployeeRow(row.id));
}
/** An employee who appears in a payroll run is kept for the record: switch them off instead. */
export async function deleteEmployee(row) {
  if (Number((await query("SELECT COUNT(*) AS n FROM payroll_lines WHERE employee_id = ?", [row.id]))[0].n) > 0) throw conflict("This employee is in a payroll run. Switch them off instead of deleting.");
  await query("DELETE FROM employees WHERE id = ?", [row.id]);
}

// ---------- payroll ----------
export function payLine(e, bonus = 0) {
  const allowances = round2(Number(e.housing) + Number(e.transport) + Number(e.other_allowance));
  const gross = round2(Number(e.basic) + allowances + bonus);
  const pension = round2(((Number(e.basic) + Number(e.housing) + Number(e.transport)) * Number(e.pension_pct)) / 100);
  const paye = Number(e.paye);
  const other = Number(e.other_deduction);
  return { employeeId: e.id, name: e.name, title: e.title, basic: Number(e.basic), allowances, bonus, gross, pension, paye, other, net: round2(gross - pension - paye - other) };
}
const sum = (lines, k) => round2(lines.reduce((s, l) => s + l[k], 0));
export const runTotals = (lines) => ({ gross: sum(lines, "gross"), pension: sum(lines, "pension"), paye: sum(lines, "paye"), other: sum(lines, "other"), net: sum(lines, "net") });

export const runOut = (r, lines) => {
  const ls = lines.map((l) => ({ employeeId: l.employee_id, name: l.name, title: l.title, basic: Number(l.basic), allowances: Number(l.allowances), bonus: Number(l.bonus), gross: Number(l.gross), pension: Number(l.pension), paye: Number(l.paye), other: Number(l.other), net: Number(l.net) }));
  return { id: r.id, month: r.month, status: r.status, paidOn: r.paid_on ?? undefined, paidFromAccountId: r.paid_from_account ?? undefined, paidBy: r.paid_by ?? undefined, txnId: r.txn_id ?? undefined, remittedOn: r.remitted_on ?? undefined, remittanceTxnId: r.remittance_txn_id ?? undefined, lines: ls, totals: runTotals(ls) };
};
export async function listRuns() {
  const runs = await query("SELECT * FROM payroll_runs ORDER BY month DESC");
  if (!runs.length) return [];
  const lines = await query("SELECT * FROM payroll_lines WHERE run_id IN (?) ORDER BY id", [runs.map((r) => r.id)]);
  return runs.map((r) => runOut(r, lines.filter((l) => l.run_id === r.id)));
}
export const getRun = async (id) => (await listRuns()).find((r) => r.id === id);

/** Builds (or rebuilds) the draft for a month from the active employees. A paid month can't be touched. */
export async function prepareRun(month, bonuses = {}) {
  const id = `PAY-${month}`;
  await tx(async (conn) => {
    await lockName(conn, "payroll");
    const [[run]] = await conn.query("SELECT * FROM payroll_runs WHERE month = ? FOR UPDATE", [month]);
    if (run?.status === "Paid") throw conflict(`${month} has already been paid and can't be changed.`);
    const [emps] = await conn.query("SELECT * FROM employees WHERE active = 1 ORDER BY name");
    if (!emps.length) throw bad("Add at least one active employee first.");
    if (!run) await conn.query("INSERT INTO payroll_runs (id, month) VALUES (?,?)", [id, month]);
    await conn.query("DELETE FROM payroll_lines WHERE run_id = ?", [id]);
    for (const e of emps) {
      const l = payLine(e, round2(bonuses[e.id] ?? 0));
      if (l.net < 0) throw bad(`${e.name}'s deductions are more than their pay. Check their salary details.`);
      await conn.query("INSERT INTO payroll_lines (run_id, employee_id, name, title, basic, allowances, bonus, gross, pension, paye, other, net) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [id, e.id, l.name, l.title, l.basic, l.allowances, l.bonus, l.gross, l.pension, l.paye, l.other, l.net]);
    }
  });
  return getRun(id);
}

/** Pays the run: one "Salaries & wages" expense for the total net pay, posted in the same transaction as the status change. */
export async function payRun(id, { accountId, date = todayISO() }, by) {
  await tx(async (conn) => {
    await lockName(conn, "ledger");
    const [[run]] = await conn.query("SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE", [id]);
    if (!run) throw notFound("Payroll run not found.");
    if (run.status === "Paid") throw conflict("This month has already been paid.");
    const [lines] = await conn.query("SELECT * FROM payroll_lines WHERE run_id = ?", [id]);
    if (!lines.length) throw bad("This run has no lines.");
    const net = round2(lines.reduce((s, l) => s + Number(l.net), 0));
    const txnId = await insertTxn(conn, { type: "Expense", category: "Salaries & wages", description: `Salaries for ${run.month}`, party: "Staff", reference: id, amount: net, accountId, date, source: "payroll" }, by.name);
    await conn.query("UPDATE payroll_runs SET status = 'Paid', paid_on = ?, paid_from_account = ?, paid_by = ?, txn_id = ? WHERE id = ?", [date, accountId, by.name, txnId, id]);
  });
  return getRun(id);
}

/** Pays over what was held back from staff (pension and PAYE) as one "Taxes, pension & levies" expense. Only once per month. */
export async function remitRun(id, { accountId, date = todayISO() }, by) {
  await tx(async (conn) => {
    await lockName(conn, "ledger");
    const [[run]] = await conn.query("SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE", [id]);
    if (!run) throw notFound("Payroll run not found.");
    if (run.status !== "Paid") throw conflict("Pay the salaries before remitting the deductions.");
    if (run.remitted_on) throw conflict("The deductions for this month have already been remitted.");
    const [lines] = await conn.query("SELECT pension, paye FROM payroll_lines WHERE run_id = ?", [id]);
    const total = round2(lines.reduce((s, l) => s + Number(l.pension) + Number(l.paye), 0));
    if (!(total > 0)) throw bad("There is nothing to remit for this month.");
    const txnId = await insertTxn(conn, { type: "Expense", category: "Taxes, pension & levies", description: `Pension and PAYE for ${run.month}`, party: "Pension & tax authorities", reference: id, amount: total, accountId, date, source: "payroll" }, by.name);
    await conn.query("UPDATE payroll_runs SET remitted_on = ?, remittance_txn_id = ? WHERE id = ?", [date, txnId, id]);
  });
  return getRun(id);
}
