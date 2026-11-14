import { config } from "../config/environment.js";
import { query, sqlNow } from "../config/database.js";
import { ApiError, bad, wrap } from "../utils/errors.js";
import { audit, writeAudit } from "../services/audit.service.js";
import { DUMMY_HASH, checkPassword, hashPassword, passwordProblem } from "../services/password.service.js";
import { findRefreshToken, issueTokens, revokeFamily, revokeOwnToken, revokeToken, revokeUserTokens } from "../services/token.service.js";
import { findUserByEmail, findUserById } from "../services/user.service.js";
import { endGrants } from "../services/emergency.service.js";
import { refreshBody } from "../validators/auth.validator.js";

const actorOf = (row) => ({ id: row.id, name: row.name, roleName: row.role_name });

export const login = wrap(async (req, res) => {
  const { email, password } = req.body;
  const row = await findUserByEmail(email);
  const ctx = { ip: req.ip, ua: req.get("user-agent") };
  const fail = async (why) => {
    await writeAudit({ actor: row ? actorOf(row) : { id: "anonymous", name: email }, ...ctx, action: "Failed sign-in", module: "Authentication", summary: `Failed sign-in for ${email}: ${why}`, outcome: "failure" });
    // The same answer whether the email, the password or the account state was the problem.
    throw new ApiError(401, "Invalid email or password.");
  };

  if (!row) {
    await checkPassword(password, DUMMY_HASH); // keeps the response time the same as for a real account
    return fail("unknown email");
  }
  if (row.locked_until && row.locked_until > sqlNow()) {
    await checkPassword(password, DUMMY_HASH);
    await writeAudit({ actor: actorOf(row), ...ctx, action: "Failed sign-in", module: "Authentication", summary: `Sign-in refused for ${email}: account is locked`, outcome: "failure" });
    throw new ApiError(423, "Too many wrong passwords. This account is locked for a while. Try again later or ask an administrator.");
  }
  const ok = await checkPassword(password, row.password_hash);
  if (!ok || !row.active) {
    if (!ok) {
      const failed = row.failed_logins + 1;
      if (failed >= config.maxFailedLogins) {
        await query("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?", [sqlNow(new Date(Date.now() + config.lockMinutes * 60_000)), row.id]);
        await writeAudit({ actor: actorOf(row), ...ctx, action: "Security", module: "Authentication", summary: `Account ${email} locked for ${config.lockMinutes} minutes after ${failed} wrong passwords`, outcome: "failure" });
      } else {
        await query("UPDATE users SET failed_logins = ? WHERE id = ?", [failed, row.id]);
      }
    }
    return fail(ok ? "account is deactivated" : "wrong password");
  }

  await query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = ? WHERE id = ?", [sqlNow(), row.id]);
  const tokens = await issueTokens(row, req);
  req.user = tokens.user;
  await audit(req, { action: "Sign in", module: "Authentication", summary: `${row.name} signed in` });
  res.json(tokens);
});

export const refresh = wrap(async (req, res) => {
  const tok = await findRefreshToken(req.body.refreshToken);
  if (!tok) throw new ApiError(401, "Sign in again.");
  const user = await findUserById(tok.user_id);
  if (tok.revoked_at) {
    // A used token came back: someone has a copy. End every session that came from this sign-in.
    await revokeFamily(tok.family);
    if (user) await writeAudit({ actor: actorOf(user), ip: req.ip, ua: req.get("user-agent"), action: "Security", module: "Authentication", summary: `A used sign-in token was presented again for ${user.email}. All sessions from that sign-in were ended.`, outcome: "failure" });
    throw new ApiError(401, "Sign in again.");
  }
  if (tok.expires_at <= sqlNow() || !user || !user.active) throw new ApiError(401, "Sign in again.");
  await revokeToken(tok.id);
  res.json(await issueTokens(user, req, tok.family));
});

export const logout = wrap(async (req, res) => {
  const parsed = refreshBody.safeParse(req.body);
  if (parsed.success) await revokeOwnToken(parsed.data.refreshToken, req.user.id);
  if (await endGrants(req.user.id, "sign out")) await audit(req, { action: "Security", module: "Emergency access", summary: `Emergency access ended at sign out for ${req.user.name}` });
  await audit(req, { action: "Sign out", module: "Authentication", summary: `${req.user.name} signed out` });
  res.json({ ok: true });
});

export const me = (req, res) => res.json({ user: req.user });

export const changePassword = wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const row = await findUserById(req.user.id);
  if (!(await checkPassword(currentPassword, row.password_hash))) {
    await audit(req, { action: "Security", module: "Authentication", summary: `${req.user.name} entered the wrong current password while changing it`, outcome: "failure" });
    throw new ApiError(400, "Your current password is not right.");
  }
  if (currentPassword === newPassword) throw bad("Choose a password you haven't used here before.");
  const problem = passwordProblem(newPassword, { email: row.email, name: row.name });
  if (problem) throw bad(problem);
  await query("UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?", [await hashPassword(newPassword), sqlNow(), row.id]);
  await revokeUserTokens(row.id); // every other device has to sign in again with the new password
  await audit(req, { action: "Security", module: "Authentication", summary: `${req.user.name} changed their password` });
  res.json(await issueTokens(await findUserById(row.id), req));
});
