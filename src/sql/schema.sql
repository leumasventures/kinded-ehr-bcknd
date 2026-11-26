-- Hospital management system: core schema (milestone 1).
-- Works on MySQL 8 and MariaDB 10.6+. Every statement is idempotent, so `npm run migrate` can be re-run safely.

CREATE TABLE IF NOT EXISTS roles (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL DEFAULT '',
  permissions JSON         NOT NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id                   VARCHAR(40)  NOT NULL PRIMARY KEY,
  name                 VARCHAR(120) NOT NULL,
  email                VARCHAR(190) NOT NULL UNIQUE,
  phone                VARCHAR(40)  NULL,
  role_id              VARCHAR(40)  NOT NULL,
  permissions          JSON         NULL,            -- per-user override; replaces the role's permissions when set
  active               TINYINT(1)   NOT NULL DEFAULT 1,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 1,
  password_hash        VARCHAR(100) NOT NULL,        -- bcrypt, never returned by the API
  failed_logins        INT          NOT NULL DEFAULT 0,
  locked_until         DATETIME(3)  NULL,
  last_login           DATETIME(3)  NULL,
  password_changed_at  DATETIME(3)  NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

-- Renewal tokens. Only a SHA-256 of the token is stored, and each token is used once (rotated on every renewal).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(40)  NOT NULL,
  token_hash  CHAR(64)     NOT NULL UNIQUE,
  family      CHAR(32)     NOT NULL,                 -- all tokens from one sign-in share a family, so reuse can revoke them all
  expires_at  DATETIME(3)  NOT NULL,
  revoked_at  DATETIME(3)  NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS counters (
  name  VARCHAR(40) NOT NULL PRIMARY KEY,
  value BIGINT      NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patients (
  id            VARCHAR(20)  NOT NULL PRIMARY KEY,   -- P-1001, issued by the server
  name          VARCHAR(160) NOT NULL,
  dob           DATE         NOT NULL,
  gender        ENUM('Male','Female') NOT NULL,
  phone         VARCHAR(40)  NOT NULL DEFAULT '',
  address       VARCHAR(255) NOT NULL DEFAULT '',
  blood_group   VARCHAR(10)  NOT NULL DEFAULT 'Unknown',
  genotype      VARCHAR(10)  NOT NULL DEFAULT 'Unknown',
  payer         VARCHAR(30)  NOT NULL DEFAULT 'Self-pay',
  payer_name    VARCHAR(160) NULL,
  member_id     VARCHAR(80)  NULL,
  allergies     VARCHAR(500) NOT NULL DEFAULT '',
  kin_name      VARCHAR(160) NOT NULL DEFAULT '',
  kin_relation  VARCHAR(40)  NOT NULL DEFAULT '',
  kin_phone     VARCHAR(40)  NOT NULL DEFAULT '',
  notes         TEXT         NULL,
  merged_from   JSON         NULL,
  registered_on DATE         NOT NULL,
  created_by    VARCHAR(40)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_patients_name (name),
  KEY idx_patients_phone (phone)
) ENGINE=InnoDB;

-- One row per booking. `is_live` is 1 while the booking is live and NULL once cancelled or missed. NULLs never clash in a
-- UNIQUE index, so the database itself refuses a second live booking for the same doctor, date and time (even in a race).
CREATE TABLE IF NOT EXISTS appointments (
  id          VARCHAR(20)  NOT NULL PRIMARY KEY,   -- A-201, issued by the server
  patient_id  VARCHAR(20)  NOT NULL,
  doctor      VARCHAR(120) NOT NULL,
  appt_date   DATE         NOT NULL,
  appt_time   CHAR(5)      NOT NULL,               -- HH:mm
  visit_type  VARCHAR(40)  NOT NULL,
  reason      VARCHAR(255) NULL,
  status      ENUM('Scheduled','Checked in','In Progress','Completed','Cancelled','No-show') NOT NULL DEFAULT 'Scheduled',
  created_by  VARCHAR(40)  NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  is_live     TINYINT      AS (IF(status IN ('Cancelled','No-show'), NULL, 1)) STORED,
  UNIQUE KEY uq_appointments_slot (doctor, appt_date, appt_time, is_live),
  KEY idx_appointments_date (appt_date),
  KEY idx_appointments_patient (patient_id),
  CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id) REFERENCES patients(id)
) ENGINE=InnoDB;

-- Billing. Money is DECIMAL(12,2). Invoice number and id are the same thing (INV-1001), issued by the server.
CREATE TABLE IF NOT EXISTS invoices (
  id          VARCHAR(20)   NOT NULL PRIMARY KEY,
  patient_id  VARCHAR(20)   NOT NULL,
  inv_date    DATE          NOT NULL,
  due_date    DATE          NOT NULL,
  discount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  vat_rate    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  notes       VARCHAR(500)  NULL,
  created_by  VARCHAR(40)   NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_invoices_patient (patient_id, inv_date),
  CONSTRAINT fk_invoices_patient FOREIGN KEY (patient_id) REFERENCES patients(id)
) ENGINE=InnoDB;

-- `source` names the event that caused an automatic charge (appt:A-201, lab:L-501). The UNIQUE key means the same
-- event can never charge the same item twice for a patient. Manual lines have no source, and NULLs never clash.
CREATE TABLE IF NOT EXISTS invoice_items (
  id          BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id  VARCHAR(20)   NOT NULL,
  patient_id  VARCHAR(20)   NOT NULL,
  description VARCHAR(255)  NOT NULL,
  qty         DECIMAL(10,2) NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  source      VARCHAR(80)   NULL,
  UNIQUE KEY uq_item_source (patient_id, source, description),
  KEY idx_items_invoice (invoice_id),
  CONSTRAINT fk_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id          BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id  VARCHAR(20)   NOT NULL,
  pay_date    DATE          NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  method      ENUM('Cash','Bank Transfer','POS','Cheque','HMO / Insurance') NOT NULL,
  reference   VARCHAR(80)   NULL,
  claim_id    VARCHAR(20)   NULL,
  created_by  VARCHAR(40)   NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_payments_invoice (invoice_id),
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB;

-- Insurance, HMO and corporate claims: a batch of invoices sent to one payer.
CREATE TABLE IF NOT EXISTS claims (
  id               VARCHAR(20)   NOT NULL PRIMARY KEY,   -- CLM-1001
  payer            VARCHAR(160)  NOT NULL,
  payer_type       VARCHAR(40)   NOT NULL,
  status           ENUM('Draft','Submitted','Approved','Rejected','Paid') NOT NULL DEFAULT 'Draft',
  submitted_on     DATE          NULL,
  reference        VARCHAR(80)   NULL,
  approved_amount  DECIMAL(12,2) NULL,
  received_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  rejection_reason VARCHAR(500)  NULL,
  created_by       VARCHAR(40)   NULL,
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS claim_lines (
  id          BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
  claim_id    VARCHAR(20)   NOT NULL,
  invoice_id  VARCHAR(20)   NOT NULL,
  patient_id  VARCHAR(20)   NOT NULL,
  member_id   VARCHAR(80)   NULL,
  amount      DECIMAL(12,2) NOT NULL,                    -- the invoice balance when the claim was made
  KEY idx_claim_lines_claim (claim_id),
  KEY idx_claim_lines_invoice (invoice_id),
  KEY idx_claim_lines_patient (patient_id),
  CONSTRAINT fk_claim_lines_claim FOREIGN KEY (claim_id) REFERENCES claims(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS claim_events (
  id        BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  claim_id  VARCHAR(20)  NOT NULL,
  at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  by_name   VARCHAR(120) NOT NULL,
  text      VARCHAR(500) NOT NULL,
  KEY idx_claim_events_claim (claim_id),
  CONSTRAINT fk_claim_events_claim FOREIGN KEY (claim_id) REFERENCES claims(id)
) ENGINE=InnoDB;

-- A copy of every duplicate registration that was merged away. Append-only, like the audit log.
CREATE TABLE IF NOT EXISTS patient_merges (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  by_user_id  VARCHAR(40)  NOT NULL,
  by_name     VARCHAR(120) NOT NULL,
  kept_id     VARCHAR(20)  NOT NULL,
  removed_id  VARCHAR(20)  NOT NULL,
  removed     JSON         NOT NULL,
  moved       JSON         NOT NULL,
  KEY idx_merges_kept (kept_id)
) ENGINE=InnoDB;

-- Clinical notes are never deleted. Corrections are addenda that point at the original.
CREATE TABLE IF NOT EXISTS clinical_notes (
  id             VARCHAR(40)  NOT NULL PRIMARY KEY,
  patient_id     VARCHAR(20)  NOT NULL,
  category       VARCHAR(40)  NOT NULL,
  body           MEDIUMTEXT   NOT NULL,
  author_id      VARCHAR(40)  NOT NULL,
  author_name    VARCHAR(120) NOT NULL,
  author_role    VARCHAR(80)  NOT NULL DEFAULT '',
  event_at       DATETIME(3)  NOT NULL,
  recorded_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  appointment_id VARCHAR(40)  NULL,
  addendum_to    VARCHAR(40)  NULL,
  locked         TINYINT(1)   NOT NULL DEFAULT 0,
  revisions      JSON         NULL,
  lock_log       JSON         NULL,
  KEY idx_notes_patient (patient_id, event_at),
  CONSTRAINT fk_notes_patient FOREIGN KEY (patient_id) REFERENCES patients(id)
) ENGINE=InnoDB;

-- Break-glass grants. The server issues, times and ends them; the browser only holds the right to ask.
CREATE TABLE IF NOT EXISTS emergency_grants (
  id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      VARCHAR(40)  NOT NULL,
  reason       VARCHAR(500) NOT NULL,
  started_at   DATETIME(3)  NOT NULL,
  expires_at   DATETIME(3)  NOT NULL,
  ended_at     DATETIME(3)  NULL,
  ended_reason VARCHAR(40)  NULL,
  KEY idx_grants_user (user_id, expires_at),
  CONSTRAINT fk_grants_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Audit trail: append-only, and each row carries a hash of the one before it, so a removed or edited row shows up.
CREATE TABLE IF NOT EXISTS audit_log (
  seq        BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at         DATETIME(3)  NOT NULL,
  user_id    VARCHAR(40)  NOT NULL,
  user_name  VARCHAR(120) NOT NULL,
  role       VARCHAR(80)  NOT NULL DEFAULT '',
  action     VARCHAR(30)  NOT NULL,
  module     VARCHAR(60)  NOT NULL,
  summary    VARCHAR(500) NOT NULL,
  detail     TEXT         NULL,
  outcome    ENUM('success','failure') NOT NULL DEFAULT 'success',
  ip         VARCHAR(64)  NULL,
  device     VARCHAR(255) NULL,
  prev_hash  CHAR(64)     NOT NULL,
  hash       CHAR(64)     NOT NULL,
  KEY idx_audit_at (at),
  KEY idx_audit_user (user_id),
  KEY idx_audit_module (module)
) ENGINE=InnoDB;

-- One row, locked while an entry is written, so two requests can't chain from the same previous hash.
CREATE TABLE IF NOT EXISTS audit_head (
  id        TINYINT  NOT NULL PRIMARY KEY,
  last_seq  BIGINT   NOT NULL,
  last_hash CHAR(64) NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO audit_head (id, last_seq, last_hash) VALUES (1, 0, REPEAT('0', 64));

-- ---------- Doctors ----------
-- Appointments and admissions refer to a doctor by name, so the name is unique and a doctor who has history can't be deleted.
CREATE TABLE IF NOT EXISTS doctors (
  id         VARCHAR(20)  NOT NULL PRIMARY KEY,   -- DR-01
  name       VARCHAR(120) NOT NULL,
  specialty  VARCHAR(120) NOT NULL DEFAULT '',
  phone      VARCHAR(40)  NOT NULL DEFAULT '',
  email      VARCHAR(160) NOT NULL DEFAULT '',
  days       VARCHAR(20)  NOT NULL DEFAULT '1,2,3,4,5',   -- 0 = Sunday ... 6 = Saturday
  start_time CHAR(5)      NOT NULL DEFAULT '08:00',
  end_time   CHAR(5)      NOT NULL DEFAULT '16:00',
  status     ENUM('Available','In Surgery','On Leave') NOT NULL DEFAULT 'Available',
  created_by VARCHAR(40)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_doctor_name (name)
) ENGINE=InnoDB;

-- ---------- Duty roster ----------
-- One shift per person per day. Name and role are copied from the staff record by the server when the shift is made.
CREATE TABLE IF NOT EXISTS roster_shifts (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shift_date DATE         NOT NULL,
  staff_id   VARCHAR(40)  NOT NULL,
  staff_name VARCHAR(120) NOT NULL,
  staff_role VARCHAR(80)  NOT NULL DEFAULT '',
  shift      ENUM('Morning','Afternoon','Night','On call','Leave') NOT NULL,
  unit       VARCHAR(60)  NOT NULL DEFAULT '',
  note       VARCHAR(255) NOT NULL DEFAULT '',
  created_by VARCHAR(40)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_roster_person_day (staff_id, shift_date),
  KEY idx_roster_date (shift_date)
) ENGINE=InnoDB;

-- ---------- Admissions ----------
CREATE TABLE IF NOT EXISTS admissions (
  id             VARCHAR(20)  NOT NULL PRIMARY KEY,   -- ADM-1001
  patient_id     VARCHAR(20)  NOT NULL,
  ward           VARCHAR(40)  NOT NULL,
  bed            VARCHAR(10)  NOT NULL,
  admitted_on    DATE         NOT NULL,
  doctor         VARCHAR(120) NOT NULL,
  diagnosis      VARCHAR(255) NOT NULL DEFAULT '',
  status         ENUM('Admitted','Discharged') NOT NULL DEFAULT 'Admitted',
  discharged_on  DATE         NULL,
  outcome        VARCHAR(60)  NULL,
  discharge_notes VARCHAR(500) NULL,
  created_by     VARCHAR(40)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_adm_patient (patient_id),
  KEY idx_adm_status (status, ward),
  CONSTRAINT fk_adm_patient FOREIGN KEY (patient_id) REFERENCES patients(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_moves (
  id           BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admission_id VARCHAR(20) NOT NULL,
  at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  from_ward    VARCHAR(40) NOT NULL,
  from_bed     VARCHAR(10) NOT NULL,
  to_ward      VARCHAR(40) NOT NULL,
  to_bed       VARCHAR(10) NOT NULL,
  by_name      VARCHAR(120) NOT NULL,
  KEY idx_moves_adm (admission_id),
  CONSTRAINT fk_moves_adm FOREIGN KEY (admission_id) REFERENCES admissions(id)
) ENGINE=InnoDB;

-- ---------- Accounts ----------
CREATE TABLE IF NOT EXISTS money_accounts (
  id             VARCHAR(20)   NOT NULL PRIMARY KEY,   -- ACC-01
  name           VARCHAR(120)  NOT NULL,
  kind           ENUM('Cash','Bank','POS / Mobile money') NOT NULL,
  bank_name      VARCHAR(120)  NOT NULL DEFAULT '',
  account_number VARCHAR(40)   NOT NULL DEFAULT '',
  opening        DECIMAL(14,2) NOT NULL DEFAULT 0,
  opening_date   DATE          NOT NULL,
  active         TINYINT(1)    NOT NULL DEFAULT 1,
  UNIQUE KEY uq_money_account_name (name)
) ENGINE=InnoDB;

-- Money is never edited or deleted once recorded. A mistake is voided (kept, with who/when/why) and re-entered.
CREATE TABLE IF NOT EXISTS transactions (
  id            VARCHAR(20)   NOT NULL PRIMARY KEY,   -- TXN-1001
  txn_date      DATE          NOT NULL,
  type          ENUM('Income','Expense','Transfer') NOT NULL,
  category      VARCHAR(80)   NOT NULL DEFAULT '',
  description   VARCHAR(255)  NOT NULL DEFAULT '',
  party         VARCHAR(160)  NOT NULL DEFAULT '',
  reference     VARCHAR(80)   NOT NULL DEFAULT '',
  amount        DECIMAL(14,2) NOT NULL,
  account_id    VARCHAR(20)   NOT NULL,
  to_account_id VARCHAR(20)   NULL,
  source        ENUM('manual','billing','payroll') NOT NULL DEFAULT 'manual',
  recorded_by   VARCHAR(120)  NOT NULL,
  recorded_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  void_at       DATETIME(3)   NULL,
  void_by       VARCHAR(120)  NULL,
  void_reason   VARCHAR(255)  NULL,
  KEY idx_txn_date (txn_date),
  KEY idx_txn_account (account_id),
  CONSTRAINT fk_txn_account FOREIGN KEY (account_id) REFERENCES money_accounts(id),
  CONSTRAINT fk_txn_to_account FOREIGN KEY (to_account_id) REFERENCES money_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employees (
  id              VARCHAR(20)   NOT NULL PRIMARY KEY,   -- EMP-01
  name            VARCHAR(120)  NOT NULL,
  title           VARCHAR(120)  NOT NULL DEFAULT '',
  department      VARCHAR(120)  NOT NULL DEFAULT '',
  bank_name       VARCHAR(120)  NOT NULL DEFAULT '',
  account_number  VARCHAR(40)   NOT NULL DEFAULT '',
  basic           DECIMAL(14,2) NOT NULL DEFAULT 0,
  housing         DECIMAL(14,2) NOT NULL DEFAULT 0,
  transport       DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_allowance DECIMAL(14,2) NOT NULL DEFAULT 0,
  pension_pct     DECIMAL(5,2)  NOT NULL DEFAULT 8,
  paye            DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_deduction DECIMAL(14,2) NOT NULL DEFAULT 0,
  active          TINYINT(1)    NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                 VARCHAR(20)  NOT NULL PRIMARY KEY,   -- PAY-2026-11
  month              CHAR(7)      NOT NULL,
  status             ENUM('Draft','Paid') NOT NULL DEFAULT 'Draft',
  paid_on            DATE         NULL,
  paid_from_account  VARCHAR(20)  NULL,
  paid_by            VARCHAR(120) NULL,
  txn_id             VARCHAR(20)  NULL,
  remitted_on        DATE         NULL,
  remittance_txn_id  VARCHAR(20)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payroll_month (month)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payroll_lines (
  id          BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id      VARCHAR(20)   NOT NULL,
  employee_id VARCHAR(20)   NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  title       VARCHAR(120)  NOT NULL DEFAULT '',
  basic       DECIMAL(14,2) NOT NULL,
  allowances  DECIMAL(14,2) NOT NULL,
  bonus       DECIMAL(14,2) NOT NULL DEFAULT 0,
  gross       DECIMAL(14,2) NOT NULL,
  pension     DECIMAL(14,2) NOT NULL,
  paye        DECIMAL(14,2) NOT NULL,
  other       DECIMAL(14,2) NOT NULL,
  net         DECIMAL(14,2) NOT NULL,
  KEY idx_pl_run (run_id),
  CONSTRAINT fk_pl_run FOREIGN KEY (run_id) REFERENCES payroll_runs(id)
) ENGINE=InnoDB;
