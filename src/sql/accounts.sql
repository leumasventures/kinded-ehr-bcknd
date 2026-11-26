-- Simple hospital ledger for the Accounts module.
CREATE TABLE IF NOT EXISTS account_books (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  name        VARCHAR(120)  NOT NULL,
  kind        VARCHAR(40)   NOT NULL,  -- Cash, Bank, Expense, Income, Payroll, Other
  opening     DECIMAL(14,2) NOT NULL DEFAULT 0,
  active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS account_txns (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  book_id     CHAR(36)      NOT NULL,
  txn_date    DATE          NOT NULL,
  type        VARCHAR(20)   NOT NULL,  -- Income | Expense | Transfer | Payroll
  category    VARCHAR(80)   NOT NULL DEFAULT '',
  amount      DECIMAL(14,2) NOT NULL,
  memo        VARCHAR(255)  NULL,
  reference   VARCHAR(80)   NULL,
  status      VARCHAR(20)   NOT NULL DEFAULT 'Posted', -- Posted | Void
  created_by  VARCHAR(40)   NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_txn_book FOREIGN KEY (book_id) REFERENCES account_books(id),
  INDEX idx_txn_date (txn_date),
  INDEX idx_txn_book (book_id, txn_date)
) ENGINE=InnoDB;
