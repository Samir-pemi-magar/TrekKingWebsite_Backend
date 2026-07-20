import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const postInclude = {
  author: { select: { id: true, name: true, avatarUrl: true, role: true } },
  trip: { select: { id: true, name: true } },
  photos: { orderBy: { order: "asc" } },
  videos: { orderBy: { order: "asc" } },
} satisfies Prisma.PostInclude;

export async function listPosts(page = 1, pageSize = 20) {
  const [items, total] = await Promise.all([
    prisma.post.findMany({
      include: postInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.post.count(),
  ]);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export function getPostById(id: string) {
  return prisma.post.findUnique({ where: { id }, include: postInclude });
}

export interface PostCreateInput {
  authorId: string;
  caption: string;
  tripId?: string;
  photos: { url: string; publicId: string; order: number }[];
  videos: { url: string; publicId: string; thumbnailUrl?: string; order: number }[];
}

export function createPost(data: PostCreateInput) {
  return prisma.post.create({
    data: {
      authorId: data.authorId,
      caption: data.caption,
      tripId: data.tripId,
      photos: { create: data.photos },
      videos: { create: data.videos },
    },
    include: postInclude,
  });
}

export function deletePost(id: string) {
  return prisma.post.delete({ where: { id } });
}
