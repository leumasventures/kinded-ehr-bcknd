// The only file the route files import their guards from. These are YOUR existing middleware, so a route here is
// protected by exactly the same permissions as the patient routes: requirePerm("Module", "action").
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm, requireAdmin } from "../middleware/permission.middleware.js";
import { validate as checkBody } from "../middleware/validate.middleware.js";

export { authenticate, requirePerm, requireAdmin };

/** validate(schema) shows the first problem found; validate(schema, "Check the details.") shows that message instead. */
export const validate = (schema, message = null) => checkBody(schema, message);

/** Passes when ANY of the listed [module, action] pairs is granted, e.g. requireAny(["Pharmacy", "view"], ["Doctors", "view"]).
 *  When none is, it fails the same way requirePerm does (403, and the blocked attempt goes to the audit log). */
export const requireAny = (...pairs) => {
  const refuse = requirePerm(...pairs[0]);
  return (req, res, next) => (pairs.some(([m, a]) => req.user.permissions[m]?.[a]) ? next() : refuse(req, res, next));
};