import { NextFunction, Request, Response } from "express";
import { BookingStatus, PaymentStatus, PaymentMethod, Role } from "@prisma/client";
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
});

const statusUpdateSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  amountPaid: z.coerce.number().int().nonnegative().optional(),
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

    const contactEmail = req.user?.email ?? data.guestEmail!;
    const contactName = data.guestName ?? "there";
    void sendMail(
      contactEmail,
      "Booking received",
      templates.bookingReceived(contactName, trip.name, booking.status)
    );

    res.status(201).json({ status: "success", data: booking });
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
    const updated = await BookingModel.updateBooking(id, data);

    recordAuditLog({
      actorId: req.user?.userId,
      action: "booking.updated",
      entityType: "Booking",
      entityId: id,
      meta: data,
    });

    if (data.status) {
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

    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}
