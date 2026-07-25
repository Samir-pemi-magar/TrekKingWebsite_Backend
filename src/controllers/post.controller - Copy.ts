import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as PostModel from "../models/post.model.js";
import { uploadManyToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

const createPostSchema = z.object({
  caption: z.string().min(1).max(2000),
  tripId: z.string().uuid().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
});

// Public — the feed. Clients and organizers browse recent treks/tours here.
export async function getPosts(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, pageSize } = listQuerySchema.parse(req.query);
    const result = await PostModel.listPosts(page, pageSize);
    res.json({ status: "success", data: result });
  } catch (err) {
    next(err);
  }
}

export async function getPost(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const post = await PostModel.getPostById(id);
    if (!post) throw ApiError.notFound("Post not found");
    res.json({ status: "success", data: post });
  } catch (err) {
    next(err);
  }
}

// ORGANIZER or ADMIN only. Multipart: caption, optional tripId, optional
// photos[]/videos[] (see upload.middleware.ts -> uploadPostMedia).
export async function createPost(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPostSchema.parse(req.body);
    const files = req.files as { photos?: Express.Multer.File[]; videos?: Express.Multer.File[] } | undefined;

    const photoFiles = files?.photos ?? [];
    const videoFiles = files?.videos ?? [];
    if (photoFiles.length === 0 && videoFiles.length === 0) {
      throw ApiError.badRequest("Add at least one photo or video to your post");
    }

    const [uploadedPhotos, uploadedVideos] = await Promise.all([
      photoFiles.length ? uploadManyToCloudinary(photoFiles, "posts/photos", "image") : [],
      videoFiles.length ? uploadManyToCloudinary(videoFiles, "posts/videos", "video") : [],
    ]);

    const post = await PostModel.createPost({
      authorId: req.user!.userId,
      caption: data.caption,
      tripId: data.tripId,
      photos: uploadedPhotos.map((p, i) => ({ url: p.url, publicId: p.publicId, order: i })),
      videos: uploadedVideos.map((v, i) => ({
        url: v.url,
        publicId: v.publicId,
        thumbnailUrl: v.thumbnailUrl,
        order: i,
      })),
    });

    res.status(201).json({ status: "success", data: post });
  } catch (err) {
    next(err);
  }
}

// Author or Admin only.
export async function deletePost(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const post = await PostModel.getPostById(id);
    if (!post) throw ApiError.notFound("Post not found");

    const isAuthor = req.user?.userId === post.author.id;
    if (!isAuthor && req.user?.role !== Role.ADMIN) {
      throw ApiError.forbidden("You can only delete your own posts");
    }

    await Promise.all([
      ...post.photos.map((p) => (p.publicId ? deleteFromCloudinary(p.publicId, "image") : null)),
      ...post.videos.map((v) => (v.publicId ? deleteFromCloudinary(v.publicId, "video") : null)),
    ]);

    await PostModel.deletePost(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
