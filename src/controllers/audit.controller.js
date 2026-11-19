import { query } from "../config/database.js";
import { wrap } from "../utils/errors.js";
import { AUDIT_ACTIONS, audit, verifyChain } from "../services/audit.service.js";

const iso = (s) => `${String(s).replace(" ", "T")}Z`;
const entryOut = (r) => ({ id: String(r.seq), seq: Number(r.seq), at: iso(r.at), userId: r.user_id, userName: r.user_name, role: r.role, action: r.action, module: r.module, summary: r.summary, detail: r.detail ?? undefined, outcome: r.outcome, ip: r.ip ?? undefined, device: r.device ?? undefined });

export const list = wrap(async (req, res) => {
  const where = [];
  const args = [];
  const { from, to, user, action, module, outcome, q, before } = req.query;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(from ?? ""))) (where.push("at >= ?"), args.push(`${from} 00:00:00.000`));
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(to ?? ""))) (where.push("at <= ?"), args.push(`${to} 23:59:59.999`));
  if (user) (where.push("user_id = ?"), args.push(String(user).slice(0, 40)));
  if (AUDIT_ACTIONS.includes(String(action))) (where.push("action = ?"), args.push(String(action)));
  if (module) (where.push("module = ?"), args.push(String(module).slice(0, 60)));
  if (outcome === "success" || outcome === "failure") (where.push("outcome = ?"), args.push(outcome));
  if (q) {
    const like = `%${String(q).slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push("(summary LIKE ? OR user_name LIKE ? OR detail LIKE ?)");
    args.push(like, like, like);
  }
  if (Number(before) > 0) (where.push("seq < ?"), args.push(Number(before)));
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = await query(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`, [...args, limit]);
  res.json({ entries: rows.map(entryOut), next: rows.length === limit ? Number(rows[rows.length - 1].seq) : null });
});

export const verify = wrap(async (req, res) => {
  const result = await verifyChain();
  await audit(req, { action: "Security", module: "Audit log", summary: `${req.user.name} checked the audit log: ${result.message}`, outcome: result.ok ? "success" : "failure" });
  res.json(result);
});

/** The web app reporting an action in a part of the system that is not on the server yet. The server adds who, when and from where. */
export const clientEntry = wrap(async (req, res) => {
  const { action, module, summary, detail, outcome } = req.body;
  await audit(req, { action, module, summary, detail: `Reported by the app.${detail ? ` ${detail}` : ""}`, outcome });
  res.status(201).json({ ok: true });
});
