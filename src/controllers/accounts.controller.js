import { wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { balances, createBook, createTxn, listBooks, listTxns, voidTxn } from "../services/accounts.service.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));

export const books = wrap(async (_req, res) => {
  res.json({ books: await listBooks() });
});

export const addBook = wrap(async (req, res) => {
  const book = await createBook(req.body);
  await audit(req, { action: "Create", module: "Accounts", summary: `Created account book ${book.name}` });
  res.status(201).json({ book });
});

export const txns = wrap(async (req, res) => {
  const { from, to, type, bookId } = req.query;
  const rows = await listTxns({
    from: isDay(from) ? from : undefined,
    to: isDay(to) ? to : undefined,
    type: type ? String(type) : undefined,
    bookId: bookId ? String(bookId) : undefined,
    limit: req.query.limit,
  });
  res.json({ transactions: rows });
});

export const addTxn = wrap(async (req, res) => {
  const transaction = await createTxn(req.body, req.user.id);
  await audit(req, {
    action: "Create",
    module: "Accounts",
    summary: `Posted ${transaction.type} of ${transaction.amount} on ${transaction.bookName || transaction.bookId}`,
  });
  res.status(201).json({ transaction });
});

export const voidOne = wrap(async (req, res) => {
  const transaction = await voidTxn(req.params.id);
  await audit(req, { action: "Update", module: "Accounts", summary: `Voided transaction ${transaction.id}` });
  res.json({ transaction });
});

export const balanceSheet = wrap(async (_req, res) => {
  res.json({ balances: await balances() });
});
