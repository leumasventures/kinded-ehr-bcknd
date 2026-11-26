import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/settings.controller.js";
import { settingsBody } from "../validators/settings.validator.js";

const r = Router();
r.use(authenticate());

r.get("/", requirePerm("Settings", "view"), c.get);
r.put("/", requirePerm("Settings", "edit"), validate(settingsBody, "Check the settings."), c.update);
r.patch("/", requirePerm("Settings", "edit"), validate(settingsBody, "Check the settings."), c.update);

export default r;
