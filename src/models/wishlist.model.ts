import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const wishlistInclude = {
  trip: {
    include: {
      photos: { orderBy: { order: "asc" }, take: 1 },
    },
  },
} satisfies Prisma.WishlistInclude;

export function listWishlist(userId: string) {
  return prisma.wishlist.findMany({
    where: { userId },
    include: wishlistInclude,
    orderBy: { createdAt: "desc" },
  });
}

export function findWishlistEntry(userId: string, tripId: string) {
  return prisma.wishlist.findUnique({ where: { userId_tripId: { userId, tripId } } });
}

export function addToWishlist(userId: string, tripId: string) {
  return prisma.wishlist.create({ data: { userId, tripId }, include: wishlistInclude });
}

export function removeFromWishlist(userId: string, tripId: string) {
  return prisma.wishlist.delete({ where: { userId_tripId: { userId, tripId } } });
}
