// Doctors, duty roster, admissions, accounts and payroll, billing and claims over HTTP, and the admin dashboard.
// Runs against a scratch database that it wipes first (its name must contain "test").
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

if (!process.env.TEST_DB_HOST) throw new Error("Set TEST_DB_HOST (and the other TEST_DB_* settings) to a scratch test database.");
process.env.DB_HOST = process.env.TEST_DB_HOST;
process.env.DB_PORT = process.env.TEST_DB_PORT ?? "3306";
process.env.DB_USER = process.env.TEST_DB_USER ?? "root";
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? "";
process.env.DB_NAME = process.env.TEST_DB_NAME ?? "hms_test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-test-secret";
process.env.MIN_PASSWORD_LENGTH = "10";
process.env.LOGIN_RATE_LIMIT = "100000";
if (!/test/i.test(process.env.DB_NAME)) throw new Error("Refusing to run: the test database name must contain 'test'.");

const mysql = (await import("mysql2/promise")).default;
const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/config/database.js");
const { hashPassword } = await import("../src/services/password.service.js");
const { seedRoles } = await import("../src/config/permissions.js");
const { applySchema } = await import("../scripts/applySchema.js");

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
};
const ADMIN = { email: "admin@test.local", password: "Adm1nStrong-Pass" };
let admin;
async function newStaff(name, email, roleId) {
  const c = await api("POST", "/users", { token: admin, body: { name, email, roleId } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const first = (await api("POST", "/auth/login", { body: { email, password: c.body.temporaryPassword } })).body;
  const pw = "Zeta-Orbit-4821-xq";
  const ch = await api("POST", "/auth/change-password", { token: first.accessToken, body: { currentPassword: c.body.temporaryPassword, newPassword: pw } });
  assert.equal(ch.status, 200, JSON.stringify(ch.body));
  return { token: ch.body.accessToken, id: c.body.user.id };
}
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  const [tables] = await db.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await db.query(`DROP TABLE IF EXISTS \`${t}\``);
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
  await applySchema(db);
  for (const r of seedRoles) await db.query("INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?,?,?,?,1)", [r.id, r.name, r.description, JSON.stringify(r.permissions)]);
  await db.query("INSERT INTO users (id, name, email, role_id, active, must_change_password, password_hash) VALUES ('u-admin','Test Admin',?,'r-admin',1,0,?)", [ADMIN.email, await hashPassword(ADMIN.password)]);
  await db.end();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await api("POST", "/auth/login", { body: ADMIN })).body.accessToken;
});
after(async () => {
  server?.close();
  await pool.end();
});

test("doctors: directory, unique names, status, permissions, delete only without history", async () => {
  const nurse = await newStaff("Nurse Mods", "nurse.mods@test.local", "r-nurse");
  const bad1 = await api("POST", "/doctors", { token: admin, body: { name: "Dr. Eze", days: [], start: "08:00", end: "16:00" } });
  assert.equal(bad1.status, 400);
  assert.equal((await api("POST", "/doctors", { token: admin, body: { name: "Dr. Eze", days: [1, 2], start: "16:00", end: "08:00" } })).status, 400, "ends before it starts");
  const c = await api("POST", "/doctors", { token: admin, body: { name: "Dr. Eze", specialty: "Obstetrics", days: [1, 3, 5], start: "08:00", end: "16:00" } });
  assert.equal(c.status, 201);
  assert.equal(c.body.doctor.id, "DR-01");
  assert.deepEqual(c.body.doctor.days, [1, 3, 5]);
  assert.equal((await api("POST", "/doctors", { token: admin, body: { name: "Dr. Eze", days: [1], start: "08:00", end: "16:00" } })).status, 409);
  assert.equal((await api("POST", "/doctors", { token: nurse.token, body: { name: "Dr. Nurse", days: [1], start: "08:00", end: "16:00" } })).status, 403);
  assert.equal((await api("GET", "/doctors", { token: nurse.token })).body.doctors.length, 1, "anyone signed in can read the directory");
  assert.equal((await api("GET", "/doctors")).status, 401);
  const st = await api("POST", "/doctors/DR-01/status", { token: admin, body: { status: "In Surgery" } });
  assert.equal(st.body.doctor.status, "In Surgery");
  assert.equal((await api("POST", "/doctors/DR-01/status", { token: admin, body: { status: "Asleep" } })).status, 400);
  await api("POST", "/doctors", { token: admin, body: { name: "Dr. Obi", days: [2, 4], start: "09:00", end: "15:00" } });
  // A doctor with an appointment can't be deleted or renamed.
  const pat = (await api("POST", "/patients", { token: admin, body: { name: "Doc Patient", dob: "1990-01-01", gender: "Female" } })).body.patient;
  assert.equal((await api("POST", "/appointments", { token: admin, body: { patientId: pat.id, doctor: "Dr. Eze", date: "2030-05-06", time: "09:00", type: "General consultation" } })).status, 201);
  assert.equal((await api("DELETE", "/doctors/DR-01", { token: admin })).status, 409);
  assert.equal((await api("PUT", "/doctors/DR-01", { token: admin, body: { name: "Dr. Renamed" } })).status, 409);
  assert.equal((await api("PUT", "/doctors/DR-01", { token: admin, body: { phone: "0803" } })).body.doctor.phone, "0803");
  assert.equal((await api("DELETE", "/doctors/DR-02", { token: admin })).status, 200);
});

test("duty roster: one shift per person per day, nine-week limit, own shifts for everyone", async () => {
  const nurse = await newStaff("Nurse Roster", "nurse.roster@test.local", "r-nurse");
  const entry = (staffId, date, shift = "Morning") => ({ staffId, date, shift, unit: "General Ward", note: "" });
  const r1 = await api("POST", "/roster", { token: admin, body: { entries: [entry(nurse.id, day(1)), entry(nurse.id, day(2), "Night")] } });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.created.length, 2);
  assert.equal(r1.body.created[0].staffName, "Nurse Roster");
  assert.equal(r1.body.created[0].staffRole, "Nurse");
  assert.equal((await api("POST", "/roster", { token: admin, body: { entries: [entry(nurse.id, day(3)), entry(nurse.id, day(1), "Night")] } })).status, 409, "one clash rejects the lot");
  assert.equal((await api("GET", `/roster?from=${day(3)}&to=${day(3)}`, { token: admin })).body.shifts.length, 0, "and nothing was saved");
  const skip = await api("POST", "/roster", { token: admin, body: { onConflict: "skip", entries: [entry(nurse.id, day(3)), entry(nurse.id, day(1), "Night")] } });
  assert.equal(skip.body.created.length, 1);
  assert.equal(skip.body.skipped.length, 1);
  assert.equal((await api("POST", "/roster", { token: admin, body: { entries: [entry(nurse.id, day(10)), entry(nurse.id, day(80))] } })).status, 400, "more than nine weeks");
  assert.equal((await api("POST", "/roster", { token: admin, body: { entries: [entry(nurse.id, day(5), "Lunch")] } })).status, 400);
  assert.equal((await api("POST", "/roster", { token: admin, body: { entries: [entry("u-nobody", day(5))] } })).status, 404);
  assert.equal((await api("POST", "/roster", { token: nurse.token, body: { entries: [entry(nurse.id, day(6))] } })).status, 403);
  assert.equal((await api("GET", "/roster", { token: nurse.token })).status, 403, "the whole roster needs Roster view");
  assert.equal((await api("GET", "/roster?mine=1", { token: nurse.token })).body.shifts.length, 3, "but your own shifts are always yours");
  const id = r1.body.created[0].id;
  assert.equal((await api("PUT", `/roster/${id}`, { token: admin, body: { shift: "On call" } })).body.shift.shift, "On call");
  assert.equal((await api("DELETE", `/roster/${id}`, { token: admin })).status, 200);
  assert.equal((await api("DELETE", `/roster/${id}`, { token: admin })).status, 404);
});

test("admissions: bed rules, one admission per patient, transfer, discharge, occupancy", async () => {
  const doc = (await api("POST", "/doctors", { token: admin, body: { name: "Dr. Ward", days: [1], start: "08:00", end: "16:00" } })).status;
  assert.equal(doc, 201);
  const mk = async (name) => (await api("POST", "/patients", { token: admin, body: { name, dob: "1980-01-01", gender: "Male" } })).body.patient.id;
  const [p1, p2] = [await mk("Ward One"), await mk("Ward Two")];
  const admit = (patientId, bed = "G-01", extra = {}) => api("POST", "/admissions", { token: admin, body: { patientId, ward: "General Ward", bed, doctor: "Dr. Ward", diagnosis: "Malaria", ...extra } });
  const a1 = await admit(p1);
  assert.equal(a1.status, 201, JSON.stringify(a1.body));
  assert.equal(a1.body.admission.id, "ADM-1001");
  assert.equal((await admit(p2)).status, 409, "bed taken");
  assert.equal((await admit(p1, "G-02")).status, 409, "already admitted");
  assert.equal((await admit(p2, "M-01")).status, 400, "that bed isn't in this ward");
  assert.equal((await admit(p2, "G-02", { doctor: "Dr. Phantom" })).status, 400);
  assert.equal((await admit("P-9999", "G-02")).status, 400);
  assert.equal((await admit(p2, "G-02", { admittedOn: "2999-01-01" })).status, 400);
  // two people racing for the same bed: exactly one wins
  const race = await Promise.all([admit(p2, "G-05"), api("POST", "/admissions", { token: admin, body: { patientId: await mk("Ward Three"), ward: "General Ward", bed: "G-05", doctor: "Dr. Ward" } })]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  const winner = race.find((r) => r.status === 201).body.admission;
  const tr = await api("POST", `/admissions/${winner.id}/transfer`, { token: admin, body: { ward: "ICU", bed: "I-01" } });
  assert.equal(tr.status, 200);
  assert.equal(tr.body.admission.ward, "ICU");
  assert.equal((await api("POST", `/admissions/${a1.body.admission.id}/transfer`, { token: admin, body: { ward: "ICU", bed: "I-01" } })).status, 409);
  const wards = (await api("GET", "/admissions/wards", { token: admin })).body.wards;
  const icu = wards.find((w) => w.ward === "ICU");
  assert.equal(icu.occupied, 1);
  assert.equal(icu.free, 7);
  assert.equal(wards.find((w) => w.ward === "General Ward").occupied, 1);
  const d1 = await api("POST", `/admissions/${a1.body.admission.id}/discharge`, { token: admin, body: { outcome: "Recovered / improved", notes: "Well" } });
  assert.equal(d1.body.admission.status, "Discharged");
  assert.equal((await api("POST", `/admissions/${a1.body.admission.id}/discharge`, { token: admin, body: { outcome: "Recovered / improved" } })).status, 409);
  assert.equal((await api("POST", `/admissions/${a1.body.admission.id}/transfer`, { token: admin, body: { ward: "General Ward", bed: "G-09" } })).status, 409);
  assert.equal((await admit(await mk("Ward Four"), "G-01")).status, 201, "a discharged bed is free again");
  const detail = await api("GET", `/admissions/${winner.id}`, { token: admin });
  assert.equal(detail.body.moves.length, 1);
  const audit = JSON.stringify((await api("GET", "/audit?limit=100", { token: admin })).body);
  assert.ok(!audit.includes("Malaria"), "the diagnosis never reaches the audit log");
});

test("accounts: balances, transfers, void, payroll pay and remit exactly once", async () => {
  const cashier = await newStaff("Cashier Mods", "cashier.mods@test.local", "r-cashier");
  const mkAcct = (name, opening = 0) => api("POST", "/accounts/money-accounts", { token: admin, body: { name, kind: "Bank", opening, openingDate: day(-30) } });
  const bank = (await mkAcct("GTBank", 100000)).body.account;
  const cash = (await mkAcct("Cash office", 5000)).body.account;
  assert.equal((await mkAcct("GTBank")).status, 409);
  assert.equal((await api("POST", "/accounts/money-accounts", { token: cashier.token, body: { name: "X", kind: "Cash", openingDate: today } })).status, 403);
  const txn = (b) => api("POST", "/accounts/transactions", { token: admin, body: { date: today, description: "", party: "", reference: "", ...b } });
  assert.equal((await txn({ type: "Income", category: "Donations & grants", amount: 25000, accountId: bank.id })).status, 201);
  const exp = await txn({ type: "Expense", category: "Rent", amount: 10000, accountId: bank.id });
  assert.equal(exp.status, 201);
  assert.equal((await txn({ type: "Transfer", amount: 20000, accountId: bank.id, toAccountId: cash.id })).status, 201);
  assert.equal((await txn({ type: "Transfer", amount: 1, accountId: bank.id, toAccountId: bank.id })).status, 400);
  assert.equal((await txn({ type: "Income", category: "Rent", amount: 5, accountId: bank.id })).status, 400, "wrong category for income");
  assert.equal((await txn({ type: "Expense", category: "Rent", amount: -5, accountId: bank.id })).status, 400);
  assert.equal((await txn({ type: "Expense", category: "Rent", amount: 5, accountId: bank.id, date: day(1) })).status, 400, "future date");
  assert.equal((await txn({ type: "Expense", category: "Rent", amount: 5, accountId: bank.id, date: day(-40) })).status, 400, "before the account opened");
  const bal = async () => Object.fromEntries((await api("GET", "/accounts/money-accounts", { token: admin })).body.accounts.map((a) => [a.name, a.balance]));
  assert.deepEqual(await bal(), { GTBank: 95000, "Cash office": 25000 });
  assert.equal((await api("POST", `/accounts/transactions/${exp.body.txn.id}/void`, { token: admin, body: { reason: "x" } })).status, 400, "reason too short");
  const v = await api("POST", `/accounts/transactions/${exp.body.txn.id}/void`, { token: admin, body: { reason: "Entered twice" } });
  assert.equal(v.body.txn.voided.reason, "Entered twice");
  assert.equal((await api("POST", `/accounts/transactions/${exp.body.txn.id}/void`, { token: admin, body: { reason: "Entered twice" } })).status, 409);
  assert.deepEqual(await bal(), { GTBank: 105000, "Cash office": 25000 });
  assert.equal((await api("GET", "/accounts/transactions", { token: admin })).body.txns.length, 3, "a voided entry stays on the record");

  // payroll
  const emp = (name, extra = {}) => api("POST", "/accounts/employees", { token: admin, body: { name, title: "Nurse", basic: 100000, housing: 20000, transport: 10000, otherAllowance: 0, pensionPct: 8, paye: 5000, otherDeduction: 1000, ...extra } });
  const e1 = (await emp("Staff One")).body.employee;
  await emp("Staff Two", { basic: 50000, housing: 0, transport: 0, paye: 0, otherDeduction: 0 });
  assert.equal((await api("POST", "/accounts/payroll", { token: admin, body: { month: "2026-13" } })).status, 400);
  const run = await api("POST", "/accounts/payroll", { token: admin, body: { month: "2026-10", bonuses: { [e1.id]: 10000 } } });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  const l1 = run.body.run.lines.find((l) => l.employeeId === e1.id);
  assert.equal(l1.gross, 140000); // 100000 + 30000 allowances + 10000 bonus
  assert.equal(l1.pension, 10400); // 8% of 130000
  assert.equal(l1.net, 123600); // 140000 - 10400 - 5000 - 1000
  assert.equal(run.body.run.totals.net, 123600 + 46000); // second person: 50000 - 4000 pension
  const runId = run.body.run.id;
  assert.equal((await api("POST", `/accounts/payroll/${runId}/remit`, { token: admin, body: { accountId: bank.id } })).status, 409, "pay first");
  const paid = await api("POST", `/accounts/payroll/${runId}/pay`, { token: admin, body: { accountId: bank.id } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.run.status, "Paid");
  assert.equal((await bal()).GTBank, 105000 - 169600);
  assert.equal((await api("POST", `/accounts/payroll/${runId}/pay`, { token: admin, body: { accountId: bank.id } })).status, 409, "no second payment");
  assert.equal((await api("POST", "/accounts/payroll", { token: admin, body: { month: "2026-10" } })).status, 409, "a paid month is closed");
  assert.equal((await api("POST", `/accounts/transactions/${paid.body.run.txnId}/void`, { token: admin, body: { reason: "Trying to undo" } })).status, 409, "payroll money is voided through payroll, not the ledger");
  const rem = await api("POST", `/accounts/payroll/${runId}/remit`, { token: admin, body: { accountId: bank.id } });
  assert.equal(rem.status, 200);
  assert.equal((await api("POST", `/accounts/payroll/${runId}/remit`, { token: admin, body: { accountId: bank.id } })).status, 409, "no second remittance");
  assert.equal((await bal()).GTBank, 105000 - 169600 - (10400 + 4000 + 5000));
  assert.equal((await api("DELETE", `/accounts/employees/${e1.id}`, { token: admin })).status, 409, "an employee on a payroll run is switched off, not deleted");
  const sum = await api("GET", `/accounts/summary?from=${day(-30)}&to=${today}`, { token: admin });
  assert.equal(sum.status, 200);
  assert.ok(sum.body.months.length >= 1);
});

test("billing and claims over HTTP, with permissions", async () => {
  const cashier = await newStaff("Cashier Bill", "cashier.bill@test.local", "r-cashier");
  const nurse = await newStaff("Nurse Bill", "nurse.bill@test.local", "r-nurse");
  const pat = (await api("POST", "/patients", { token: admin, body: { name: "Insured Person", dob: "1985-05-05", gender: "Female", payer: "HMO", payerName: "AXA Mansard", memberId: "AXA-9" } })).body.patient;
  const body = { patientId: pat.id, items: [{ description: "Consultation", qty: 1, unitPrice: 5000 }, { description: "Drugs", qty: 2, unitPrice: 1250 }], discount: 500, vatRate: 10 };
  assert.equal((await api("POST", "/billing/invoices", { token: nurse.token, body })).status, 403);
  assert.equal((await api("POST", "/billing/invoices", { token: cashier.token, body: { ...body, items: [] } })).status, 400);
  assert.equal((await api("POST", "/billing/invoices", { token: cashier.token, body: { ...body, patientId: "P-9999" } })).status, 400);
  const inv = await api("POST", "/billing/invoices", { token: cashier.token, body });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assert.equal(inv.body.invoice.totals.total, 7700);
  const id = inv.body.invoice.id;
  assert.equal((await api("GET", `/billing/invoices/${id}`, { token: cashier.token })).body.invoice.status, "Unpaid");
  assert.equal((await api("POST", `/billing/invoices/${id}/payments`, { token: cashier.token, body: { amount: 99999, method: "Cash" } })).status, 409, "overpayment");
  assert.equal((await api("POST", `/billing/invoices/${id}/payments`, { token: cashier.token, body: { amount: 0, method: "Cash" } })).status, 400);
  assert.equal((await api("POST", `/billing/invoices/${id}/payments`, { token: cashier.token, body: { amount: 1000, method: "Barter" } })).status, 400);
  const pay = await api("POST", `/billing/invoices/${id}/payments`, { token: cashier.token, body: { amount: 700, method: "Cash" } });
  assert.equal(pay.status, 201);
  assert.equal(pay.body.invoice.status, "Partial");
  assert.equal((await api("GET", "/billing/totals", { token: cashier.token })).body.outstanding, 7000);
  assert.equal((await api("GET", "/billing/invoices?status=Paid", { token: cashier.token })).body.invoices.length, 0);

  const cl = (await api("GET", "/claims/claimable", { token: cashier.token })).body.groups;
  assert.equal(cl.length, 1);
  assert.equal(cl[0].payer, "AXA Mansard");
  const claim = await api("POST", "/claims", { token: cashier.token, body: { payer: "AXA Mansard", payerType: "HMO", invoiceIds: [id] } });
  assert.equal(claim.status, 201, JSON.stringify(claim.body));
  const cid = claim.body.claim.id;
  assert.equal((await api("POST", "/claims", { token: cashier.token, body: { payer: "AXA Mansard", payerType: "HMO", invoiceIds: [id] } })).status, 409, "an invoice can't be in two claims");
  assert.equal((await api("POST", `/claims/${cid}/approve`, { token: cashier.token, body: { approvedAmount: 100 } })).status, 409, "submit first");
  assert.equal((await api("POST", `/claims/${cid}/submit`, { token: cashier.token, body: { reference: "SUB-1" } })).body.claim.status, "Submitted");
  assert.equal((await api("POST", `/claims/${cid}/approve`, { token: cashier.token, body: { approvedAmount: 99999 } })).status, 400);
  assert.equal((await api("POST", `/claims/${cid}/approve`, { token: cashier.token, body: { approvedAmount: 7000 } })).body.claim.status, "Approved");
  assert.equal((await api("POST", `/claims/${cid}/payments`, { token: cashier.token, body: { amount: 8000 } })).status, 409, "more than the payer owes");
  const cp = await api("POST", `/claims/${cid}/payments`, { token: cashier.token, body: { amount: 7000 } });
  assert.equal(cp.status, 201);
  assert.equal(cp.body.claim.status, "Paid");
  assert.equal((await api("GET", `/billing/invoices/${id}`, { token: cashier.token })).body.invoice.status, "Paid");
  assert.equal((await api("GET", "/claims", { token: nurse.token })).status, 403);
  const bogus = await api("POST", "/claims/CLM-9999/reject", { token: cashier.token, body: { reason: "No such claim" } });
  assert.equal(bogus.status, 404);
});

test("admin dashboard: administrators only, real figures", async () => {
  const nurse = await newStaff("Nurse Dash", "nurse.dash@test.local", "r-nurse");
  assert.equal((await api("GET", "/admin/dashboard", { token: nurse.token })).status, 403);
  assert.equal((await api("GET", "/admin/dashboard")).status, 401);
  const d = (await api("GET", "/admin/dashboard", { token: admin })).body;
  assert.ok(d.users.total >= 5);
  assert.equal(d.users.activeAdmins, 1);
  assert.ok(d.attention.some((a) => /Only one active administrator/.test(a.text)));
  assert.equal(d.perRole.find((r) => r.roleId === "r-admin").count, 1);
  assert.ok(d.records.patients >= 1);
  assert.ok(d.records.admitted >= 1);
  assert.ok(Array.isArray(d.recentAudit) && d.recentAudit.length > 0);
});
