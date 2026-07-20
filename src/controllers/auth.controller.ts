import { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { ApiError } from "../utils/apiError.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generatePasswordResetToken,
  hashPasswordResetToken,
} from "../utils/jwt.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
  storeRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  storePasswordResetToken,
  findPasswordResetTokenByHash,
  markPasswordResetTokenUsed,
  updateUserPassword,
} from "../models/auth.model.js";
import { sendMail, templates } from "../config/mailer.js";
import { env } from "../config/env.js";

const SALT_ROUNDS = 12;

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).optional(),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

const forgotPasswordSchema = z.object({ email: z.string().email() });

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

function publicUser(user: { id: string; email: string; name: string | null; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function issueTokenPair(user: { id: string; email: string; role: Role }) {
  const accessToken = signAccessToken({ userId: user.id, email: user.email, role: user.role });
  const { raw, hash, expiresAt } = generateRefreshToken();
  await storeRefreshToken(user.id, hash, expiresAt);
  return { accessToken, refreshToken: raw };
}

// Public signup — always creates a plain USER account. This is for customers
// who want to book trips / save wishlists / leave reviews later; it is NOT
// how Organizers, Guides, or Admins get created (that only happens via an
// existing Admin, see user.controller.ts).
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, name } = credentialsSchema.parse(req.body);

    const existing = await findUserByEmail(email);
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(email, passwordHash, name);
    const tokens = await issueTokenPair(user);

    res.status(201).json({ status: "success", data: { ...tokens, user: publicUser(user) } });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = credentialsSchema.pick({ email: true, password: true }).parse(req.body);

    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) throw ApiError.unauthorized("Invalid email or password");
    if (user.deletedAt || !user.isActive) throw ApiError.unauthorized("This account is no longer active");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw ApiError.unauthorized("Invalid email or password");

    const tokens = await issueTokenPair(user);
    res.json({ status: "success", data: { ...tokens, user: publicUser(user) } });
  } catch (err) {
    next(err);
  }
}

// Rotates a refresh token: the old one is revoked and a new access+refresh
// pair is issued. Protects against a leaked long-lived refresh token being
// reused indefinitely.
export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const tokenHash = hashRefreshToken(refreshToken);

    const stored = await findRefreshTokenByHash(tokenHash);
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw ApiError.unauthorized("Refresh token is invalid or expired");
    }

    const user = await findUserById(stored.userId);
    if (!user || user.deletedAt || !user.isActive) throw ApiError.unauthorized();

    const tokens = await issueTokenPair(user);
    await revokeRefreshToken(tokenHash, hashRefreshToken(tokens.refreshToken));

    res.json({ status: "success", data: tokens });
  } catch (err) {
    next(err);
  }
}

// Revoke a single refresh token (log out this device). Pass no body to
// revoke every session for the current user instead ("log out everywhere").
export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (parsed.success) {
      await revokeRefreshToken(hashRefreshToken(parsed.data.refreshToken)).catch(() => {});
    } else if (req.user) {
      await revokeAllRefreshTokensForUser(req.user.userId);
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// GET /auth/me — used by the frontend to hydrate the logged-in user on page load.
export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const user = await findUserById(req.user.userId);
    if (!user || user.deletedAt) throw ApiError.unauthorized();
    res.json({
      status: "success",
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        bio: user.bio,
        nationality: user.nationality,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

// Public — request a reset link. ALWAYS returns success, even if the email
// isn't registered, so this endpoint can't be used to check which emails
// have accounts. Pair this route with rate limiting, same as /contact.
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await findUserByEmail(email);

    if (user && !user.deletedAt && user.isActive) {
      const { raw, hash, expiresAt } = generatePasswordResetToken();
      await storePasswordResetToken(user.id, hash, expiresAt);

      const resetLink = `${env.FRONTEND_URL}/reset-password?token=${raw}`;
      void sendMail(user.email, "Reset your password", templates.passwordReset(user.name ?? "there", resetLink));
    }

    // Same response whether or not the account exists.
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Public — consume a reset token and set a new password. Also revokes all
// existing sessions, so a stolen device/session is logged out on reset.
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const tokenHash = hashPasswordResetToken(token);

    const stored = await findPasswordResetTokenByHash(tokenHash);
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw ApiError.badRequest("This reset link is invalid or has expired");
    }

    const user = await findUserById(stored.userId);
    if (!user || user.deletedAt || !user.isActive) throw ApiError.badRequest("This reset link is invalid or has expired");

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await updateUserPassword(user.id, passwordHash);
    await markPasswordResetTokenUsed(tokenHash);
    await revokeAllRefreshTokensForUser(user.id);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}