import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { config } from "../config/environment.js";

const BCRYPT_COST = 12;
export const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);
// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

/** A readable one-time password with no look-alike characters. Shown once to the administrator, then only its hash is kept. */
export function temporaryPassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  const pick = (set) => set[randomInt(set.length)];
  const chars = [pick(letters.toUpperCase()), pick(letters.toLowerCase()), pick(digits), pick(digits)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const COMMON = new Set(["password", "password1", "password123", "123456789", "1234567890", "qwerty123", "welcome123", "hospital123", "admin12345", "letmein123"]);

/** Returns a message when the password is not acceptable, otherwise null. */
export function passwordProblem(pw, { email = "", name = "" } = {}) {
  if (typeof pw !== "string" || pw.length < config.minPasswordLength) return `Use at least ${config.minPasswordLength} characters.`;
  if (pw.length > 128) return "Use at most 128 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use both letters and numbers.";
  const low = pw.toLowerCase();
  if (COMMON.has(low)) return "That password is too common.";
  const local = email.split("@")[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return "The password can't contain your email name.";
  for (const part of name.toLowerCase().split(/\s+/)) if (part.length >= 4 && low.includes(part)) return "The password can't contain your name.";
  return null;
}
