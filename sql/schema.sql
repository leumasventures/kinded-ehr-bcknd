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

DROP TRIGGER IF EXISTS audit_log_no_update;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
DROP TRIGGER IF EXISTS audit_log_no_delete;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
