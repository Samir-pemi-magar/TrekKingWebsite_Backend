import { Prisma, BookingStatus, PaymentStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const bookingInclude = {
  trip: { select: { id: true, name: true, price: true, organizerId: true } },
  departure: { select: { id: true, startDate: true, endDate: true, guideId: true } },
  user: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.BookingInclude;

export interface BookingCreateInput {
  tripId: string;
  departureId?: string;
  userId?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  travelers: number;
  totalPrice: number;
  notes?: string;
}

export function createBooking(data: BookingCreateInput) {
  return prisma.booking.create({ data, include: bookingInclude });
}

export function getBookingById(id: string) {
  return prisma.booking.findUnique({ where: { id }, include: bookingInclude });
}

export function listMyBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });
}

// For an Organizer/Admin dashboard — all bookings for one trip (optionally
// scoped further by departure).
export function listBookingsForTrip(tripId: string, departureId?: string) {
  return prisma.booking.findMany({
    where: { tripId, ...(departureId ? { departureId } : {}) },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });
}

export function listAllBookings(filters?: { status?: BookingStatus; organizerId?: string }) {
  return prisma.booking.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.organizerId ? { trip: { organizerId: filters.organizerId } } : {}),
    },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });
}

export interface BookingUpdateInput {
  status?: BookingStatus;
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
  // The only manual override left for payment status. A refund isn't a
  // function of amountPaid alone (money already left the account), so it
  // can't be derived the same way UNPAID/PARTIAL/PAID can.
  markRefunded?: boolean;
  notes?: string;
}

// Single source of truth for payment status. amountPaid is the only value
// staff (or a gateway webhook) ever write — this keeps status from ever
// drifting out of sync with the money, since it's recomputed from the
// numbers every time instead of being a second field someone can forget.
export function derivePaymentStatus(amountPaid: number, totalPrice: number): PaymentStatus {
  if (amountPaid <= 0) return PaymentStatus.UNPAID;
  if (amountPaid >= totalPrice) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

// totalPrice is threaded in by the caller (already has it from
// getBookingById) rather than re-queried here, since it never changes
// after booking creation.
export function updateBooking(id: string, data: BookingUpdateInput, totalPrice: number) {
  const { markRefunded, amountPaid, ...rest } = data;
  const updateData: Prisma.BookingUpdateInput = { ...rest };

  if (amountPaid !== undefined) {
    updateData.amountPaid = amountPaid;
    updateData.paymentStatus = markRefunded
      ? PaymentStatus.REFUNDED
      : derivePaymentStatus(amountPaid, totalPrice);
  } else if (markRefunded) {
    updateData.paymentStatus = PaymentStatus.REFUNDED;
  }

  return prisma.booking.update({ where: { id }, data: updateData, include: bookingInclude });
}

// A user is considered to have "completed" a trip (and is therefore allowed
// to leave a verified review) if they have at least one COMPLETED booking
// for that trip.
export function hasCompletedBookingForTrip(userId: string, tripId: string) {
  return prisma.booking.findFirst({
    where: { userId, tripId, status: BookingStatus.COMPLETED },
  });
}