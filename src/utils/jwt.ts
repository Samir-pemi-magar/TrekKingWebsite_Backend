import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
}

// ── Access token — short-lived, sent as `Authorization: Bearer <token>` ──
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

// ── Refresh token — opaque random string, stored server-side as a hash so a
// leaked database dump doesn't hand out usable tokens. The raw value is only
// ever returned to the client once, at issuance. ──────────────────────────
export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(48).toString("hex");
  const hash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRES_IN));
  return { raw, hash, expiresAt };
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Password reset token — same opaque/hashed pattern as the refresh token
// above, but short-lived (30 min) and single-use. ─────────────────────────
const PASSWORD_RESET_EXPIRY_MS = 30 * 60 * 1000;

export function generatePasswordResetToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashPasswordResetToken(raw);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
  return { raw, hash, expiresAt };
}

export function hashPasswordResetToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Email verification token — same opaque/hashed/single-use pattern, but
// longer-lived (24h) since there's no urgency pressure the way a password
// reset has, and people don't always open a signup email right away. ─────
const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function generateEmailVerificationToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashEmailVerificationToken(raw);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);
  return { raw, hash, expiresAt };
}

export function hashEmailVerificationToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── OAuth login code — very short-lived (60s), single-use. Lets the Google
// OAuth callback (a server-driven redirect) hand the SPA something safe to
// carry in a URL, which it immediately exchanges for a real token pair.
// Nowhere near long-lived enough to be worth stealing off a screen or out
// of a browser history entry the way a refresh token would be. ───────────
const OAUTH_LOGIN_CODE_EXPIRY_MS = 60 * 1000;

export function generateOAuthLoginCode(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashOAuthLoginCode(raw);
  const expiresAt = new Date(Date.now() + OAUTH_LOGIN_CODE_EXPIRY_MS);
  return { raw, hash, expiresAt };
}

export function hashOAuthLoginCode(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Minimal "7d" / "30d" / "15m" / "12h" duration parser — good enough for the
// small set of formats used in JWT_EXPIRES_IN-style env vars.
function parseDurationMs(input: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!match) return 30 * 24 * 60 * 60 * 1000; // fallback: 30 days
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}