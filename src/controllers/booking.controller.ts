import { NextFunction, Request, Response } from "express";
import { BookingStatus, PaymentMethod, PaymentStatus, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as BookingModel from "../models/booking.model.js";
import * as TripModel from "../models/trip.model.js";
import { sendMail, templates } from "../config/mailer.js";
import { recordAuditLog } from "../utils/auditLog.js";

// Contact-info requirements differ for guests vs logged-in users, so that's
// validated conditionally inside the handler rather than via .refine() here.
const baseBookingSchema = z.object({
  tripId: z.string().uuid(),
  departureId: z.string().uuid().optional(),
  travelers: z.coerce.number().int().positive().max(50).default(1),
  guestName: z.string().min(1).optional(),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().min(5).optional(),
  notes: z.string().max(1000).optional(),
  // One per checkout attempt on the client, reused verbatim on any retry
  // of that same attempt (never regenerated for a genuinely new booking).
  // Optional so older/other clients that haven't been updated yet don't
  // break, but the frontend should always send one going forward.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const statusUpdateSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  amountPaid: z.coerce.number().int().nonnegative().optional(),
  // Payment status is never accepted directly — it's derived server-side
  // from amountPaid vs totalPrice. markRefunded is the one deliberate
  // override, since a refund can't be inferred from the amount alone.
  markRefunded: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

async function assertCanManageTripBookings(req: Request, tripId: string) {
  const trip = await TripModel.getTripById(tripId);
  if (!trip) throw ApiError.notFound("Trip not found");
  if (req.user?.role === Role.ADMIN) return trip;
  if (req.user?.role === Role.ORGANIZER && trip.organizerId === req.user.userId) return trip;
  throw ApiError.forbidden("You can only manage bookings for trips you organize");
}

// Public (optionalAuth) — logged-in users book against their account; guests
// must supply guestName + guestEmail. Paired with rate limiting in routes.
export async function createBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const data = baseBookingSchema.parse(req.body);

    if (!req.user && (!data.guestName || !data.guestEmail)) {
      throw ApiError.badRequest("guestName and guestEmail are required when not logged in");
    }

    // Has this exact checkout attempt already been processed — whether it
    // resulted in a fresh booking OR got merged into an existing one (see
    // below)? Checked before re-validating seat availability, so a retry
    // of the request that took the last seat doesn't get wrongly rejected
    // as sold-out for a seat it already has.
    if (data.idempotencyKey) {
      const attempt = await BookingModel.findBookingAttempt(data.idempotencyKey);
      if (attempt) {
        const existing = await BookingModel.getBookingById(attempt.bookingId);
        if (existing) {
          res.status(200).json({ status: "success", data: existing, merged: false });
          return;
        }
      }
    }

    const trip = await TripModel.getTripById(data.tripId);
    if (!trip) throw ApiError.badRequest("Referenced trip does not exist");

    if (data.departureId) {
      const departure = trip.departures.find((d) => d.id === data.departureId);
      if (!departure) throw ApiError.badRequest("Referenced departure does not exist for this trip");

      const seatsRemaining = await TripModel.getDepartureSeatsRemaining(data.departureId);
      if (seatsRemaining !== null && seatsRemaining < data.travelers) {
        throw ApiError.badRequest(`Only ${seatsRemaining} seat(s) remaining for this departure`);
      }
    }

    // Same trip + the exact same departure (day/month/year, since a
    // departure IS a fixed date) + the same logged-in customer + they
    // already have a non-cancelled booking for it: fold the extra
    // travelers into that booking instead of creating a second
    // near-identical row. This is what used to pile up as "10 bookings
    // for one trip" clutter on the account page whenever someone hit
    // "book again" for a trip they'd already booked.
    //
    // Deliberately scoped to logged-in users with a fixed departureId only:
    // - Guests have no reliable identity to match an existing booking
    //   against, so every guest checkout still creates its own row.
    // - Flexible/no-fixed-date trips (departureId absent) have no "same
    //   date" to compare, so there's nothing to merge into.
    // A cancelled booking is never merged into — if they cancelled and
    // want back in, that's genuinely a new booking, not "more of the same".
    let booking;
    let merged = false;
    if (req.user && data.departureId) {
      const existingActive = await BookingModel.findActiveBookingForUserDeparture(
        req.user.userId,
        data.departureId,
      );
      if (existingActive) {
        booking = await BookingModel.addTravelersToBooking(
          existingActive.id,
          data.travelers,
          trip.price,
        );
        merged = true;
      }
    }

    if (!booking) {
      booking = await BookingModel.createBooking({
        tripId: data.tripId,
        departureId: data.departureId,
        userId: req.user?.userId,
        guestName: data.guestName,
        guestEmail: data.guestEmail,
        guestPhone: data.guestPhone,
        travelers: data.travelers,
        totalPrice: trip.price * data.travelers,
        notes: data.notes,
      });
    }

    if (data.idempotencyKey) {
      try {
        await BookingModel.recordBookingAttempt(data.idempotencyKey, booking.id);
      } catch (err) {
        // A concurrent request carrying the identical idempotencyKey won
        // this race and recorded its attempt first — defer to whatever
        // THAT request produced (create or merge) instead of the result
        // this request just computed, so the two requests can't both
        // succeed and double up the effect.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const winningAttempt = await BookingModel.findBookingAttempt(data.idempotencyKey);
          const winningBooking = winningAttempt
            ? await BookingModel.getBookingById(winningAttempt.bookingId)
            : null;
          if (winningBooking) {
            res.status(200).json({ status: "success", data: winningBooking, merged: false });
            return;
          }
        }
        throw err;
      }
    }

    // Only send the "booking received" email for a genuinely fresh
    // booking — merging into an existing one isn't a new booking, and a
    // separate "we added N travelers" notification would need its own
    // template rather than reusing this one.
    if (!merged) {
      const contactEmail = req.user?.email ?? data.guestEmail!;
      const contactName = data.guestName ?? "there";
      void sendMail(
        contactEmail,
        "Booking received",
        templates.bookingReceived(contactName, trip.name, booking.status)
      );
    }

    // `merged: true` tells the frontend this attempt added travelers to an
    // existing booking rather than creating a new row — useful for showing
    // a different confirmation message ("Added 2 travelers to your
    // existing booking" vs "Booking created").
    res.status(merged ? 200 : 201).json({ status: "success", data: booking, merged });
  } catch (err) {
    next(err);
  }
}

// Logged-in user's own booking history.
export async function getMyBookings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const bookings = await BookingModel.listMyBookings(req.user.userId);
    res.json({ status: "success", data: bookings });
  } catch (err) {
    next(err);
  }
}

// Organizer (their trips only) or Admin (everything). ?status= filter.
export async function getAllBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.query.status ? statusUpdateSchema.shape.status.parse(req.query.status) : undefined;
    const organizerId = req.user!.role === Role.ADMIN ? undefined : req.user!.userId;
    const bookings = await BookingModel.listAllBookings({ status, organizerId });
    res.json({ status: "success", data: bookings });
  } catch (err) {
    next(err);
  }
}

// Bookings for one specific trip (an organizer's roster for that trip).
export async function getTripBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.tripId);
    await assertCanManageTripBookings(req, tripId);
    const bookings = await BookingModel.listBookingsForTrip(tripId, req.query.departureId as string | undefined);
    res.json({ status: "success", data: bookings });
  } catch (err) {
    next(err);
  }
}

export async function getBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const booking = await BookingModel.getBookingById(id);
    if (!booking) throw ApiError.notFound("Booking not found");

    const isOwner = booking.userId && booking.userId === req.user?.userId;
    if (!isOwner) {
      await assertCanManageTripBookings(req, booking.tripId);
    }

    res.json({ status: "success", data: booking });
  } catch (err) {
    next(err);
  }
}

// Organizer/Admin only — confirm, cancel, mark completed, and/or record
// payment progress (e.g. after a bank transfer or cash payment is verified).
export async function updateBookingStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const existing = await BookingModel.getBookingById(id);
    if (!existing) throw ApiError.notFound("Booking not found");

    await assertCanManageTripBookings(req, existing.tripId);

    const data = statusUpdateSchema.parse(req.body);

    if (data.amountPaid !== undefined && data.amountPaid > existing.totalPrice) {
      throw ApiError.badRequest(
        `amountPaid ($${data.amountPaid}) cannot exceed the booking's totalPrice ($${existing.totalPrice})`
      );
    }

    // A dollar amount with no method attached is unreconcilable later —
    // require one before it's recorded, unless the booking already has a
    // method on file from an earlier save (so tweaking the amount later
    // doesn't force re-picking the same method every time). Gateway
    // webhooks/verify handlers never hit this path — they call
    // BookingModel.updateBooking directly and always pass their own
    // paymentMethod, so this only constrains manual staff edits here.
    if (
      data.amountPaid !== undefined &&
      data.amountPaid > 0 &&
      !data.paymentMethod &&
      !existing.paymentMethod
    ) {
      throw ApiError.badRequest("Select a payment method before recording an amount paid");
    }

    // Cancelling a booking that still has money sitting on it is the kind
    // of thing that should never happen by accident — require markRefunded
    // to be sent in the same request as confirmation that the money side
    // has been (or is being) handled, rather than silently letting status
    // and payment drift apart.
    if (
      data.status === BookingStatus.CANCELLED &&
      existing.amountPaid > 0 &&
      existing.paymentStatus !== PaymentStatus.REFUNDED &&
      data.markRefunded !== true
    ) {
      throw ApiError.badRequest(
        `This booking has $${existing.amountPaid} collected — include markRefunded: true to confirm the refund alongside cancelling`
      );
    }

    // Can't mark a trip "completed" before it's actually happened. Uses the
    // departure's end date (or start date, for a departure with no end
    // date set) — a booking with no departure at all (flexible/AVAILABLE
    // trips have no fixed dates) has nothing to check against, so it's
    // left up to staff judgement in that case.
    if (data.status === BookingStatus.COMPLETED) {
      const departureDate = existing.departure?.endDate ?? existing.departure?.startDate;
      if (departureDate && new Date(departureDate).getTime() > Date.now()) {
        throw ApiError.badRequest(
          `This trip doesn't depart until ${new Date(departureDate).toLocaleDateString()} — it can't be marked completed before then`
        );
      }
    }

    const updated = await BookingModel.updateBooking(id, data, existing.totalPrice, existing.status);

    recordAuditLog({
      actorId: req.user?.userId,
      action: "booking.updated",
      entityType: "Booking",
      entityId: id,
      meta: { ...data, derivedPaymentStatus: updated.paymentStatus },
    });

    // Checks the *actual* change, not just whether the admin sent a status
    // field — this also catches the auto-confirm case (a booking reaching
    // full payment while PENDING flips itself to CONFIRMED inside
    // BookingModel.updateBooking without `data.status` ever being set).
    if (updated.status !== existing.status) {
      const contactEmail = updated.user?.email ?? existing.guestEmail;
      const contactName = updated.user?.name ?? existing.guestName ?? "there";
      if (contactEmail) {
        void sendMail(
          contactEmail,
          "Booking status update",
          templates.bookingStatusUpdate(contactName, updated.trip.name, updated.status)
        );
      }
    }

    // Receipt for a manually-recorded payment (wire transfer, cash, etc).
    // Keyed off the actual increase, not just "amountPaid was sent" — so
    // this doesn't fire on a no-op save or on a refund (amountPaid staying
    // flat or dropping while markRefunded is set).
    const paidNow = updated.amountPaid - existing.amountPaid;
    if (data.amountPaid !== undefined && paidNow > 0) {
      const contactEmail = updated.user?.email ?? existing.guestEmail;
      const contactName = updated.user?.name ?? existing.guestName ?? "there";
      if (contactEmail) {
        void sendMail(
          contactEmail,
          "Payment received",
          templates.paymentReceived(contactName, updated.trip.name, paidNow, updated.paymentStatus)
        );
      }
    }

    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}