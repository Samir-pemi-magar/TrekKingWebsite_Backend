import { Router } from "express";
import { Role } from "@prisma/client";
import * as TestimonialController from "../controllers/testimonial.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/", TestimonialController.getTestimonials);
router.post("/", requireAuth, requireRole(Role.ADMIN), TestimonialController.createTestimonial);
router.delete("/:id", requireAuth, requireRole(Role.ADMIN), TestimonialController.deleteTestimonial);

export default router;
