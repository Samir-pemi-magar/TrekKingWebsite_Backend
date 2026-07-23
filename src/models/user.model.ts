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