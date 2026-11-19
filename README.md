# Kinded Care EHR backend (milestone 1)

## Folder layout

```
sql/            schema.sql (tables, audit triggers)
scripts/        migrate.js, seed.js
src/
  config/       environment.js, database.js, permissions.js
  routes/       URL + middleware + controller, nothing else
  controllers/  read the request, call services, send the response
  services/     business rules and SQL (tokens, passwords, patients, audit chain)
  validators/   zod schemas for request bodies
  middleware/   authenticate, requirePerm/requireAdmin, rate limits, validate, errors
  utils/        errors.js
tests/          api.test.js, billing-merge.test.js (need a scratch database whose name contains "test")
```


Node + Express + MySQL API for the hospital web app. This milestone covers the parts that must be trusted before any real patient data is entered:

| Area | What the server does |
| --- | --- |
| Sign-in | bcrypt-hashed passwords, 30-minute access tokens, renewal tokens that rotate (a reused one ends that whole sign-in), account lockout after 5 wrong passwords, rate limiting |
| Passwords | New and reset accounts get a one-time password and **must** choose their own before anything else works. Length, letters and numbers, no common passwords, no name or email in it |
| Permissions | Roles and per-user overrides are checked **on the server** for every request. Deactivating someone or changing a role applies on their very next request |
| Audit log | Written by the server (time, person, address, device never come from the browser). Append-only in the database (triggers refuse UPDATE and DELETE) and hash-chained, so a changed or removed row is detected. Blocked attempts are logged too |
| Emergency access | "Break glass": a person with no patient access can read (never write) patient records for 60 minutes after giving a reason. The server times it, and every record opened is logged |
| Patients | Register, search, update, delete (refused when clinical notes exist), duplicate detection, IDs issued in order by the server |
| Users and roles | Administrator-only management. The last administrator can't be removed, demoted or deactivated |

Services written and tested, with no HTTP endpoints yet: `billing.service.js` (invoices, automatic charges, payments, insurance claims) and `merge.service.js` (patient merge). Not done yet: admissions, lab, pharmacy, billing and claims, accounts, roster and clinical notes endpoints.

## Everything goes to the hosted database

There is no local database and no localhost anywhere. The server will not start, migrate or seed unless `DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` are set, and it refuses a `DB_HOST` that is localhost or 127.0.0.1. `CORS_ORIGINS` (the website allowed to call the API, `https://kindedcarehospital.com`) and `JWT_SECRET` are required too.

### One-time setup on Hostinger

1. hPanel > Databases > Management: note the database name and user (`u986504880_kindedEHR_db`).
2. hPanel > Databases > **Remote MySQL**: allow the address of the machine that will connect (your own computer's public IP for running `migrate`, and Render's outbound IPs, shown in the Render service's **Connect > Outbound** tab). The **hostname** shown on that page is your `DB_HOST`.
3. Keep the password only in Render's Environment tab (or your own `.env`, which is git-ignored). Never paste it in chat or commit it.

### Create the tables and the first administrator

Run these from any machine whose address you allowed in step 2, with the variables from `.env.example` set in `.env`:

```bash
npm install
npm run migrate        # creates the tables in the hosted database (safe to run again)
ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" npm run seed
```

`npm run seed` prints a one-time password for the first administrator. It is shown once and not stored. Sign in at the website, and you will be asked to choose your own.

Make the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Deploy on Render

1. Push this project to GitHub. In Render choose **New > Web Service** (or **New > Blueprint** to use `render.yaml`), point it at the repository and leave the root directory empty.
2. Build command `npm ci`, start command `npm run migrate && npm start`.
3. Environment tab: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `CORS_ORIGINS=https://kindedcarehospital.com`.
4. Check `https://YOUR-SERVICE.onrender.com/health`.
5. Frontend: build it with `VITE_API_URL=https://YOUR-SERVICE.onrender.com/api` (a GitHub Actions variable or a `.env.production` file). The site shows a "not connected" screen if this is missing.

**Database account:** if Hostinger lets you, do not grant the app's user `UPDATE` or `DELETE` on `audit_log`. The triggers already refuse them, and this closes the gap if someone drops a trigger.

## Tests

The tests wipe the database they connect to and refuse any database whose name does not contain "test". Use a separate scratch database on your hosted server, never the real one:

```bash
TEST_DB_HOST=... TEST_DB_PORT=3306 TEST_DB_USER=... TEST_DB_PASSWORD=... TEST_DB_NAME=yourprefix_test npm test
```

## API

All paths start with `/api`. Send `Authorization: Bearer <accessToken>`. Errors look like `{ "error": "message" }`.

| Method and path | Who | Notes |
| --- | --- | --- |
| `POST /auth/login` | anyone | `{ email, password }` returns `accessToken`, `refreshToken`, `user` |
| `POST /auth/refresh` | anyone with a renewal token | returns a fresh pair; the old renewal token stops working |
| `POST /auth/logout` | signed in | `{ refreshToken }`; also ends any emergency access |
| `GET /auth/me` | signed in | the user and their effective permissions |
| `POST /auth/change-password` | signed in | `{ currentPassword, newPassword }` |
| `GET/POST/PUT/DELETE /users`, `POST /users/:id/reset-password` | administrators | creating or resetting returns `temporaryPassword` once |
| `GET /roles` | signed in | names for everyone; permissions for administrators |
| `POST/PUT/DELETE /roles` | administrators | the Administrator role is fixed |
| `GET /patients?search=&limit=&offset=`, `GET /patients/:id` | Patients: view (or emergency access) | opening a record is logged |
| `POST /patients` | Patients: create | `409 possible_duplicate` unless `allowDuplicate: true` |
| `PUT /patients/:id`, `DELETE /patients/:id` | Patients: edit, delete | |
| `GET /appointments?date=&from=&to=&doctor=&patientId=&status=`, `GET /appointments/:id` | Appointments: view | the patient's name and phone come from the register |
| `POST /appointments` | Appointments: create | `{ patientId, doctor, date, time, type, reason? }`; `409 slot_taken` if the doctor is already booked then (the database enforces it) |
| `PUT /appointments/:id` | Appointments: edit | reschedule or change doctor, type, reason; only while Scheduled or Checked in |
| `POST /appointments/:id/status` | Appointments: edit | `{ status }`; allowed moves are Scheduled, Checked in, In Progress, Completed, with Cancelled and No-show able to be rebooked |
| `DELETE /appointments/:id` | Appointments: delete | only Scheduled, Cancelled or No-show, and not once clinical notes are linked |
| `GET/POST/DELETE /emergency-access` | signed in | POST `{ reason }` (15+ characters) |
| `GET /audit`, `GET /audit/verify` | administrators | filters: `from`, `to`, `user`, `action`, `module`, `outcome`, `q`, `before`, `limit` |

## Security notes

- Never commit `.env`. Rotate `JWT_SECRET` if it leaks (everyone is signed out).
- Always serve the API over HTTPS (Render does this for you).
- Tokens live in the browser. The web app must keep the access token in memory and the renewal token as short-lived as practical, and must not log either.
- Back up the database on a schedule and test a restore. The audit log is part of that backup.
