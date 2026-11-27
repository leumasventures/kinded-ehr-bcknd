import { bad, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { addNote, listNotes, listVitals, recordVitals, wardBoard } from "../services/nursing.service.js";

// Measurements and note text are clinical, so the audit log records who recorded something for which patient and when,
// and only the number of flagged values, never the values or the words.

const needPatient = (req) => {
  const id = String(req.query.patientId ?? "").slice(0, 20);
  if (!id) throw bad("Say which patient with ?patientId=.");
  return id;
};

export const vitals = wrap(async (req, res) => {
  res.json({ vitals: await listVitals({ patientId: needPatient(req), limit: req.query.limit }) });
});

export const record = wrap(async (req, res) => {
  const reading = await recordVitals(req.body, req.user);
  const flagged = reading.alerts.length;
  await audit(req, { action: "Create", module: "Nursing", summary: `Recorded vitals for ${reading.patient} (${reading.patientId})${flagged ? `; ${flagged} value${flagged === 1 ? "" : "s"} flagged` : ""}` });
  // alerts come back with the reading so the screen can highlight them straight away.
  res.status(201).json({ vitals: reading });
});

// Admitted patients with their latest vitals, optionally one ward: ?ward=
export const board = wrap(async (req, res) => {
  const patients = await wardBoard({ ward: req.query.ward ? String(req.query.ward).slice(0, 60) : undefined });
  // The web app reads "board"; "patients" is kept for anything that already uses it.
  res.json({ patients, board: patients });
});

export const notes = wrap(async (req, res) => {
  res.json({ notes: await listNotes({ patientId: needPatient(req), limit: req.query.limit }) });
});

export const createNote = wrap(async (req, res) => {
  const note = await addNote(req.body, req.user);
  await audit(req, { action: "Create", module: "Nursing", summary: `Added a nursing note for ${note.patient} (${note.patientId})` });
  res.status(201).json({ note });
});

// There is no edit or delete for vitals or notes: correct a mistake by adding a new entry.