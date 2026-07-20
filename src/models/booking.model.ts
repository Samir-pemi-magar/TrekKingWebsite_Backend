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
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
  notes?: string;
}

export function updateBooking(id: string, data: BookingUpdateInput) {
  return prisma.booking.update({ where: { id }, data, include: bookingInclude });
}

// A user is considered to have "completed" a trip (and is therefore allowed
// to leave a verified review) if they have at least one COMPLETED booking
// for that trip.
export function hasCompletedBookingForTrip(userId: string, tripId: string) {
  return prisma.booking.findFirst({
    where: { userId, tripId, status: BookingStatus.COMPLETED },
  });
}
