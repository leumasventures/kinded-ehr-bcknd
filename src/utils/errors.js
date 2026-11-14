export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (m, extra) => new ApiError(400, m, extra);
export const notFound = (m = "Not found.") => new ApiError(404, m);
export const forbidden = (m = "You don't have permission to do this.") => new ApiError(403, m);
export const conflict = (m, extra) => new ApiError(409, m, extra);

/** Express 4 doesn't catch rejected promises on its own. Wrap async handlers with this. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
