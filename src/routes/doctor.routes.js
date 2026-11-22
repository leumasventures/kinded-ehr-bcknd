import { Router } from "express";
import { authenticate, allow, ACCESS } from "./guards.js";
import * as c from "../controllers/doctor.controller.js";

const r = Router();
r.use(authenticate(), allow(...ACCESS.doctor.use));

r.get("/workspace", c.workspace);
r.get("/results", c.results);

export default r;