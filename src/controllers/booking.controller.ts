import { NextFunction, Request, Response } from "express";
import { BookingStatus, ChangeRequestStatus, PaymentMethod, PaymentStatus, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as BookingModel from "../models/booking.model.js";
import * as TripModel from "../models/trip.model.js";
import { sendMail, templates } from "../config/mailer.js";
import { recordAuditLog } from "../utils/auditLog.js";
import { env } from "../config/env.js";

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

// Logged-in customers only (see requestBookingChange) — how many *more*
// travelers they want added to a booking they already own. Capped at 50
// like the original booking schema; the model layer separately re-checks
// this against real seat availability at review time, not just here.
const changeRequestSchema = z.object({
  additionalTravelers: z.coerce.number().int().positive().max(50),
  note: z.string().max(500).optional(),
});

const changeRequestReviewSchema = z.object({
  decision: z.enum(["APPROVED", "DECLINED"]),
  note: z.string().max(500).optional(),
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
      const departure = trip.departures.find((d: any) => d.id === data.departureId);
      if (!departure) throw ApiError.badRequest("Referenced departure does not exist for this trip");

      const seatsRemaining = await TripModel.getDepartureSeatsRemaining(data.departureId);
      if (seatsRemaining !== null && seatsRemaining < data.travelers) {
        throw ApiError.badRequest(`Only ${seatsRemaining} seat(s) remaining for this departure`);
      }
    }

    // Same trip + the exact same departure (day/month/year, since a
    // departure IS a fixed date) + the same customer already has a
    // non-cancelled booking for it: don't create (or silently modify) a
    // second row — just hand back the existing one untouched. This is what
    // used to pile up as "10 bookings for one trip" clutter on the account
    // page whenever someone hit "book again" for a trip they'd already
    // booked, or clicked the button repeatedly.
    //
    // Changing the size of a booking that already exists is now always a
    // deliberate, reviewed action (see requestBookingChange below) rather
    // than something that happens as a side effect of resubmitting the
    // booking form — so no travelers are added here, for logged-in users
    // or guests alike. `alreadyBooked: true` lets the frontend show
    // "You've already booked this date" and, for logged-in users, point
    // them at "Request more travelers" instead of silently doing nothing.
    //
    // A cancelled booking is never matched against — if they cancelled and
    // want back in, that's genuinely a new booking, not "more of the same".
    let existingActive = null as Awaited<ReturnType<typeof BookingModel.findActiveBookingForUserDeparture>> | null;
    if (data.departureId) {
      if (req.user) {
        existingActive = await BookingModel.findActiveBookingForUserDeparture(
          req.user.userId,
          data.departureId,
        );
      } else if (data.guestEmail) {
        existingActive = await BookingModel.findActiveBookingForGuestDeparture(
          data.guestEmail,
          data.departureId,
        );
      }
    }

    if (existingActive) {
      res.status(200).json({ status: "success", data: existingActive, alreadyBooked: true, merged: false });
      return;
    }

    const booking = await BookingModel.createBooking({
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

    // Every booking that reaches this point is genuinely fresh (the
    // duplicate/idempotency cases above all return earlier), so the
    // "booking received" email always applies here.
    const contactEmail = req.user?.email ?? data.guestEmail!;
    const contactName = data.guestName ?? "there";
    void sendMail(
      contactEmail,
      "Booking received",
      templates.bookingReceived(contactName, trip.name, booking.status)
    );

    // `merged` is kept in the response shape (always false now) purely so
    // older frontend code checking for it doesn't break; new code should
    // key off `alreadyBooked` instead, set above when nothing was created.
    res.status(201).json({ status: "success", data: booking, merged: false });
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

    // A drop in amountPaid means money is being taken back off the books —
    // that's a refund or a correction, either way it shouldn't happen as a
    // silent side effect of some other edit. This mirrors the CANCELLED
    // guard below, but applies regardless of what `status` is being set to
    // in the same request (a decrease on a CONFIRMED/COMPLETED booking is
    // just as much a real refund as one on a CANCELLED booking).
    if (
      data.amountPaid !== undefined &&
      data.amountPaid < existing.amountPaid &&
      data.markRefunded !== true
    ) {
      throw ApiError.badRequest(
        `Lowering amountPaid from $${existing.amountPaid} to $${data.amountPaid} needs markRefunded: true to confirm this is an intentional refund/correction`
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

// ── Change requests (traveler-count increases) ──────────────────────────
// Logged-in customers only — the account they booked under has to own the
// booking. Guests have no session to authenticate this with, so they're
// pointed at contacting support directly instead (see createBooking above).
//
// This deliberately never touches the booking itself. It only ever creates
// a BookingChangeRequest row for an Organizer/Admin to act on via
// reviewChangeRequest — no seats are held, no price changes, nothing is
// emailed to the customer as a confirmation, because nothing has actually
// changed yet.
export async function requestBookingChange(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const id = requireStringParam(req.params.id);
    const data = changeRequestSchema.parse(req.body);

    const booking = await BookingModel.getBookingById(id);
    if (!booking) throw ApiError.notFound("Booking not found");
    if (booking.userId !== req.user.userId) {
      throw ApiError.forbidden("You can only request changes on your own bookings");
    }
    if (booking.status === BookingStatus.CANCELLED) {
      throw ApiError.badRequest("This booking is cancelled — start a new booking instead");
    }

    // At most one open request per booking at a time. A customer who wants
    // to change their mind about the number has to wait for the pending
    // one to be reviewed (or, if it's still genuinely pending, this also
    // stops a double-click/resubmit from creating a second identical row —
    // the same "one attempt, one effect" idea idempotencyKey gives
    // createBooking, just enforced here by a plain existence check instead,
    // since a change request has no client-generated key of its own).
    const existingPending = await BookingModel.findPendingChangeRequestForBooking(id);
    if (existingPending) {
      throw ApiError.badRequest(
        "You already have a pending request for this booking — wait for it to be reviewed before submitting another"
      );
    }

    // Advisory only: tells the customer up front if there's obviously not
    // enough room, so they're not left waiting on a request that was
    // always going to be declined. The real, authoritative check happens
    // again in reviewChangeRequest at approval time, since seats can sell
    // out in the meantime.
    if (booking.departureId) {
      const seatsRemaining = await TripModel.getDepartureSeatsRemaining(booking.departureId);
      if (seatsRemaining !== null && seatsRemaining < data.additionalTravelers) {
        throw ApiError.badRequest(`Only ${seatsRemaining} seat(s) remaining for this departure`);
      }
    }

    const changeRequest = await BookingModel.createChangeRequest({
      bookingId: id,
      requestedTravelers: booking.travelers + data.additionalTravelers,
      additionalTravelers: data.additionalTravelers,
      note: data.note,
      requestedByUserId: req.user.userId,
    });

    recordAuditLog({
      actorId: req.user.userId,
      action: "booking.changeRequest.created",
      entityType: "Booking",
      entityId: id,
      meta: { additionalTravelers: data.additionalTravelers, changeRequestId: changeRequest.id },
    });

    // Best-effort notice to the admin inbox. Never blocks the response;
    // sendMail failures shouldn't turn into a 500 for the customer over
    // what's already a successfully-recorded request. (Routed to the admin
    // inbox rather than the organizer directly, since this controller
    // doesn't otherwise touch User/organizer contact details — staff can
    // still see and act on it via listChangeRequests either way.)
    const recipient = env.ADMIN_NOTIFICATION_EMAIL;
    if (recipient) {
      void sendMail(
        recipient,
        "Booking change request awaiting review",
        `<p>${booking.user?.name ?? booking.guestName ?? "A customer"} requested +${data.additionalTravelers} traveler(s) on their booking for <strong>${booking.trip.name}</strong> (currently ${booking.travelers} → ${booking.travelers + data.additionalTravelers}).</p>` +
          (data.note ? `<p>Note: ${data.note}</p>` : "") +
          `<p>Review it from the Bookings panel.</p>`
      );
    }

    res.status(201).json({ status: "success", data: changeRequest });
  } catch (err) {
    next(err);
  }
}

// Organizer (their trips only) or Admin (everything) — mirrors
// getAllBookings' scoping. Defaults to PENDING so the dashboard badge/count
// only reflects things actually waiting on staff.
export async function listChangeRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const statusParam = req.query.status;
    const status =
      statusParam === "ALL"
        ? null
        : statusParam
          ? z.nativeEnum(ChangeRequestStatus).parse(statusParam)
          : ChangeRequestStatus.PENDING;
    const organizerId = req.user!.role === Role.ADMIN ? undefined : req.user!.userId;
    const requests = await BookingModel.listChangeRequests({ status, organizerId });
    res.json({ status: "success", data: requests });
  } catch (err) {
    next(err);
  }
}

// Organizer/Admin only. Approving actually applies the traveler increase
// (reusing the same addTravelersToBooking used by the old auto-merge path,
// now only ever invoked here, deliberately, after a human has looked at
// it); declining just closes the request out with no effect on the
// booking.
export async function reviewChangeRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const { decision, note } = changeRequestReviewSchema.parse(req.body);

    const changeRequest = await BookingModel.getChangeRequestById(id);
    if (!changeRequest) throw ApiError.notFound("Change request not found");
    if (changeRequest.status !== ChangeRequestStatus.PENDING) {
      throw ApiError.badRequest("This request has already been reviewed");
    }

    const booking = changeRequest.booking;
    await assertCanManageTripBookings(req, booking.tripId);

    if (decision === "APPROVED") {
      // Re-check seats now, not just at request time — availability can
      // have moved in either direction while this sat waiting for review.
      if (booking.departureId) {
        const seatsRemaining = await TripModel.getDepartureSeatsRemaining(booking.departureId);
        if (seatsRemaining !== null && seatsRemaining < changeRequest.additionalTravelers) {
          throw ApiError.badRequest(
            `Only ${seatsRemaining} seat(s) remaining for this departure now — can't approve +${changeRequest.additionalTravelers}`
          );
        }
      }

      const updatedBooking = await BookingModel.addTravelersToBooking(
        booking.id,
        changeRequest.additionalTravelers,
        booking.trip.price,
      );

      const reviewed = await BookingModel.reviewChangeRequest(id, {
        status: ChangeRequestStatus.APPROVED,
        reviewedByUserId: req.user!.userId,
        reviewNote: note,
      });

      recordAuditLog({
        actorId: req.user?.userId,
        action: "booking.changeRequest.approved",
        entityType: "Booking",
        entityId: booking.id,
        meta: { additionalTravelers: changeRequest.additionalTravelers, changeRequestId: id },
      });

      const contactEmail = updatedBooking.user?.email ?? updatedBooking.guestEmail;
      const contactName = updatedBooking.user?.name ?? updatedBooking.guestName ?? "there";
      if (contactEmail) {
        void sendMail(
          contactEmail,
          "Your booking change was approved",
          `<p>Hi ${contactName},</p><p>Your request to add ${changeRequest.additionalTravelers} traveler(s) to your booking for <strong>${updatedBooking.trip.name}</strong> has been approved. Your booking is now for ${updatedBooking.travelers} traveler(s), totaling $${updatedBooking.totalPrice}.</p>`
        );
      }

      res.json({ status: "success", data: { changeRequest: reviewed, booking: updatedBooking } });
    } else {
      const reviewed = await BookingModel.reviewChangeRequest(id, {
        status: ChangeRequestStatus.DECLINED,
        reviewedByUserId: req.user!.userId,
        reviewNote: note,
      });

      recordAuditLog({
        actorId: req.user?.userId,
        action: "booking.changeRequest.declined",
        entityType: "Booking",
        entityId: booking.id,
        meta: { additionalTravelers: changeRequest.additionalTravelers, changeRequestId: id },
      });

      const contactEmail = booking.user?.email ?? booking.guestEmail;
      const contactName = booking.user?.name ?? booking.guestName ?? "there";
      if (contactEmail) {
        void sendMail(
          contactEmail,
          "Your booking change request was declined",
          `<p>Hi ${contactName},</p><p>Your request to add ${changeRequest.additionalTravelers} traveler(s) to your booking for <strong>${booking.trip.name}</strong> wasn't approved.</p>` +
            (note ? `<p>Note from our team: ${note}</p>` : "") +
            `<p>Feel free to reach out if you have questions.</p>`
        );
      }

      res.json({ status: "success", data: { changeRequest: reviewed, booking } });
    }
  } catch (err) {
    next(err);
  }
}