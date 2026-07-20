import { Router } from "express";
import { Role } from "@prisma/client";
import * as SiteContentController from "../controllers/siteContent.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { uploadSiteContentImages } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", SiteContentController.getSiteContent);
router.patch(
  "/",
  requireAuth,
  requireRole(Role.ADMIN),
  uploadSiteContentImages,
  SiteContentController.updateSiteContent,
);

export default router;