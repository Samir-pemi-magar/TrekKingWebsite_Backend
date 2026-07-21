import { Router } from "express";
import { Role } from "@prisma/client";
import * as BookingController from "../controllers/booking.controller.js";
import * as PaymentController from "../controllers/payment_controller.js";
import { requireAuth, requireRole, optionalAuth } from "../middleware/auth.middleware.js";
import { bookingRateLimiter } from "../middleware/rateLimiter.middleware.js";

const router = Router();

const organizerOrAdmin = requireRole(Role.ORGANIZER, Role.ADMIN);

// "mine" before "/:id" so it isn't parsed as a booking id. "payments/*" are
// two-segment paths, so they never collide with the single-segment "/:id"
// pattern regardless of where they're declared — grouped up here anyway for
// visibility alongside the other payment routes.

// Public — tells the frontend which gateways are actually configured, so
// it can hide (not just disable) buttons for ones the client hasn't set up.
router.get("/payments/methods", PaymentController.getPaymentMethodsConfig);

// Public — the frontend calls this once after eSewa redirects the customer
// back with a signed `data` payload; see payment.controller.ts for why the
// redirect alone isn't trusted.
router.post("/payments/esewa/verify", PaymentController.verifyEsewaPayment);

// Public — same reasoning, but Khalti's redirect carries a `pidx` instead
// of a signed payload; verification is a server-side lookup call instead
// of a signature check (Khalti's KPG-2 has no webhooks or signing at all).
router.post("/payments/khalti/verify", PaymentController.verifyKhaltiPayment);

// Public — same reasoning again; Fonepay's redirect carries its own
// PS/RC/UID/BC/INI/P_AMT/R_AMT/DV query params, verified both by signature
// (DV) and a follow-up server-to-server call, same two-step trust model as
// eSewa.
router.post("/payments/fonepay/verify", PaymentController.verifyFonepayPayment);

router.get("/mine", requireAuth, BookingController.getMyBookings);
router.get("/", requireAuth, organizerOrAdmin, BookingController.getAllBookings);
router.get("/trip/:tripId", requireAuth, organizerOrAdmin, BookingController.getTripBookings);
router.get("/:id", requireAuth, BookingController.getBooking);

// Public — works for both guests and logged-in users (see controller).
router.post("/", bookingRateLimiter, optionalAuth, BookingController.createBooking);

// Public — called right after createBooking to get a Stripe Checkout URL.
// No auth: same trust model as an emailed order-confirmation link (see
// payment.controller.ts for the reasoning).
router.post("/:id/checkout/stripe", PaymentController.createStripeCheckoutSession);

// Public — same trust model, returns signed form fields instead of a
// ready-made redirect URL (eSewa needs a real browser form POST).
router.post("/:id/checkout/esewa", PaymentController.createEsewaCheckoutSession);

// Public — same trust model, returns a ready-made redirect URL like Stripe
// (Khalti's initiate call hands back a payment_url directly).
router.post("/:id/checkout/khalti", PaymentController.createKhaltiCheckoutSession);

// Public — same trust model, returns a ready-made redirect URL like
// Stripe/Khalti (Fonepay's signature is baked into the URL itself, so
// there's no separate session/initiate call needed before redirecting).
router.post("/:id/checkout/fonepay", PaymentController.createFonepayCheckoutSession);

router.patch("/:id", requireAuth, organizerOrAdmin, BookingController.updateBookingStatus);

export default router;