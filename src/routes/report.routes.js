import { Router } from "express";
import { authenticate, allow, ACCESS } from "./guards.js";
import * as c from "../controllers/report.controller.js";

const R = ACCESS.reports;
const r = Router();
r.use(authenticate());

// money
r.get("/revenue", allow(...R.money), c.revenue);
r.get("/receivables", allow(...R.money), c.receivables);
r.get("/claims", allow(...R.money), c.claims);
// clinical activity
r.get("/admissions", allow(...R.clinical), c.admissions);
r.get("/appointments", allow(...R.clinical), c.appointments);
r.get("/laboratory", allow(...R.clinical), c.laboratory);
r.get("/pharmacy", allow(...R.pharmacy), c.pharmacy);

export default r;