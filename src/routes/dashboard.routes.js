import { Router } from "express";
import { authenticate, allow, ACCESS } from "./guards.js";
import * as c from "../controllers/dashboard.controller.js";

const r = Router();
r.use(authenticate());

r.get("/", c.overview); // counts only, open to any signed-in staff
r.get("/money", allow(...ACCESS.dashboard.money), c.money);

export default r;