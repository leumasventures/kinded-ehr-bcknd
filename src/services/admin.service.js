import { query } from "../config/database.js";
import { ADMIN_ROLE_ID } from "../config/permissions.js";
import { listInvoices } from "./billing.service.js";

const STALE_DAYS = 30;
const days = (stamp) => (stamp ? Math.floor((Date.now() - new Date(String(stamp).replace(" ", "T") + (String(stamp).includes("Z") ? "" : "Z")).getTime()) / 86_400_000) : null);

/** Everything the administrator's dashboard shows, computed from the database in one place. */
export async function dashboard() {
  const users = await query("SELECT id, name, role_id, active, last_login, locked_until FROM users");
  const roles = await query("SELECT id, name FROM roles ORDER BY name");
  const active = users.filter((u) => u.active);
  const activeAdmins = active.filter((u) => u.role_id === ADMIN_ROLE_ID).length;
  const inactive = users.length - active.length;
  const stale = active.filter((u) => u.last_login && days(u.last_login) > STALE_DAYS);
  const never = active.filter((u) => !u.last_login);
  const locked = users.filter((u) => u.locked_until && new Date(String(u.locked_until).replace(" ", "T") + "Z") > new Date());

  const attention = [];
  if (activeAdmins <= 1) attention.push({ tone: "warn", text: "Only one active administrator. Add another so you can't be locked out." });
  if (locked.length) attention.push({ tone: "warn", text: `Locked after failed sign-ins: ${locked.map((u) => u.name).join(", ")}.` });
  if (inactive > 0) attention.push({ tone: "info", text: `${inactive} deactivated account${inactive > 1 ? "s" : ""}. Delete if no longer needed.` });
  if (stale.length) attention.push({ tone: "warn", text: `No sign-in in ${STALE_DAYS}+ days: ${stale.map((u) => u.name).join(", ")}.` });
  if (never.length) attention.push({ tone: "info", text: `Never signed in: ${never.map((u) => u.name).join(", ")}.` });

  const count = async (sql) => Number((await query(sql))[0].n);
  const recent = await query("SELECT seq, at, user_name, role, action, module, summary, outcome FROM audit_log ORDER BY seq DESC LIMIT 8");
  return {
    users: { total: users.length, active: active.length, inactive, activeAdmins, locked: locked.length },
    perRole: roles.map((r) => ({ roleId: r.id, role: r.name, count: users.filter((u) => u.role_id === r.id).length })),
    attention,
    records: {
      patients: await count("SELECT COUNT(*) AS n FROM patients"),
      doctors: await count("SELECT COUNT(*) AS n FROM doctors"),
      appointmentsToday: await count("SELECT COUNT(*) AS n FROM appointments WHERE appt_date = CURDATE()"),
      admitted: await count("SELECT COUNT(*) AS n FROM admissions WHERE status = 'Admitted'"),
      unpaidInvoices: (await listInvoices({ limit: 500 })).filter((i) => i.status !== "Paid").length,
      openClaims: await count("SELECT COUNT(*) AS n FROM claims WHERE status IN ('Draft','Submitted','Approved')"),
    },
    recentAudit: recent.map((r) => ({ seq: Number(r.seq), at: r.at, userName: r.user_name, role: r.role, action: r.action, module: r.module, summary: r.summary, outcome: r.outcome })),
  };
}
