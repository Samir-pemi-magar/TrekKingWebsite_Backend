import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as UserModel from "../models/user.model.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";
import { recordAuditLog } from "../utils/auditLog.js";

const roleUpdateSchema = z.object({ role: z.nativeEnum(Role) });
const activeUpdateSchema = z.object({ isActive: z.boolean() });
const profileUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(5).max(20).optional(),
  bio: z.string().max(1000).optional(),
  nationality: z.string().max(60).optional(),
});

// Admin-only. Optional ?role= filter (e.g. ?role=GUIDE to populate a
// "assign a guide" dropdown when creating a trip departure).
export async function getUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.query.role ? roleUpdateSchema.shape.role.parse(req.query.role) : undefined;
    const users = await UserModel.listUsers({ role });
    res.json({ status: "success", data: users });
  } catch (err) {
    next(err);
  }
}

// Public — no auth required. Powers the marketing "Our Guides" page.
// Returns a narrower shape than getUsers (see listPublicGuides/
// publicGuideSelect) so visitors never see email/phone/account status.
export async function getPublicGuides(_req: Request, res: Response, next: NextFunction) {
  try {
    const guides = await UserModel.listPublicGuides();
    res.json({ status: "success", data: guides });
  } catch (err) {
    next(err);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const user = await UserModel.getUserById(id);
    if (!user) throw ApiError.notFound("User not found");
    res.json({ status: "success", data: user });
  } catch (err) {
    next(err);
  }
}

// Admin-only. This is the ONLY way someone becomes an Organizer, Guide, or
// Admin — e.g. a customer registers as USER, then the Head Admin promotes
// them to ORGANIZER or GUIDE once approved.
export async function updateUserRole(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const { role } = roleUpdateSchema.parse(req.body);

    const existing = await UserModel.getUserById(id);
    if (!existing) throw ApiError.notFound("User not found");

    const updated = await UserModel.updateUserRole(id, role);
    recordAuditLog({
      actorId: req.user?.userId,
      action: "user.role_updated",
      entityType: "User",
      entityId: id,
      meta: { from: existing.role, to: role },
    });
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

// Admin-only. Suspend/reactivate an account without deleting it (e.g. a
// guide who's on leave, or a user under investigation for abuse).
export async function updateUserActive(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const { isActive } = activeUpdateSchema.parse(req.body);

    const existing = await UserModel.getUserById(id);
    if (!existing) throw ApiError.notFound("User not found");

    const updated = await UserModel.updateUserActive(id, isActive);
    recordAuditLog({
      actorId: req.user?.userId,
      action: isActive ? "user.reactivated" : "user.suspended",
      entityType: "User",
      entityId: id,
    });
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

// Admin-only. Soft delete — preserves the user's bookings/reviews/posts.
export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const existing = await UserModel.getUserById(id);
    if (!existing) throw ApiError.notFound("User not found");

    await UserModel.softDeleteUser(id);
    recordAuditLog({ actorId: req.user?.userId, action: "user.deleted", entityType: "User", entityId: id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Self-service profile (any authenticated user) ───────────────────────
export async function updateMyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const data = profileUpdateSchema.parse(req.body);
    const updated = await UserModel.updateOwnProfile(req.user.userId, data);
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

// PATCH /users/me/avatar — multipart, field "avatar" (see upload.middleware.ts)
export async function updateMyAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    if (!req.file) throw ApiError.badRequest("No avatar file provided");

    const existing = await UserModel.getUserWithAvatarPublicId(req.user.userId);
    const uploaded = await uploadBufferToCloudinary(req.file.buffer, "users/avatars", "image");

    if (existing?.avatarPublicId) {
      await deleteFromCloudinary(existing.avatarPublicId, "image");
    }

    const updated = await UserModel.updateAvatar(req.user.userId, uploaded.url, uploaded.publicId);
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}