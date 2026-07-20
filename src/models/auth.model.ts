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