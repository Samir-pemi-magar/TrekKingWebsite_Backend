import { Router } from "express";
import { Role } from "@prisma/client";
import * as InquiryController from "../controllers/inquiry.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { inquiryRateLimiter } from "../middleware/rateLimiter.middleware.js";

const router = Router();

router.post("/", inquiryRateLimiter, InquiryController.submitInquiry);
router.get("/", requireAuth, requireRole(Role.ADMIN), InquiryController.getInquiries);
router.delete("/:id", requireAuth, requireRole(Role.ADMIN), InquiryController.deleteInquiry);

export default router;
