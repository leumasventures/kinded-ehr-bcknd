import { Router } from "express";
import { authenticate, requirePerm } from "./guards.js";
import * as c from "../controllers/report.controller.js";

const r = Router();
r.use(authenticate(), requirePerm("Reports", "view"));

// money
r.get("/revenue", c.revenue);
r.get("/receivables", c.receivables);
r.get("/claims", c.claims);
// clinical activity
r.get("/admissions", c.admissions);
r.get("/appointments", c.appointments);
r.get("/laboratory", c.laboratory);
r.get("/pharmacy", c.pharmacy);

export default r;