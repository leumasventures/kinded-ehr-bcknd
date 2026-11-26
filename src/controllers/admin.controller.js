import { wrap } from "../utils/errors.js";
import { dashboard } from "../services/admin.service.js";

export const getDashboard = wrap(async (_req, res) => res.json(await dashboard()));
