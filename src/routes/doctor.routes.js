import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/doctor.controller.js";
import { profileBody } from "../validators/doctor.validator.js";

const r = Router();
r.use(authenticate());

// Directory and profiles (Doctors module)
r.get("/", requirePerm("Doctors", "view"), c.list);
r.get("/workspace", requirePerm("Doctors", "view"), c.workspace);
r.get("/results", requirePerm("Doctors", "view"), c.results);
r.get("/:id", requirePerm("Doctors", "view"), c.get);
r.put("/:id", requirePerm("Doctors", "edit"), validate(profileBody, "Check the doctor profile."), c.upsert);
r.patch("/:id", requirePerm("Doctors", "edit"), validate(profileBody, "Check the doctor profile."), c.upsert);

export default r;
