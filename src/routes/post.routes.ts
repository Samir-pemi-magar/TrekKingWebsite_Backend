import { Router } from "express";
import { Role } from "@prisma/client";
import * as PostController from "../controllers/post.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { uploadPostMedia } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", PostController.getPosts);
router.get("/:id", PostController.getPost);
router.post(
  "/",
  requireAuth,
  requireRole(Role.ORGANIZER, Role.ADMIN, Role.GUIDE),
  uploadPostMedia,
  PostController.createPost
);
router.delete("/:id", requireAuth, PostController.deletePost);

export default router;