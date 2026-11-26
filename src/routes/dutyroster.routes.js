import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/dutyroster.controller.js";
import { assignSchema, createSchema, updateSchema } from "../validators/dutyroster.validator.js";

const r = Router();
r.use(authenticate());

// Everyone can see their own shifts and who is on duty today.
r.get("/mine", c.mine);
r.get("/on-duty", c.duty);
// The full roster, and changes to it, follow the Roster module.
r.get("/", requirePerm("Roster", "view"), c.list);
r.post("/", requirePerm("Roster", "create"), validate(createSchema), c.create);
r.post("/assign", requirePerm("Roster", "create"), validate(assignSchema), c.assign);
r.put("/:id", requirePerm("Roster", "edit"), validate(updateSchema), c.update);
r.patch("/:id", requirePerm("Roster", "edit"), validate(updateSchema), c.update);
r.delete("/:id", requirePerm("Roster", "delete"), c.remove);

export default r;