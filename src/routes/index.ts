import { Router } from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import tripRoutes from "./trip.routes.js";
import postRoutes from "./post.routes.js";
import inquiryRoutes from "./inquiry.routes.js";
import testimonialRoutes from "./testimonial.routes.js";
import bookingRoutes from "./booking.routes.js";
import reviewRoutes from "./review.routes.js";
import wishlistRoutes from "./wishlist.routes.js";
import siteContentRoutes from "./siteContent.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/trips", tripRoutes);
router.use("/posts", postRoutes);
router.use("/inquiries", inquiryRoutes);
router.use("/testimonials", testimonialRoutes);
router.use("/bookings", bookingRoutes);
router.use("/reviews", reviewRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/site-content", siteContentRoutes);

export default router;