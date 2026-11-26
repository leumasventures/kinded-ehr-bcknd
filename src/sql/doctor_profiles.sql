-- Optional clinical profile for staff who practise as doctors.
-- staff_id references users.id; schedule fields drive the Doctors page.
CREATE TABLE IF NOT EXISTS doctor_profiles (
  staff_id      VARCHAR(40)  NOT NULL PRIMARY KEY,
  specialty     VARCHAR(80)  NOT NULL DEFAULT 'General Medicine',
  days_json     JSON         NOT NULL,              -- e.g. [1,2,3,4,5] (0=Sun … 6=Sat)
  start_time    CHAR(5)      NOT NULL DEFAULT '08:00', -- HH:mm
  end_time      CHAR(5)      NOT NULL DEFAULT '16:00',
  status        VARCHAR(20)  NOT NULL DEFAULT 'Available', -- Available | Not Onseat | On Leave
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_doctor_staff FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
