import { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import type { Role, User } from "@prisma/client";
import { ApiError } from "../utils/apiError.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generatePasswordResetToken,
  hashPasswordResetToken,
  generateEmailVerificationToken,
  hashEmailVerificationToken,
  generateOAuthLoginCode,
  hashOAuthLoginCode,
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
  storeEmailVerificationToken,
  findEmailVerificationTokenByHash,
  markEmailVerificationTokenUsed,
  markUserEmailVerified,
  storeOAuthLoginCode,
  findOAuthLoginCodeByHash,
  markOAuthLoginCodeUsed,
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

const verifyEmailSchema = z.object({ token: z.string().min(1) });

const resendVerificationSchema = z.object({ email: z.string().email() });

const googleExchangeSchema = z.object({ code: z.string().min(1) });

function publicUser(user: { id: string; email: string; name: string | null; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function issueTokenPair(user: { id: string; email: string; role: Role }) {
  const accessToken = signAccessToken({ userId: user.id, email: user.email, role: user.role });
  const { raw, hash, expiresAt } = generateRefreshToken();
  await storeRefreshToken(user.id, hash, expiresAt);
  return { accessToken, refreshToken: raw };
}

async function sendVerificationEmail(user: { id: string; email: string; name: string | null }) {
  const { raw, hash, expiresAt } = generateEmailVerificationToken();
  await storeEmailVerificationToken(user.id, hash, expiresAt);
  const verifyLink = `${env.FRONTEND_URL}/verify-email?token=${raw}`;
  void sendMail(user.email, "Verify your email", templates.verifyEmail(user.name ?? "there", verifyLink));
}

// Public signup — always creates a plain USER account. This is for customers
// who want to book trips / save wishlists / leave reviews later; it is NOT
// how Organizers, Guides, or Admins get created (that only happens via an
// existing Admin, see user.controller.ts).
//
// Hard email-verification gate: this does NOT log the user in or return
// tokens. It creates the account (unverified), fires off a verification
// email, and the frontend shows a "check your email" screen. The account
// can't be used to log in until POST /auth/verify-email succeeds.
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, name } = credentialsSchema.parse(req.body);

    const existing = await findUserByEmail(email);
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(email, passwordHash, name);
    await sendVerificationEmail(user);

    res.status(201).json({
      status: "success",
      data: {
        message: "Account created. Check your email to verify your address before logging in.",
        email: user.email,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = credentialsSchema.pick({ email: true, password: true }).parse(req.body);

    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) {
      // Covers both "no such user" and "this account only has a Google
      // login" (passwordHash is null for Google-only accounts) — same
      // generic message either way so login can't be used to fingerprint
      // which emails exist or how they signed up.
      throw ApiError.unauthorized("Invalid email or password");
    }
    if (user.deletedAt || !user.isActive) throw ApiError.unauthorized("This account is no longer active");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw ApiError.unauthorized("Invalid email or password");

    // Hard gate — block login entirely until the address is confirmed.
    if (!user.emailVerifiedAt) {
      throw ApiError.forbidden(
        "Please verify your email before logging in. Check your inbox for the verification link, or request a new one.",
      );
    }

    const tokens = await issueTokenPair(user);
    res.json({ status: "success", data: { ...tokens, user: publicUser(user) } });
  } catch (err) {
    next(err);
  }
}

// Consumes a verification token from the emailed link. On success we log
// the user in immediately (issue a token pair) rather than making them
// re-enter their password right after proving they own the account —
// otherwise the hard gate would cost them an extra manual login step.
export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    const tokenHash = hashEmailVerificationToken(token);

    const stored = await findEmailVerificationTokenByHash(tokenHash);
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw ApiError.badRequest("This verification link is invalid or has expired");
    }

    const user = await findUserById(stored.userId);
    if (!user || user.deletedAt || !user.isActive) {
      throw ApiError.badRequest("This verification link is invalid or has expired");
    }

    if (!user.emailVerifiedAt) {
      await markUserEmailVerified(user.id);
    }
    await markEmailVerificationTokenUsed(tokenHash);

    const tokens = await issueTokenPair(user);
    res.json({
      status: "success",
      data: { ...tokens, user: publicUser(user) },
    });
  } catch (err) {
    next(err);
  }
}

// Re-sends the verification email. Always returns 204, even if the email
// isn't registered or is already verified — same "don't leak which emails
// exist" reasoning as forgotPassword below.
export async function resendVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = resendVerificationSchema.parse(req.body);
    const user = await findUserByEmail(email);

    if (user && !user.deletedAt && user.isActive && !user.emailVerifiedAt) {
      await sendVerificationEmail(user);
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Google OAuth ──────────────────────────────────────────────────────
// GET /auth/google/callback — runs after passport's GoogleStrategy has
// already found-or-created req.user (see config/passport.ts). We don't hand
// tokens back in the redirect URL (they'd land in browser history and
// server logs); instead we mint a one-time code and send the SPA to fetch
// the real tokens via POST /auth/google/exchange.
export async function googleCallback(req: Request, res: Response, next: NextFunction) {
  try {
    // req.user is JwtPayload everywhere requireAuth/optionalAuth run (see
    // auth.middleware.ts's global Request.user augmentation), but on THIS
    // route it's whatever passport's GoogleStrategy `done(null, user)`
    // called with — the raw Prisma User (see config/passport.ts). The two
    // never overlap on the same request, so the cast is safe here.
    const user = req.user as unknown as User | undefined;
    if (!user) throw ApiError.unauthorized("Google sign-in failed");

    const { raw, hash, expiresAt } = generateOAuthLoginCode();
    await storeOAuthLoginCode(user.id, hash, expiresAt);

    res.redirect(`${env.FRONTEND_URL}/auth/google/callback?code=${raw}`);
  } catch (err) {
    next(err);
  }
}

// POST /auth/google/exchange — the SPA calls this immediately after landing
// on /auth/google/callback?code=... to trade the short-lived code for a
// real access/refresh token pair.
export async function googleExchange(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = googleExchangeSchema.parse(req.body);
    const codeHash = hashOAuthLoginCode(code);

    const stored = await findOAuthLoginCodeByHash(codeHash);
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw ApiError.unauthorized("This sign-in link is invalid or has expired. Please try again.");
    }
    await markOAuthLoginCodeUsed(codeHash);

    const user = await findUserById(stored.userId);
    if (!user || user.deletedAt || !user.isActive) throw ApiError.unauthorized();

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
        isEmailVerified: !!user.emailVerifiedAt,
        hasPassword: !!user.passwordHash,
        // Non-null while a self-requested deletion's 7-day grace period is
        // running (see user.model.ts requestAccountDeletion). Lets the
        // frontend show a "your account will be deleted on X — Undo" banner.
        deletionRequestedAt: user.deletionRequestedAt,
        scheduledDeletionAt: user.scheduledDeletionAt,
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