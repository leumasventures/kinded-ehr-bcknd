import { ApiError } from "../utils/errors.js";

/** Checks req.body against a zod schema and replaces it with the cleaned result. Nothing reaches a controller unchecked.
 *  `message` is what the caller sees (pass null to show the first problem found instead);
 *  `issues: false` hides the field-by-field detail (used on sign-in). */
export const validate = (schema, message, { status = 400, issues = true } = {}) => (req, _res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(status, message ?? parsed.error.issues[0].message, issues ? { issues: parsed.error.issues.map((i) => i.message) } : {}));
  req.body = parsed.data;
  next();
};
