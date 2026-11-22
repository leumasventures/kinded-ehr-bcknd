import { Router } from "express";
import { authenticate, allow, validate, ACCESS } from "./guards.js";
import * as c from "../controllers/nursing.controller.js";
import { noteSchema, vitalsSchema } from "../validators/nursing.validator.js";

const r = Router();
r.use(authenticate(), allow(...ACCESS.nursing.use));

r.get("/vitals", c.vitals); // ?patientId=
r.post("/vitals", validate(vitalsSchema), c.record);
r.get("/board", c.board);
r.get("/notes", c.notes); // ?patientId=
r.post("/notes", validate(noteSchema), c.createNote);

export default r;