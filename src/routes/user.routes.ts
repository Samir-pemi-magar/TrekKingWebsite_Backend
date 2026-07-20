import { Router } from "express";
import { Role } from "@prisma/client";
import * as UserController from "../controllers/user.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { uploadAvatar } from "../middleware/upload.middleware.js";

const router = Router();

// Self-service — must come before /:id routes so "me" isn't parsed as an id.
router.patch("/me", requireAuth, UserController.updateMyProfile);
router.patch("/me/avatar", requireAuth, uploadAvatar, UserController.updateMyAvatar);

// Organizers/Admins need to browse Guides to assign them to departures.
router.get("/guides", requireAuth, requireRole(Role.ORGANIZER, Role.ADMIN), (req, res, next) => {
  req.query.role = Role.GUIDE;
  UserController.getUsers(req, res, next);
});

// Admin-only user management
router.get("/", requireAuth, requireRole(Role.ADMIN), UserController.getUsers);
router.get("/:id", requireAuth, requireRole(Role.ADMIN), UserController.getUser);
router.patch("/:id/role", requireAuth, requireRole(Role.ADMIN), UserController.updateUserRole);
router.patch("/:id/active", requireAuth, requireRole(Role.ADMIN), UserController.updateUserActive);
router.delete("/:id", requireAuth, requireRole(Role.ADMIN), UserController.deleteUser);

export default router;
