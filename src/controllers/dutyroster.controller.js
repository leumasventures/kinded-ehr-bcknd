import { forbidden, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import {
  assignShifts,
  createEntry,
  entryOut,
  getEntry,
  listEntries,
  onDuty,
  removeEntry,
  todayISO,
  updateEntry,
} from "../services/dutyroster.service.js";

const isDay = (s) => /^\\d{4}-\\d{2}-\\d{2}$/.test(String(s ?? ""));

export const list = wrap(async (req, res) => {
  const mine = req.query.mine === "1" || req.query.mine === "true";
  if (!mine && !req.user.permissions.Roster?.view) throw forbidden();
  const entries = await listEntries({
    from: isDay(req.query.from) ? req.query.from : undefined,
    to: isDay(req.query.to) ? req.query.to : undefined,
    staffId: mine ? req.user.id : req.query.staffId ? String(req.query.staffId).slice(0, 40) : undefined,
    department: req.query.department ? String(req.query.department).slice(0, 60) : undefined,
    limit: req.query.limit,
  });
  res.json({ entries, roster: entries });
});

export const mine = wrap(async (req, res) => {
  const entries = await listEntries({ staffId: req.user.id, from: isDay(req.query.from) ? req.query.from : undefined, to: isDay(req.query.to) ? req.query.to : undefined });
  res.json({ entries, roster: entries });
});

export const duty = wrap(async (req, res) => {
  const date = isDay(req.query.date) ? req.query.date : todayISO();
  res.json({ shifts: await onDuty(date) });
});

export const create = wrap(async (req, res) => {
  const entry = entryOut(await createEntry(req.body, req.user));
  await audit(req, { action: "Create", module: "Duty roster", summary: `Rostered ${entry.staff} on ${entry.date} for ${entry.shift}` });
  res.status(201).json({ entry });
});

export const assign = wrap(async (req, res) => {
  const result = await assignShifts(req.body, req.user);
  if (result.created) await audit(req, { action: "Create", module: "Duty roster", summary: `Assigned ${result.created} duty roster shifts` });
  res.status(201).json(result);
});

export const update = wrap(async (req, res) => {
  const row = await getEntry(req.params.id);
  if (!row) throw notFound("Roster entry not found.");
  const changed = await updateEntry(row, req.body);
  const entry = entryOut(await getEntry(req.params.id));
  if (changed.length) await audit(req, { action: "Update", module: "Duty roster", summary: `Updated roster entry ${entry.id}: ${changed.join(", ")}` });
  res.json({ entry });
});

export const remove = wrap(async (req, res) => {
  const row = await getEntry(req.params.id);
  if (!row) throw notFound("Roster entry not found.");
  await removeEntry(row);
  await audit(req, { action: "Delete", module: "Duty roster", summary: `Removed ${row.staff_name}'s ${row.shift} shift on ${row.shift_date}` });
  res.json({ ok: true });
});
