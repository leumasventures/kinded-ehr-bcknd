import { Router } from "express";
import { authenticate, requirePerm } from "./guards.js";
import * as c from "../controllers/doctor.controller.js";

const r = Router();
r.use(authenticate(), requirePerm("Doctors", "view"));

r.get("/workspace", c.workspace);
r.get("/results", c.results);

export default r;