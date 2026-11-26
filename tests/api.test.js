// Runs against a real MySQL/MariaDB database that it wipes first. Never point it at real data.
// Needs a SEPARATE scratch database (its name must contain "test"). Never point it at the hosted production database.
//   TEST_DB_HOST=... TEST_DB_PORT=3306 TEST_DB_USER=... TEST_DB_PASSWORD=... TEST_DB_NAME=..._test npm test
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
process.env.LOGIN_RATE_LIMIT = "100000"; // the suite signs in from one address, far more often than a real person would

if (!/test/i.test(process.env.DB_NAME)) throw new Error("Refusing to run: the test database name must contain 'test'.");

const mysql = (await import("mysql2/promise")).default;
const { createApp } = await import("../src/app.js");
const { pool, query } = await import("../src/config/database.js");
const { hashPassword } = await import("../src/services/password.service.js");
const { seedRoles } = await import("../src/config/permissions.js");
const { verifyChain } = await import("../src/services/audit.service.js");
const { applySchema } = await import("../scripts/applySchema.js");

let server;
let base;
const api = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
};

const ADMIN = { email: "admin@test.local", password: "Adm1nStrong-Pass" };
const dbAdmin = async () => mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });

async function login(email, password) {
  const r = await api("POST", "/auth/login", { body: { email, password } });
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`);
  return r.body;
}

// Creates a user as the administrator, then completes the forced password change. Returns their tokens.
async function newStaff(adminToken, name, email, roleId, extra = {}) {
  const c = await api("POST", "/users", { token: adminToken, body: { name, email, roleId, ...extra } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const first = await login(email, c.body.temporaryPassword);
  const pw = "Zeta-Orbit-4821-xq"; // must not contain the person's name or email, or the policy (correctly) refuses it
  const ch = await api("POST", "/auth/change-password", { token: first.accessToken, body: { currentPassword: c.body.temporaryPassword, newPassword: pw } });
  assert.equal(ch.status, 200, JSON.stringify(ch.body));
  return { ...ch.body, password: pw, id: c.body.user.id };
}

before(async () => {
  const db = await dbAdmin();
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
});

after(async () => {
  server?.close();
  await pool.end();
});

test("health check reaches the database", async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
});

test("sign-in: wrong password and unknown email give the same answer, and no password hash ever leaves the server", async () => {
  const wrong = await api("POST", "/auth/login", { body: { email: ADMIN.email, password: "nope-nope-nope" } });
  const unknown = await api("POST", "/auth/login", { body: { email: "nobody@test.local", password: "nope-nope-nope" } });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  const ok = await login(ADMIN.email, ADMIN.password);
  assert.ok(ok.accessToken && ok.refreshToken);
  assert.ok(!JSON.stringify(ok).includes("password_hash") && !JSON.stringify(ok).includes("$2"));
  const users = await api("GET", "/users", { token: ok.accessToken });
  assert.equal(users.status, 200);
  assert.ok(!JSON.stringify(users.body).includes("$2"));
});

test("requests without a valid token are refused", async () => {
  assert.equal((await api("GET", "/patients")).status, 401);
  assert.equal((await api("GET", "/patients", { token: "garbage.token.value" })).status, 401);
});

test("a new account must choose its own password before doing anything else, and weak passwords are refused", async () => {
  const { accessToken } = await login(ADMIN.email, ADMIN.password);
  const c = await api("POST", "/users", { token: accessToken, body: { name: "Nina Nurse", email: "nina@test.local", roleId: "r-nurse" } });
  assert.equal(c.status, 201);
  assert.ok(c.body.temporaryPassword.length >= 12);
  const first = await login("nina@test.local", c.body.temporaryPassword);
  const blocked = await api("GET", "/patients", { token: first.accessToken });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "password_change_required");
  for (const weak of ["short1", "onlyletterslongenough", "1234567890123", "password123", "nina-pass-1234"]) {
    const r = await api("POST", "/auth/change-password", { token: first.accessToken, body: { currentPassword: c.body.temporaryPassword, newPassword: weak } });
    assert.equal(r.status, 400, `should reject ${weak}`);
  }
  const good = await api("POST", "/auth/change-password", { token: first.accessToken, body: { currentPassword: c.body.temporaryPassword, newPassword: "Tr1cky-Zebra-Pass" } });
  assert.equal(good.status, 200);
  assert.equal((await api("GET", "/patients", { token: good.body.accessToken })).status, 200);
  // The temporary password no longer works.
  assert.equal((await api("POST", "/auth/login", { body: { email: "nina@test.local", password: c.body.temporaryPassword } })).status, 401);
});

test("five wrong passwords lock the account, even for the right password", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const s = await newStaff(admin.accessToken, "Lock Me", "lockme@test.local", "r-cashier");
  for (let i = 0; i < 5; i++) assert.equal((await api("POST", "/auth/login", { body: { email: "lockme@test.local", password: "wrong-wrong-1" } })).status, 401);
  const r = await api("POST", "/auth/login", { body: { email: "lockme@test.local", password: s.password } });
  assert.equal(r.status, 423);
  // An administrator resetting the password unlocks it.
  const reset = await api("POST", `/users/${s.id}/reset-password`, { token: admin.accessToken });
  assert.equal(reset.status, 200);
  assert.equal((await api("POST", "/auth/login", { body: { email: "lockme@test.local", password: reset.body.temporaryPassword } })).status, 200);
});

test("renewal tokens rotate, and reusing an old one ends the whole sign-in", async () => {
  const a = await login(ADMIN.email, ADMIN.password);
  const b = await api("POST", "/auth/refresh", { body: { refreshToken: a.refreshToken } });
  assert.equal(b.status, 200);
  assert.notEqual(b.body.refreshToken, a.refreshToken);
  const reuse = await api("POST", "/auth/refresh", { body: { refreshToken: a.refreshToken } });
  assert.equal(reuse.status, 401);
  const afterReuse = await api("POST", "/auth/refresh", { body: { refreshToken: b.body.refreshToken } });
  assert.equal(afterReuse.status, 401, "the newer token from the same sign-in must be revoked too");
});

test("permissions are enforced on the server, per role", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const pharm = await newStaff(admin.accessToken, "Pat Pharm", "pat@test.local", "r-pharmacist");
  const cash = await newStaff(admin.accessToken, "Cas Cash", "cas@test.local", "r-cashier");
  assert.equal((await api("GET", "/users", { token: cash.accessToken })).status, 403, "cashiers can't list users");
  assert.equal((await api("GET", "/audit", { token: cash.accessToken })).status, 403, "only admins read the audit log");
  assert.equal((await api("GET", "/patients", { token: pharm.accessToken })).status, 403, "pharmacists have no patient access");
  const roles = await api("GET", "/roles", { token: cash.accessToken });
  assert.equal(roles.status, 200);
  assert.ok(roles.body.roles.every((r) => r.permissions === undefined), "non-admins see role names, not what a role may do");
  // The blocked attempts are on record.
  const log = await api("GET", "/audit?action=Security&outcome=failure", { token: admin.accessToken });
  assert.ok(log.body.entries.some((e) => /Pat Pharm tried to view in Patients/.test(e.summary)));
});

test("a personal privilege override replaces the role's permissions", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const perms = { Patients: { view: true, create: false, edit: false, delete: false } };
  const s = await newStaff(admin.accessToken, "Cash Plus", "cashplus@test.local", "r-cashier", { permissions: perms });
  assert.equal((await api("GET", "/patients", { token: s.accessToken })).status, 200);
  assert.equal((await api("POST", "/patients", { token: s.accessToken, body: { name: "No Way", dob: "2000-01-01", gender: "Male" } })).status, 403);
  // Billing came from the role, and the override replaced it entirely.
  const me = await api("GET", "/auth/me", { token: s.accessToken });
  assert.equal(me.body.user.permissions.Billing.view, false);
});

test("deactivating someone cuts off their session on the very next request", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const s = await newStaff(admin.accessToken, "Gone Soon", "gone@test.local", "r-nurse");
  assert.equal((await api("GET", "/patients", { token: s.accessToken })).status, 200);
  assert.equal((await api("PUT", `/users/${s.id}`, { token: admin.accessToken, body: { active: false } })).status, 200);
  assert.equal((await api("GET", "/patients", { token: s.accessToken })).status, 401);
  assert.equal((await api("POST", "/auth/refresh", { body: { refreshToken: s.refreshToken } })).status, 401);
});

test("the last administrator can't be removed, demoted or deactivated, and neither can yourself", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  assert.equal((await api("PUT", "/users/u-admin", { token: admin.accessToken, body: { roleId: "r-nurse" } })).status, 409);
  assert.equal((await api("PUT", "/users/u-admin", { token: admin.accessToken, body: { active: false } })).status, 409);
  assert.equal((await api("DELETE", "/users/u-admin", { token: admin.accessToken })).status, 409);
  assert.equal((await api("PUT", "/roles/r-admin", { token: admin.accessToken, body: { name: "Boss", description: "", permissions: {} } })).status, 403);
  assert.equal((await api("DELETE", "/roles/r-nurse", { token: admin.accessToken })).status, 409, "role still has users");
  assert.equal((await api("POST", "/users", { token: admin.accessToken, body: { name: "Dup", email: ADMIN.email, roleId: "r-nurse" } })).status, 409);
});

test("patients: register, validate, find duplicates, search, update", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const t = admin.accessToken;
  const p = { name: "Ngozi Okafor", dob: "1990-05-14", gender: "Female", phone: "0803 555 0101", allergies: "Penicillin" };
  const a = await api("POST", "/patients", { token: t, body: p });
  assert.equal(a.status, 201);
  assert.equal(a.body.patient.id, "P-1001");
  assert.equal(a.body.patient.dob, "1990-05-14");

  assert.equal((await api("POST", "/patients", { token: t, body: { ...p, dob: "2999-01-01" } })).status, 400);
  assert.equal((await api("POST", "/patients", { token: t, body: { ...p, gender: "Other" } })).status, 400);
  assert.equal((await api("POST", "/patients", { token: t, body: { ...p, dob: "1990-02-31" } })).status, 400, "a day that doesn't exist");

  const dup = await api("POST", "/patients", { token: t, body: { ...p, name: "N. Okafor", dob: "1991-01-01", phone: "+234 803 555 0101" } });
  assert.equal(dup.status, 409, "same phone number");
  assert.equal(dup.body.code, "possible_duplicate");
  assert.equal(dup.body.duplicates[0].id, "P-1001");
  const forced = await api("POST", "/patients", { token: t, body: { ...p, name: "N. Okafor", dob: "1991-01-01", phone: "+234 803 555 0101", allowDuplicate: true } });
  assert.equal(forced.status, 201);
  assert.equal(forced.body.patient.id, "P-1002", "ids are issued in order by the server");

  const found = await api("GET", "/patients?search=okafor", { token: t });
  assert.equal(found.body.total, 2);
  assert.equal((await api("GET", "/patients?search=%25", { token: t })).body.total, 0, "% is searched literally, not as a wildcard");

  const upd = await api("PUT", "/patients/P-1001", { token: t, body: { ...p, phone: "0803 555 9999", allergies: "Penicillin, Sulfa" } });
  assert.equal(upd.status, 200);
  const log = await api("GET", "/audit?module=Patients&limit=5", { token: t });
  const entry = log.body.entries.find((e) => /Updated Ngozi Okafor/.test(e.summary));
  assert.ok(entry && /phone/.test(entry.summary) && /allergies/.test(entry.summary));
  assert.ok(!/9999|Sulfa/.test(JSON.stringify(log.body.entries)), "the audit log records which fields changed, never their values");
  assert.equal((await api("GET", "/patients/P-9999", { token: t })).status, 404);
});

test("clinical records keep a patient from being deleted", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const t = admin.accessToken;
  const p = await api("POST", "/patients", { token: t, body: { name: "Has Notes", dob: "1980-02-02", gender: "Male", phone: "0900 000 0001" } });
  await query("INSERT INTO clinical_notes (id, patient_id, category, body, author_id, author_name, event_at) VALUES ('n1', ?, 'Consultation', 'x', 'u-admin', 'Test Admin', NOW(3))", [p.body.patient.id]);
  assert.equal((await api("DELETE", `/patients/${p.body.patient.id}`, { token: t })).status, 409);
  const q = await api("POST", "/patients", { token: t, body: { name: "No Notes", dob: "1981-02-02", gender: "Male", phone: "0900 000 0002" } });
  assert.equal((await api("DELETE", `/patients/${q.body.patient.id}`, { token: t })).status, 200);
});

test("emergency access: reason required, read-only, time-limited by the server, fully logged", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const pharm = await login("pat@test.local", (await (async () => {
    const r = await api("POST", "/users/" + (await query("SELECT id FROM users WHERE email='pat@test.local'"))[0].id + "/reset-password", { token: admin.accessToken });
    const first = await login("pat@test.local", r.body.temporaryPassword);
    const ch = await api("POST", "/auth/change-password", { token: first.accessToken, body: { currentPassword: r.body.temporaryPassword, newPassword: "Zeta-Orbit-4821-xq" } });
    assert.equal(ch.status, 200);
    return "Zeta-Orbit-4821-xq";
  })()));
  const t = pharm.accessToken;
  assert.equal((await api("GET", "/patients", { token: t })).status, 403);
  assert.equal((await api("POST", "/emergency-access", { token: t, body: { reason: "too short" } })).status, 400);
  assert.equal((await api("POST", "/emergency-access", { token: admin.accessToken, body: { reason: "I already have access to everything" } })).status, 409);

  const g = await api("POST", "/emergency-access", { token: t, body: { reason: "Unconscious patient on the ward, need allergies" } });
  assert.equal(g.status, 201);
  assert.ok(Date.parse(g.body.grant.expiresAt.replace(" ", "T") + "Z") > Date.now());

  assert.equal((await api("GET", "/patients", { token: t })).status, 200);
  assert.equal((await api("GET", "/patients/P-1001", { token: t })).status, 200);
  assert.equal((await api("POST", "/patients", { token: t, body: { name: "Not Allowed", dob: "2000-01-01", gender: "Male" } })).status, 403, "emergency access is read-only");
  assert.equal((await api("PUT", "/patients/P-1001", { token: t, body: { name: "Hacked Name", dob: "1990-05-14", gender: "Female" } })).status, 403);
  assert.equal((await api("GET", "/users", { token: t })).status, 403, "and covers patient records only");

  const log = await api("GET", "/audit?module=Emergency%20access", { token: admin.accessToken });
  const text = JSON.stringify(log.body.entries);
  assert.ok(/Unconscious patient on the ward/.test(text), "the reason is recorded");
  assert.ok(/opened the record of Ngozi Okafor \(P-1001\) in an emergency/.test(text), "every record opened is recorded");

  // Time is up: the server stops honouring the grant without anyone ending it.
  await query("UPDATE emergency_grants SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE user_id = (SELECT id FROM users WHERE email='pat@test.local')");
  assert.equal((await api("GET", "/patients", { token: t })).status, 403);

  // Ending it by hand also works.
  assert.equal((await api("POST", "/emergency-access", { token: t, body: { reason: "Second emergency, different patient" } })).status, 201);
  assert.equal((await api("DELETE", "/emergency-access", { token: t })).status, 200);
  assert.equal((await api("GET", "/patients", { token: t })).status, 403);
});

test("audit log: written by the server, filterable, admin-only, tamper-evident and append-only", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const t = admin.accessToken;
  const all = await api("GET", "/audit?limit=500", { token: t });
  assert.equal(all.status, 200);
  assert.ok(all.body.entries.some((e) => e.action === "Sign in"));
  assert.ok(all.body.entries.some((e) => e.action === "Failed sign-in"));
  assert.ok(all.body.entries.every((e) => e.ip && e.device), "address and device are recorded by the server");

  const v = await api("GET", "/audit/verify", { token: t });
  assert.equal(v.body.ok, true, v.body.message);

  // The database itself refuses edits and deletes.
  await assert.rejects(query("UPDATE audit_log SET summary = 'x' WHERE seq = 1"), /append-only/);
  await assert.rejects(query("DELETE FROM audit_log WHERE seq = 1"), /append-only/);

  // Someone with full database access removes the guard and edits a row: the chain check catches it.
  const db = await dbAdmin();
  await db.query("DROP TRIGGER audit_log_no_update");
  await db.query("UPDATE audit_log SET summary = 'tampered' WHERE seq = 3");
  const bad = await verifyChain();
  assert.equal(bad.ok, false);
  assert.equal(bad.seq, 3);
  await db.end();
});

const book0 = (token, patientId, doctor) => api("POST", "/appointments", { token, body: { patientId, doctor, date: "2030-03-04", time: "09:00", type: "General consultation" } });

test("appointments: registered patients only, no double booking, status rules, permissions, nothing clinical in the log", async () => {
  const admin = (await login(ADMIN.email, ADMIN.password)).accessToken;
  const doctor = (await newStaff(admin, "Dr Appt Tester", "appt.doctor@test.local", "r-doctor")).accessToken;
  const nurse = (await newStaff(admin, "Nurse Appt Tester", "appt.nurse@test.local", "r-nurse")).accessToken;
  const pat = await api("POST", "/patients", { token: admin, body: { name: "Appt Patient", dob: "1985-02-02", gender: "Male", phone: "0901 555 0001" } });
  assert.equal(pat.status, 201);
  const pid = pat.body.patient.id;
  for (const name of ["Dr. Eze", "Dr. Obi"]) assert.equal((await api("POST", "/doctors", { token: admin, body: { name, days: [1, 2, 3, 4, 5], start: "08:00", end: "16:00" } })).status, 201);
  assert.equal((await book0(admin, pid, "Dr. Nobody")).status, 404, "a doctor who isn't in the directory can't be booked");
  const day = "2030-03-04";
  const book = (body, token = admin) => api("POST", "/appointments", { token, body: { patientId: pid, doctor: "Dr. Eze", date: day, time: "09:00", type: "General consultation", ...body } });

  const a = await book({ reason: "secret-clinical-reason" });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.appointment.id, "A-201");
  assert.equal(a.body.appointment.patient, "Appt Patient", "the name comes from the register");
  assert.equal(a.body.appointment.status, "Scheduled");
  assert.equal(a.body.appointment.phone, "0901 555 0001");
  assert.equal((await book({ time: "09:30", status: "Completed" })).body.appointment.status, "Scheduled", "a client can't choose the status when booking");

  assert.equal((await book({ patientId: "P-9999", time: "10:00" })).status, 400, "unregistered patient");
  assert.equal((await book({ time: "08:15" })).status, 400, "not a real slot");
  assert.equal((await book({ type: "Haircut", time: "10:00" })).status, 400);
  assert.equal((await book({ date: "2030-02-31", time: "10:00" })).status, 400);

  const clash = await book({});
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, "slot_taken");
  const other = await book({ doctor: "Dr. Obi" });
  assert.equal(other.status, 201, "a different doctor can have the same time");

  // Five clerks book the same free slot at the same instant: exactly one wins.
  const race = await Promise.all([1, 2, 3, 4, 5].map(() => book({ date: "2030-03-05", time: "11:00" })));
  assert.equal(race.filter((r) => r.status === 201).length, 1);
  assert.equal(race.filter((r) => r.status === 409).length, 4);

  assert.equal((await api("GET", `/appointments?date=${day}`, { token: admin })).body.appointments.length, 3);
  assert.equal((await api("GET", `/appointments?date=${day}&doctor=Dr.%20Obi`, { token: admin })).body.appointments.length, 1);
  assert.equal((await api("GET", `/appointments?patientId=${pid}&status=Scheduled`, { token: admin })).body.appointments.length, 4);

  // Rescheduling
  const id = a.body.appointment.id;
  assert.equal((await api("PUT", `/appointments/${id}`, { token: admin, body: { time: "14:00" } })).body.appointment.time, "14:00");
  assert.equal((await api("PUT", `/appointments/${id}`, { token: admin, body: { doctor: "Dr. Obi", time: "09:00" } })).status, 409, "moving onto someone else's slot");

  // Status rules
  assert.equal((await api("POST", `/appointments/${id}/status`, { token: admin, body: { status: "Completed" } })).status, 409, "can't complete what hasn't started");
  assert.equal((await api("POST", `/appointments/${id}/status`, { token: admin, body: { status: "Done" } })).status, 400);
  for (const s of ["Checked in", "In Progress", "Completed"]) assert.equal((await api("POST", `/appointments/${id}/status`, { token: admin, body: { status: s } })).status, 200, s);
  assert.equal((await api("PUT", `/appointments/${id}`, { token: admin, body: { time: "15:00" } })).status, 409, "a completed appointment is not editable");
  assert.equal((await api("POST", `/appointments/${id}/status`, { token: admin, body: { status: "Scheduled" } })).status, 409);
  assert.equal((await api("DELETE", `/appointments/${id}`, { token: admin })).status, 409, "a completed appointment is part of the record");

  // Cancelling frees the slot; bringing it back fails if someone took the slot meanwhile.
  const obi = other.body.appointment.id;
  assert.equal((await api("POST", `/appointments/${obi}/status`, { token: admin, body: { status: "Cancelled" } })).status, 200);
  assert.equal((await book({ doctor: "Dr. Obi" })).status, 201);
  const back = await api("POST", `/appointments/${obi}/status`, { token: admin, body: { status: "Scheduled" } });
  assert.equal(back.status, 409);
  assert.equal(back.body.code, "slot_taken");

  // Permissions: the doctor role can book but not delete; a nurse has no appointment access at all.
  assert.equal((await api("GET", "/appointments", { token: doctor })).status, 200);
  assert.equal((await book({ time: "12:00" }, doctor)).status, 201);
  assert.equal((await api("DELETE", `/appointments/${obi}`, { token: doctor })).status, 403);
  assert.equal((await api("GET", "/appointments", { token: nurse })).status, 403);
  assert.equal((await book({ time: "12:30" }, nurse)).status, 403);
  assert.equal((await api("GET", "/appointments")).status, 401);

  // Deleting: allowed while it is only a booking; the patient can't be deleted while appointments exist.
  assert.equal((await api("DELETE", `/appointments/${obi}`, { token: admin })).status, 200);
  assert.equal((await api("GET", `/appointments/${obi}`, { token: admin })).status, 404);
  assert.equal((await api("DELETE", `/patients/${pid}`, { token: admin })).status, 409);

  // The reason for the visit is clinical and must never reach the audit log.
  const leaked = await query("SELECT COUNT(*) AS n FROM audit_log WHERE summary LIKE '%secret-clinical-reason%' OR detail LIKE '%secret-clinical-reason%'");
  assert.equal(Number(leaked[0].n), 0);
  const logged = await query("SELECT COUNT(*) AS n FROM audit_log WHERE module = 'Appointments'");
  assert.ok(Number(logged[0].n) >= 8);
});

test("the web app can report page views and actions, but never sign-ins or security events, and anonymous callers are refused", async () => {
  const admin = (await login(ADMIN.email, ADMIN.password)).accessToken;
  const doctor = (await newStaff(admin, "Dr Reporter", "reporter@test.local", "r-doctor")).accessToken;
  const ok = await api("POST", "/audit/client", { token: doctor, body: { action: "View", module: "Laboratory", summary: "Opened Laboratory" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  for (const action of ["Sign in", "Failed sign-in", "Sign out", "Security", "Nonsense"]) {
    assert.equal((await api("POST", "/audit/client", { token: doctor, body: { action, module: "x", summary: "y" } })).status, 400, action);
  }
  assert.equal((await api("POST", "/audit/client", { body: { action: "View", module: "x", summary: "y" } })).status, 401);
  assert.equal((await api("POST", "/audit/client", { token: doctor, body: { action: "View", module: "x", summary: "z".repeat(301) } })).status, 400);
  const log = await api("GET", "/audit?module=Laboratory&q=Opened", { token: admin });
  const mine = log.body.entries.find((e) => e.summary === "Opened Laboratory");
  assert.equal(mine.userName, "Dr Reporter", "the server records who, not the browser");
  assert.match(mine.detail, /Reported by the app/);
  assert.equal((await api("GET", "/audit", { token: doctor })).status, 403, "still administrators only to read");
});

test("staff directory is readable by any signed-in user and exposes names only", async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  assert.equal((await api("GET", "/users/directory")).status, 401);
  const doctor = (await newStaff(admin.accessToken, "Dr Directory", "directory@test.local", "r-doctor")).accessToken;
  const r = await api("GET", "/users/directory", { token: doctor });
  assert.equal(r.status, 200);
  assert.ok(r.body.staff.length >= 2);
  for (const p of r.body.staff) assert.deepEqual(Object.keys(p).sort(), ["id", "name", "roleId"]);
  assert.equal((await api("GET", "/users", { token: doctor })).status, 403, "the full list stays administrators only");
});
