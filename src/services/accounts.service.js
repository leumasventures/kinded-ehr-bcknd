import { randomUUID } from "node:crypto";
import { query } from "../config/database.js";
import { bad, notFound } from "../utils/errors.js";

const TXN_TYPES = ["Income", "Expense", "Transfer", "Payroll"];
const STATUSES = ["Posted", "Void"];

export const bookOut = (r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  opening: Number(r.opening),
  active: !!r.active,
  createdAt: r.created_at,
});

export const txnOut = (r) => ({
  id: r.id,
  bookId: r.book_id,
  bookName: r.book_name || undefined,
  date: r.txn_date,
  type: r.type,
  category: r.category || "",
  amount: Number(r.amount),
  memo: r.memo || undefined,
  reference: r.reference || undefined,
  status: r.status,
  createdBy: r.created_by || undefined,
  createdAt: r.created_at,
});

export async function listBooks() {
  const rows = await query("SELECT * FROM account_books WHERE active = 1 ORDER BY name");
  return rows.map(bookOut);
}

export async function createBook(d) {
  const id = randomUUID();
  await query("INSERT INTO account_books (id, name, kind, opening, active) VALUES (?,?,?,?,1)", [
    id,
    String(d.name).slice(0, 120),
    String(d.kind || "Other").slice(0, 40),
    Number(d.opening) || 0,
  ]);
  const [row] = await query("SELECT * FROM account_books WHERE id = ?", [id]);
  return bookOut(row);
}

export async function listTxns({ from, to, type, bookId, limit = 500 } = {}) {
  const where = ["t.status = 'Posted'"];
  const args = [];
  if (from) (where.push("t.txn_date >= ?"), args.push(from));
  if (to) (where.push("t.txn_date <= ?"), args.push(to));
  if (type) (where.push("t.type = ?"), args.push(type));
  if (bookId) (where.push("t.book_id = ?"), args.push(bookId));
  const n = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const rows = await query(
    `SELECT t.*, b.name AS book_name
       FROM account_txns t
       JOIN account_books b ON b.id = t.book_id
      WHERE ${where.join(" AND ")}
      ORDER BY t.txn_date DESC, t.created_at DESC
      LIMIT ${n}`,
    args
  );
  return rows.map(txnOut);
}

export async function createTxn(d, userId) {
  if (!TXN_TYPES.includes(d.type)) throw bad("Invalid transaction type.");
  const [book] = await query("SELECT id FROM account_books WHERE id = ? AND active = 1", [d.bookId]);
  if (!book) throw bad("That account book doesn't exist.");
  const amount = Number(d.amount);
  if (!(amount > 0)) throw bad("Amount must be greater than zero.");
  const id = randomUUID();
  await query(
    `INSERT INTO account_txns (id, book_id, txn_date, type, category, amount, memo, reference, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,'Posted',?)`,
    [
      id,
      d.bookId,
      d.date,
      d.type,
      String(d.category || "").slice(0, 80),
      amount,
      d.memo ? String(d.memo).slice(0, 255) : null,
      d.reference ? String(d.reference).slice(0, 80) : null,
      userId || null,
    ]
  );
  const [row] = await query(
    `SELECT t.*, b.name AS book_name FROM account_txns t JOIN account_books b ON b.id = t.book_id WHERE t.id = ?`,
    [id]
  );
  return txnOut(row);
}

export async function voidTxn(id) {
  const [row] = await query("SELECT * FROM account_txns WHERE id = ?", [id]);
  if (!row) throw notFound("Transaction not found.");
  if (row.status === "Void") return txnOut(row);
  await query("UPDATE account_txns SET status = 'Void' WHERE id = ?", [id]);
  const [updated] = await query(
    `SELECT t.*, b.name AS book_name FROM account_txns t JOIN account_books b ON b.id = t.book_id WHERE t.id = ?`,
    [id]
  );
  return txnOut(updated);
}

/** Opening + posted movements per book. */
export async function balances() {
  const rows = await query(
    `SELECT b.id, b.name, b.kind, b.opening,
            COALESCE(SUM(CASE
              WHEN t.status = 'Posted' AND t.type IN ('Income') THEN t.amount
              WHEN t.status = 'Posted' AND t.type IN ('Expense', 'Payroll') THEN -t.amount
              ELSE 0 END), 0) AS movement
       FROM account_books b
       LEFT JOIN account_txns t ON t.book_id = b.id
      WHERE b.active = 1
      GROUP BY b.id, b.name, b.kind, b.opening
      ORDER BY b.name`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    opening: Number(r.opening),
    movement: Number(r.movement),
    balance: Number(r.opening) + Number(r.movement),
  }));
}
