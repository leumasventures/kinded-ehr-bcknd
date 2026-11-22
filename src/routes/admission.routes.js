import { Router } from "express";
import { authenticate, allow, validate, ACCESS } from "./guards.js";
import * as c from "../controllers/admission.controller.js";
import { createSchema, dischargeSchema, updateSchema } from "../validators/admission.validator.js";

const A = ACCESS.admissions;
const r = Router();
r.use(authenticate());

r.get("/", allow(...A.read), c.list);
r.get("/census", allow(...A.read), c.census); // before /:id
r.get("/:id", allow(...A.read), c.get);
r.post("/", allow(...A.admit), validate(createSchema), c.create);
r.patch("/:id", allow(...A.manage), validate(updateSchema), c.update);
r.post("/:id/discharge", allow(...A.manage), validate(dischargeSchema), c.discharge);

export default r;