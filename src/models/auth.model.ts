import { prisma } from "../config/prisma.js";

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export function createUser(email: string, passwordHash: string, name?: string) {
  return prisma.user.create({ data: { email, passwordHash, name } });
}

// ── Google OAuth ────────────────────────────────────────────────────────
export function findUserByGoogleId(googleId: string) {
  return prisma.user.findUnique({ where: { googleId } });
}

// Creates a brand-new account from a Google profile. No passwordHash — this
// user can only ever sign in via Google unless they later set a password
// through "forgot password" (which works fine, since resetPassword just
// writes passwordHash regardless of how the account started).
// emailVerifiedAt is set immediately: Google has already verified this
// address on their end, so there's nothing for us to double-check by email.
export function createUserFromGoogle(
  email: string,
  googleId: string,
  name?: string | null,
  avatarUrl?: string | null,
) {
  return prisma.user.create({
    data: {
      email,
      googleId,
      name: name ?? undefined,
      avatarUrl: avatarUrl ?? undefined,
      emailVerifiedAt: new Date(),
    },
  });
}

// Attaches a Google ID to an existing (e.g. password-created) account so the
// next login can go through either method. Also marks the email verified —
// same reasoning as createUserFromGoogle above.
export function linkGoogleAccount(userId: string, googleId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { googleId, emailVerifiedAt: new Date() },
  });
}

// ── Refresh tokens ──────────────────────────────────────────────────────
export function storeRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export function revokeRefreshToken(tokenHash: string, replacedBy?: string) {
  return prisma.refreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date(), replacedBy },
  });
}

export function revokeAllRefreshTokensForUser(userId: string) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ── Password reset tokens ──────────────────────────────────────────────
export function storePasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
}

export function findPasswordResetTokenByHash(tokenHash: string) {
  return prisma.passwordResetToken.findUnique({ where: { tokenHash } });
}

export function markPasswordResetTokenUsed(tokenHash: string) {
  return prisma.passwordResetToken.update({
    where: { tokenHash },
    data: { usedAt: new Date() },
  });
}

export function updateUserPassword(userId: string, passwordHash: string) {
  return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

// ── Email verification tokens ──────────────────────────────────────────
export function storeEmailVerificationToken(userId: string, tokenHash: string, expiresAt: Date) {
  return prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } });
}

export function findEmailVerificationTokenByHash(tokenHash: string) {
  return prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
}

export function markEmailVerificationTokenUsed(tokenHash: string) {
  return prisma.emailVerificationToken.update({
    where: { tokenHash },
    data: { usedAt: new Date() },
  });
}

export function markUserEmailVerified(userId: string) {
  return prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

// ── One-time OAuth login codes ─────────────────────────────────────────
export function storeOAuthLoginCode(userId: string, codeHash: string, expiresAt: Date) {
  return prisma.oAuthLoginCode.create({ data: { userId, codeHash, expiresAt } });
}

export function findOAuthLoginCodeByHash(codeHash: string) {
  return prisma.oAuthLoginCode.findUnique({ where: { codeHash } });
}

export function markOAuthLoginCodeUsed(codeHash: string) {
  return prisma.oAuthLoginCode.update({
    where: { codeHash },
    data: { usedAt: new Date() },
  });
}