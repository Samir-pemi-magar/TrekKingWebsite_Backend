import { Router } from "express";
import { Role } from "@prisma/client";
import * as BookingController from "../controllers/booking.controller.js";
import { requireAuth, requireRole, optionalAuth } from "../middleware/auth.middleware.js";
import { bookingRateLimiter } from "../middleware/rateLimiter.middleware.js";

const router = Router();

const organizerOrAdmin = requireRole(Role.ORGANIZER, Role.ADMIN);

// "mine" before "/:id" so it isn't parsed as a booking id.
router.get("/mine", requireAuth, BookingController.getMyBookings);
router.get("/", requireAuth, organizerOrAdmin, BookingController.getAllBookings);
router.get("/trip/:tripId", requireAuth, organizerOrAdmin, BookingController.getTripBookings);
router.get("/:id", requireAuth, BookingController.getBooking);

// Public — works for both guests and logged-in users (see controller).
router.post("/", bookingRateLimiter, optionalAuth, BookingController.createBooking);

router.patch("/:id", requireAuth, organizerOrAdmin, BookingController.updateBookingStatus);

export default router;
