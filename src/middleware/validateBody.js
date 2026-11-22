import { bad } from "../utils/errors.js";

/** Parses req.body with a zod schema and replaces it with the cleaned data, or fails with the first problem.
 *  Unknown keys are dropped, so a client can't smuggle extra fields past the controller. */
export const validateBody = (schema) => (req, _res, next) => {
  const out = schema.safeParse(req.body ?? {});
  if (!out.success) {
    const issue = out.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return next(bad(`${where}${issue.message}`));
  }
  req.body = out.data;
  next();
};