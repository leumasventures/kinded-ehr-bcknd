import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { adjustStock, cancelPrescription, createDrug, dispense, drugOut, getDrug, getPrescription, listDrugs, listMovements, listPrescriptions, prescribe, updateDrug } from "../services/pharmacy.service.js";
import { STATUSES } from "../validators/pharmacy.validator.js";

const money = (n) => Number(n).toFixed(2);
const who = (rx) => `${rx.patient} (${rx.patientId})`;
const flag = (v) => v === "1" || v === "true";
// Which drug a patient is on is clinical, so audit lines about prescriptions name the prescription number, the patient and
// counts, never the drug. Stock changes are not about a patient, so those lines do name the drug.

// ---------- drugs and stock ----------

export const drugs = wrap(async (req, res) => {
  res.json({ drugs: await listDrugs({ q: req.query.q ? String(req.query.q).slice(0, 80) : undefined, lowStock: flag(req.query.lowStock), includeInactive: flag(req.query.includeInactive), limit: req.query.limit }) });
});

export const addDrug = wrap(async (req, res) => {
  const row = await createDrug(req.body, req.user);
  await audit(req, { action: "Create", module: "Pharmacy", summary: `Added ${drugOut(row).label} at ${money(row.unit_price)} with opening stock ${row.stock_qty}` });
  res.status(201).json({ drug: drugOut(row) });
});

export const editDrug = wrap(async (req, res) => {
  const row = await getDrug(req.params.id);
  if (!row) throw notFound("Drug not found.");
  const changed = await updateDrug(row, req.body);
  if (changed.length) await audit(req, { action: "Update", module: "Pharmacy", summary: `Updated ${drugOut(row).label}: ${changed.join(", ")}` });
  res.json({ drug: drugOut(await getDrug(row.id)) });
});

// Add or take away stock, always with a reason. The new balance and the reason go into the stock history.
export const stock = wrap(async (req, res) => {
  const drug = await adjustStock(req.params.id, req.body.delta, req.body.reason, req.user);
  await audit(req, { action: "Update", module: "Pharmacy", summary: `Stock of ${drug.label} ${req.body.delta > 0 ? "increased" : "reduced"} by ${Math.abs(req.body.delta)} to ${drug.stockQty}: ${req.body.reason}` });
  res.json({ drug });
});

export const movements = wrap(async (req, res) => {
  if (!(await getDrug(req.params.id))) throw notFound("Drug not found.");
  res.json({ movements: await listMovements(req.params.id, req.query.limit) });
});

// ---------- prescriptions ----------

export const list = wrap(async (req, res) => {
  const { status, patientId, mine } = req.query;
  res.json({
    prescriptions: await listPrescriptions({
      status: STATUSES.includes(String(status)) ? String(status) : undefined,
      patientId: patientId ? String(patientId).slice(0, 20) : undefined,
      prescriberId: flag(mine) ? req.user.id : undefined,
      limit: req.query.limit,
    }),
  });
});

export const get = wrap(async (req, res) => {
  const prescription = await getPrescription(req.params.id);
  if (!prescription) throw notFound("Prescription not found.");
  res.json({ prescription });
});

export const create = wrap(async (req, res) => {
  const prescriptions = await prescribe(req.body, req.user);
  await audit(req, { action: "Create", module: "Pharmacy", summary: `Prescribed ${prescriptions.length} item${prescriptions.length === 1 ? "" : "s"} (${prescriptions.map((p) => p.id).join(", ")}) for ${who(prescriptions[0])}` });
  res.status(201).json({ prescriptions });
});

export const dispenseOne = wrap(async (req, res) => {
  const { prescription, charged, lowStock } = await dispense(req.params.id, req.user);
  await audit(req, { action: "Update", module: "Pharmacy", summary: `Dispensed ${prescription.id} for ${who(prescription)}${charged ? `; ${money(charged.amount)} added to invoice ${charged.invoiceId}` : ""}` });
  // lowStock tells the screen the drug has reached its reorder level.
  res.json({ prescription, charged, lowStock });
});

export const cancel = wrap(async (req, res) => {
  const prescription = await cancelPrescription(req.params.id, req.body.reason);
  await audit(req, { action: "Update", module: "Pharmacy", summary: `Cancelled ${prescription.id} for ${who(prescription)}: ${req.body.reason}` });
  res.json({ prescription });
});

// A dispensed prescription is part of the record and can't be cancelled; a return or correction needs its own process.