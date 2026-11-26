import { query, tx } from "../config/database.js";
import { conflict, notFound } from "../utils/errors.js";
import { nextCounter } from "./ids.js";

export const doctorOut = (r) => ({
  id: r.id,
  name: r.name,
  specialty: r.specialty,
  phone: r.phone,
  email: r.email,
  days: String(r.days).split(",").filter(Boolean).map(Number),
  start: r.start_time,
  end: r.end_time,
  status: r.status,
});

export const listDoctors = async () => (await query("SELECT * FROM doctors ORDER BY name")).map(doctorOut);
export const getDoctorRow = async (id) => (await query("SELECT * FROM doctors WHERE id = ?", [id]))[0];
export const doctorByName = async (name) => (await query("SELECT * FROM doctors WHERE name = ?", [name]))[0];
export const nameTaken = async (name, exceptId = "") => (await query("SELECT id FROM doctors WHERE name = ? AND id <> ?", [name, exceptId])).length > 0;

export async function createDoctor(d, by) {
  if (await nameTaken(d.name)) throw conflict("A doctor with this name is already in the directory.");
  const id = await tx(async (conn) => {
    const n = await nextCounter(conn, "doctor", 0);
    const id = `DR-${String(n).padStart(2, "0")}`;
    await conn.query("INSERT INTO doctors (id, name, specialty, phone, email, days, start_time, end_time, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [id, d.name, d.specialty, d.phone, d.email, [...new Set(d.days)].sort().join(","), d.start, d.end, d.status, by]);
    return id;
  });
  return doctorOut(await getDoctorRow(id));
}

export async function updateDoctor(row, d) {
  if (d.name && d.name !== row.name) {
    if (await nameTaken(d.name, row.id)) throw conflict("A doctor with this name is already in the directory.");
    // Appointments and admissions hold the name, so a renamed doctor with history would orphan them.
    if ((await historyCount(row.name)) > 0) throw conflict("This doctor has appointments or admissions on record, so the name can't be changed. Add a new entry instead.");
  }
  const map = { name: "name", specialty: "specialty", phone: "phone", email: "email", start: "start_time", end: "end_time", status: "status" };
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) (sets.push(`${col} = ?`), vals.push(d[k]));
  if (d.days) (sets.push("days = ?"), vals.push([...new Set(d.days)].sort().join(",")));
  const start = d.start ?? row.start_time;
  const end = d.end ?? row.end_time;
  if (start >= end) throw conflict("The shift must end after it starts.");
  if (sets.length) await query(`UPDATE doctors SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  return doctorOut(await getDoctorRow(row.id));
}

export const setDoctorStatus = async (row, status) => {
  await query("UPDATE doctors SET status = ? WHERE id = ?", [status, row.id]);
  return doctorOut(await getDoctorRow(row.id));
};

export async function historyCount(name) {
  const [a] = await query("SELECT COUNT(*) AS n FROM appointments WHERE doctor = ?", [name]);
  const [b] = await query("SELECT COUNT(*) AS n FROM admissions WHERE doctor = ?", [name]);
  return Number(a.n) + Number(b.n);
}

export async function deleteDoctor(row) {
  if ((await historyCount(row.name)) > 0) throw conflict("This doctor has appointments or admissions on record. Set the status to On Leave instead of deleting.");
  await query("DELETE FROM doctors WHERE id = ?", [row.id]);
}

/** Used by appointments and admissions: the name must belong to a doctor in the directory. */
export async function assertDoctor(name) {
  if (!(await doctorByName(name))) throw notFound("That doctor isn't in the directory. Add the doctor under Doctors first.");
}
