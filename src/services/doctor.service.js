import { query } from "../config/database.js";
import { bad, notFound } from "../utils/errors.js";

const STATUSES = ["Available", "Not Onseat", "On Leave"];

export const profileOut = (r) => ({
  id: r.staff_id,
  name: r.name,
  email: r.email || undefined,
  phone: r.phone || undefined,
  specialty: r.specialty || "General Medicine",
  days: typeof r.days_json === "string" ? JSON.parse(r.days_json) : r.days_json || [1, 2, 3, 4, 5],
  start: r.start_time || "08:00",
  end: r.end_time || "16:00",
  status: r.status || "Available",
  roleId: r.role_id || undefined,
  roleName: r.role_name || undefined,
});

/** All staff with a doctor profile, plus optionally doctor-role users without a profile yet. */
export async function listDoctors() {
  const rows = await query(
    `SELECT u.id AS staff_id, u.name, u.email, u.phone, u.role_id, r.name AS role_name,
            dp.specialty, dp.days_json, dp.start_time, dp.end_time, dp.status
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN doctor_profiles dp ON dp.staff_id = u.id
      WHERE u.active = 1
        AND (dp.staff_id IS NOT NULL OR r.name LIKE '%Doctor%' OR u.role_id = 'r-doctor')
      ORDER BY u.name`
  );
  return rows.map((r) =>
    profileOut({
      ...r,
      specialty: r.specialty || "General Medicine",
      days_json: r.days_json || [1, 2, 3, 4, 5],
      start_time: r.start_time || "08:00",
      end_time: r.end_time || "16:00",
      status: r.status || "Available",
    })
  );
}

export async function getDoctor(staffId) {
  const [row] = await query(
    `SELECT u.id AS staff_id, u.name, u.email, u.phone, u.role_id, r.name AS role_name,
            dp.specialty, dp.days_json, dp.start_time, dp.end_time, dp.status
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN doctor_profiles dp ON dp.staff_id = u.id
      WHERE u.id = ?`,
    [staffId]
  );
  return row ? profileOut({
    ...row,
    specialty: row.specialty || "General Medicine",
    days_json: row.days_json || [1, 2, 3, 4, 5],
    start_time: row.start_time || "08:00",
    end_time: row.end_time || "16:00",
    status: row.status || "Available",
  }) : null;
}

export async function upsertProfile(staffId, d) {
  const [user] = await query("SELECT id FROM users WHERE id = ? AND active = 1", [staffId]);
  if (!user) throw notFound("Staff member not found.");
  if (d.status && !STATUSES.includes(d.status)) throw bad("Invalid status.");
  const days = Array.isArray(d.days) ? d.days.map(Number).filter((n) => n >= 0 && n <= 6) : [1, 2, 3, 4, 5];
  await query(
    `INSERT INTO doctor_profiles (staff_id, specialty, days_json, start_time, end_time, status)
     VALUES (?, ?, CAST(? AS JSON), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       specialty = VALUES(specialty),
       days_json = VALUES(days_json),
       start_time = VALUES(start_time),
       end_time = VALUES(end_time),
       status = VALUES(status)`,
    [
      staffId,
      (d.specialty || "General Medicine").slice(0, 80),
      JSON.stringify(days),
      (d.start || "08:00").slice(0, 5),
      (d.end || "16:00").slice(0, 5),
      d.status || "Available",
    ]
  );
  return getDoctor(staffId);
}
