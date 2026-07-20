import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as SiteContentModel from "../models/siteContent.model.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

// Same reasoning/pattern as `stringArrayField` in trip.controller.ts: the
// create/update route goes through multer (uploadSiteContentImages) because
// it accepts optional image files, so the request is multipart/form-data —
// every field, including objects/arrays, arrives in req.body as a plain
// string. The frontend JSON.stringifies aboutFeatures before appending it
// to FormData, so this preprocessor parses it back before validation.
const featureSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
});

const aboutFeaturesField = z.preprocess((val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON — fall through and let the array schema below reject it.
    }
  }
  return val;
}, z.array(featureSchema).max(6).optional());

const updateSchema = z.object({
  aboutIntro: z.string().max(2000).optional(),
  aboutBody: z.string().max(5000).optional(),
  aboutClosing: z.string().max(2000).optional(),
  aboutFeatures: aboutFeaturesField,
});

// Public — powers the About page and Homepage hero for every visitor.
export async function getSiteContent(_req: Request, res: Response, next: NextFunction) {
  try {
    const content = await SiteContentModel.getSiteContent();
    res.json({ status: "success", data: content });
  } catch (err) {
    next(err);
  }
}

// Admin-only (see requireRole(Role.ADMIN) on the route). Multipart: any
// subset of the text fields above, plus optional homeHeroImage /
// aboutHeroImage files (see upload.middleware.ts -> uploadSiteContentImages).
// Only fields actually sent are changed — a partial update, same as
// PATCH /trips/:id.
export async function updateSiteContent(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateSchema.parse(req.body);
    const files = req.files as
      | { homeHeroImage?: Express.Multer.File[]; aboutHeroImage?: Express.Multer.File[] }
      | undefined;

    const existing = await SiteContentModel.getSiteContent();
    const updates: Record<string, unknown> = { ...data };

    const homeHeroFile = files?.homeHeroImage?.[0];
    if (homeHeroFile) {
      const uploaded = await uploadBufferToCloudinary(homeHeroFile.buffer, "site/home-hero", "image");
      if (existing.homeHeroPublicId) {
        await deleteFromCloudinary(existing.homeHeroPublicId, "image");
      }
      updates.homeHeroImageUrl = uploaded.url;
      updates.homeHeroPublicId = uploaded.publicId;
    }

    const aboutHeroFile = files?.aboutHeroImage?.[0];
    if (aboutHeroFile) {
      const uploaded = await uploadBufferToCloudinary(aboutHeroFile.buffer, "site/about-hero", "image");
      if (existing.aboutHeroPublicId) {
        await deleteFromCloudinary(existing.aboutHeroPublicId, "image");
      }
      updates.aboutHeroImageUrl = uploaded.url;
      updates.aboutHeroPublicId = uploaded.publicId;
    }

    const updated = await SiteContentModel.upsertSiteContent(updates);
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}