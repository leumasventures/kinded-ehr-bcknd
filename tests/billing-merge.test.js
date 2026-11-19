// Runs against a real MySQL/MariaDB database that it wipes first. Never point it at real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

if (!process.env.TEST_DB_HOST) throw new Error("Set TEST_DB_HOST (and the other TEST_DB_* settings) to a scratch test database.");
process.env.DB_HOST = process.env.TEST_DB_HOST;
process.env.DB_PORT = process.env.TEST_DB_PORT ?? "3306";
process.env.DB_USER = process.env.TEST_DB_USER ?? "root";
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? "";
process.env.DB_NAME = process.env.TEST_DB_NAME ?? "hms_test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-test-secret";
if (!/test/i.test(process.env.DB_NAME)) throw new Error("Refusing to run: the test database name must contain 'test'.");

const mysql = (await import("mysql2/promise")).default;
const { pool, query } = await import("../src/config/database.js");
const { createPatient } = await import("../src/services/patient.service.js");
const { createAppointment } = await import("../src/services/appointment.service.js");
const billing = await import("../src/services/billing.service.js");
const { applySchema } = await import("../scripts/applySchema.js");
const { mergePatients, recordCounts, listMerges } = await import("../src/services/merge.service.js");

const by = { id: "u-cashier", name: "Test Cashier" };
const base = { dob: "1990-01-01", gender: "Female", phone: "", address: "", bloodGroup: "Unknown", genotype: "Unknown", payer: "Self-pay", allergies: "", kinName: "", kinRelation: "", kinPhone: "" };
const status = async (promise) => {
  try {
    await promise;
    return 200;
  } catch (e) {
    return e.status ?? `crash: ${e.message}`;
  }
};
let self, hmo1, hmo2, hmo3;
const reg = (o) => createPatient({ ...base, ...o }, by.id);

before(async () => {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  const [tables] = await db.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await db.query(`DROP TABLE IF EXISTS \`${t}\``);
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
  await applySchema(db);
  await db.end();
  self = await reg({ name: "Sade Self-pay" });
  const ins = { payer: "HMO", payerName: "AXA Mansard" };
  hmo1 = await reg({ ...ins, name: "Bola Insured", memberId: "AXA-1" });
  hmo2 = await reg({ ...ins, name: "Chike Insured", memberId: "AXA-2" });
  hmo3 = await reg({ payer: "HMO", payerName: "Hygeia", name: "Dayo Other", memberId: "HY-1" });
});

after(() => pool.end());

test("manual invoices: totals, validation, only for registered patients", async () => {
  const inv = await billing.createInvoice({ patientId: self.id, items: [{ description: "Consultation", qty: 1, unitPrice: 5000 }, { description: "Drugs", qty: 2, unitPrice: 1250 }], discount: 500, vatRate: 10 }, by.id);
  assert.equal(inv.id, "INV-1001");
  assert.deepEqual(inv.totals, { subtotal: 7500, discount: 500, vat: 700, total: 7700 });
  assert.equal(inv.balance, 7700);
  assert.equal(inv.status, "Unpaid");
  assert.equal(inv.patient, "Sade Self-pay");
  assert.equal(await status(billing.createInvoice({ patientId: "P-9999", items: [{ description: "x", qty: 1, unitPrice: 1 }] })), 400);
  assert.equal(await status(billing.createInvoice({ patientId: self.id, items: [] })), 400);
  assert.equal(await status(billing.createInvoice({ patientId: self.id, items: [{ description: "x", qty: 1, unitPrice: -5 }] })), 400);
  assert.equal(await status(billing.createInvoice({ patientId: self.id, date: "2030-01-10", dueDate: "2030-01-01", items: [{ description: "x", qty: 1, unitPrice: 1 }] })), 400);
  assert.equal(await status(billing.countInvoicesFor(self.id)), 200);
});

test("automatic charges: join the open invoice, never repeat, and survive many at once", async () => {
  const p = await reg({ name: "Efe Charges" });
  const first = await billing.addCharges(p, "appt:A-201", [{ description: "General consultation", qty: 1, unitPrice: 5000 }]);
  assert.equal(first.added, 1);
  const open = first.invoiceId;
  const second = await billing.addCharges(p, "lab:L-1", [{ description: "Full blood count", qty: 1, unitPrice: 7500 }]);
  assert.equal(second.invoiceId, open, "joins the patient's open invoice");
  assert.equal(await billing.addCharges(p, "lab:L-1", [{ description: "Full blood count", qty: 1, unitPrice: 7500 }]), null, "the same event never charges twice");
  assert.equal(await status(billing.addCharges(p, "x:1", [{ description: "Same", qty: 1, unitPrice: 5 }, { description: "Same", qty: 1, unitPrice: 5 }])), 400);

  // Ten clicks of the same button at the same moment.
  const race = await Promise.all(Array.from({ length: 10 }, () => billing.addCharges(p, "pharm:D-7", [{ description: "Paracetamol", qty: 2, unitPrice: 500 }])));
  assert.equal(race.filter(Boolean).length, 1);
  const inv = await billing.getInvoice(open);
  assert.equal(inv.items.filter((i) => i.source === "pharm:D-7").length, 1);
  assert.equal(inv.totals.total, 13500);

  // Once it is fully paid, the next charge opens a new invoice.
  await billing.recordPayment(open, { amount: 13500, method: "Cash" }, { createdBy: by.id });
  const later = await billing.addCharges(p, "appt:A-300", [{ description: "Follow-up", qty: 1, unitPrice: 3000 }]);
  assert.notEqual(later.invoiceId, open);
  assert.equal((await billing.getInvoice(open)).status, "Paid");
});

test("taking back charges: unpaid lines go, paid-for lines are kept, an emptied invoice disappears", async () => {
  const p = await reg({ name: "Femi Takeback" });
  const c = await billing.addCharges(p, "lab:L-9", [{ description: "Malaria test", qty: 1, unitPrice: 2000 }]);
  const r = await billing.removeCharges(p.id, "lab:L-9");
  assert.equal(r.removed, 1);
  assert.equal(r.amount, 2000);
  assert.equal(await billing.getInvoice(c.invoiceId), undefined, "the empty unpaid invoice is dropped");

  const d = await billing.addCharges(p, "lab:L-10", [{ description: "Scan", qty: 1, unitPrice: 4000 }]);
  await billing.recordPayment(d.invoiceId, { amount: 4000, method: "POS" });
  const blocked = await billing.removeCharges(p.id, "lab:L-10");
  assert.equal(blocked.removed, 0);
  assert.equal(blocked.blocked, 1);
  assert.equal((await billing.getInvoice(d.invoiceId)).items.length, 1);
});

test("payments: method and amount checked, no overpaying, and two cashiers can't both take the last of a balance", async () => {
  const p = await reg({ name: "Gozie Payments" });
  const inv = await billing.createInvoice({ patientId: p.id, items: [{ description: "Procedure", qty: 1, unitPrice: 10000 }] }, by.id);
  assert.equal(await status(billing.recordPayment(inv.id, { amount: 100, method: "Gold bars" })), 400);
  assert.equal(await status(billing.recordPayment(inv.id, { amount: 0, method: "Cash" })), 400);
  assert.equal(await status(billing.recordPayment(inv.id, { amount: 10000.01, method: "Cash" })), 409);
  assert.equal(await status(billing.recordPayment("INV-9999", { amount: 1, method: "Cash" })), 404);
  await billing.recordPayment(inv.id, { amount: 4000, method: "Cash", reference: "R1" });
  assert.equal((await billing.getInvoice(inv.id)).status, "Partial");
  const both = await Promise.all([billing.recordPayment(inv.id, { amount: 6000, method: "POS" }), billing.recordPayment(inv.id, { amount: 6000, method: "Bank Transfer" })].map(status));
  assert.deepEqual(both.sort(), [200, 409]);
  const done = await billing.getInvoice(inv.id);
  assert.equal(done.status, "Paid");
  assert.equal(done.balance, 0);
  assert.equal(done.payments.length, 2);
});

test("insurance claims: checks, approval, shared-out payments, rejection frees the invoices", async () => {
  const a = await billing.createInvoice({ patientId: hmo1.id, items: [{ description: "Admission", qty: 1, unitPrice: 30000 }] }, by.id);
  const b = await billing.createInvoice({ patientId: hmo2.id, items: [{ description: "Surgery", qty: 1, unitPrice: 70000 }] }, by.id);
  const other = await billing.createInvoice({ patientId: hmo3.id, items: [{ description: "Visit", qty: 1, unitPrice: 5000 }] }, by.id);
  const selfInv = (await billing.listInvoices({ patientId: self.id }))[0];

  assert.equal(await status(billing.createClaim({ payer: "AXA Mansard", payerType: "HMO", invoiceIds: [selfInv.id] }, by)), 409, "self-pay is not claimable");
  assert.equal(await status(billing.createClaim({ payer: "AXA Mansard", payerType: "HMO", invoiceIds: [a.id, other.id] }, by)), 409, "another payer's patient");
  assert.equal(await status(billing.createClaim({ payer: "AXA Mansard", payerType: "HMO", invoiceIds: [] }, by)), 400);

  const groups = await billing.claimableByPayer();
  assert.deepEqual(groups.map((g) => g.payer), ["AXA Mansard", "Hygeia"]);

  const claim = await billing.createClaim({ payer: "AXA Mansard", payerType: "HMO", invoiceIds: [a.id, b.id] }, by);
  assert.equal(claim.id, "CLM-1001");
  assert.equal(claim.status, "Draft");
  assert.equal(claim.total, 100000);
  assert.equal(claim.lines[0].memberId, "AXA-1");
  assert.equal(await status(billing.createClaim({ payer: "AXA Mansard", payerType: "HMO", invoiceIds: [a.id] }, by)), 409, "already in a live claim");
  assert.equal(await status(billing.approveClaim({ id: claim.id, approvedAmount: 1 }, by)), 409, "not submitted yet");

  await billing.submitClaim({ id: claim.id, reference: "AXA-REF-9" }, by);
  assert.equal(await status(billing.submitClaim({ id: claim.id }, by)), 409);
  assert.equal(await status(billing.approveClaim({ id: claim.id, approvedAmount: 100000.5 }, by)), 400);
  const approved = await billing.approveClaim({ id: claim.id, approvedAmount: 90000 }, by);
  assert.equal(approved.outstanding, 90000);

  assert.equal(await status(billing.recordClaimPayment({ id: claim.id, amount: 90000.01 }, by)), 409);
  const part = await billing.recordClaimPayment({ id: claim.id, amount: 50000 }, by);
  assert.deepEqual(part.posted, [{ invoiceId: a.id, amount: 30000 }, { invoiceId: b.id, amount: 20000 }], "shared out in order, each up to its balance");
  assert.equal(part.claim.status, "Approved");
  const fin = await billing.recordClaimPayment({ id: claim.id, amount: 40000 }, by);
  assert.equal(fin.claim.status, "Paid");
  assert.equal(fin.claim.receivedAmount, 90000);
  assert.equal((await billing.getInvoice(a.id)).status, "Paid");
  const bAfter = await billing.getInvoice(b.id);
  assert.equal(bAfter.balance, 10000, "the 10,000 the payer didn't approve is still owed");
  assert.ok(bAfter.payments.every((p) => p.method === "HMO / Insurance" && p.claimId === claim.id));
  assert.ok(fin.claim.history.length >= 5);

  // Rejection lets the invoices go.
  const c2 = await billing.createClaim({ payer: "Hygeia", payerType: "HMO", invoiceIds: [other.id] }, by);
  await billing.submitClaim({ id: c2.id }, by);
  assert.equal(await status(billing.rejectClaim({ id: c2.id, reason: " " }, by)), 400);
  await billing.rejectClaim({ id: c2.id, reason: "Not covered" }, by);
  assert.equal((await billing.createClaim({ payer: "Hygeia", payerType: "HMO", invoiceIds: [other.id] }, by)).status, "Draft");
});

test("a claim payment that can't be placed saves nothing at all", async () => {
  const p = await reg({ payer: "NHIA / NHIS", payerName: "NHIA", name: "Hauwa Nhis", memberId: "N-1" });
  const inv = await billing.createInvoice({ patientId: p.id, items: [{ description: "Care", qty: 1, unitPrice: 8000 }] }, by.id);
  const c = await billing.createClaim({ payer: "NHIA", payerType: "NHIA / NHIS", invoiceIds: [inv.id] }, by);
  await billing.submitClaim({ id: c.id }, by);
  await billing.approveClaim({ id: c.id, approvedAmount: 8000 }, by);
  await billing.recordPayment(inv.id, { amount: 8000, method: "Cash" }); // the patient paid it themselves meanwhile
  const result = await status(billing.recordClaimPayment({ id: c.id, amount: 8000 }, by));
  assert.equal(result, 409);
  const after = await billing.getClaim(c.id);
  assert.equal(after.receivedAmount, 0);
  assert.equal((await billing.getInvoice(inv.id)).payments.length, 1);
});

test("patient merge: moves everything in one step, fills gaps, keeps a copy, and rolls back on a clash", async () => {
  const keep = await reg({ name: "Ify Keep", phone: "0801 000 0001", allergies: "Penicillin", payer: "HMO", payerName: "AXA Mansard" });
  const dupe = await reg({ name: "Ifeoma Keep", phone: "", address: "12 Aba Road", allergies: "penicillin, Sulfa", bloodGroup: "O+", payer: "HMO", payerName: "AXA Mansard", memberId: "AXA-77", notes: "Registered twice by mistake" });
  const appt = await createAppointment({ patientId: dupe.id, doctor: "Dr. Eze", date: "2030-05-05", time: "09:00", type: "Follow-up" }, by.id);
  const inv = await billing.createInvoice({ patientId: dupe.id, items: [{ description: "Visit", qty: 1, unitPrice: 4000 }] }, by.id);
  const claim = await billing.createClaim({ payer: "AXA Mansard", payerType: "HMO", invoiceIds: [inv.id] }, by);

  assert.deepEqual(await recordCounts(dupe.id), { Appointments: 1, "Clinical notes": 0, Invoices: 1, "Claim lines": 1 });
  assert.equal(await status(mergePatients(keep.id, keep.id, by)), 400);
  assert.equal(await status(mergePatients(keep.id, "P-9999", by)), 404);

  const r = await mergePatients(keep.id, dupe.id, by);
  assert.deepEqual(r.moved, { Appointments: 1, Invoices: 1, "Claim lines": 1 });
  assert.equal(r.patient.allergies, "Penicillin, Sulfa", "allergies are combined without repeats");
  assert.equal(r.patient.phone, "0801 000 0001", "the kept patient's own details win");
  assert.equal(r.patient.address, "12 Aba Road", "gaps are filled from the duplicate");
  assert.equal(r.patient.bloodGroup, "O+");
  assert.equal(r.patient.memberId, "AXA-77");
  assert.deepEqual(r.patient.mergedFrom, [dupe.id]);
  assert.equal(await query("SELECT id FROM patients WHERE id = ?", [dupe.id]).then((x) => x.length), 0, "the duplicate is off the register");
  assert.equal((await billing.getInvoice(inv.id)).patientId, keep.id);
  assert.equal((await billing.getClaim(claim.id)).lines[0].patientId, keep.id);
  assert.equal((await billing.getClaim(claim.id)).lines[0].memberId, "AXA-77");
  assert.equal((await query("SELECT patient_id FROM appointments WHERE id = ?", [appt.id]))[0].patient_id, keep.id);

  const log = await listMerges(keep.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].removed.name, "Ifeoma Keep", "a full copy of the removed registration is kept");
  await assert.rejects(query("UPDATE patient_merges SET by_name = 'x'"), /append-only/);
  await assert.rejects(query("DELETE FROM patient_merges"), /append-only/);

  // Both registrations were charged for the same lab event: the merge must stop and leave everything as it was.
  const x = await reg({ name: "Gina Clash" });
  const y = await reg({ name: "Gina Clash Two" });
  await billing.addCharges(x, "lab:L-77", [{ description: "FBC", qty: 1, unitPrice: 1000 }]);
  await billing.addCharges(y, "lab:L-77", [{ description: "FBC", qty: 1, unitPrice: 1000 }]);
  const yAppt = await createAppointment({ patientId: y.id, doctor: "Dr. Obi", date: "2030-06-06", time: "10:00", type: "Follow-up" }, by.id);
  assert.equal(await status(mergePatients(x.id, y.id, by)), 409);
  assert.equal((await query("SELECT patient_id FROM appointments WHERE id = ?", [yAppt.id]))[0].patient_id, y.id, "the appointment moved before the clash was found, then was rolled back");
  assert.equal((await query("SELECT id FROM patients WHERE id = ?", [y.id])).length, 1);
  assert.equal((await listMerges(x.id)).length, 0);
});
