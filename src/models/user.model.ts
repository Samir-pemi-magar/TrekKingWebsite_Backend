import { Prisma, Role } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  bio: true,
  nationality: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  createdAt: true,
  deletionRequestedAt: true,
  scheduledDeletionAt: true,
} satisfies Prisma.UserSelect;

export function listUsers(filters?: { role?: Role }) {
  return prisma.user.findMany({
    where: { deletedAt: null, ...(filters?.role ? { role: filters.role } : {}) },
    select: publicUserSelect,
    orderBy: { createdAt: "desc" },
  });
}

export function getUserById(id: string) {
  return prisma.user.findFirst({ where: { id, deletedAt: null }, select: publicUserSelect });
}

export function updateUserRole(id: string, role: Role) {
  return prisma.user.update({ where: { id }, data: { role }, select: publicUserSelect });
}

export function updateUserActive(id: string, isActive: boolean) {
  return prisma.user.update({ where: { id }, data: { isActive }, select: publicUserSelect });
}

// Soft delete — keeps the row (and its bookings/reviews/posts history)
// intact but hides it from normal listings and blocks login.
export function softDeleteUser(id: string) {
  return prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

export interface ProfileUpdateInput {
  name?: string;
  phone?: string;
  bio?: string;
  nationality?: string;
}

export function updateOwnProfile(id: string, data: ProfileUpdateInput) {
  return prisma.user.update({ where: { id }, data, select: publicUserSelect });
}

export function updateAvatar(id: string, avatarUrl: string, avatarPublicId: string) {
  return prisma.user.update({ where: { id }, data: { avatarUrl, avatarPublicId }, select: publicUserSelect });
}

const DELETION_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// Starts (or restarts) the 7-day grace period. The account stays fully
// active/usable in the meantime — deletedAt is NOT touched here — so the
// user can keep using and log back into their account right up until the
// scheduled moment, and undo at any time via cancelAccountDeletion below.
export function requestAccountDeletion(id: string) {
  const now = new Date();
  return prisma.user.update({
    where: { id },
    data: {
      deletionRequestedAt: now,
      scheduledDeletionAt: new Date(now.getTime() + DELETION_GRACE_PERIOD_MS),
    },
    select: publicUserSelect,
  });
}

// Undo — clears the pending request. Safe to call even if there's nothing
// pending (just no-ops the fields back to null).
export function cancelAccountDeletion(id: string) {
  return prisma.user.update({
    where: { id },
    data: { deletionRequestedAt: null, scheduledDeletionAt: null },
    select: publicUserSelect,
  });
}

// Sweep target for a scheduled job (see scripts/finalizeAccountDeletions.ts).
// Finalizes any account whose grace period has elapsed and was never
// cancelled, using the exact same soft-delete shape as an admin-initiated
// delete (deletedAt + isActive=false) — so every existing `deletedAt: null`
// filter across the app (listUsers, getUserById, login, etc.) already
// excludes these once finalized, with no other code needing to change.
// Also revokes any live sessions, since the account is gone as far as the
// rest of the app is concerned.
export async function finalizeDueAccountDeletions(): Promise<number> {
  const due = await prisma.user.findMany({
    where: { deletedAt: null, scheduledDeletionAt: { not: null, lte: new Date() } },
    select: { id: true },
  });

  for (const { id } of due) {
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
      prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  return due.length;
}

// ── Admin-created accounts ─────────────────────────────────────────────
// The ONLY way to create an ORGANIZER, GUIDE, or (a second) ADMIN account
// directly — public /auth/register always creates a plain USER (see
// auth.controller.ts). emailVerifiedAt is set immediately: an admin is
// vouching for this address by creating the account, so there's no separate
// "check your inbox" step the way self-registration has.
export function createUserByAdmin(
  email: string,
  passwordHash: string,
  role: Role,
  name?: string,
) {
  return prisma.user.create({
    data: { email, passwordHash, role, name, emailVerifiedAt: new Date() },
    select: publicUserSelect,
  });
}

export function getUserWithAvatarPublicId(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { avatarPublicId: true } });
}

// Guides are just Users with role=GUIDE — exposed as its own list so a
// trip-departure "assign a guide" dropdown has something to search.
export function listGuides() {
  return listUsers({ role: Role.GUIDE });
}

// ── Public guide directory ──────────────────────────────────────────────
// Powers the marketing "Our Guides" page, which anyone can view whether
// logged in or not. Deliberately a much narrower shape than publicUserSelect
// above — no email, phone, isActive, or createdAt. Those are fine for an
// internal admin/organizer list but shouldn't be handed to every visitor.
const publicGuideSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  bio: true,
} satisfies Prisma.UserSelect;

export function listPublicGuides() {
  return prisma.user.findMany({
    where: { deletedAt: null, isActive: true, role: Role.GUIDE },
    select: publicGuideSelect,
    orderBy: { createdAt: "desc" },
  });
}