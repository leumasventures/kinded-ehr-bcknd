import { ApiError, wrap } from "../utils/errors.js";
import { verifyAccess } from "../services/token.service.js";
import { findUserById, publicUser } from "../services/user.service.js";

/** Reads the Bearer token, loads the user fresh from the database, and attaches req.user.
 *  Loading every time means deactivating someone or changing their role takes effect on their very next request. */
export const authenticate = ({ allowPendingPassword = false } = {}) =>
  wrap(async (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new ApiError(401, "Sign in to continue.");
    const row = await findUserById(verifyAccess(token));
    if (!row || !row.active) throw new ApiError(401, "This account is not active.");
    req.user = publicUser(row);
    if (req.user.mustChangePassword && !allowPendingPassword) throw new ApiError(403, "Choose a new password before continuing.", { code: "password_change_required" });
    next();
  });
