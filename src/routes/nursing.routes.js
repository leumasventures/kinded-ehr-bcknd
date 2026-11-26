import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/nursing.controller.js";
import { noteSchema, vitalsSchema } from "../validators/nursing.validator.js";

const r = Router();
r.use(authenticate());

r.get("/vitals", requirePerm("Nursing", "view"), c.vitals); // ?patientId=
r.post("/vitals", requirePerm("Nursing", "create"), validate(vitalsSchema), c.record);
r.get("/board", requirePerm("Nursing", "view"), c.board);
r.get("/notes", requirePerm("Nursing", "view"), c.notes); // ?patientId=
r.post("/notes", requirePerm("Nursing", "create"), validate(noteSchema), c.createNote);

export default r;