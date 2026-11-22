import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { addDaysISO, assignShifts, createEntry, entryOut, getEntry, listEntries, onDuty, removeEntry, todayISO, updateEntry } from "../services/dutyroster.service.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const label = (e) => `${e.staff_name ?? e.staff} on ${e.shift_date ?? e.date} (${e.shift}${e.department ? `, ${e.department}` : ""})`;

// Default window is the next two weeks, which is what the roster screen shows.
export const list = wrap(async (req, res) => {
  const { from, to, staffId, department } = req.query;
  const start = isDay(from) ? from : todayISO();
  const entries = await listEntries({
    from: start,
    to: isDay(to) ? to : addDaysISO(start, 13),
    staffId: staffId ? String(staffId).slice(0, 40) : undefined,
    department: department ? String(department).slice(0, 60) : undefined,
    limit: req.query.limit,
  });
  res.json({ entries });
});

// The signed-in person's own upcoming shifts.
export const mine = wrap(async (req, res) => {
  const today = todayISO();
  res.json({ entries: await listEntries({ from: today, to: addDaysISO(today, 30), staffId: req.user.id }) });
});

// Who is on duty on a date (default today), grouped by shift.
export const duty = wrap(async (req, res) => {
  const date = isDay(req.query.date) ? req.query.date : todayISO();
  res.json({ date, shifts: await onDuty(date) });
});

export const create = wrap(async (req, res) => {
  const row = await createEntry(req.body, req.user);
  await audit(req, { action: "Create", module: "Duty roster", summary: `Rostered ${label(row)}` });
  res.status(201).json({ entry: entryOut(row) });
});

export const assign = wrap(async (req, res) => {
  const { created, skipped } = await assignShifts(req.body, req.user);
  const b = req.body;
  await audit(req, { action: "Create", module: "Duty roster", summary: `Rostered ${new Set(b.staffIds).size} staff for the ${b.shift.toLowerCase()} shift on ${new Set(b.dates).size} date(s)${b.department ? ` in ${b.department}` : ""}: ${created} added, ${skipped} already there` });
  res.status(201).json({ created, skipped });
});

export const update = wrap(async (req, res) => {
  const row = await getEntry(req.params.id);
  if (!row) throw notFound("Roster entry not found.");
  const changed = await updateEntry(row, req.body);
  if (changed.length) await audit(req, { action: "Update", module: "Duty roster", summary: `Updated the shift of ${label(row)}: ${changed.join(", ")}` });
  res.json({ entry: entryOut(await getEntry(row.id)) });
});

export const remove = wrap(async (req, res) => {
  const row = await getEntry(req.params.id);
  if (!row) throw notFound("Roster entry not found.");
  await removeEntry(row);
  await audit(req, { action: "Delete", module: "Duty roster", summary: `Removed ${label(row)} from the roster` });
  res.json({ ok: true });
});