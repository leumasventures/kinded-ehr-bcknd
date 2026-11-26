import { bad, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import * as svc from "../services/account.service.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const money = (n) => Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- money accounts ----
export const listAccounts = wrap(async (_req, res) => res.json({ accounts: await svc.listAccounts() }));
export const createAccount = wrap(async (req, res) => {
  const account = await svc.createAccount(req.body);
  await audit(req, { action: "Create", module: "Accounts", summary: `Opened money account ${account.name} (${account.id}), opening balance ${money(account.opening)}` });
  res.status(201).json({ account });
});
export const updateAccount = wrap(async (req, res) => {
  const row = await svc.getAccountRow(req.params.id);
  if (!row) throw notFound("Account not found.");
  const account = await svc.updateAccount(row, req.body);
  await audit(req, { action: "Update", module: "Accounts", summary: `Updated money account ${row.name} (${row.id}): ${Object.keys(req.body).join(", ")}` });
  res.json({ account });
});

// ---- ledger ----
export const listTxns = wrap(async (req, res) => {
  const { from, to, accountId, type } = req.query;
  res.json({ txns: await svc.listTxns({ from: isDay(from) ? from : undefined, to: isDay(to) ? to : undefined, accountId: accountId ? String(accountId).slice(0, 20) : undefined, type: ["Income", "Expense", "Transfer"].includes(String(type)) ? String(type) : undefined, limit: req.query.limit }) });
});
export const createTxn = wrap(async (req, res) => {
  const txn = await svc.createTxn(req.body, req.user);
  await audit(req, { action: "Create", module: "Accounts", summary: `Recorded ${txn.type.toLowerCase()} ${txn.id}: ${money(txn.amount)}${txn.category ? ` (${txn.category})` : ""}` });
  res.status(201).json({ txn });
});
export const voidTxn = wrap(async (req, res) => {
  const txn = await svc.voidTxn(req.params.id, req.body.reason, req.user);
  await audit(req, { action: "Void", module: "Accounts", summary: `Voided ${txn.type.toLowerCase()} ${txn.id} of ${money(txn.amount)}: ${req.body.reason}` });
  res.json({ txn });
});
export const summary = wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!isDay(from) || !isDay(to)) throw bad("Give the period as ?from=YYYY-MM-DD&to=YYYY-MM-DD.");
  res.json(await svc.summary({ from, to }));
});

// ---- employees ----
export const listEmployees = wrap(async (_req, res) => res.json({ employees: await svc.listEmployees() }));
export const createEmployee = wrap(async (req, res) => {
  const employee = await svc.createEmployee(req.body);
  await audit(req, { action: "Create", module: "Accounts", summary: `Added employee ${employee.name} (${employee.id}) to payroll` }); // pay details stay out of the log
  res.status(201).json({ employee });
});
export const updateEmployee = wrap(async (req, res) => {
  const row = await svc.getEmployeeRow(req.params.id);
  if (!row) throw notFound("Employee not found.");
  const employee = await svc.updateEmployee(row, req.body);
  await audit(req, { action: "Update", module: "Accounts", summary: `Updated payroll details of ${row.name} (${row.id}): ${Object.keys(req.body).join(", ")}` });
  res.json({ employee });
});
export const deleteEmployee = wrap(async (req, res) => {
  const row = await svc.getEmployeeRow(req.params.id);
  if (!row) throw notFound("Employee not found.");
  await svc.deleteEmployee(row);
  await audit(req, { action: "Delete", module: "Accounts", summary: `Removed employee ${row.name} (${row.id}) from payroll` });
  res.json({ ok: true });
});

// ---- payroll ----
export const listRuns = wrap(async (_req, res) => res.json({ runs: await svc.listRuns() }));
export const prepareRun = wrap(async (req, res) => {
  const run = await svc.prepareRun(req.body.month, req.body.bonuses);
  await audit(req, { action: "Create", module: "Accounts", summary: `Prepared payroll for ${run.month}: ${run.lines.length} employees, net ${money(run.totals.net)}` });
  res.status(201).json({ run });
});
export const payRun = wrap(async (req, res) => {
  const run = await svc.payRun(req.params.id, req.body, req.user);
  await audit(req, { action: "Payment", module: "Accounts", summary: `Paid salaries for ${run.month}: ${money(run.totals.net)} (${run.txnId})` });
  res.json({ run });
});
export const remitRun = wrap(async (req, res) => {
  const run = await svc.remitRun(req.params.id, req.body, req.user);
  await audit(req, { action: "Payment", module: "Accounts", summary: `Remitted pension and PAYE for ${run.month}: ${money(run.totals.pension + run.totals.paye)} (${run.remittanceTxnId})` });
  res.json({ run });
});
