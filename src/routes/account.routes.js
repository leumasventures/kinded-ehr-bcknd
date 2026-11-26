import { Router } from "express";
import * as c from "../controllers/account.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import * as v from "../validators/account.validator.js";

const router = Router();
router.use(authenticate());
const A = (a) => requirePerm("Accounts", a);

router.get("/money-accounts", A("view"), c.listAccounts);
router.post("/money-accounts", A("create"), validate(v.createMoneyAccountBody, "Check the account details."), c.createAccount);
router.put("/money-accounts/:id", A("edit"), validate(v.updateMoneyAccountBody, "Check the account details."), c.updateAccount);

router.get("/summary", A("view"), c.summary);
router.get("/transactions", A("view"), c.listTxns);
router.post("/transactions", A("create"), validate(v.createTxnBody, "Check the transaction."), c.createTxn);
router.post("/transactions/:id/void", A("delete"), validate(v.voidTxnBody, "Give a reason for voiding."), c.voidTxn);

router.get("/employees", A("view"), c.listEmployees);
router.post("/employees", A("create"), validate(v.employeeBody, "Check the employee's details."), c.createEmployee);
router.put("/employees/:id", A("edit"), validate(v.updateEmployeeBody, "Check the employee's details."), c.updateEmployee);
router.delete("/employees/:id", A("delete"), c.deleteEmployee);

router.get("/payroll", A("view"), c.listRuns);
router.post("/payroll", A("create"), validate(v.preparePayrollBody, "Choose a month."), c.prepareRun);
router.post("/payroll/:id/pay", A("edit"), validate(v.payPayrollBody, "Choose the account."), c.payRun);
router.post("/payroll/:id/remit", A("edit"), validate(v.remitPayrollBody, "Choose the account."), c.remitRun);
export default router;
