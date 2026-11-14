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
tests/          api.test.js (14 tests, need a database whose name contains "test")
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

Not done yet (next milestones): appointments, admissions, lab, pharmacy, billing and claims, accounts, roster, clinical notes endpoints, patient merge, and switching the web app over to this API. **The web app still uses its browser-only demo data until then.**

## Run it on your computer

You need Node 20 or newer and a MySQL 8 (or MariaDB 10.6+) database.

```bash
npm install
cp .env.example .env        # then edit .env: database details and JWT_SECRET
npm run migrate             # creates the tables (safe to run again)
ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" npm run seed
npm run dev                 # http://localhost:4000/health
```

`npm run seed` prints a one-time password for the first administrator. It is shown once and not stored. Sign in, and you will be asked to choose your own.

Make the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Deploy on Render

1. Create a MySQL database with a hosting provider (Render does not offer MySQL itself). Note its host, port, user, password and database name.
2. Push this project to GitHub. In Render choose **New > Web Service** (or **New > Blueprint** to use `render.yaml`), point it at the repository and leave the root directory empty (the backend sits at the top of the repository).
3. Build command `npm ci`, start command `npm run migrate && npm start`.
4. Set the environment variables from `.env.example`. `CORS_ORIGINS` must be your GitHub Pages address, for example `https://your-user.github.io`.
5. Open the service's **Shell** and run `ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" npm run seed` once.

**Database account:** create a separate MySQL user for the app and, if your provider allows it, do not grant it `UPDATE` or `DELETE` on `audit_log`. The triggers already refuse them, and this closes the gap if someone drops a trigger.

## Tests

The tests run against a real database and **wipe it first**. The database name must contain "test".

```bash
mysql -e "CREATE DATABASE hms_test"
TEST_DB_USER=root TEST_DB_PASSWORD=yourpassword npm test
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
| `GET/POST/DELETE /emergency-access` | signed in | POST `{ reason }` (15+ characters) |
| `GET /audit`, `GET /audit/verify` | administrators | filters: `from`, `to`, `user`, `action`, `module`, `outcome`, `q`, `before`, `limit` |

## Security notes

- Never commit `.env`. Rotate `JWT_SECRET` if it leaks (everyone is signed out).
- Always serve the API over HTTPS (Render does this for you).
- Tokens live in the browser. The web app must keep the access token in memory and the renewal token as short-lived as practical, and must not log either.
- Back up the database on a schedule and test a restore. The audit log is part of that backup.
