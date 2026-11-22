import { ApiError } from "../utils/errors.js";
import { ADMIN_ROLE_ID } from "../config/permissions.js";

/** Use after authenticate(). Lets through the listed role ids, plus the administrator. allow() with no ids is administrators only. */
export const allow = (...roleIds) => (req, _res, next) => {
  // ASSUMPTION: publicUser() puts the role id on req.user.roleId.
  if (req.user.roleId === ADMIN_ROLE_ID || roleIds.includes(req.user.roleId)) return next();
  next(new ApiError(403, "You don't have access to this."));
};