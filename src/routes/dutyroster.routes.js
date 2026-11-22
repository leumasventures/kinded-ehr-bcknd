import { Router } from "express";
import { authenticate, allow, validate } from "./guards.js";
import * as c from "../controllers/dutyroster.controller.js";
import { assignSchema, createSchema, updateSchema } from "../validators/dutyroster.validator.js";

const r = Router();
r.use(authenticate());

// Anyone signed in can see the roster and their own shifts.
r.get("/", c.list);
r.get("/mine", c.mine);
r.get("/on-duty", c.duty);
// Only administrators change it.
r.post("/", allow(), validate(createSchema), c.create);
r.post("/assign", allow(), validate(assignSchema), c.assign);
r.patch("/:id", allow(), validate(updateSchema), c.update);
r.delete("/:id", allow(), c.remove);

export default r;