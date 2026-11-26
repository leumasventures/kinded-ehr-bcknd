import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/accounts.controller.js";
import { bookBody, txnBody } from "../validators/accounts.validator.js";

const r = Router();
r.use(authenticate());

r.get("/books", requirePerm("Accounts", "view"), c.books);
r.post("/books", requirePerm("Accounts", "create"), validate(bookBody, "Check the account book."), c.addBook);
r.get("/transactions", requirePerm("Accounts", "view"), c.txns);
r.post("/transactions", requirePerm("Accounts", "create"), validate(txnBody, "Check the transaction."), c.addTxn);
r.post("/transactions/:id/void", requirePerm("Accounts", "edit"), c.voidOne);
r.get("/balances", requirePerm("Accounts", "view"), c.balanceSheet);

export default r;
