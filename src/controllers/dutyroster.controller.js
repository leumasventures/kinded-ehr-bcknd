import { forbidden, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { createShifts, deleteShift, getShiftRow, listShifts, shiftOut, updateShift } from "../services/roster.service.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));

/** Everyone may read their own shifts (?mine=1). The whole roster needs Roster view. */
export const list = wrap(async (req, res) => {
  const mine = req.query.mine === "1" || req.query.mine === "true";
  if (!mine && !req.user.permissions.Roster?.view) throw forbidden();
  const shifts = await listShifts({ from: isDay(req.query.from) ? req.query.from : undefined, to: isDay(req.query.to) ? req.query.to : undefined, staffId: mine ? req.user.id : req.query.staffId ? String(req.query.staffId).slice(0, 40) : undefined });
  res.json({ shifts });
});

export const create = wrap(async (req, res) => {
  const { created, skipped } = await createShifts(req.body.entries, { onConflict: req.body.onConflict, by: req.user.id });
  if (created.length) await audit(req, { action: "Create", module: "Roster", summary: `Added ${created.length} shift${created.length === 1 ? "" : "s"} (${created[0].date}${created.length > 1 ? ` to ${created[created.length - 1].date}` : ""}), ${skipped.length} skipped` });
  res.status(201).json({ created, skipped });
});

export const update = wrap(async (req, res) => {
  const row = await getShiftRow(req.params.id);
  if (!row) throw notFound("Shift not found.");
  const shift = await updateShift(row, req.body);
  await audit(req, { action: "Update", module: "Roster", summary: `Changed ${row.staff_name}'s shift on ${row.shift_date}` });
  res.json({ shift });
});

export const remove = wrap(async (req, res) => {
  const row = await getShiftRow(req.params.id);
  if (!row) throw notFound("Shift not found.");
  await deleteShift(row.id);
  await audit(req, { action: "Delete", module: "Roster", summary: `Removed ${row.staff_name}'s ${row.shift} shift on ${row.shift_date}` });
  res.json({ ok: true });
});

export { shiftOut };
