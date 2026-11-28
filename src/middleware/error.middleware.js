import { ZodError } from "zod";
import { ApiError } from "../utils/errors.js";

export const notFoundHandler = (_req, res) => res.status(404).json({ error: "Not found." });

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof ZodError)
    return res.status(400).json({
      error: "Check the details you entered.",
      issues: err.issues.map((i) => i.message),
    });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "The request wasn't valid JSON." });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "The request is too large." });

  console.error(err);

  // Surface DB errors so production can be fixed without guessing (table missing, bad column, etc.).
  if (err && (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR" || err.code === "ER_DUP_ENTRY" || err.errno)) {
    return res.status(500).json({
      error: err.sqlMessage || err.message || "Database error.",
      code: err.code,
      errno: err.errno,
      sql: typeof err.sql === "string" ? err.sql.slice(0, 300) : undefined,
    });
  }

  res.status(500).json({ error: "Something went wrong on the server." });
};
