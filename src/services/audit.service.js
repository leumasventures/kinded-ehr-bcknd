import { createHash } from "node:crypto";
import { pool, query, sqlNow } from "../config/database.js";

export const AUDIT_ACTIONS = ["Sign in", "Failed sign-in", "Sign out", "View", "Create", "Update", "Delete", "Lock", "Unlock", "Void", "Payment", "Export", "Security"];

const sha = (s) => createHash("sha256").update(s).digest("hex");
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

/** What goes into each row's hash. Changing any of these in the database breaks the chain from that row onward. */
export const rowHash = (prev, r) => sha(JSON.stringify([prev, Number(r.seq), r.at, r.user_id, r.user_name, r.role, r.action, r.module, r.summary, r.detail ?? "", r.outcome]));

export function deviceLabel(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Client";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}

/**
 * Appends one entry. The time, the person and the address always come from the server, never from the request body.
 * Runs in its own transaction and locks the chain head, so entries are numbered and linked strictly in order.
 */
export async function writeAudit({ actor, ip, ua, action, module, summary, detail, outcome = "success" }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[head]] = await conn.query("SELECT last_seq, last_hash FROM audit_head WHERE id = 1 FOR UPDATE");
    const entry = {
      seq: Number(head.last_seq) + 1,
      at: sqlNow(),
      user_id: clip(actor?.id ?? "anonymous", 40),
      user_name: clip(actor?.name ?? "Not signed in", 120),
      role: clip(actor?.roleName ?? "", 80),
      action,
      module: clip(module, 60),
      summary: clip(summary, 500),
      detail: clip(detail, 5000),
      outcome,
    };
    const hash = rowHash(head.last_hash, entry);
    await conn.query(
      "INSERT INTO audit_log (seq, at, user_id, user_name, role, action, module, summary, detail, outcome, ip, device, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [entry.seq, entry.at, entry.user_id, entry.user_name, entry.role, entry.action, entry.module, entry.summary, entry.detail, entry.outcome, clip(ip, 64), clip(deviceLabel(ua), 255), head.last_hash, hash]
    );
    await conn.query("UPDATE audit_head SET last_seq = ?, last_hash = ? WHERE id = 1", [entry.seq, hash]);
    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
}

/** Audit from inside a request handler. If the entry can't be written the request fails: no unlogged actions. */
export const audit = (req, entry) =>
  writeAudit({ actor: req.user, ip: req.ip, ua: req.get("user-agent"), ...entry });

/** Walks the whole log and checks every link. Reports the first row that doesn't match. */
export async function verifyChain() {
  const rows = await query("SELECT * FROM audit_log ORDER BY seq ASC");
  const [head] = await query("SELECT last_seq, last_hash FROM audit_head WHERE id = 1");
  let prev = "0".repeat(64);
  let expectedSeq = rows.length ? Number(rows[0].seq) : 1;
  for (const r of rows) {
    if (Number(r.seq) !== expectedSeq) return { ok: false, checked: rows.length, message: `Entries are missing: number ${expectedSeq} is not in the log.`, seq: expectedSeq };
    if (r.prev_hash !== prev) return { ok: false, checked: rows.length, message: `Entry ${r.seq} does not follow the entry before it.`, seq: Number(r.seq) };
    if (rowHash(prev, r) !== r.hash) return { ok: false, checked: rows.length, message: `Entry ${r.seq} has been changed.`, seq: Number(r.seq) };
    prev = r.hash;
    expectedSeq = Number(r.seq) + 1;
  }
  if (Number(head.last_seq) !== (rows.length ? Number(rows[rows.length - 1].seq) : 0) || head.last_hash !== prev) {
    return { ok: false, checked: rows.length, message: "The newest entries have been removed from the log." };
  }
  return { ok: true, checked: rows.length, message: rows.length ? `All ${rows.length} entries are present and unchanged.` : "The log is empty." };
}
