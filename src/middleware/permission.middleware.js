import { forbidden, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { activeGrant } from "../services/emergency.service.js";

/** Allows the request when the person's role (or personal privileges) grant `action` on `module`.
 *  The one exception is break-glass: a live emergency grant allows reading (GET) patient records only. */
export const requirePerm = (module, action) =>
  wrap(async (req, _res, next) => {
    if (req.user.permissions[module]?.[action]) return next();
    if (module === "Patients" && action === "view" && req.method === "GET") {
      const grant = await activeGrant(req.user.id);
      if (grant) {
        req.emergency = grant;
        return next();
      }
    }
    await audit(req, { action: "Security", module, summary: `Blocked: ${req.user.name} tried to ${action} in ${module} without permission (${req.method} ${req.originalUrl.split("?")[0]})`, outcome: "failure" });
    throw forbidden();
  });

export const requireAdmin = wrap(async (req, _res, next) => {
  if (req.user.isAdmin) return next();
  await audit(req, { action: "Security", module: "Admin", summary: `Blocked: ${req.user.name} tried an administrator-only action (${req.method} ${req.originalUrl.split("?")[0]})`, outcome: "failure" });
  throw forbidden("Only administrators can do this.");
});
