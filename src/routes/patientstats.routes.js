// GET /api/patients/stats: the four numbers above the patient list.
// Kept in its own file because the patient controller in this repo has no stats handler. Mounted in index.js BEFORE
// /patients, otherwise "stats" would be read as a patient id.
import { Router } from "express";
import { query } from "../config/database.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { wrap } from "../utils/errors.js";

const router = Router();
router.use(authenticate());

router.get(
  "/",
  requirePerm("Patients", "view"),
  wrap(async (_req, res) => {
    const monthStart = `${new Date().toISOString().slice(0, 8)}01`;
    const [r] = await query(
      "SELECT COUNT(*) AS total, COALESCE(SUM(registered_on >= ?), 0) AS new_this_month, COALESCE(SUM(TRIM(allergies) <> ''), 0) AS with_allergies FROM patients",
      [monthStart]
    );
    const [adm] = await query("SELECT COUNT(DISTINCT patient_id) AS n FROM admissions WHERE status = 'Admitted'");
    res.json({
      total: Number(r.total),
      newThisMonth: Number(r.new_this_month),
      admitted: Number(adm.n),
      withAllergies: Number(r.with_allergies),
    });
  })
);

export default router;
