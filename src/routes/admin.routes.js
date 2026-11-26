import { Router } from "express";
import { authenticate, requireAdmin } from "./guards.js";
import * as c from "../controllers/admin.controller.js";

const r = Router();
r.use(authenticate(), requireAdmin); // administrators only

r.get("/overview", c.overview);
r.get("/locked", c.lockedAccounts);
r.get("/stale", c.staleAccounts);
r.post("/users/:id/unlock", c.unlock);
r.post("/users/:id/sign-out", c.signOut);

export default r;