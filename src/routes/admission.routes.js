import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/admission.controller.js";
import { createSchema, dischargeSchema, updateSchema } from "../validators/admission.validator.js";

const r = Router();
r.use(authenticate());

r.get("/", requirePerm("Admissions", "view"), c.list);
r.get("/census", requirePerm("Admissions", "view"), c.census); // before /:id
r.get("/:id", requirePerm("Admissions", "view"), c.get);
r.post("/", requirePerm("Admissions", "create"), validate(createSchema), c.create);
r.put("/:id", requirePerm("Admissions", "edit"), validate(updateSchema), c.update);
r.patch("/:id", requirePerm("Admissions", "edit"), validate(updateSchema), c.update);
r.post("/:id/discharge", requirePerm("Admissions", "edit"), validate(dischargeSchema), c.discharge);

export default r;